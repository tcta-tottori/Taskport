import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { Segmented } from '../components/Segmented'
import { CategoryChip } from '../components/CategoryChip'
import { addDaysKey, durationLabel, formatMDShort, startOfWeek } from '../lib/date'
import { sortTasks } from '../lib/tasks'
import { colorOf, primaryCategory } from '../lib/workCategories'
import { jobLabel, jobRatio, NO_JOB, rangeMinutesByJob, sortJobs, totalsByJob } from '../lib/jobs'
import type { Job, Plan, Settings, Task, WorkRun } from '../types'

/* =========================================================
 * 工数（案件ごとの時間）
 *
 * 「どの仕事にどれだけ時間を使ったか」を案件の単位で見る面。
 * 分析（ANALYSIS）が**日**で見るのに対し、こちらは**案件**で見る。
 *
 * 数えるのは押して測った時間だけ（稼働・円グラフと同じ）。
 * 見積（案件の予算）と実績は別の欄に置き、1つの数字に混ぜない。
 *
 * 期間の数字は実行ログから出す。ログは 90日ぶんしか残らないので、
 * 「合計」（台帳の実績）とは別の行に置いて、どちらが何かを画面に書く。
 * =======================================================*/

type Range = 'week' | 'month' | 'all'

const RANGES: { key: Range; label: string }[] = [
  { key: 'week', label: '今週' },
  { key: 'month', label: '今月' },
  { key: 'all', label: 'すべて' },
]

