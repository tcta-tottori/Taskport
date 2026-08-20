import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { QuickBar, type SheetMode } from './components/QuickBar'
import { Toast, type ToastMessage } from './components/Toast'
import { TapWave } from './components/TapWave'
import { ListView } from './views/ListView'
import { ScheduleView } from './views/ScheduleView'
import { CalendarView } from './views/CalendarView'
import { PlanSheet } from './views/PlanSheet'
import { StartSheet, type StartMode } from './views/StartSheet'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { ExportSheet } from './views/ExportSheet'
import { ReviewSheet } from './views/ReviewSheet'
import { TaskEditor } from './views/TaskEditor'
import { TemplateSheet } from './views/TemplateSheet'
import { TextSheet } from './views/TextSheet'
import { TriageSheet, type TriageAction } from './views/TriageSheet'
import { WrapUpSheet } from './views/WrapUpSheet'
import { WorkLogView, type LogEntry } from './views/WorkLogView'
import { WorkCalendarSheet } from './views/WorkCalendarSheet'
import { RecordingOverlay } from './views/RecordingOverlay'
import { RecordingsView } from './views/RecordingsView'
import { repository } from './repository'
import { DbOpenError, onDbStatus, type DbStatus } from './repository/LocalRepository'
import { APP_VERSION, buildLabel } from './version'
import { checkForUpdate } from './lib/updater'
import { parseToTasks, type ParseEngine } from './ports/in/parseToTasks'
import { useShareTarget } from './ports/in/useShareTarget'
import { eventToDraft } from './ports/in/fromCalendar'
import { useRecordingSession } from './ports/in/useRecordingSession'
import { voiceSupported } from './ports/in/useVoiceInput'
import { addDaysKey, dayKey, diffDays, durationLabel, formatMD, timeKey, toMinutes } from './lib/date'
import { cleanPlan, emptyPlan, occurrencesInRange, occurrencesOn } from './lib/plans'
import {
  autoTrack,
  beginRun,
  finishRun,
  pauseRun,
  resumeRun,
  runForTask,
  runMinutes,
  runOf,
  runSeconds,
  runsOf,
  type RunBox,
} from './lib/runs'
import { draftToTask, emptyDraft, LIST_TABS, type ListTab } from './lib/tasks'
import { overview } from './lib/stats'
import { isRunning, logToTask, runningMin, runningSec } from './lib/worklog'
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
import { acquireWakeLock, refreshWakeLock, releaseWakeLock } from './lib/keepAlive'
import { ulid } from './lib/ulid'
import { applyTemplate, forget, remember, touch } from './lib/templates'
import { cleanCategories } from './lib/workCategories'
import { hasKey as hasGeminiKey, transcribeAudio } from './lib/gemini'
import {
  cancelTranscribe,
  modelOf,
  transcribe,
  WhisperCancelled,
  whisperSupported,
  type WhisperProgress,
} from './lib/whisper'
import {
  DEFAULT_SETTINGS,
  RUN_KEEP_DAYS,
  type CalendarEvent,
  type CategoryGroup,
  type Draft,
  type Plan,
  type PlanOccurrence,
  type Recording,
  type Settings,
  type Source,
  type Task,
  type TaskFilter,
  type TaskTemplate,
  type WorkRun,
} from './types'

/* =========================================================
 * 画面の組み立てと状態
 *
 * データに触るのは必ず repository 経由。IndexedDB を直接叩かない。
 * 自然文はどの入口から来ても parseToTasks を通り、必ず確認画面に出る。
 * =======================================================*/

type ViewKey = 'list' | 'worklog' | 'calendar' | 'schedule' | 'dashboard' | 'recordings' | 'settings'

const NAV: { key: ViewKey; label: string; icon: IconName }[] = [
  // 「実行」＝いま動かす面と、その日の記録。1日のうちいちばん開くので最上段に置く
  { key: 'worklog', label: '実行', icon: 'play' },
  { key: 'list', label: '一覧', icon: 'list' },
  { key: 'calendar', label: 'カレンダー', icon: 'grid' },
  { key: 'schedule', label: 'スケジュール', icon: 'calendar' },
  { key: 'dashboard', label: '分析', icon: 'chart' },
  { key: 'recordings', label: '録音', icon: 'mic' },
  { key: 'settings', label: '設定', icon: 'gear' },
]

/** 録音を取り直すときの相手。端末内で聞き直すか、Gemini へ送るか。 */
export type RefineEngine = 'local' | 'gemini'

