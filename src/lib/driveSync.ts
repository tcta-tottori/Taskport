import { googleFetch } from './googleAuth'
import { mergeLedgers, type Ledger, type Tombstones } from './merge'
import type { Task } from '../types'

/* =========================================================
 * 端末どうしの同期（Google Drive のアプリ専用フォルダ）
 *
 * 置き場は Drive の `appDataFolder`。利用者の Drive の中にあるが、
 * マイドライブには出てこず、**このアプリからしか読めない**。
 * ほかのアプリからも、Drive の画面からも見えない。
 *
 * 【design.md §8 からの変更】
 * これまで「タスクデータをサーバに置かない」を守ってきたが、
 * スマホとPCで同じ台帳を使うという要望のため、**タスクの本文（件名・
 * メモ・区分）が Google に保存される**ようになった。既定では切ってあり、
 * 設定画面で入れたときだけ動く。切れば以後は上げない。
 *
 * 【やり取りの形】
 *   読む → 手元と1件ずつ突き合わせる → 手元へ反映 → 変わっていれば書き戻す
 * 1回のやり取りで完結させ、途中で失敗しても手元は壊さない。
 * =======================================================*/

const FILE_NAME = 'taskport-ledger.json'
const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

/** 保存する中身。version は将来の形の変更に備えて持つ */
interface RemoteLedger {
  app: 'taskport'
  version: 1
  updatedAt: string
  tasks: Task[]
  deleted: Tombstones
}

function isRemote(v: unknown): v is RemoteLedger {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.app === 'taskport' && Array.isArray(o.tasks)
}

async function findFileId(clientId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}'`)
  const res = await googleFetch(
    clientId,
    `${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`,
  )
  if (!res.ok) throw new Error(await failure(res, '同期用のファイルを探せませんでした'))
  const body = (await res.json()) as { files?: { id?: string }[] }
  return body.files?.[0]?.id ?? null
}

async function createFile(clientId: string, payload: RemoteLedger): Promise<string> {
  // メタデータと中身を1回で送る（multipart）
  const boundary = 'tp-' + Math.random().toString(36).slice(2)
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(payload) +
    `\r\n--${boundary}--`
  const res = await googleFetch(clientId, `${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new Error(await failure(res, '同期用のファイルを作れませんでした'))
  const created = (await res.json()) as { id?: string }
  if (!created.id) throw new Error('同期用のファイルを作れませんでした。')
  return created.id
}

async function readFile(clientId: string, fileId: string): Promise<RemoteLedger | null> {
  const res = await googleFetch(clientId, `${FILES}/${fileId}?alt=media`)
  if (!res.ok) throw new Error(await failure(res, '同期用のファイルを読めませんでした'))
  const raw: unknown = await res.json().catch(() => null)
  return isRemote(raw) ? raw : null
}

async function writeFile(clientId: string, fileId: string, payload: RemoteLedger): Promise<void> {
  const res = await googleFetch(clientId, `${UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await failure(res, '同期用のファイルへ書けませんでした'))
}

/** 失敗の理由を、次の一手が分かる形にする */
async function failure(res: Response, what: string): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    /* 本文が読めないこともある */
  }
  if (res.status === 403 && /insufficient|scope/i.test(detail)) {
    return `${what}。Googleの許可が足りません。設定画面で「接続を切る」を押してから、もう一度接続して同意し直してください。`
  }
  if (res.status === 401) {
    return `${what}。Googleとの接続が切れています。設定画面から接続し直してください。`
  }
  return `${what}（${res.status}${detail ? `: ${detail}` : ''}）。`
}

/**
 * 置き場のファイルを消す。同期をやめるときに、上げたぶんを Google から
 * 引き上げるための出口。手元の台帳には触らない。
 * @returns 消したファイルの数（もともと無ければ 0）
 */
export async function clearRemote(clientId: string): Promise<number> {
  const fileId = await findFileId(clientId)
  if (!fileId) return 0
  const res = await googleFetch(clientId, `${FILES}/${fileId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(await failure(res, '同期用のファイルを消せませんでした'))
  }
  return 1
}

export interface SyncOutcome {
  /** 手元に取り込んだ件数 */
  pulled: number
  /** 向こうへ上げた件数（併合後の総数） */
  pushed: number
  /** 手元から消した件数 */
  removed: number
  /** 向こうを書き換えたか */
  wrote: boolean
  at: string
}

/**
 * 1回ぶんの同期。
 * @param local  手元の台帳（タスクと墓標）
 * @param apply  併合の結果を手元へ書き戻す処理
 */
export async function syncOnce(
  clientId: string,
  local: Ledger,
  apply: (upsert: Task[], removeIds: string[], deleted: Tombstones) => Promise<void>,
): Promise<SyncOutcome> {
  const now = new Date().toISOString()
  let fileId = await findFileId(clientId)

  // 初回は手元をそのまま置く
  if (!fileId) {
    const payload: RemoteLedger = {
      app: 'taskport',
      version: 1,
      updatedAt: now,
      tasks: local.tasks,
      deleted: local.deleted,
    }
    fileId = await createFile(clientId, payload)
    await apply([], [], local.deleted)
    return { pulled: 0, pushed: local.tasks.length, removed: 0, wrote: true, at: now }
  }

  const remote = (await readFile(clientId, fileId)) ?? { tasks: [], deleted: {} }
  const result = mergeLedgers(local, { tasks: remote.tasks, deleted: remote.deleted }, now)

  await apply(result.toUpsert, result.toRemove, result.merged.deleted)

  if (result.remoteChanged) {
    await writeFile(clientId, fileId, {
      app: 'taskport',
      version: 1,
      updatedAt: now,
      tasks: result.merged.tasks,
      deleted: result.merged.deleted,
    })
  }

  return {
    pulled: result.toUpsert.length,
    pushed: result.merged.tasks.length,
    removed: result.toRemove.length,
    wrote: result.remoteChanged,
    at: now,
  }
}