export function JobsView({
  jobs,
  tasks,
  plans,
  runs,
  today,
  settings,
  onNewJob,
  onEditJob,
  onEditTask,
  onAssign,
}: {
  jobs: Job[]
  tasks: Task[]
  plans: Plan[]
  runs: WorkRun[]
  today: string
  settings: Settings
  onNewJob: () => void
  onEditJob: (job: Job) => void
  onEditTask: (task: Task) => void
  /** タスクを案件に入れる／外す */
  onAssign: (task: Task, jobId: string | null) => void
}) {
  const [range, setRange] = useState<Range>('week')
  const [open, setOpen] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const totals = useMemo(
    () => totalsByJob(tasks, plans, runs, settings.defaultEstimateMin),
    [tasks, plans, runs, settings.defaultEstimateMin],
  )

  const [from, to] = useMemo<[string, string]>(() => {
    if (range === 'all') return ['0000-01-01', '9999-12-31']
    if (range === 'week') {
      const start = startOfWeek(today)
      return [start, addDaysKey(start, 6)]
    }
    return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-31`]
  }, [range, today])

  const inRange = useMemo(
    () => rangeMinutesByJob(tasks, plans, runs, from, to),
    [tasks, plans, runs, from, to],
  )

  const sorted = useMemo(() => sortJobs(jobs), [jobs])
  const live = sorted.filter((j) => !j.closed)
  const closed = sorted.filter((j) => j.closed)

  /** 案件に入れていない仕事。ここが大きいままだと工数が読めない */
  const loose = totals.get(NO_JOB)
  const looseTasks = useMemo(
    () => sortTasks(tasks.filter((t) => !t.jobId && (t.status === 'open' || (t.actualMin ?? 0) > 0))),
    [tasks],
  )

  const rangeTotal = useMemo(() => {
    let sum = 0
    for (const [key, min] of inRange) if (key !== NO_JOB) sum += min
    return sum
  }, [inRange])

  return (
    <div className="tp-view">
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>工数</h2>
            <div className="tp-head-acts">
              <span className="tp-badge tp-mono">{live.length}</span>
              <button type="button" className="tp-btn-ghost tp-btn-sm" onClick={onNewJob}>
                <Icon name="plus" size={15} />
                案件を作る
              </button>
            </div>
          </div>

          <Segmented
            items={RANGES}
            value={range}
            onChange={(v) => setRange(v as Range)}
            ariaLabel="工数を数える期間"
          />
          <p className="tp-hint">
            {range === 'all'
              ? '押して測った時間の合計です。'
              : `${formatMDShort(from)}〜${formatMDShort(to)} に押して測った時間は ${durationLabel(rangeTotal)}。`}
            見積は案件ごとに入れた予算で、実績とは別の数字です。
          </p>

          {live.length === 0 ? (
            <p className="tp-empty-body">
              案件がまだありません。「案件を作る」で1件作ると、タスクと予定から選べるようになります。
            </p>
          ) : (
            <ul className="tp-job-list">
              {live.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  totals={totals.get(job.id)}
                  rangeMin={inRange.get(job.id) ?? 0}
                  range={range}
                  tasks={tasks}
                  isOpen={open === job.id}
                  onToggle={() => setOpen(open === job.id ? null : job.id)}
                  onEditJob={() => onEditJob(job)}
                  onEditTask={onEditTask}
                  onAssign={onAssign}
                />
              ))}
            </ul>
          )}

          {closed.length > 0 && (
            <>
              <button
                type="button"
                className="tp-done-toggle"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((v) => !v)}
              >
                <Icon name="check" size={14} strokeWidth={2.4} />
                締めた {closed.length}件
                <Icon name="chevron" size={15} className={showClosed ? 'tp-caret-up' : 'tp-caret-down'} />
              </button>
              {showClosed && (
                <ul className="tp-job-list">
                  {closed.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      totals={totals.get(job.id)}
                      rangeMin={inRange.get(job.id) ?? 0}
                      range={range}
                      tasks={tasks}
                      isOpen={open === job.id}
                      onToggle={() => setOpen(open === job.id ? null : job.id)}
                      onEditJob={() => onEditJob(job)}
                      onEditTask={onEditTask}
                      onAssign={onAssign}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </Reveal>

      {/* --- 案件に入れていないぶん --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>案件なし</h2>
            <span className="tp-badge tp-mono">{durationLabel(loose?.actualMin ?? 0)}</span>
          </div>
          {looseTasks.length === 0 ? (
            <p className="tp-empty-body">案件に入れていない仕事はありません。</p>
          ) : (
            <>
              <p className="tp-hint">
                案件に入れていない仕事です。押すと案件を選べます（工数はそこへ移ります）。
              </p>
              <ul className="tp-job-tasks">
                {looseTasks.slice(0, 12).map((t) => (
                  <LooseRow key={t.id} task={t} jobs={live} settings={settings} onAssign={onAssign} onEdit={onEditTask} />
                ))}
              </ul>
              {looseTasks.length > 12 && (
                <p className="tp-hint">ほか {looseTasks.length - 12} 件。タスクを開いても案件を選べます。</p>
              )}
            </>
          )}
        </section>
      </Reveal>
    </div>
  )
}

function JobRow({
  job,
  totals,
  rangeMin,
  range,
  tasks,
  isOpen,
  onToggle,
  onEditJob,
  onEditTask,
  onAssign,
}: {
  job: Job
  totals: ReturnType<typeof totalsByJob> extends Map<string, infer V> ? V | undefined : never
  rangeMin: number
  range: Range
  tasks: Task[]
  isOpen: boolean
  onToggle: () => void
  onEditJob: () => void
  onEditTask: (task: Task) => void
  onAssign: (task: Task, jobId: string | null) => void
}) {
  const actual = totals?.actualMin ?? 0
  const rest = totals?.restMin ?? 0
  const ratio = totals ? jobRatio(job, totals) : null
  const pct = ratio === null ? null : Math.round(ratio * 100)
  const mine = useMemo(() => sortTasks(tasks.filter((t) => t.jobId === job.id)), [tasks, job.id])
  const openTasks = mine.filter((t) => t.status === 'open')
  const doneTasks = mine.filter((t) => t.status === 'done')

  return (
    <li className={`tp-job${isOpen ? ' is-open' : ''}${job.closed ? ' is-closed' : ''}`}>
      <button type="button" className="tp-job-head" aria-expanded={isOpen} onClick={onToggle}>
        <span className="tp-job-name">
          {job.code && <b className="tp-mono tp-job-code">{job.code}</b>}
          {job.name}
        </span>
        <span className="tp-job-nums tp-mono">
          {durationLabel(actual)}
          {job.plannedMin > 0 && <small> / {durationLabel(job.plannedMin)}</small>}
        </span>
        <Icon name="chevron" size={16} className={isOpen ? 'tp-caret-up' : 'tp-caret-down'} />
      </button>

      {job.plannedMin > 0 && (
        <div className="tp-progress tp-job-bar">
          <span
            className={pct !== null && pct > 100 ? 'is-over' : pct !== null && pct > 80 ? 'is-tight' : ''}
            style={{ width: `${Math.min(100, pct ?? 0)}%` }}
          />
        </div>
      )}

      <p className="tp-job-meta tp-mono">
        {job.client && <span>{job.client}</span>}
        {range !== 'all' && <span>{RANGES.find((r) => r.key === range)?.label} {durationLabel(rangeMin)}</span>}
        <span>残り見込み {durationLabel(rest)}</span>
        <span>
          {totals?.openCount ?? 0} / {totals?.taskCount ?? 0} 件
        </span>
        {job.due && <span>期限 {formatMDShort(job.due)}</span>}
        {pct !== null && <span className={pct > 100 ? 'tp-over' : ''}>{pct}%</span>}
      </p>

      {isOpen && (
        <div className="tp-job-body">
          {job.note && <p className="tp-note">{job.note}</p>}
          {totals && totals.planMin > 0 && (
            <p className="tp-hint">うち予定（打合せなど）で {durationLabel(totals.planMin)}。</p>
          )}

          {mine.length === 0 ? (
            <p className="tp-empty-body">
              この案件のタスクはまだありません。タスクを開いて「案件」で選ぶと、ここに入ります。
            </p>
          ) : (
            <ul className="tp-job-tasks">
              {[...openTasks, ...doneTasks].slice(0, 20).map((t) => (
                <li key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                  <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEditTask(t)}>
                    <span>{t.title}</span>
                    <span className="tp-mono">
                      {(t.actualMin ?? 0) > 0 ? durationLabel(t.actualMin as number) : '—'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tp-icon-btn"
                    aria-label={`${t.title} を案件から外す`}
                    title="案件から外す"
                    onClick={() => onAssign(t, null)}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="tp-flow-acts">
            <button type="button" className="tp-btn-ghost" onClick={onEditJob}>
              <Icon name="pencil" size={15} />
              案件を直す
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** 案件に入れていない1件。押して案件を選ぶ */
function LooseRow({
  task,
  jobs,
  settings,
  onAssign,
  onEdit,
}: {
  task: Task
  jobs: Job[]
  settings: Settings
  onAssign: (task: Task, jobId: string | null) => void
  onEdit: (task: Task) => void
}) {
  return (
    <li>
      <button type="button" className={`tp-mini tp-pri-${task.priority}`} onClick={() => onEdit(task)}>
        <span>
          {task.title}
          {task.categories.length > 0 && (
            <CategoryChip
              label={primaryCategory(task.categories)}
              color={colorOf(settings.categoryGroups, primaryCategory(task.categories))}
            />
          )}
        </span>
        <span className="tp-mono">
          {(task.actualMin ?? 0) > 0 ? durationLabel(task.actualMin as number) : '—'}
        </span>
      </button>
      <label className="tp-job-pick">
        <span className="tp-sr">案件を選ぶ</span>
        <select value="" onChange={(e) => e.target.value && onAssign(task, e.target.value)}>
          <option value="">案件へ…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {jobLabel(j)}
            </option>
          ))}
        </select>
      </label>
    </li>
  )
}
