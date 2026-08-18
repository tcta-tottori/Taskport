import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Repository } from './Repository'
import {
  DEFAULT_SETTINGS,
  DEFAULT_WORK_HOURS,
  RECORDING_KEEP,
  type Recording,
  type Settings,
  type Task,
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
const MEDIA_DB = 'taskport-media'

/** 開けないまま待たせない。ここを過ぎたら理由を付けて失敗させる。 */
const OPEN_TIMEOUT_MS = 8000

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

/** 別のタブが掴んでいて開けないときに投げる。画面で案内を分けるために区別する。 */
export class DbBlockedError extends Error {
  constructor() {
    super(
      'ほかのタブで開いている Taskport が、データをさえぎっています。' +
        '他のタブをすべて閉じてから、この画面を読み込み直してください。',
    )
    this.name = 'DbBlockedError'
  }
}

/**
 * DBを1つ開く。開けない状態が続いても、必ず時間内に決着させる。
 * @param version 省略すると「いまある版」で開く（＝アップグレードを起こさない）
 */
function open<T>(
  name: string,
  version: number | undefined,
  upgrade: (d: IDBPDatabase<T>) => void,
  onLost: () => void,
): Promise<IDBPDatabase<T>> {
  let blocked = false
  let settled = false
  let instance: IDBPDatabase<T> | null = null

  const opening = openDB<T>(name, version, {
    upgrade(d) {
      upgrade(d)
    },
    /** ほかの接続にさえぎられている */
    blocked() {
      blocked = true
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
  } as Parameters<typeof openDB<T>>[2])

  return new Promise<IDBPDatabase<T>>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onLost()
      // 遅れて開いた接続は置き去りにせず閉じる（残すと次の版上げをさえぎる）
      void opening.then((d) => {
        try {
          d.close()
        } catch {
          /* noop */
        }
      })
      reject(
        blocked
          ? new DbBlockedError()
          : new Error('保存データを開けませんでした。ブラウザを開き直してみてください。'),
      )
    }, OPEN_TIMEOUT_MS)

    opening.then(
      (d) => {
        clearTimeout(timer)
        instance = d
        if (settled) {
          try {
            d.close()
          } catch {
            /* noop */
          }
          return
        }
        settled = true
        resolve(d)
      },
      (err) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        onLost()
        reject(err)
      },
    )
  })
}

let mainPromise: Promise<IDBPDatabase<MainDB>> | null = null
let mediaPromise: Promise<IDBPDatabase<MediaDB>> | null = null

/** 台帳。版は指定しない（＝アップグレードを起こさない）。 */
function main(): Promise<IDBPDatabase<MainDB>> {
  if (!mainPromise) {
    mainPromise = open<MainDB>(
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
      },
    ).catch((err) => {
      mainPromise = null
      throw err
    })
  }
  return mainPromise
}

/** 録音。台帳とは別のDBなので、ここが開けなくても台帳は読める。 */
function media(): Promise<IDBPDatabase<MediaDB>> {
  if (!mediaPromise) {
    mediaPromise = open<MediaDB>(
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

/**
 * 保存済みタスクを現行の型へ寄せる。
 * 古いバックアップの取り込みや、後から増えた項目（estimateMin など）が
 * 欠けているレコードで画面が壊れないようにするための防波堤。
 */
function normalizeTask(raw: Task): Task {
  return {
    ...raw,
    note: raw.note ?? '',
    due: raw.due ?? null,
    dueTime: raw.dueTime ?? null,
    estimateMin: typeof raw.estimateMin === 'number' ? raw.estimateMin : null,
    priority: raw.priority ?? 'mid',
    category: raw.category ?? '',
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
    repeat: raw.repeat ?? null,
    status: raw.status ?? 'open',
    source: raw.source ?? 'form',
    doneAt: raw.doneAt ?? null,
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
    await (await main()).delete('tasks', id)
  }

  async replaceAll(tasks: Task[]): Promise<void> {
    const d = await main()
    const tx = d.transaction('tasks', 'readwrite')
    await tx.store.clear()
    await Promise.all(tasks.map((t) => tx.store.put(normalizeTask(t))))
    await tx.done
  }

  async loadSettings(): Promise<Settings> {
    const raw = (await (await main()).get('meta', 'settings')) as Partial<Settings> | undefined
    if (!raw) return DEFAULT_SETTINGS
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      workHours: { ...DEFAULT_WORK_HOURS, ...(raw.workHours ?? {}) },
      // 後から足した項目。古い保存には無いので既定で埋める
      savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters : [],
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await (await main()).put('meta', settings, 'settings')
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
