import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { InputDock } from './components/InputDock'
import { Toast, type ToastMessage } from './components/Toast'
import { TapWave } from './components/TapWave'
import { ListView } from './views/ListView'
import { ScheduleView } from './views/ScheduleView'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { ExportSheet } from './views/ExportSheet'
import { ReviewSheet } from './views/ReviewSheet'
import { TaskEditor } from './views/TaskEditor'
import { RecordingOverlay } from './views/RecordingOverlay'
import { RecordingsView } from './views/RecordingsView'
import { repository } from './repository'
import { APP_VERSION, buildLabel } from './version'
import { checkForUpdate } from './lib/updater'
import { parseToTasks } from './ports/in/parseToTasks'
import { useShareTarget } from './ports/in/useShareTarget'
import { eventToDraft } from './ports/in/fromCalendar'
import { useRecordingSession } from './ports/in/useRecordingSession'
import { voiceSupported } from './ports/in/useVoiceInput'
import { dayKey, formatMD } from './lib/date'
import { draftToTask, emptyDraft, type ListTab } from './lib/tasks'
import { overview } from './lib/stats'
import { EMPTY_FILTER, sameFilter } from './lib/taskFilter'
import { nextOccurrence, repeatLabel } from './lib/repeat'
import { ulid } from './lib/ulid'
import {
  DEFAULT_SETTINGS,
  type CalendarEvent,
  type Draft,
  type Recording,
  type Settings,
  type Source,
  type Task,
  type TaskFilter,
} from './types'

/* =========================================================
 * 画面の組み立てと状態
 *
 * データに触るのは必ず repository 経由。IndexedDB を直接叩かない。
 * 自然文はどの入口から来ても parseToTasks を通り、必ず確認画面に出る。
 * =======================================================*/

type ViewKey = 'list' | 'schedule' | 'dashboard' | 'recordings' | 'settings'

const NAV: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'list', label: '一覧', icon: 'list' },
  { key: 'schedule', label: 'スケジュール', icon: 'calendar' },
  { key: 'dashboard', label: '分析', icon: 'chart' },
  { key: 'recordings', label: '録音', icon: 'mic' },
  { key: 'settings', label: '設定', icon: 'gear' },
]

