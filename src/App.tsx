import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { InputDock } from './components/InputDock'
import { Toast, type ToastMessage } from './components/Toast'
import { ListView } from './views/ListView'
import { ScheduleView } from './views/ScheduleView'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { ExportSheet } from './views/ExportSheet'
import { ReviewSheet } from './views/ReviewSheet'
import { TaskEditor } from './views/TaskEditor'
import { repository } from './repository'
import { parseToTasks, type ParseEngine } from './ports/in/parseToTasks'
import { useShareTarget } from './ports/in/useShareTarget'
import { dayKey } from './lib/date'
import { draftToTask, emptyDraft, type ListTab } from './lib/tasks'
import { overview } from './lib/stats'
import { DEFAULT_SETTINGS, type Draft, type Settings, type Source, type Task } from './types'

/* =========================================================
 * 画面の組み立てと状態
 *
 * データに触るのは必ず repository 経由。IndexedDB を直接叩かない。
 * 自然文はどの入口から来ても parseToTasks を通り、必ず確認画面に出る。
 * =======================================================*/

type ViewKey = 'list' | 'schedule' | 'dashboard' | 'settings'

const NAV: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'list', label: '一覧', icon: 'list' },
  { key: 'schedule', label: 'スケジュール', icon: 'calendar' },
  { key: 'dashboard', label: '分析', icon: 'chart' },
  { key: 'settings', label: '設定', icon: 'gear' },
]

interface Pending {
  drafts: Draft[]
  engine: ParseEngine
  fallbackReason?: string
  sourceText: string
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewKey>('list')
  const [tab, setTab] = useState<ListTab>('today')
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [today, setToday] = useState(dayKey())

  const share = useShareTarget()

  const notify = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const reload = useCallback(async () => {
    const list = await repository.list()
    setTasks(list)
  }, [])

  // 初期読み込み
  useEffect(() => {
    void (async () => {
      try {
        const [list, s] = await Promise.all([repository.list(), repository.loadSettings()])
        setTasks(list)
        setSettings(s)
      } catch {
        notify('保存データを読めませんでした。ブラウザのプライベートモードでは保存できません。', 'error')
      } finally {
        setLoading(false)
      }
    })()
  }, [notify])

