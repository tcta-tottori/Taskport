import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { TriageSheet, type TriageAction } from './views/TriageSheet'
import { WrapUpSheet } from './views/WrapUpSheet'
import { WorkCalendarSheet } from './views/WorkCalendarSheet'
import { RecordingOverlay } from './views/RecordingOverlay'
import { RecordingsView } from './views/RecordingsView'
import { repository } from './repository'
import { DbOpenError, onDbStatus, type DbStatus } from './repository/LocalRepository'
import { APP_VERSION, buildLabel } from './version'
import { checkForUpdate } from './lib/updater'
import { parseToTasks } from './ports/in/parseToTasks'
import { useShareTarget } from './ports/in/useShareTarget'
import { eventToDraft } from './ports/in/fromCalendar'
import { useRecordingSession } from './ports/in/useRecordingSession'
import { voiceSupported } from './ports/in/useVoiceInput'
import { addDaysKey, dayKey, diffDays, formatMD, timeKey, toMinutes } from './lib/date'
import { draftToTask, emptyDraft, type ListTab } from './lib/tasks'
import { overview } from './lib/stats'
import { EMPTY_FILTER, sameFilter } from './lib/taskFilter'
import { clearRemote, syncOnce } from './lib/driveSync'
import { isConnected } from './lib/googleAuth'
import { nextOccurrence, repeatLabel } from './lib/repeat'
import {
  rescheduleReminders,
  showDueNotification,
  startForegroundReminders,
  type ForegroundReminders,
} from './lib/reminder'
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
  const [loadError, setLoadError] = useState<{ message: string; detail: string } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  /** 保存データの開き具合。時間がかかっていることを画面に出すために見張る。 */
  const [dbStatus, setDbStatus] = useState<DbStatus>('idle')
  const [triaging, setTriaging] = useState(false)
  const [wrappingUp, setWrappingUp] = useState(false)
  const [editingCalendar, setEditingCalendar] = useState(false)
  /** いまの時刻（0時からの分）。1分ごとに更新する */
  const [nowMin, setNowMin] = useState(() => toMinutes(timeKey()) ?? 0)
  /** 同期の様子。画面に出して、動いているのか失敗しているのかを分かるようにする */
  const [sync, setSync] = useState<{
    state: 'off' | 'idle' | 'running' | 'ok' | 'error'
    at: string | null
    message: string
  }>({ state: 'off', at: null, message: '' })
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
      setTasks([])
      setLoadError({
        message:
          err instanceof Error
            ? err.message
            : '保存データを読めませんでした。ブラウザを開き直してみてください。',
        detail: err instanceof DbOpenError ? err.detail : '',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * 保存データが開けないときの最後の手段。**台帳の中身は消える。**
   * 開けない以上いまある分は取り出せないので、その旨も画面に書いてある。
   */
  const resetLedger = useCallback(async () => {
    setResetting(true)
    try {
      await repository.resetLedger()
      setConfirmReset(false)
      await load()
      notify('保存データを作り直しました')
    } catch (err) {
      notify(err instanceof Error ? err.message : '作り直せませんでした', 'error')
    } finally {
      setResetting(false)
    }
  }, [load, notify])

  /** 保存に失敗したときは黙って落とさず、必ず画面に出す */
  const guard = useCallback(
    async (run: () => Promise<void>) => {
      try {
        await run()
      } catch (err) {
        notify(
          err instanceof Error ? err.message : '保存できませんでした。もう一度試してください。',
          'error',
        )
      }
    },
    [notify],
  )

  useEffect(() => onDbStatus((st) => setDbStatus(st)), [])

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
      setNowMin(toMinutes(timeKey()) ?? 0)
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
        next = nextOccurrence(task, today, { workHours: settings.workHours, workCalendar: settings.workCalendar })
        if (next) await repository.add([next])
      }
      await reload()
      if (next) notify(`完了。次は ${formatMD(next.due ?? '')}（${repeatLabel(task.repeat)}）`)
    },
    [reload, today, settings.workHours, settings.workCalendar, notify],
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
          timebox: draft.timebox,
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

  /* --- 期限のリマインド ---
     予約に対応した端末では、7日先までのぶんを Service Worker に預ける。
     対応していない端末では、アプリを開いている間だけタイマーで出す。
     どちらも端末内で完結し、予定を外へ送らない。 */
  useEffect(() => {
    if (loading) return
    void rescheduleReminders(tasks, settings)
  }, [tasks, settings, loading])

  const liveRef = useRef({ tasks, settings })
  liveRef.current = { tasks, settings }
  const fgRef = useRef<ForegroundReminders | null>(null)
  useEffect(() => {
    const fg = startForegroundReminders(
      () => liveRef.current.tasks,
      () => liveRef.current.settings,
      (task) => void showDueNotification(task, liveRef.current.settings.reminderLeadMin),
    )
    fgRef.current = fg
    return () => {
      fgRef.current = null
      fg.stop()
    }
  }, [])
  // 台帳や設定が変わったら張り直す（起動直後の読み込み完了もここを通る）
  useEffect(() => {
    fgRef.current?.refresh()
  }, [tasks, settings])

  /* --- 端末どうしの同期 ---
     置き場は Google Drive のアプリ専用フォルダ。1件ずつ更新時刻で
     突き合わせるので、スマホとPCで同時に触っても片方が消えない。
     既定は切で、設定で入れたときだけ動く。 */

  const syncingRef = useRef(false)

  const runSync = useCallback(
    async (manual: boolean) => {
      const s = liveRef.current.settings
      if (!s.syncEnabled || !s.googleClientId) {
        setSync((v) => (v.state === 'off' ? v : { ...v, state: 'off' }))
        return
      }
      // 手動でないときは、既に繋がっているときだけ動かす。
      // 黙って同意画面を出すと、操作の途中で邪魔になる。
      if (!manual && !isConnected()) return
      if (syncingRef.current) return
      syncingRef.current = true
      setSync((v) => ({ ...v, state: 'running', message: '' }))
      try {
        const [tasksNow, tombstones] = await Promise.all([
          repository.list(),
          repository.listTombstones(),
        ])
        const out = await syncOnce(
          s.googleClientId,
          { tasks: tasksNow, deleted: tombstones },
          (upsert, removeIds, deleted) => repository.applySync(upsert, removeIds, deleted),
          s.workCalendar,
        )
        // 向こうの会社カレンダーのほうが新しければ、こちらへ入れ直す
        if (out.calendar) {
          const next: Settings = { ...liveRef.current.settings, workCalendar: out.calendar }
          setSettings(next)
          await repository.saveSettings(next)
        }
        await reload()
        setSync({ state: 'ok', at: out.at, message: '' })
        if (manual) {
          notify(
            out.pulled + out.removed > 0
              ? `同期しました（取り込み ${out.pulled}件・削除 ${out.removed}件）`
              : '同期しました（変わりなし）',
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '同期できませんでした'
        setSync((v) => ({ state: 'error', at: v.at, message }))
        if (manual) notify(message, 'error')
      } finally {
        syncingRef.current = false
      }
    },
    [reload, notify],
  )

  // 読み込み直後と、画面に戻ってきたときに合わせる
  useEffect(() => {
    if (loading || loadError) return
    void runSync(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSync(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loading, loadError, runSync])

  // 手元が変わったら少し置いてから上げる（連打でも1回にまとめる）
  useEffect(() => {
    if (loading || !settings.syncEnabled) return
    const id = window.setTimeout(() => void runSync(false), 4000)
    return () => window.clearTimeout(id)
  }, [tasks, loading, settings.syncEnabled, runSync])

  /**
   * 置き場を空にする。手元の台帳には触らない。
   * 同期を入れたまま消しても、次の同期ですぐ上がり直してしまうので、
   * ここで同期も切る（消したのに残っている、という嘘をつかないため）。
   */
  const clearSyncStore = useCallback(async () => {
    const s = liveRef.current.settings
    if (!s.googleClientId) throw new Error('GoogleのクライアントIDが未設定です。')
    const off: Settings = { ...s, syncEnabled: false }
    setSettings(off)
    await repository.saveSettings(off)
    const n = await clearRemote(s.googleClientId)
    setSync({ state: 'off', at: null, message: '' })
    notify(n > 0 ? '置き場を空にし、同期を切りました' : '置き場は空でした。同期を切りました')
  }, [notify])

  /* --- 朝の仕分け・明日の準備 --- */

  const overdueTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'open' && !!t.due && diffDays(t.due, today) < 0)
        .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')),
    [tasks, today],
  )

  const applyTriage = useCallback(
    async (task: Task, action: TriageAction) => {
      if (action.kind === 'today') {
        await repository.update(task.id, { due: today, timebox: action.timebox })
      } else if (action.kind === 'tomorrow') {
        await repository.update(task.id, { due: addDaysKey(today, 1), timebox: null })
      } else if (action.kind === 'someday') {
        await repository.update(task.id, { due: null, timebox: null })
      } else {
        await repository.update(task.id, { status: 'done', doneAt: new Date().toISOString() })
        const next = nextOccurrence(task, today, { workHours: settings.workHours, workCalendar: settings.workCalendar })
        if (next) await repository.add([next])
      }
      await reload()
    },
    [today, reload, settings.workHours, settings.workCalendar],
  )

  const pushToTomorrow = useCallback(
    async (list: Task[]) => {
      const due = addDaysKey(today, 1)
      for (const t of list) await repository.update(t.id, { due, timebox: null })
      await reload()
      notify(list.length === 1 ? '明日へ送りました' : `${list.length}件を明日へ送りました`)
    },
    [today, reload, notify],
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
          {/* 同期の様子。動いているのか失敗しているのかを、押さずに分かるようにする */}
          {settings.syncEnabled && (
            <button
              type="button"
              className={`tp-sync tp-sync-${sync.state}`}
              onClick={() => void runSync(true)}
              disabled={sync.state === 'running'}
            >
              <Icon name={sync.state === 'error' ? 'alert' : 'repeat'} size={13} />
              <span>
                {sync.state === 'running'
                  ? '同期しています…'
                  : sync.state === 'error'
                    ? '同期できていません'
                    : sync.at
                      ? `同期 ${sync.at.slice(11, 16)}`
                      : '押すと同期します'}
              </span>
            </button>
          )}
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
        {/* 保存データが開けなくても、画面そのものは動かす。
            1つ開けないだけで全部の画面が使えなくなると、書き出しにも設定にも
            手が届かなくなる（v1.6.0 で実機がこの状態になった）。
            台帳は空で出し、いま何が起きていて何ができないかを上に出す。 */}
        {loadError && (
          <div className="tp-fatal" role="alert">
            <Icon name="alert" size={26} />
            <p className="tp-fatal-head">保存データを開けませんでした</p>
            <p className="tp-fatal-body">{loadError.message}</p>
            <p className="tp-fatal-body">
              画面は使えますが、<b>いまタスクは読めておらず、新しい登録も保存できません。</b>
            </p>
            {loadError.detail && (
              <p className="tp-fatal-detail tp-mono">理由: {loadError.detail}</p>
            )}
            <div className="tp-fatal-acts">
              <button type="button" className="tp-btn-primary" onClick={() => void load()}>
                もう一度開く
              </button>
              {!confirmReset && (
                <button type="button" className="tp-btn-ghost" onClick={() => setConfirmReset(true)}>
                  保存データを作り直す
                </button>
              )}
            </div>
            {confirmReset && (
              <div className="tp-fatal-reset">
                <p>
                  台帳を空にして作り直します。<b>いま入っているタスクは戻りません。</b>
                  開けていないので、先に書き出して救うこともできません。
                </p>
                <div className="tp-row-end">
                  <button type="button" className="tp-btn-ghost" onClick={() => setConfirmReset(false)}>
                    やめる
                  </button>
                  <button
                    type="button"
                    className="tp-btn-danger"
                    disabled={resetting}
                    onClick={() => void resetLedger()}
                  >
                    <Icon name="trash" size={15} />
                    {resetting ? '作り直しています…' : '消して作り直す'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 開くのに手間取っているだけのときは、待たせずに画面を出す。
            開けた時点で中身が入る。 */}
        {loading && (dbStatus === 'slow' || dbStatus === 'blocked') && (
          <p className="tp-slow" role="status">
            <Icon name="alert" size={15} />
            {dbStatus === 'blocked'
              ? '保存データがほかのタブにさえぎられています。ほかのタブを閉じると続きます。'
              : '保存データを開いています。少し時間がかかっています…'}
          </p>
        )}

        {loading && dbStatus !== 'slow' && dbStatus !== 'blocked' ? (
          <p className="tp-loading">読み込んでいます…</p>
        ) : view === 'list' ? (
          <ListView
            tasks={tasks}
            today={today}
            settings={settings}
            tab={tab}
            onTabChange={setTab}
            onToggle={(t) => void guard(() => toggleDone(t))}
            onEdit={setEditing}
            onToggleSubtask={(t, id) => void guard(() => toggleSubtask(t, id))}
            filter={filter}
            onFilterChange={setFilter}
            saved={settings.savedFilters}
            onSaveFilter={saveFilter}
            onRemoveSavedFilter={removeSavedFilter}
            nowMin={nowMin}
            onTriage={() => setTriaging(true)}
            onWrapUp={() => setWrappingUp(true)}
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
            onSave={(s) => void guard(() => saveSettings(s))}
            sync={sync}
            onSyncNow={() => void runSync(true)}
            onClearRemote={() => guard(() => clearSyncStore())}
            onEditCalendar={() => setEditingCalendar(true)}
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
          workHours={settings.workHours}
          onCommit={(d) => void guard(() => commitDrafts(d))}
          onCancel={() => setPending(null)}
        />
      )}

      {(editing || creating) && (
        <TaskEditor
          task={editing ?? undefined}
          initialDraft={emptyDraft('form')}
          workHours={settings.workHours}
          onSave={(d) => void guard(() => saveEdit(d))}
          onDelete={(t) => void guard(() => removeTask(t))}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}

      {editingCalendar && (
        <WorkCalendarSheet
          settings={settings}
          today={today}
          onNotify={notify}
          onSave={(cal) => void guard(() => saveSettings({ ...settings, workCalendar: cal }))}
          onClose={() => setEditingCalendar(false)}
        />
      )}

      {triaging && (
        <TriageSheet
          tasks={overdueTasks}
          today={today}
          settings={settings}
          onApply={(t, a) => guard(() => applyTriage(t, a))}
          onClose={() => setTriaging(false)}
        />
      )}

      {wrappingUp && (
        <WrapUpSheet
          tasks={tasks}
          today={today}
          settings={settings}
          onPush={(t) => guard(() => pushToTomorrow([t]))}
          onPushAll={(list) => guard(() => pushToTomorrow(list))}
          onClose={() => setWrappingUp(false)}
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
