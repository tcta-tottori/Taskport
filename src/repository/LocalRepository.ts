import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Repository } from './Repository'
import { normalizeCalendar } from '../lib/workCalendar'
import { cleanCategories, defaultCategoryGroups, normalizeGroups } from '../lib/workCategories'
import {
  DEFAULT_SETTINGS,
  DEFAULT_WORK_HOURS,
  RECORDING_KEEP,
  TEMPLATE_KEEP,
  type Plan,
  type Recording,
  type Settings,
  type Task,
  type TaskTemplate,
  type PlanRun,
} from '../types'

/* =========================================================
 * 保存先。端末内 IndexedDB のみ。サーバには置かない。
 *
 * 【バージョンを上げない】
 * 以前は台帳と録音を1つのDBに入れ、録音を足すときに版を1→2へ上げた。
 * その結果、別のタブが古い版を掴んでいるとアップグレードが永久に待たされ、
 * 「読み込んでいます…」から先へ進めなくなった（v1.2.0 の不具合）。
 *
 * そこで版を固定するのをやめ、
 *   - 台帳（tasks / meta）… 版を指定せずに開く。既にある版のまま使う
 *   - 録音（recordings / audio）… 別のDBに分ける
 * にした。版が上がらないので、以後アップグレード待ちで固まることがない。
 * 保存する先が増えても、新しいDBを足せば台帳には触らずに済む。
 * =======================================================*/

const MAIN_DB = 'taskport'
/** meta ストアの中で墓標を置くキー。保存先を増やさずに済ませる */
const TOMBSTONE_KEY = 'tombstones'
/** meta ストアの中で「記憶したタスク」を置くキー */
const TEMPLATE_KEY = 'templates'
const MEDIA_DB = 'taskport-media'
/**
 * 予定と実行ログ。**台帳とは別のDB**にする。
 * 保存先が増えるたびに台帳の版を上げると、古い版を掴んだタブがあるだけで
 * アップグレード待ちで固まる（v1.2.0 の不具合）。DBを足すぶんには何も起きない。
 */
const WORK_DB = 'taskport-work'

/** 開けなかったときに諦めるまでの回数（端末が寝起きのときは1回目だけ落ちることがある） */
const OPEN_TRIES = 3

interface MainDB extends DBSchema {
  tasks: {
    key: string
    value: Task
    indexes: { by_due: string; by_status: string }
  }
  meta: {
    key: string
    value: unknown
  }
}

interface WorkDB extends DBSchema {
  plans: {
    key: string
    value: Plan
    indexes: { by_day: string }
  }
  runs: {
    key: string
    value: PlanRun
    indexes: { by_day: string; by_plan: string }
  }
}

interface MediaDB extends DBSchema {
  recordings: {
    key: string
    value: Recording
  }
  /** 音声の実体。キーは録音ID。一覧を読むときに載せたくないので別ストアにする。 */
  audio: {
    key: string
    value: Blob
  }
}

/**
 * 保存データを開けなかったときのエラー。
 *
 * 画面で案内を出し分けるために原因を持たせる。ここを曖昧にすると
 * 「開けませんでした」だけが出て、利用者にも作った側にも手が打てなくなる。
 */
export type DbFailKind =
  /** ほかのタブ／窓が掴んでいる */
  | 'blocked'
  /** そもそも IndexedDB が使えない（プライベートモードなど） */
  | 'unavailable'
  /** ブラウザが理由を返してきた（容量不足・保存領域の破損など） */
  | 'error'

export class DbOpenError extends Error {
  readonly kind: DbFailKind
  /** ブラウザが返した素の理由（画面にそのまま出して、原因の切り分けに使う） */
  readonly detail: string

  constructor(kind: DbFailKind, detail = '') {
    super(MESSAGE[kind])
    this.name = 'DbOpenError'
    this.kind = kind
    this.detail = detail
  }
}