  // 日付をまたいだら「今日」を更新する（アプリを開きっぱなしにする使い方を想定）
  useEffect(() => {
    const id = window.setInterval(() => {
      const k = dayKey()
      setToday((prev) => (prev === k ? prev : k))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  /** 自然文 → 候補（必ず確認画面へ）。ここ以外に登録の経路を作らない。 */
  const runParse = useCallback(
    async (text: string, source: Source) => {
      setBusy(true)
      try {
        const result = await parseToTasks(text, source, {
          endpoint: settings.parseEndpoint,
          today,
        })
        if (result.drafts.length === 0) {
          notify('タスクを取り出せませんでした。用件をもう少しはっきり書いてください。', 'error')
          return
        }
        setPending({
          drafts: result.drafts,
          engine: result.engine,
          fallbackReason: result.fallbackReason,
          sourceText: text,
        })
      } finally {
        setBusy(false)
      }
    },
    [settings.parseEndpoint, today, notify],
  )

  // 他アプリから共有されてきた本文も同じパイプラインへ流す
  useEffect(() => {
    if (!share.sharedText || loading) return
    const body = share.sharedText
    share.consume()
    void runParse(body, 'share')
  }, [share, loading, runParse])

  const commitDrafts = useCallback(
    async (drafts: Draft[]) => {
      const newTasks = drafts.map(draftToTask)
      await repository.add(newTasks)
      await reload()
      setPending(null)
      notify(`${newTasks.length}件を登録しました`)
      setView('list')
    },
    [reload, notify],
  )

  const toggleDone = useCallback(
    async (task: Task) => {
      const done = task.status === 'done'
      await repository.update(task.id, {
        status: done ? 'open' : 'done',
        doneAt: done ? null : new Date().toISOString(),
      })
      await reload()
    },
    [reload],
  )

  const saveEdit = useCallback(
    async (draft: Draft) => {
      if (editing) {
        await repository.update(editing.id, {
          title: draft.title.trim(),
          note: draft.note.trim(),
          due: draft.due,
          dueTime: draft.dueTime,
          estimateMin: draft.estimateMin,
          priority: draft.priority,
          category: draft.category.trim(),
        })
        notify('保存しました')
      } else {
        await repository.add([draftToTask(draft)])
        notify('登録しました')
      }
      await reload()
      setEditing(null)
      setCreating(false)
    },
    [editing, reload, notify],
  )

  const removeTask = useCallback(
    async (task: Task) => {
      await repository.remove(task.id)
      await reload()
      setEditing(null)
      notify('削除しました')
    },
    [reload, notify],
  )

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next)
    await repository.saveSettings(next)
  }, [])

  const restore = useCallback(
    async (next: Task[], nextSettings: Partial<Settings> | null) => {
      await repository.replaceAll(next)
      if (nextSettings) {
        const merged = { ...settings, ...nextSettings }
        setSettings(merged)
        await repository.saveSettings(merged)
      }
      await reload()
    },
    [reload, settings],
  )

  const ov = useMemo(() => overview(tasks, today), [tasks, today])

  // 起動時のクエリ（PWAショートカット）
  const params = new URLSearchParams(window.location.search)
  const autoVoice = params.get('dock') === 'voice'
  useEffect(() => {
    const v = params.get('view')
    if (v === 'schedule' || v === 'dashboard' || v === 'settings') setView(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (key: ViewKey) => {
    setView(key)
    setDrawer(false)
  }

  return (
    <div className="tp-app">
      <div className="tp-glow" aria-hidden="true" />

      <header className="tp-header">
        <button
          type="button"
          className="tp-menu"
          aria-expanded={drawer}
          aria-label="メニュー"
          onClick={() => setDrawer((v) => !v)}
        >
          <span className="tp-bar" />
          <span className="tp-bar" />
          <span className="tp-bar" />
        </button>
        <div className="tp-brand">
          <span className="tp-wordmark">Taskport</span>
          <span className="tp-tagline">IN / OUT — ONE LEDGER</span>
        </div>
        <button
          type="button"
          className="tp-head-btn"
          onClick={() => setExporting(true)}
          aria-label="書き出し"
        >
          <Icon name="export" size={19} />
        </button>
      </header>

      {drawer && <div className="tp-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <nav className={`tp-drawer${drawer ? ' is-open' : ''}`} aria-label="画面の切り替え">
        <div className="tp-drawer-head">
          <span className="tp-drawer-name">Taskport</span>
          <span className="tp-drawer-sub">タスク・スケジュール管理</span>
        </div>
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`tp-drawer-item${view === n.key ? ' is-on' : ''}`}
            onClick={() => go(n.key)}
          >
            <Icon name={n.icon} size={19} />
            <span>{n.label}</span>
            {n.key === 'list' && ov.overdue > 0 && <b className="tp-drawer-n">{ov.overdue}</b>}
          </button>
        ))}
        <button type="button" className="tp-drawer-item" onClick={() => { setExporting(true); setDrawer(false) }}>
          <Icon name="export" size={19} />
          <span>書き出し</span>
        </button>
        <div className="tp-drawer-foot">
          <p className="tp-mono">
            未完了 {ov.open} ／ 超過 {ov.overdue}
          </p>
        </div>
      </nav>

      <main className="tp-main">
        {loading ? (
          <p className="tp-loading">読み込んでいます…</p>
        ) : view === 'list' ? (
          <ListView
            tasks={tasks}
            today={today}
            settings={settings}
            tab={tab}
            onTabChange={setTab}
            onToggle={(t) => void toggleDone(t)}
            onEdit={setEditing}
          />
        ) : view === 'schedule' ? (
          <ScheduleView tasks={tasks} today={today} settings={settings} onEdit={setEditing} />
        ) : view === 'dashboard' ? (
          <DashboardView tasks={tasks} today={today} settings={settings} />
        ) : (
          <SettingsView
            settings={settings}
            tasks={tasks}
            onSave={(s) => void saveSettings(s)}
            onRestore={restore}
            onNotify={notify}
          />
        )}
      </main>

      {view !== 'settings' && (
        <InputDock
          busy={busy}
          autoOpenVoice={autoVoice}
          onSubmitText={(text, source) => void runParse(text, source)}
          onOpenForm={() => setCreating(true)}
        />
      )}

      {pending && (
        <ReviewSheet
          drafts={pending.drafts}
          engine={pending.engine}
          fallbackReason={pending.fallbackReason}
          sourceText={pending.sourceText}
          today={today}
          onCommit={(d) => void commitDrafts(d)}
          onCancel={() => setPending(null)}
        />
      )}

      {(editing || creating) && (
        <TaskEditor
          task={editing ?? undefined}
          initialDraft={emptyDraft('form')}
          onSave={(d) => void saveEdit(d)}
          onDelete={(t) => void removeTask(t)}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}

      {exporting && (
        <ExportSheet
          tasks={tasks}
          today={today}
          settings={settings}
          onClose={() => setExporting(false)}
          onNotify={notify}
        />
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
