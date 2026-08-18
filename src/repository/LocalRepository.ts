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
 * Phase 1 の保存先。端末内 IndexedDB のみ。サーバには置かない。
 * =======================================================*/

const DB_NAME = 'taskport'
// v2: 録音（recordings）と音声（audio）のストアを追加
const DB_VERSION = 2

interface TaskportDB extends DBSchema {
  tasks: {
    key: string
    value: Task
    indexes: { by_due: string; by_status: string }
  }
  meta: {
    key: string
    value: unknown
  }
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

let dbPromise: Promise<IDBPDatabase<TaskportDB>> | null = null

function db(): Promise<IDBPDatabase<TaskportDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TaskportDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('tasks')) {
          const store = d.createObjectStore('tasks', { keyPath: 'id' })
          store.createIndex('by_due', 'due')
          store.createIndex('by_status', 'status')
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta')
        }
        if (!d.objectStoreNames.contains('recordings')) {
          d.createObjectStore('recordings', { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains('audio')) {
          d.createObjectStore('audio')
        }
      },
    })
  }
  return dbPromise
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
    status: raw.status ?? 'open',
    source: raw.source ?? 'form',
    doneAt: raw.doneAt ?? null,
  }
}

export class LocalRepository implements Repository {
  async list(): Promise<Task[]> {
    const all = await (await db()).getAll('tasks')
    return all.map(normalizeTask)
  }

  async add(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return
    const d = await db()
    const tx = d.transaction('tasks', 'readwrite')
    await Promise.all(tasks.map((t) => tx.store.put(t)))
    await tx.done
  }

  async update(id: string, patch: Partial<Task>): Promise<void> {
    const d = await db()
    const tx = d.transaction('tasks', 'readwrite')
    const current = await tx.store.get(id)
    if (current) {
      await tx.store.put({ ...current, ...patch, id, updatedAt: new Date().toISOString() })
    }
    await tx.done
  }

  async remove(id: string): Promise<void> {
    await (await db()).delete('tasks', id)
  }

  async replaceAll(tasks: Task[]): Promise<void> {
    const d = await db()
    const tx = d.transaction('tasks', 'readwrite')
    await tx.store.clear()
    await Promise.all(tasks.map((t) => tx.store.put(normalizeTask(t))))
    await tx.done
  }

  async loadSettings(): Promise<Settings> {
    const raw = (await (await db()).get('meta', 'settings')) as Partial<Settings> | undefined
    if (!raw) return DEFAULT_SETTINGS
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      workHours: { ...DEFAULT_WORK_HOURS, ...(raw.workHours ?? {}) },
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await (await db()).put('meta', settings, 'settings')
  }

  /* --- 録音 --- */

  async listRecordings(): Promise<Recording[]> {
    const all = await (await db()).getAll('recordings')
    // ULID は時系列に並ぶので、新しい順にするだけでよい
    return all.sort((a, b) => (a.id < b.id ? 1 : -1))
  }

  async addRecording(rec: Recording, audio: Blob | null): Promise<void> {
    const d = await db()
    const tx = d.transaction(['recordings', 'audio'], 'readwrite')
    await tx.objectStore('recordings').put(rec)
    if (audio) await tx.objectStore('audio').put(audio, rec.id)
    await tx.done
    await this.pruneRecordings()
  }

  async getRecordingAudio(id: string): Promise<Blob | null> {
    return (await (await db()).get('audio', id)) ?? null
  }

  async removeRecording(id: string): Promise<void> {
    const d = await db()
    const tx = d.transaction(['recordings', 'audio'], 'readwrite')
    await tx.objectStore('recordings').delete(id)
    await tx.objectStore('audio').delete(id)
    await tx.done
  }

  async updateRecording(id: string, patch: Partial<Recording>): Promise<void> {
    const d = await db()
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