const MESSAGE: Record<DbFailKind, string> = {
  blocked:
    'ほかのタブで開いている Taskport が、データをさえぎっています。' +
    '他のタブをすべて閉じてから、もう一度試してください。',
  unavailable:
    'このブラウザでは保存機能が使えません。プライベートモードを使っている場合は、通常のタブで開いてください。',
  error:
    '保存データを開けませんでした。端末の空き容量を確かめて、もう一度試してください。' +
    '直らないときは、下の「保存データを作り直す」で作り直せます。',
}

/** 保存機能そのものが使えるか */
function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 端末の保存領域の使用量。開けなかった理由の切り分けに使う。
 * 空きが尽きていると IndexedDB は開かないことがあるが、
 * ブラウザはその理由を返さずに黙って止まることがある。
 */
export async function storageNote(): Promise<string> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return ''
    const mb = (n: number) => `${Math.round(n / 1_048_576)}MB`
    const free = est.quota - est.usage
    return `保存領域 ${mb(est.usage)} / ${mb(est.quota)}（空き ${mb(free)}）`
  } catch {
    return ''
  }
}

/* ---------------------------------------------------------
 * 開いている最中の様子を画面へ伝える
 *
 * v1.6.0 では「8秒で開かなければ失敗」にしていた。ところが実機では、
 * ホーム画面から起動した直後は端末が重く、健全なDBでも8秒を超えることが
 * あった。しかも諦めるときに、開きかけの接続をこちらから閉じていたため、
 * あと少しで開くはずのものを自分で壊していた。
 *
 * そこで「待つのをやめる」のはやめた。開くまで待ち続け、時間がかかって
 * いることだけを画面に伝える。開けたらその時点で画面が直る。
 * ------------------------------------------------------- */

export type DbStatus =
  /** まだ開こうとしていない */
  | 'idle'
  /** 開いている最中 */
  | 'opening'
  /** 時間がかかっている（待ちは続けている） */
  | 'slow'
  /** ほかのタブにさえぎられている（待ちは続けている） */
  | 'blocked'
  | 'ready'
  /** ブラウザが理由を返して開けなかった */
  | 'failed'

/** ここを過ぎたら「時間がかかっています」を出す。待ちはやめない。 */
const SLOW_MS = 6000

let status: DbStatus = 'idle'
let lastError: DbOpenError | null = null
const watchers = new Set<(s: DbStatus, e: DbOpenError | null) => void>()

function setStatus(next: DbStatus, err: DbOpenError | null = null): void {
  status = next
  lastError = err
  for (const w of watchers) w(next, err)
}

/** 開き具合を見張る。戻り値を呼ぶと外れる。 */
export function onDbStatus(cb: (s: DbStatus, e: DbOpenError | null) => void): () => void {
  watchers.add(cb)
  cb(status, lastError)
  return () => {
    watchers.delete(cb)
  }
}

/**
 * DBを1つ開く。**時間で打ち切らない。**
 * @param version 省略すると「いまある版」で開く（＝アップグレードを起こさない）
 */
function open<T>(
  name: string,
  version: number | undefined,
  upgrade: (d: IDBPDatabase<T>) => void,
  onLost: () => void,
  /** 台帳のときだけ開き具合を画面へ伝える（録音DBの都合を混ぜない） */
  reportStatus = false,
): Promise<IDBPDatabase<T>> {
  let instance: IDBPDatabase<T> | null = null

  try {
    return openDB<T>(name, version, {
      upgrade(d) {
        upgrade(d)
      },
      /** ほかの接続にさえぎられている。閉じられるまで待つ。 */
      blocked() {
        if (reportStatus) setStatus('blocked')
      },
      /** こちらが相手をさえぎっている。すぐ手放して相手を進ませる。 */
      blocking() {
        try {
          instance?.close()
        } catch {
          /* 既に閉じている */
        }
        onLost()
      },
      /** ブラウザに接続を切られた。次のアクセスで開き直す。 */
      terminated() {
        onLost()
      },
    } as Parameters<typeof openDB<T>>[2]).then(
      (d) => {
        instance = d
        return d
      },
      (err) => {
        throw asOpenError(err)
      },
    )
  } catch (err) {
    // indexedDB.open そのものが投げることがある（保存が禁止されている環境など）
    return Promise.reject(asOpenError(err))
  }
}