interface Pending {
  drafts: Draft[]
  sourceText: string
  /** 確認画面の上に出す補足（予定からの取り込みなど） */
  hint?: string
  /** 音声から来た場合、確定後にタスクIDを紐づける録音 */
  recordingId?: string
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  /** 保存データを開けなかったときの案内。null なら正常。 */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<ViewKey>('list')
  const [tab, setTab] = useState<ListTab>('today')
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER)
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [today, setToday] = useState(dayKey())
  const [checking, setChecking] = useState(false)

  const share = useShareTarget()
  const session = useRecordingSession({
    keepAudio: settings.keepAudio,
    keepAwake: settings.keepAwake,
  })

  const notify = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const reload = useCallback(async () => {
    const list = await repository.list()
    setTasks(list)
  }, [])

  /**
   * 保存データを読む。
   * 読めなかったときは必ず理由を画面に出す。
   * 「読み込んでいます…」のまま止めない（何が起きたか分からず手の打ちようがなくなる）。
   */
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [list, s] = await Promise.all([repository.list(), repository.loadSettings()])
      setTasks(list)
      setSettings(s)
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : '保存データを読めませんでした。ブラウザのプライベートモードでは保存できません。',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 開けなかったときは、画面に戻ってきたら黙って開き直す。
  // 「他のタブを閉じて戻る」で自然に直るようにするため。
  useEffect(() => {
    if (!loadError) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadError, load])

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
    (text: string, source: Source, recordingId?: string) => {
      setBusy(true)
      try {
        const result = parseToTasks(text, source, { today })
        if (result.drafts.length === 0) {
          notify('タスクを取り出せませんでした。用件をもう少しはっきり書いてください。', 'error')
          return
        }
        setPending({ drafts: result.drafts, sourceText: text, recordingId })
      } finally {
        setBusy(false)
      }
    },
    [today, notify],
  )

  // 他アプリから共有されてきた本文も同じパイプラインへ流す
  useEffect(() => {
    if (!share.sharedText || loading) return
    const body = share.sharedText
    share.consume()
    runParse(body, 'share')
  }, [share, loading, runParse])

  /**
   * 録音を止めて、認識テキストをタスク候補にする。
   * 音声と認識テキストは録音履歴に残し、後から元を確かめられるようにする。
   * 議事録は作らない。ここが NoteLoop との違い。
   */
  const finishRecording = useCallback(async () => {
    const result = await session.stop()
    const text = result.transcript.trim()

    let recordingId: string | undefined
    if (settings.keepAudio || text) {
      const rec: Recording = {
        id: ulid(),
        createdAt: new Date().toISOString(),
        durationSec: result.durationSec,
        transcript: text,
        mimeType: result.audio?.type ?? '',
        bytes: result.audio?.size ?? 0,
        taskIds: [],
        warning: result.warning,
      }
      try {
        await repository.addRecording(rec, settings.keepAudio ? result.audio : null)
        recordingId = rec.id
      } catch {
        notify('録音を保存できませんでした。端末の空き容量を確認してください。', 'error')
      }
    }
    if (result.warning) notify(result.warning, 'error')

    session.reset()
    if (!text) {
      notify('音声を聞き取れませんでした。もう一度話すか、キーボード入力をお使いください。', 'error')
      return
    }
    runParse(text, 'voice', recordingId)
  }, [session, settings.keepAudio, runParse, notify])

  /** 録音を捨ててやめる。音声も残さない。 */
  const cancelRecording = useCallback(async () => {
    await session.stop()
    session.reset()
  }, [session])

  /**
   * カレンダーの予定をタスクにする。
   * AIの候補と同じく確認画面を通す（無確認では登録しない）。
   */
  const importEvent = useCallback((ev: CalendarEvent) => {
    setPending({
      drafts: [eventToDraft(ev)],
      sourceText: `${ev.day} ${ev.startTime ?? '終日'} ${ev.title}`,
      hint: 'Googleカレンダーの予定から作りました。期限と見込み時間を確認してください。',
    })
  }, [])

  const commitDrafts = useCallback(
    async (drafts: Draft[]) => {
      const newTasks = drafts.map(draftToTask)
      await repository.add(newTasks)
      // どの録音から出たタスクかを残す（録音履歴から辿れるようにする）
      if (pending?.recordingId) {
        await repository.updateRecording(pending.recordingId, { taskIds: newTasks.map((t) => t.id) })
      }
      await reload()
      setPending(null)
      notify(`${newTasks.length}件を登録しました`)
      setView('list')
    },
    [reload, notify, pending],
  )

  const toggleDone = useCallback(
    async (task: Task) => {
      const done = task.status === 'done'
      await repository.update(task.id, {
        status: done ? 'open' : 'done',
        doneAt: done ? null : new Date().toISOString(),
      })
      // 繰り返しのタスクを完了にしたら、次の1件だけをここで作る。
      // 完了したほうは履歴として残し、触らない。
      let next: Task | null = null
      if (!done) {
        next = nextOccurrence(task, today, settings.workHours.workDays)
        if (next) await repository.add([next])
      }
      await reload()
      if (next) notify(`完了。次は ${formatMD(next.due ?? '')}（${repeatLabel(task.repeat)}）`)
    },
    [reload, today, settings.workHours.workDays, notify],
  )

  /** 手順1つの済／未了。カードから直接切り替えられるようにする。 */
  const toggleSubtask = useCallback(
    async (task: Task, subtaskId: string) => {
      await repository.update(task.id, {
        subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)),
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
          subtasks: draft.subtasks.filter((t) => t.title.trim()).map((t) => ({ ...t, title: t.title.trim() })),
          repeat: draft.due ? draft.repeat : null,
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

  /* --- 絞り込みの保存。設定と同じ場所に置く（端末内にのみ残る） --- */

  const saveFilter = useCallback(
    (name: string) => {
      if (settings.savedFilters.some((f) => sameFilter(f.filter, filter))) return
      const next: Settings = {
        ...settings,
        savedFilters: [...settings.savedFilters, { id: ulid(), name, filter }],
      }
      setSettings(next)
      void repository.saveSettings(next)
      notify('この条件を残しました')
    },
    [settings, filter, notify],
  )

  const removeSavedFilter = useCallback(
    (id: string) => {
      const next: Settings = {
        ...settings,
        savedFilters: settings.savedFilters.filter((f) => f.id !== id),
      }
      setSettings(next)
      void repository.saveSettings(next)
    },
    [settings],
  )

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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('view')
    if (v === 'schedule' || v === 'dashboard' || v === 'recordings' || v === 'settings') setView(v)
    // ?dock=voice で開いたときはそのまま録音を始める
    if (params.get('dock') === 'voice' && voiceSupported()) void session.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (key: ViewKey) => {
    setView(key)
    setDrawer(false)
  }

  /** 手で更新を確認する。新しい版があれば自動で再読み込みされる。 */
  const onCheckUpdate = async () => {
    setChecking(true)
    try {
      const found = await checkForUpdate()
      notify(found ? '新しい版があります。読み込み直します。' : `最新です（Ver. ${APP_VERSION}）`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="tp-app">
      <TapWave />
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
          <p className="tp-mono tp-drawer-count">
            未完了 {ov.open} ／ 超過 {ov.overdue}
          </p>
          {/* 端末に届いているのがどの版かを見えるようにする。
              更新が反映されないときは、ここを見れば切り分けられる。 */}
          <div className="tp-drawer-ver">
            <span>
              <b className="tp-mono">Ver. {APP_VERSION}</b>
              <span className="tp-mono">{buildLabel()}</span>
            </span>
            <button type="button" className="tp-ver-btn" disabled={checking} onClick={onCheckUpdate}>
              {checking ? '確認中' : '更新を確認'}
            </button>
          </div>
        </div>
      </nav>

      <main className="tp-main">
        {loading ? (
          <p className="tp-loading">読み込んでいます…</p>
        ) : loadError ? (
          <div className="tp-fatal" role="alert">
            <Icon name="alert" size={28} />
            <p className="tp-fatal-head">保存データを開けませんでした</p>
            <p className="tp-fatal-body">{loadError}</p>
            <button type="button" className="tp-btn-primary" onClick={() => void load()}>
              もう一度試す
            </button>
          </div>
        ) : view === 'list' ? (
          <ListView
            tasks={tasks}
            today={today}
            settings={settings}
            tab={tab}
            onTabChange={setTab}
            onToggle={(t) => void toggleDone(t)}
            onEdit={setEditing}
            onToggleSubtask={(t, id) => void toggleSubtask(t, id)}
            filter={filter}
            onFilterChange={setFilter}
            saved={settings.savedFilters}
            onSaveFilter={saveFilter}
            onRemoveSavedFilter={removeSavedFilter}
          />
        ) : view === 'schedule' ? (
          <ScheduleView
            tasks={tasks}
            today={today}
            settings={settings}
            onEdit={setEditing}
            onImportEvent={importEvent}
            onNotify={notify}
          />
        ) : view === 'dashboard' ? (
          <DashboardView tasks={tasks} today={today} settings={settings} />
        ) : view === 'recordings' ? (
          <RecordingsView onNotify={notify} />
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

      {view !== 'settings' && !session.recording && (
        <InputDock
          busy={busy}
          voiceSupported={voiceSupported()}
          onSubmitText={(text, source) => runParse(text, source)}
          onStartVoice={() => void session.start()}
          onOpenForm={() => setCreating(true)}
        />
      )}

      {session.recording && (
        <RecordingOverlay
          session={session}
          onFinish={() => void finishRecording()}
          onCancel={() => void cancelRecording()}
        />
      )}

      {pending && (
        <ReviewSheet
          drafts={pending.drafts}
          hint={pending.hint}
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
