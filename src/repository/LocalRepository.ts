import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Repository } from './Repository'
import { DEFAULT_SETTINGS, DEFAULT_WORK_HOURS, type Settings, type Task } from '../types'

/* =========================================================
 * Phase 1 の保存先。端末内 IndexedDB のみ。サーバには置かない。
 * =======================================================*/

const DB_NAME = 'taskport'
const DB_VERSION = 1

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
}