function asOpenError(err: unknown): DbOpenError {
  if (err instanceof DbOpenError) return err
  const e = err as { name?: string; message?: string } | null
  return new DbOpenError('error', [e?.name, e?.message].filter(Boolean).join(': '))
}

/**
 * 開けなければ少し待って開き直す。
 * 端末が寝起きのときや、直前の接続が閉じきる前だと1回目だけ落ちることがある。
 */
async function openWithRetry<T>(
  name: string,
  version: number | undefined,
  upgrade: (d: IDBPDatabase<T>) => void,
  onLost: () => void,
  reportStatus = false,
): Promise<IDBPDatabase<T>> {
  if (!idbAvailable()) throw new DbOpenError('unavailable')
  let last: unknown = null
  for (let i = 0; i < OPEN_TRIES; i++) {
    try {
      return await open<T>(name, version, upgrade, onLost, reportStatus)
    } catch (err) {
      last = err
      if (i < OPEN_TRIES - 1) await wait(400 * (i + 1))
    }
  }
  if (last instanceof DbOpenError) {
    // 最後の失敗にだけ空き容量を添える（毎回聞くと開くのが遅くなる）
    const note = await storageNote()
    throw new DbOpenError(last.kind, [last.detail, note].filter(Boolean).join(' ／ '))
  }
  throw last instanceof Error ? last : new DbOpenError('error')
}

let mainPromise: Promise<IDBPDatabase<MainDB>> | null = null
let mediaPromise: Promise<IDBPDatabase<MediaDB>> | null = null

/** 台帳。版は指定しない（＝アップグレードを起こさない）。 */
function main(): Promise<IDBPDatabase<MainDB>> {
  if (!mainPromise) {
    setStatus('opening')
    // 「時間がかかっています」を出すためだけのタイマー。待ちは打ち切らない。
    const slow = setTimeout(() => {
      if (status === 'opening') setStatus('slow')
    }, SLOW_MS)
    mainPromise = openWithRetry<MainDB>(
      MAIN_DB,
      undefined,
      (d) => {
        // DBが無いときだけ呼ばれる（版1で作られる）
        if (!d.objectStoreNames.contains('tasks')) {
          const store = d.createObjectStore('tasks', { keyPath: 'id' })
          store.createIndex('by_due', 'due')
          store.createIndex('by_status', 'status')
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta')
        }
      },
      () => {
        mainPromise = null
        if (status === 'ready') setStatus('idle')
      },
      true,
    )
      .then((d) => {
        clearTimeout(slow)
        setStatus('ready')
        return d
      })
      .catch((err: unknown) => {
        clearTimeout(slow)
        mainPromise = null
        setStatus('failed', err instanceof DbOpenError ? err : new DbOpenError('error'))
        throw err
      })
  }
  return mainPromise
}