interface Pending {
  drafts: Draft[]
  sourceText: string
  /** 確認画面の上に出す補足（予定からの取り込みなど） */
  hint?: string
  /** 音声から来た場合、確定後にタスクIDを紐づける録音 */
  recordingId?: string
  /** すでに取り直したか（二度押しの案内を変える） */
  refined?: boolean
  /** どの読み手が出した候補か */
  engine?: ParseEngine
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  /** 予定（打合せ・固定の業務）。台帳とは別に持つ */
  const [plans, setPlans] = useState<Plan[]>([])
  /** 実行ログ（開始・一時停止・終了）。新しい日ぶんだけ手元に置く */
  const [runs, setRuns] = useState<WorkRun[]>([])
  /** 直している予定。existing が false なら新しく入れるところ */
  const [planEditing, setPlanEditing] = useState<{ plan: Plan; existing: boolean } | null>(null)
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
  /** いまの時刻（ミリ秒）。実行の経過時間に使う。秒を刻むのは実行の画面だけ。 */
  const [nowMs, setNowMs] = useState(() => Date.now())
  /**
   * キーボードが主な端末か。
   * 幅だけで決めない（タブレットは広くても指で触る）。
   * 「細かく指せる装置がある（マウス等）」と「幅が広い」の両方で判断する。
   */
  const [desktop, setDesktop] = useState(false)
  /** 同期の様子。画面に出して、動いているのか失敗しているのかを分かるようにする */
  const [sync, setSync] = useState<{
    state: 'off' | 'idle' | 'running' | 'ok' | 'error'
    at: string | null
    message: string
  }>({ state: 'off', at: null, message: '' })
  const [view, setView] = useState<ViewKey>('list')
  /** いまの画面。コールバックの中から古い値を掴まないように控える */
  const viewRef = useRef(view)
  viewRef.current = view
  const [tab, setTab] = useState<ListTab>('today')
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER)
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  /**
   * いま開いている入口（＋の扇で選んだもの）。false は閉じている。
   *   form … 手描き（フォーム）／ memory … 記憶の一覧 ／ text … 文章の欄
   * v1.13.0 でこの3つを独立した画面にした（前はフォームの中に同居していた）。
   */
  const [creating, setCreating] = useState<SheetMode | false>(false)
  /** 記憶から呼び出したときの下敷き。フォームを開くときに使う */
  const [seed, setSeed] = useState<Draft | null>(null)
  /** 「始める」の画面（タスクから／区分から）。null なら閉じている */
  const [starting, setStarting] = useState<StartMode | null>(null)
  const [exporting, setExporting] = useState(false)
  /** 録音から高精度で取り直している最中の進み具合。null なら走っていない */
  const [refining, setRefining] = useState<WhisperProgress | null>(null)
  /** 外へ問い合わせている最中の一行（Gemini）。空なら出さない */
  const [stage, setStage] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  /** 記憶したタスク（定型）。登録するたびに控え、直接入力から呼び出す */
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  /** 続けて登録したときに控えを取りこぼさないよう、いまの控えを常に持っておく */
  const templatesRef = useRef<TaskTemplate[]>([])
  /** いまの台帳と設定。あとから走る処理（同期・リマインド）が古い値を掴まないようにする */
  const liveRef = useRef({ tasks: [] as Task[], settings: DEFAULT_SETTINGS, runs: [] as WorkRun[] })
  liveRef.current = { tasks, settings, runs }
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
   * 予定と実行ログを読み直す。台帳とは別のDBなので、
   * ここが開けなくてもタスクの操作は続けられる（黙って落とさず、知らせるだけ）。
   */
  const reloadWork = useCallback(async () => {
    const [p, r] = await Promise.all([
      repository.listPlans(),
      repository.listRuns(addDaysKey(dayKey(), -RUN_KEEP_DAYS)),
    ])
    setPlans(p)
    setRuns(r)
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
      const [list, s, tpl] = await Promise.all([
        repository.list(),
        repository.loadSettings(),
        repository.listTemplates(),
      ])
      setTasks(list)
      setSettings(s)
      setTemplates(tpl)
      templatesRef.current = tpl
      // 予定と実行ログは別のDB。読めなくても台帳は使えるので、ここで握って知らせる。
      try {
        await reloadWork()
        void repository.pruneRuns(addDaysKey(dayKey(), -RUN_KEEP_DAYS)).catch(() => {
          /* 古い記録が残るだけ。画面は止めない */
        })
      } catch {
        setPlans([])
        setRuns([])
        notify('予定と実行の記録を開けませんでした。タスクの操作は続けられます。', 'error')
      }
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
  }, [reloadWork, notify])

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
    const mq = window.matchMedia?.('(min-width: 1024px) and (pointer: fine)')
    if (!mq) return
    const apply = () => setDesktop(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  /**
   * PC のキー操作。
   *   /  … 探す      n … タスクを作る    e … 書き出し
   *   1〜4 … 一覧のタブ              Esc … 開いている面を閉じる
   * 文字を打っている最中は何もしない（入力の邪魔をしない）。
   */
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === 'Escape') {
        if (session.recording) return
        setExporting(false)
        setEditing(null)
        setCreating(false)
        setTriaging(false)
        setWrappingUp(false)
        setEditingCalendar(false)
        setPlanEditing(null)
        setStarting(null)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        setView('list')
        document.querySelector<HTMLInputElement>('.tp-search-input')?.focus()
      } else if (e.key === 'n') {
        e.preventDefault()
        setCreating('form')
      } else if (e.key === 'e') {
        e.preventDefault()
        setExporting(true)
      } else if (e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        setView('list')
        setTab(LIST_TABS[Number(e.key) - 1].key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktop, session.recording])

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
      setNowMs(Date.now())
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  /**
   * 自然文 → 候補（必ず確認画面へ）。ここ以外に登録の経路を作らない。
   *
   * 読み手は端末内か Gemini。Gemini を通るのは、キーが入っていて
   * 設定で入れてあるときだけで、どちらで読んだかは確認画面に出す。
   */
  const runParse = useCallback(
    async (text: string, source: Source, recordingId?: string) => {
      setBusy(true)
      try {
        const s = liveRef.current.settings
        const result = await parseToTasks(text, source, {
          today,
          categoryGroups: s.categoryGroups,
          useGemini: s.geminiEnabled,
          geminiModel: s.geminiModel,
          onStage: (m) => setStage(m),
        })
        if (result.warning) notify(result.warning, 'error')
        if (result.drafts.length === 0) {
          notify('タスクを取り出せませんでした。用件をもう少しはっきり書いてください。', 'error')
          return
        }
        setPending({
          drafts: result.drafts,
          sourceText: text,
          recordingId,
          engine: result.engine,
        })
      } finally {
        setStage('')
        setBusy(false)
      }
    },
    [today, notify],
  )

  /**
   * 録音から高精度で取り直す。
   *
   * 録音中に出ているのは Web Speech の文字で、速いかわりに取りこぼす。
   * ここでは**保存してある音声そのもの**を端末内の Whisper に通して、
   * 精度の高い文字に置き換え、そのまま候補を作り直す。
   *
   * 音声は端末から出ない。外へ取りに行くのは仕組みとモデルだけ。
   * 時間がかかるので、押されたときだけ走らせる（自動にしない）。
   */
  const refineFromRecording = useCallback(
    async (recordingId: string, engine: RefineEngine = 'local') => {
      if (refining) return
      setRefining({ stage: 'decode', percent: null, message: '録音を読み込んでいます…' })
      try {
        const audio = await repository.getRecordingAudio(recordingId)
        if (!audio) {
          notify('この録音の音声が残っていません。設定で「音声を残す」を入れると次から使えます。', 'error')
          return
        }
        const s = liveRef.current.settings
        // 端末内で聞き直すか、Gemini へ音声を送るか。押した側が決める。
        const text = (
          engine === 'gemini'
            ? await transcribeAudio(audio, s.geminiModel, (m) =>
                setRefining({ stage: 'run', percent: null, message: m }),
              )
            : await transcribe(audio, s.whisperModel, setRefining)
        ).trim()
        if (!text) {
          notify('音声から文字を取れませんでした。もう少し近くではっきり話してみてください。', 'error')
          return
        }
        // 取り直した文字を録音の履歴にも残す（次からはこちらが正）
        await repository.updateRecording(recordingId, { transcript: text })
        const result = await parseToTasks(text, 'voice', {
          today,
          categoryGroups: s.categoryGroups,
          useGemini: s.geminiEnabled,
          geminiModel: s.geminiModel,
          onStage: (m) => setRefining({ stage: 'run', percent: null, message: m }),
        })
        if (result.drafts.length === 0) {
          notify('取り直しましたが、タスクを取り出せませんでした。', 'error')
          return
        }
        setPending({
          drafts: result.drafts,
          sourceText: text,
          recordingId,
          refined: true,
          engine: result.engine,
          hint:
            engine === 'gemini'
              ? '録音を Gemini に送って取り直しました。件名を確認してください。'
              : '録音から端末内で取り直しました。件名を確認してください。',
        })
      } catch (err) {
        if (err instanceof WhisperCancelled) return
        // 文言は whisper.ts 側が持っている（何が起きて次に何をすればよいかまで）
        notify(err instanceof Error ? err.message : String(err), 'error')
      } finally {
        setRefining(null)
      }
    },
    [refining, notify, today],
  )

  const stopRefine = useCallback(() => {
    cancelTranscribe()
    setRefining(null)
  }, [])

  // 他アプリから共有されてきた本文も同じパイプラインへ流す
  useEffect(() => {
    if (!share.sharedText || loading) return
    const body = share.sharedText
    share.consume()
    void runParse(body, 'share')
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
    void runParse(text, 'voice', recordingId)
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

  /** 登録したタスクを控える。次から「記憶から呼び出す」で埋められる。 */
  const rememberAll = useCallback(async (list: Task[]) => {
    let next = templatesRef.current
    for (const t of list) next = remember(next, t)
    templatesRef.current = next
    setTemplates(next)
    try {
      await repository.saveTemplates(next)
    } catch {
      // 控えは補助。保存できなくてもタスクの登録は済んでいるので、画面は止めない
    }
  }, [])

  const commitDrafts = useCallback(
    async (drafts: Draft[]) => {
      const newTasks = drafts.map(draftToTask)
      await repository.add(newTasks)
      await rememberAll(newTasks)
      // どの録音から出たタスクかを残す（録音履歴から辿れるようにする）
      if (pending?.recordingId) {
        await repository.updateRecording(pending.recordingId, { taskIds: newTasks.map((t) => t.id) })
      }
      await reload()
      setPending(null)
      notify(`${newTasks.length}件を登録しました`)
      setView('list')
    },
    [reload, notify, pending, rememberAll],
  )

  const toggleDone = useCallback(
    async (task: Task) => {
      const done = task.status === 'done'
      // 実行中のまま完了にしたら、着手からの経過を実績として残す。
      // すでに実績が入っているときは触らない（人が入れた値を上書きしない）。
      const measured =
        !done && isRunning(task) && task.actualMin === null ? runningMin(task) : null
      await repository.update(task.id, {
        status: done ? 'open' : 'done',
        doneAt: done ? null : new Date().toISOString(),
        ...(measured !== null && measured > 0 ? { actualMin: measured } : {}),
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

  /**
   * いま手を付ける／手を止める。
   * 押した時刻を残すだけで、タイマーは持たない（画面を閉じても続く）。
   */
  /**
   * 実行の画面のいちばん上へ移す。
   * 動かし始めたら、いちばん上の「いま動いているもの」がそのまま見えるようにする
   * （一覧やカレンダーから始めると、押した直後にどこで数えているのか分からなかった）。
   * 画面が変わるときは一気に、同じ画面にいるときは滑らせて上へ戻す。
   */
  const goRun = useCallback(() => {
    const same = viewRef.current === 'worklog'
    setDrawer(false)
    setView('worklog')
    // 画面が変わるぶんは view の切り替えで上へ戻る。
    // 同じ画面にいるときだけ、ここで滑らせて上へ返す。
    if (!same) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    })
  }, [])

  /**
   * いま手を付ける／手を止める。
   *
   * 【区間はログ、合計は台帳】
   * 押した時刻の区間を実行ログに積み、止めたときにその日の合計を台帳
   * （`actualMin`）へ書き戻す。`startedAt` は「いま動いている印」で、
   * 止めると消える。それだけだと「何時にやったか」が残らないので、
   * 時間帯の色分け（分析）と日報の枠決めのために区間を残す。
   *
   * 1分に満たないぶんの扱い:
   *   20秒未満 … 押し間違いとみなして記録ごと捨てる
   *   20秒〜1分 … 1分として数える（触った印が残らないと「止めてあるもの」に
   *               出ず、再開する道が消える。最小単位1分は日報の書き方に合わせた）
   */
  const toggleRunning = useCallback(
    async (task: Task) => {
      const at = new Date().toISOString()
      if (isRunning(task)) {
        const open = runOf(liveRef.current.runs, task.id)
        const closed = open ? finishRun(open, at) : null
        if (closed) await repository.saveRun(closed)

        // 実測（この日の区間の合計）。押し間違いは捨てる
        const others = runsOf(liveRef.current.runs, task.id, today).filter((r) => r.id !== closed?.id)
        const sec =
          (closed ? runSeconds(closed) : runningSec(task)) +
          others.reduce((s, r) => s + runSeconds(r), 0)
        const measured = sec >= 20 ? Math.max(1, Math.floor(sec / 60)) : 0
        if (closed && sec < 20) await repository.removeRun(closed.id)

        await repository.update(task.id, {
          startedAt: null,
          actualMin: measured > 0 ? measured : task.actualMin,
        })
        notify(measured > 0 ? `手を止めました（${durationLabel(measured)}を記録）` : '手を止めました')
      } else {
        const open = runOf(liveRef.current.runs, task.id)
        // 同じ日にもう一度始めるときは、前の記録に区間を足す（回数で散らばらせない）
        await repository.saveRun(open ? resumeRun(open, at) : runForTask(task, today))
        await repository.update(task.id, { startedAt: at })
        notify('始めました')
        // 始めたときだけ移る（止めたときは、押した場所にとどまる）
        goRun()
      }
      await reload()
      await reloadWork()
    },
    [reload, reloadWork, notify, goRun, today],
  )

  /** 実績を直す（かかった時間・開始時刻）。実績の画面からその場で使う。 */
  const patchTask = useCallback(
    async (task: Task, patch: Partial<Task>) => {
      await repository.update(task.id, patch)
      await reload()
    },
    [reload],
  )

  /** やった業務を1件、完了済みとして足す。確認画面は通さない（人が自分で書いた1件） */
  const addLog = useCallback(
    async (entry: LogEntry) => {
      const created = logToTask(entry.draft, entry.day, entry.start, entry.minutes)
      await repository.add([created])
      await rememberAll([created])
      await reload()
      notify('記録しました')
    },
    [reload, notify, rememberAll],
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
          categories: cleanCategories(draft.categories),
          subtasks: draft.subtasks.filter((t) => t.title.trim()).map((t) => ({ ...t, title: t.title.trim() })),
          timebox: draft.timebox,
          repeat: draft.repeat,
        })
        notify('保存しました')
      } else {
        const created = draftToTask(draft)
        await repository.add([created])
        await rememberAll([created])
        notify('登録しました')
      }
      await reload()
      setEditing(null)
      setCreating(false)
      setSeed(null)
    },
    [editing, reload, notify, rememberAll],
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

  /* --- 予定（打合せ・固定の業務） ---
     タスクとは別の台帳。完了の丸は付かず、時間だけが埋まる。
     繰り返しは作り置きせず、画面に出すときに展開する（design.md §10.1）。 */

  const openNewPlan = useCallback(
    (day: string) => setPlanEditing({ plan: emptyPlan(day, liveRef.current.settings), existing: false }),
    [],
  )

  const savePlan = useCallback(
    async (plan: Plan, existing: boolean) => {
      await repository.savePlan(cleanPlan(plan))
      await reloadWork()
      setPlanEditing(null)
      notify(existing ? '予定を直しました' : '予定を入れました')
    },
    [reloadWork, notify],
  )

  const removePlan = useCallback(
    async (plan: Plan) => {
      await repository.removePlan(plan.id)
      await reloadWork()
      setPlanEditing(null)
      notify('予定を消しました')
    },
    [reloadWork, notify],
  )

  /** 自動で計上するかを切り替える。実行の画面からその場で押せる。 */
  const togglePlanAuto = useCallback(
    async (plan: Plan) => {
      const next: Plan = { ...plan, autoTrack: !plan.autoTrack, updatedAt: new Date().toISOString() }
      await repository.savePlan(next)
      await reloadWork()
      notify(next.autoTrack ? '時間を自動で計上します' : '開始と終了を手で押します')
    },
    [reloadWork, notify],
  )

  /* --- 予定の実行（開始・一時停止・終了） ---
     タスクの実績は台帳（startedAt / actualMin）が持つので、ここは予定ぶんだけ。
     どちらも同時に動かせる（電話を受けながら伝票を打つ、が実際に起きる）。 */

  const startPlan = useCallback(
    async (occ: PlanOccurrence) => {
      const existing = runOf(liveRef.current.runs, occ.key)
      const next = existing ? resumeRun(existing) : beginRun(occ, { auto: false })
      await repository.saveRun(next)
      await reloadWork()
      notify(`「${occ.plan.title}」を始めました`)
      goRun()
    },
    [reloadWork, notify, goRun],
  )

  const pauseRunning = useCallback(
    async (run: WorkRun) => {
      const next = pauseRun(run)
      await repository.saveRun(next)
      await reloadWork()
      notify(`「${run.title}」を止めました（${durationLabel(runMinutes(next))}）`)
    },
    [reloadWork, notify],
  )

  const resumeRunning = useCallback(
    async (run: WorkRun) => {
      await repository.saveRun(resumeRun(run))
      await reloadWork()
      goRun()
    },
    [reloadWork, goRun],
  )

  const finishRunning = useCallback(
    async (run: WorkRun) => {
      const next = finishRun(run)
      await repository.saveRun(next)
      await reloadWork()
      notify(`「${run.title}」を終えました（${durationLabel(runMinutes(next))}）`)
    },
    [reloadWork, notify],
  )

  /**
   * 区分から1件立てる。飛び込みの作業を、台帳に無くてもその場で数え始めるための口。
   * 件名は区分の名前。**確認画面は挟まない**（AIの解釈ではなく、人が押した1語なので）。
   * 始めるときは台帳の `startedAt` を入れる（タスクの実績はそちらが持つ）。
   */
  const quickTask = useCallback(
    async (category: string, start: boolean) => {
      const created = draftToTask({
        ...emptyDraft('form'),
        title: category,
        categories: [category],
        due: today,
      })
      if (start) {
        created.startedAt = new Date().toISOString()
        await repository.saveRun(runForTask(created, today))
      }
      await repository.add([created])
      await rememberAll([created])
      await reload()
      await reloadWork()
      notify(start ? `「${category}」を立てて始めました` : `「${category}」を立てました`)
      if (start) goRun()
    },
    [today, reload, reloadWork, rememberAll, notify, goRun],
  )

  /** 実行の操作をまとめて画面へ渡す。画面ごとに名前が変わらないようにする。 */
  const runBox: RunBox = useMemo(
    () => ({
      runs,
      nowMs,
      startPlan: (o) => void guard(() => startPlan(o)),
      pause: (r) => void guard(() => pauseRunning(r)),
      resume: (r) => void guard(() => resumeRunning(r)),
      finish: (r) => void guard(() => finishRunning(r)),
      toggleTask: (t) => void guard(() => toggleRunning(t)),
    }),
    [runs, nowMs, guard, startPlan, pauseRunning, resumeRunning, finishRunning, toggleRunning],
  )

  /* --- 予定の自動計上 ---
     「自動」にした予定は、開始時刻で始まり終了時刻で終わる。
     アプリを閉じている間に過ぎていたぶんは、その日ぶんだけ埋める。
     手で止めた記録・終えた記録には触らない（人の操作が常に優先）。 */
  useEffect(() => {
    if (loading || loadError) return
    const occ = occurrencesOn(plans, today, {
      workHours: settings.workHours,
      workCalendar: settings.workCalendar,
    })
    const { save, notes } = autoTrack(occ, runs, today, nowMin)
    if (save.length === 0) return
    void (async () => {
      try {
        await repository.saveRuns(save)
        await reloadWork()
        if (notes.length > 0) notify(notes.join(' / '))
      } catch {
        notify('予定の時間を記録できませんでした。実行の画面から手で開始できます。', 'error')
      }
    })()
  }, [
    plans,
    runs,
    today,
    nowMin,
    loading,
    loadError,
    settings.workHours,
    settings.workCalendar,
    reloadWork,
    notify,
  ])

  /** 記憶したタスクを呼び出してフォームへ流し込む */
  const useTemplate = useCallback((t: TaskTemplate) => {
    setSeed(applyTemplate(emptyDraft('form'), t))
    setCreating('form')
    const next = touch(templatesRef.current, t.id)
    templatesRef.current = next
    setTemplates(next)
    void repository.saveTemplates(next).catch(() => {
      /* 使った回数が残らないだけなので、画面は止めない */
    })
  }, [])

  /** 記憶したタスクを1件忘れる */
  const forgetTemplate = useCallback(async (t: TaskTemplate) => {
    const next = forget(templatesRef.current, t.id)
    templatesRef.current = next
    setTemplates(next)
    await repository.saveTemplates(next)
  }, [])

  /**
   * 区分のマスタを直す。選択画面からも設定画面からも同じここを通る。
   * 直したその場で保存する（「足したのに閉じたら消えた」を起こさないため）。
   */
  const saveCategoryGroups = useCallback(
    (groups: CategoryGroup[]) => {
      const next: Settings = { ...liveRef.current.settings, categoryGroups: groups }
      setSettings(next)
      void repository.saveSettings(next).catch(() => notify('区分を保存できませんでした', 'error'))
    },
    [notify],
  )

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
    async (next: Task[], nextPlans: Plan[], nextSettings: Partial<Settings> | null) => {
      await repository.replaceAll(next)
      // 予定は別のDB。取り込んだファイルに入っていないとき（v1.13 以前の書き出し）は触らない
      if (nextPlans.length > 0) await repository.replaceAllPlans(nextPlans)
      if (nextSettings) {
        const merged = { ...settings, ...nextSettings }
        setSettings(merged)
        await repository.saveSettings(merged)
      }
      await reload()
      await reloadWork()
    },
    [reload, reloadWork, settings],
  )

  /* --- 画面を消さない ---
     現場では端末を置いたまま実行の画面を見て手を動かすので、既定で点けたままにする。
     裏へ回すと端末側でロックが外れるため、戻ってきたら取り直す。
     録音中のロックとは別々に数えるので、録音が終わってもここは切れない。 */
  useEffect(() => {
    if (!settings.screenAwake) {
      void releaseWakeLock('app')
      return
    }
    void acquireWakeLock('app')
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void releaseWakeLock('app')
    }
  }, [settings.screenAwake])

  /* --- 期限と予定のリマインド ---
     予約に対応した端末では、7日先までのぶんを Service Worker に預ける。
     対応していない端末では、アプリを開いている間だけタイマーで出す。
     どちらも端末内で完結し、中身を外へ送らない（プッシュサーバは持たない）。 */

  /** 通知に使う予定の展開。7日先まで（リマインドの見る範囲と同じ） */
  const planHorizon = useMemo(
    () =>
      occurrencesInRange(plans, today, addDaysKey(today, 7), {
        workHours: settings.workHours,
        workCalendar: settings.workCalendar,
      }),
    [plans, today, settings.workHours, settings.workCalendar],
  )
  // あとから走るタイマーが古い予定を掴まないよう、いまの展開を持っておく
  const planHorizonRef = useRef(planHorizon)
  planHorizonRef.current = planHorizon

  useEffect(() => {
    if (loading) return
    void rescheduleReminders(tasks, planHorizon, settings)
  }, [tasks, planHorizon, settings, loading])

  const fgRef = useRef<ForegroundReminders | null>(null)
  useEffect(() => {
    const fg = startForegroundReminders(
      () => liveRef.current.tasks,
      () => planHorizonRef.current,
      () => liveRef.current.settings,
      (hit) => void showDueNotification(hit, liveRef.current.settings.reminderLeadMin),
    )
    fgRef.current = fg
    return () => {
      fgRef.current = null
      fg.stop()
    }
  }, [])
  // 台帳・予定・設定が変わったら張り直す（起動直後の読み込み完了もここを通る）
  useEffect(() => {
    fgRef.current?.refresh()
  }, [tasks, planHorizon, settings])

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
  /**
   * いま動かしている本数（タスク＋予定）。止め忘れに気づけるよう引き出しにも出す。
   * タスクは台帳の startedAt、予定は実行の記録。数え方が2つに割れないよう、ここで足す。
   */
  const runningCount = useMemo(
    () => tasks.filter(isRunning).length + runs.filter((r) => r.state === 'running').length,
    [tasks, runs],
  )

  // 起動時のクエリ（PWAショートカット）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('view')
    // 「実行」は ?view=run でも開ける（v1.14 のショートカットを残してある）
    if (v === 'run') setView('worklog')
    else if (
      v === 'worklog' ||
      v === 'calendar' ||
      v === 'schedule' ||
      v === 'dashboard' ||
      v === 'recordings' ||
      v === 'settings'
    ) {
      setView(v)
    }
    // ?dock=voice で開いたときはそのまま録音を始める
    if (params.get('dock') === 'voice' && voiceSupported()) void session.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (key: ViewKey) => {
    setView(key)
    setDrawer(false)
  }

  /**
   * 画面を変えたら、必ずいちばん上から出す。
   * 前の画面の位置が残っていると、開いた先の途中から始まって見える。
   */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view])

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
            {/* 動かしたまま忘れないよう、実行中の本数は引き出しにも出す */}
            {n.key === 'worklog' && runningCount > 0 && (
              <b className="tp-drawer-n is-running">{runningCount}</b>
            )}
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
          {desktop && (
            <p className="tp-keys">
              <kbd>/</kbd> 探す <kbd>n</kbd> タスクを作る <kbd>e</kbd> 書き出し{' '}
              <kbd>1</kbd>〜<kbd>4</kbd> タブ <kbd>Esc</kbd> 閉じる
            </p>
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
            onToggleRunning={(t) => void guard(() => toggleRunning(t))}
            filter={filter}
            onFilterChange={setFilter}
            saved={settings.savedFilters}
            onSaveFilter={saveFilter}
            onRemoveSavedFilter={removeSavedFilter}
            nowMin={nowMin}
            onTriage={() => setTriaging(true)}
            onWrapUp={() => setWrappingUp(true)}
          />
        ) : view === 'calendar' ? (
          <CalendarView
            tasks={tasks}
            plans={plans}
            today={today}
            settings={settings}
            runBox={runBox}
            onEditTask={setEditing}
            onToggleTask={(t) => void guard(() => toggleDone(t))}
            onEditPlan={(p) => setPlanEditing({ plan: p, existing: true })}
            onAddPlan={openNewPlan}
            onAddTask={(day) => {
              setSeed({ ...emptyDraft('form'), due: day })
              setCreating('form')
            }}
          />
        ) : view === 'schedule' ? (
          <ScheduleView
            tasks={tasks}
            plans={plans}
            today={today}
            settings={settings}
            nowMin={nowMin}
            runBox={runBox}
            onEdit={setEditing}
            onEditPlan={(p) => setPlanEditing({ plan: p, existing: true })}
            onAddPlan={openNewPlan}
            onImportEvent={importEvent}
            onNotify={notify}
          />
        ) : view === 'worklog' ? (
          <WorkLogView
            tasks={tasks}
            plans={plans}
            today={today}
            settings={settings}
            templates={templates}
            nowMin={nowMin}
            runBox={runBox}
            onEdit={setEditing}
            onToggle={(t) => void guard(() => toggleDone(t))}
            onToggleRunning={(t) => void guard(() => toggleRunning(t))}
            onPatch={(t, p) => void guard(() => patchTask(t, p))}
            onAddLog={(e) => void guard(() => addLog(e))}
            onEditPlan={(p) => setPlanEditing({ plan: p, existing: true })}
            onTogglePlanAuto={(p) => void guard(() => togglePlanAuto(p))}
            onQuickTask={(c, start) => void guard(() => quickTask(c, start))}
            onChangeCategoryGroups={saveCategoryGroups}
            onNotify={notify}
          />
        ) : view === 'dashboard' ? (
          <DashboardView
            tasks={tasks}
            plans={plans}
            runs={runs}
            today={today}
            settings={settings}
            onPatch={(t, p) => void guard(() => patchTask(t, p))}
          />
        ) : view === 'recordings' ? (
          <RecordingsView
            onNotify={notify}
            refining={refining}
            canRefine={whisperSupported()}
            canGemini={hasGeminiKey()}
            modelLabel={modelOf(settings.whisperModel).size}
            onRefine={(id) => void refineFromRecording(id)}
            onRefineGemini={(id) => void refineFromRecording(id, 'gemini')}
            onStopRefine={stopRefine}
          />
        ) : (
          <SettingsView
            settings={settings}
            tasks={tasks}
            plans={plans}
            onSave={(s) => void guard(() => saveSettings(s))}
            onChangeCategoryGroups={saveCategoryGroups}
            sync={sync}
            onSyncNow={() => void runSync(true)}
            onClearRemote={() => guard(() => clearSyncStore())}
            onEditCalendar={() => setEditingCalendar(true)}
            onRestore={restore}
            onNotify={notify}
          />
        )}
      </main>

      {/* 右下の ＋ だけ。押すと5つの入口（予定・手描き・記憶・文章・マイク）が扇に開く。 */}
      {view !== 'settings' && !session.recording && (
        <QuickBar
          busy={busy}
          voiceSupported={voiceSupported()}
          onStartVoice={() => void session.start()}
          onCreate={(mode) => setCreating(mode)}
          onAddPlan={() => openNewPlan(today)}
          onStart={(mode) => setStarting(mode)}
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
          categoryGroups={settings.categoryGroups}
          onChangeCategoryGroups={saveCategoryGroups}
          onCommit={(d) => void guard(() => commitDrafts(d))}
          onCancel={() => setPending(null)}
          canRefine={!!pending.recordingId && whisperSupported()}
          canGemini={!!pending.recordingId && hasGeminiKey()}
          engine={pending.engine}
          refined={pending.refined === true}
          refining={refining}
          onRefine={() => pending.recordingId && void refineFromRecording(pending.recordingId)}
          onRefineGemini={() =>
            pending.recordingId && void refineFromRecording(pending.recordingId, 'gemini')
          }
          onStopRefine={stopRefine}
          modelLabel={modelOf(settings.whisperModel).size}
        />
      )}

      {/* 手描き（と既存タスクの編集） */}
      {(editing || creating === 'form') && (
        <TaskEditor
          task={editing ?? undefined}
          initialDraft={seed ?? emptyDraft('form')}
          workHours={settings.workHours}
          categoryGroups={settings.categoryGroups}
          onChangeCategoryGroups={saveCategoryGroups}
          onSave={(d) => void guard(() => saveEdit(d))}
          onDelete={(t) => void guard(() => removeTask(t))}
          onClose={() => {
            setEditing(null)
            setCreating(false)
            setSeed(null)
          }}
        />
      )}

      {/* 記憶から呼び出す。選ぶと中身の入ったフォームが開く */}
      {creating === 'memory' && (
        <TemplateSheet
          templates={templates}
          groups={settings.categoryGroups}
          onPick={useTemplate}
          onForget={(t) => void guard(() => forgetTemplate(t))}
          onClose={() => setCreating(false)}
        />
      )}

      {/* 文章から作る。候補は確認画面へ渡る */}
      {creating === 'text' && (
        <TextSheet
          busy={busy}
          onParse={(text) => {
            setCreating(false)
            void runParse(text, 'text')
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {/* 始める。押した時点で数え始め、実行の画面へ移る */}
      {starting && (
        <StartSheet
          mode={starting}
          tasks={tasks}
          today={today}
          settings={settings}
          onStartTask={(t) => {
            setStarting(null)
            void guard(() => toggleRunning(t))
          }}
          onQuickTask={(c, start) => {
            setStarting(null)
            void guard(() => quickTask(c, start))
          }}
          onClose={() => setStarting(null)}
        />
      )}

      {/* 予定を入れる・直す。タスクとは別の画面にして、完了の丸を持たせない */}
      {planEditing && (
        <PlanSheet
          plan={planEditing.plan}
          existing={planEditing.existing}
          categoryGroups={settings.categoryGroups}
          onChangeCategoryGroups={saveCategoryGroups}
          onSave={(p) => void guard(() => savePlan(p, planEditing.existing))}
          onDelete={(p) => void guard(() => removePlan(p))}
          onClose={() => setPlanEditing(null)}
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
          plans={plans}
          onClose={() => setExporting(false)}
          onNotify={notify}
        />
      )}

      {/* 外へ問い合わせている最中は、何をしているかを出す（黙って固まらせない） */}
      {stage && (
        <p className="tp-stage" role="status">
          <span className="tp-spin" aria-hidden="true" />
          {stage}
        </p>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
