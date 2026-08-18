import type { Task } from '../types'

/* =========================================================
 * 台帳の併合
 *
 * スマホとPCが同時に触るので、どちらかで上書きすると片方の操作が消える。
 * ファイル全体ではなく **1件ずつ** 突き合わせて、新しいほうを採る。
 *
 * 判定に使うのは `updatedAt`（更新時刻）だけ。
 *   - 同じIDが両方にある … 更新時刻が新しいほう
 *   - 片方にしかない     … そのまま採る
 *   - 消した跡（墓標）がある … 墓標の時刻がタスクの更新時刻以降なら消えたまま
 *
 * 【この作りで負ける場面】
 * 同じ1件を、ほぼ同時に別々の端末で直すと、あとから保存したほうだけが残る。
 * 1件の中の項目ごとには混ぜない（件名とメモを別々に採る、はしない）。
 * 一人で2台を使う前提なので、ここは割り切る。
 *
 * 端末の時計がずれていると判定もずれる。手元の時計を信じる以外に手がない。
 * =======================================================*/

/** 消した跡。タスクID → 消した時刻（ISO） */
export type Tombstones = Record<string, string>

export interface Ledger {
  tasks: Task[]
  deleted: Tombstones
}

/** 墓標を残しておく日数。これを過ぎたら落とす（ファイルが太り続けるのを防ぐ） */
export const TOMBSTONE_DAYS = 90

function newer(a: string, b: string): boolean {
  return a > b
}

/** 消した跡のほうが新しいか（同時刻なら消えたことを優先する） */
function isDeleted(task: Task, deleted: Tombstones): boolean {
  const at = deleted[task.id]
  return !!at && !newer(task.updatedAt, at)
}

export interface MergeResult {
  /** 併合後の台帳。これを両側に書き戻す */
  merged: Ledger
  /** 手元に入れ直すぶん */
  toUpsert: Task[]
  /** 手元から消すぶん */
  toRemove: string[]
  /** 向こう側を書き換える必要があるか */
  remoteChanged: boolean
}

/**
 * 手元と向こうを突き合わせる。
 * @param nowIso 墓標の掃除に使う「いま」。渡さなければ現在時刻
 */
export function mergeLedgers(local: Ledger, remote: Ledger, nowIso = new Date().toISOString()): MergeResult {
  // --- 墓標を先に合わせる（新しいほうを採る） ---
  const deleted: Tombstones = { ...remote.deleted }
  for (const [id, at] of Object.entries(local.deleted)) {
    if (!deleted[id] || newer(at, deleted[id])) deleted[id] = at
  }

  const byId = new Map<string, { local?: Task; remote?: Task }>()
  for (const t of local.tasks) byId.set(t.id, { ...(byId.get(t.id) ?? {}), local: t })
  for (const t of remote.tasks) byId.set(t.id, { ...(byId.get(t.id) ?? {}), remote: t })

  const merged: Task[] = []
  const toUpsert: Task[] = []
  const toRemove: string[] = []
  let remoteChanged = false

  for (const [id, pair] of byId) {
    const l = pair.local
    const r = pair.remote

    // 消えたものは復活させない
    const sample = l ?? r
    if (sample && isDeleted(sample, deleted)) {
      if (l) toRemove.push(id)
      if (r) remoteChanged = true
      continue
    }

    if (l && r) {
      // 更新時刻が同じなら手元を採る（往復のたびに入れ替わるのを防ぐ）
      const win = newer(r.updatedAt, l.updatedAt) ? r : l
      merged.push(win)
      if (win === r) toUpsert.push(r)
      if (win === l && newer(l.updatedAt, r.updatedAt)) remoteChanged = true
    } else if (l) {
      merged.push(l)
      remoteChanged = true
    } else if (r) {
      merged.push(r)
      toUpsert.push(r)
    }
  }

  // --- 古い墓標を落とす ---
  const cutoff = new Date(new Date(nowIso).getTime() - TOMBSTONE_DAYS * 86_400_000).toISOString()
  const kept: Tombstones = {}
  for (const [id, at] of Object.entries(deleted)) {
    if (newer(at, cutoff)) kept[id] = at
  }
  if (Object.keys(kept).length !== Object.keys(remote.deleted).length) remoteChanged = true

  return {
    merged: { tasks: merged, deleted: kept },
    toUpsert,
    toRemove,
    remoteChanged,
  }
}