/** 録音。台帳とは別のDBなので、ここが開けなくても台帳は読める。 */
function media(): Promise<IDBPDatabase<MediaDB>> {
  if (!mediaPromise) {
    mediaPromise = openWithRetry<MediaDB>(
      MEDIA_DB,
      1,
      (d) => {
        if (!d.objectStoreNames.contains('recordings')) {
          d.createObjectStore('recordings', { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains('audio')) {
          d.createObjectStore('audio')
        }
      },
      () => {
        mediaPromise = null
      },
    ).catch((err) => {
      mediaPromise = null
      throw err
    })
  }
  return mediaPromise
}

let workPromise: Promise<IDBPDatabase<WorkDB>> | null = null

/** 予定と実行ログ。ここが開けなくても、台帳（タスク）は読める。 */
function work(): Promise<IDBPDatabase<WorkDB>> {
  if (!workPromise) {
    workPromise = openWithRetry<WorkDB>(
      WORK_DB,
      1,
      (d) => {
        if (!d.objectStoreNames.contains('plans')) {
          const store = d.createObjectStore('plans', { keyPath: 'id' })
          store.createIndex('by_day', 'day')
        }
        if (!d.objectStoreNames.contains('runs')) {
          const store = d.createObjectStore('runs', { keyPath: 'id' })
          store.createIndex('by_day', 'day')
          store.createIndex('by_plan', 'planKey')
        }
      },
      () => {
        workPromise = null
      },
    ).catch((err) => {
      workPromise = null
      throw err
    })
  }
  return workPromise
}

/** 区分。v1.10 以前の1つだけの形（category: string）も読めるようにする。 */
function normalizeCategories(raw: Task & { category?: unknown }): string[] {
  if (Array.isArray(raw.categories)) {
    return cleanCategories(raw.categories.filter((c): c is string => typeof c === 'string'))
  }
  return typeof raw.category === 'string' && raw.category.trim() ? [raw.category.trim()] : []
}

/**
 * 保存済みタスクを現行の型へ寄せる。
 * 古いバックアップの取り込みや、後から増えた項目（estimateMin など）が
 * 欠けているレコードで画面が壊れないようにするための防波堤。
 */
function normalizeTask(raw: Task): Task {
  // 古い1つだけの区分（category）は categories へ移し、残骸は持ち回らない
  const { category: _legacyCategory, ...rest } = raw as Task & { category?: unknown }
  return {
    ...rest,
    note: raw.note ?? '',
    due: raw.due ?? null,
    dueTime: raw.dueTime ?? null,
    estimateMin: typeof raw.estimateMin === 'number' ? raw.estimateMin : null,
    // v1.13 以前には無かった項目。欠けていても画面が壊れないようにする
    startedAt: raw.startedAt ?? null,
    actualMin: typeof raw.actualMin === 'number' ? raw.actualMin : null,
    priority: raw.priority ?? 'mid',
    // v1.10 以前は区分が1つ（category: string）だった。読むときにここで寄せる。
    categories: normalizeCategories(raw),
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
    timebox: raw.timebox ?? null,
    repeat: raw.repeat ?? null,
    status: raw.status ?? 'open',
    source: raw.source ?? 'form',
    doneAt: raw.doneAt ?? null,
  }
}

/** 予定。後から足した項目が欠けていても画面が壊れないようにする。 */
function normalizePlan(raw: Plan): Plan {
  return {
    ...raw,
    note: raw.note ?? '',
    place: raw.place ?? '',
    startTime: raw.startTime ?? null,
    endTime: raw.endTime ?? null,
    allDay: raw.allDay === true || !raw.startTime,
    categories: Array.isArray(raw.categories) ? cleanCategories(raw.categories) : [],
    autoTrack: raw.autoTrack !== false,
    repeat: raw.repeat ?? null,
  }
}

/** 予定の実行ログ。区間の形が壊れているものは落とす（実績を推測で埋めない）。 */
function normalizeRun(raw: PlanRun): PlanRun {
  const segments = Array.isArray(raw.segments)
    ? raw.segments.filter((s) => s && typeof s.start === 'string')
    : []
  return {
    ...raw,
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    segments,
    state: raw.state === 'running' || raw.state === 'paused' ? raw.state : 'done',
    auto: raw.auto === true,
  }
}

export class LocalRepository implements Repository {
  async list(): Promise<Task[]> {
    const all = await (await main()).getAll('tasks')
    return all.map(normalizeTask)
  }

  async add(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return
    const d = await main()
    const tx = d.transaction('tasks', 'readwrite')
    await Promise.all(tasks.map((t) => tx.store.put(t)))
    await tx.done
  }

  async update(id: string, patch: Partial<Task>): Promise<void> {
    const d = await main()
    const tx = d.transaction('tasks', 'readwrite')
    const current = await tx.store.get(id)
    if (current) {
      await tx.store.put({ ...current, ...patch, id, updatedAt: new Date().toISOString() })
    }
    await tx.done
  }

  async remove(id: string): Promise<void> {
    const d = await main()
    const tx = d.transaction(['tasks', 'meta'], 'readwrite')
    await tx.objectStore('tasks').delete(id)
    // 消した跡を残す。これが無いと、同期のときに相手から戻ってくる
    const meta = tx.objectStore('meta')
    const raw = (await meta.get(TOMBSTONE_KEY)) as Record<string, string> | undefined
    await meta.put({ ...(raw ?? {}), [id]: new Date().toISOString() }, TOMBSTONE_KEY)
    await tx.done
  }

  async listTombstones(): Promise<Record<string, string>> {
    const raw = (await (await main()).get('meta', TOMBSTONE_KEY)) as
      | Record<string, string>
      | undefined
    return raw && typeof raw === 'object' ? raw : {}
  }

  async applySync(
    upsert: Task[],
    removeIds: string[],
    tombstones: Record<string, string>,
  ): Promise<void> {
    const d = await main()
    const tx = d.transaction(['tasks', 'meta'], 'readwrite')
    const tasks = tx.objectStore('tasks')
    for (const t of upsert) await tasks.put(normalizeTask(t))
    for (const id of removeIds) await tasks.delete(id)
    await tx.objectStore('meta').put(tombstones, TOMBSTONE_KEY)
    await tx.done
  }

  async replaceAll(tasks: Task[]): Promise<void> {
    const d = await main()
    const tx = d.transaction('tasks', 'readwrite')
    await tx.store.clear()
    await Promise.all(tasks.map((t) => tx.store.put(normalizeTask(t))))
    await tx.done
  }

  /**
   * 台帳のDBを消して作り直す。中身は戻らない。
   * 開けなくなった保存領域を捨てて、また使える状態に戻すための出口。
   */
  async resetLedger(): Promise<void> {
    // 掴んだままだと消せないので、先に手放す
    try {
      const d = await mainPromise
      d?.close()
    } catch {
      /* 開けていないなら閉じるものも無い */
    }
    mainPromise = null
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(MAIN_DB)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(new DbOpenError('error', String(req.error?.message ?? '')))
      // ほかのタブが掴んでいると消せない
      req.onblocked = () => reject(new DbOpenError('blocked'))
    })
  }

  async loadSettings(): Promise<Settings> {
    const raw = (await (await main()).get('meta', 'settings')) as Partial<Settings> | undefined
    if (!raw) return { ...DEFAULT_SETTINGS, categoryGroups: defaultCategoryGroups() }
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      workHours: { ...DEFAULT_WORK_HOURS, ...(raw.workHours ?? {}) },
      workCalendar: normalizeCalendar(raw.workCalendar),
      // 後から足した項目。古い保存には無いので既定で埋める
      savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters : [],
      // 区分のマスタ。無い（v1.10 以前）なら既定を入れる
      categoryGroups: normalizeGroups(raw.categoryGroups),
      syncEnabled: raw.syncEnabled === true,
      reminderEnabled: raw.reminderEnabled === true,
      reminderLeadMin: typeof raw.reminderLeadMin === 'number' ? raw.reminderLeadMin : 10,
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await (await main()).put('meta', settings, 'settings')
  }

  /* --- 記憶したタスク（定型）。端末内にのみ置き、同期には乗せない --- */

  async listTemplates(): Promise<TaskTemplate[]> {
    const raw = (await (await main()).get('meta', TEMPLATE_KEY)) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((t): t is TaskTemplate => {
      if (typeof t !== 'object' || t === null) return false
      const o = t as Record<string, unknown>
      return typeof o.id === 'string' && typeof o.title === 'string' && o.title.trim() !== ''
    })
  }

  async saveTemplates(list: TaskTemplate[]): Promise<void> {
    await (await main()).put('meta', list.slice(0, TEMPLATE_KEEP), TEMPLATE_KEY)
  }

  /* --- 予定。台帳とは別のDBなので、ここが開けなくてもタスクは読める --- */

  async listPlans(): Promise<Plan[]> {
    const all = await (await work()).getAll('plans')
    return all.map(normalizePlan)
  }

  async savePlan(plan: Plan): Promise<void> {
    await (await work()).put('plans', plan)
  }

  /**
   * 予定を消す。**実行の記録は消さない。**
   * あれは「実際にその時間動いた」という実績で、予定を取り下げても起きたことは変わらない。
   */
  async removePlan(id: string): Promise<void> {
    await (await work()).delete('plans', id)
  }

  async replaceAllPlans(plans: Plan[]): Promise<void> {
    const d = await work()
    const tx = d.transaction('plans', 'readwrite')
    await tx.store.clear()
    await Promise.all(plans.map((p) => tx.store.put(normalizePlan(p))))
    await tx.done
  }

  /* --- 予定の実行ログ。積むだけで、後から時刻を書き換えない --- */

  async listRuns(fromDay?: string): Promise<PlanRun[]> {
    const all = await (await work()).getAll('runs')
    const list = all.map(normalizeRun).filter((r) => !fromDay || r.day >= fromDay)
    // ULID は時系列に並ぶので、古い順にするだけでよい
    return list.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  async saveRun(run: PlanRun): Promise<void> {
    await (await work()).put('runs', run)
  }

  async saveRuns(runs: PlanRun[]): Promise<void> {
    if (runs.length === 0) return
    const d = await work()
    const tx = d.transaction('runs', 'readwrite')
    await Promise.all(runs.map((r) => tx.store.put(r)))
    await tx.done
  }

  async removeRun(id: string): Promise<void> {
    await (await work()).delete('runs', id)
  }

  async pruneRuns(beforeDay: string): Promise<number> {
    const d = await work()
    const tx = d.transaction('runs', 'readwrite')
    const all = await tx.store.getAll()
    const old = all.filter((r) => typeof r.day === 'string' && r.day < beforeDay)
    for (const r of old) await tx.store.delete(r.id)
    await tx.done
    return old.length
  }

  /* --- 録音。開けなくても台帳の操作は続けられるようにする --- */

  async listRecordings(): Promise<Recording[]> {
    const all = await (await media()).getAll('recordings')
    // ULID は時系列に並ぶので、新しい順にするだけでよい
    return all.sort((a, b) => (a.id < b.id ? 1 : -1))
  }

  async addRecording(rec: Recording, audio: Blob | null): Promise<void> {
    const d = await media()
    const tx = d.transaction(['recordings', 'audio'], 'readwrite')
    await tx.objectStore('recordings').put(rec)
    if (audio) await tx.objectStore('audio').put(audio, rec.id)
    await tx.done
    await this.pruneRecordings()
  }

  async getRecordingAudio(id: string): Promise<Blob | null> {
    return (await (await media()).get('audio', id)) ?? null
  }

  async removeRecording(id: string): Promise<void> {
    const d = await media()
    const tx = d.transaction(['recordings', 'audio'], 'readwrite')
    await tx.objectStore('recordings').delete(id)
    await tx.objectStore('audio').delete(id)
    await tx.done
  }

  async updateRecording(id: string, patch: Partial<Recording>): Promise<void> {
    const d = await media()
    const tx = d.transaction('recordings', 'readwrite')
    const cur = await tx.store.get(id)
    if (cur) await tx.store.put({ ...cur, ...patch, id })
    await tx.done
  }

  /** 古い録音を消して本数を抑える。音声は容量を食うので溜め込まない。 */
  private async pruneRecordings(): Promise<void> {
    const all = await this.listRecordings()
    const over = all.slice(RECORDING_KEEP)
    for (const r of over) await this.removeRecording(r.id)
  }
}
