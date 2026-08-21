import { useMemo } from 'react'
import { TimelineAxis, type TimelineItem } from './TimelineAxis'
import { toMinutes } from '../lib/date'
import { taskMinutes } from '../lib/workday'
import { planMinutes } from '../lib/plans'
import { colorOf, primaryCategory } from '../lib/workCategories'
import type { DaySegment } from '../lib/worklog'
import type { CalendarEvent, Plan, PlanOccurrence, Settings, Task } from '../types'

/* =========================================================
 * その日の時間の並び（縦軸）
 *
 * 軸そのものは `TimelineAxis`。ここは「その日に何を置くか」だけを決める。
 *
 * 置くもの
 *   予定（斜線）／ これからやるタスク（塗り）／ Googleの予定（細い斜線）
 *   **実際に動かした記録＝実績（塗り＋ ✓）**（v1.30.0。利用者の指示）
 *
 * 実績を同じ軸に置くのは、予定どおりに動いた日のほうが少ないため。
 * 予定と実績が横に並ぶので、ずれた時間がそのまま読める。
 * =======================================================*/

export function DayTimeline({
  tasks,
  occurrences,
  events,
  actual,
  settings,
  isToday,
  nowMin,
  onEdit,
  onEditPlan,
  onImportEvent,
  onPickActual,
}: {
  /** その日が期限のタスク（未完了・完了とも受け取り、未完了だけ置く） */
  tasks: Task[]
  occurrences: PlanOccurrence[]
  events: CalendarEvent[]
  /** その日に実際に動かした記録。時刻の分かっているものだけ */
  actual: DaySegment[]
  settings: Settings
  isToday: boolean
  nowMin: number
  onEdit: (task: Task) => void
  onEditPlan: (plan: Plan) => void
  onImportEvent: (ev: CalendarEvent) => void
  /** 実績を押したとき（かかった時間・開始時刻を直す） */
  onPickActual: (seg: DaySegment) => void
}) {
  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = []
    for (const o of occurrences) {
      if (o.plan.allDay) continue
      const from = toMinutes(o.plan.startTime ?? '')
      if (from === null) continue
      out.push({
        key: o.key,
        kind: 'plan',
        title: o.plan.title,
        from,
        to: from + planMinutes(o.plan),
        color: colorOf(settings.categoryGroups, primaryCategory(o.plan.categories)),
        sub: o.plan.place,
        onPick: () => onEditPlan(o.plan),
      })
    }
    for (const t of tasks) {
      if (t.status === 'done') continue
      const from = t.dueTime ? toMinutes(t.dueTime) : null
      if (from === null) continue
      out.push({
        key: t.id,
        kind: 'task',
        title: t.title,
        from,
        to: from + taskMinutes(t, settings.defaultEstimateMin),
        color: colorOf(settings.categoryGroups, primaryCategory(t.categories)),
        sub: '',
        onPick: () => onEdit(t),
        running: !!t.startedAt,
      })
    }
    // 実績（押して動かした区間・あとから足した記録）
    for (const seg of actual) {
      out.push({
        key: `ac:${seg.day}-${seg.from}-${seg.to}-${seg.title}`,
        kind: 'done',
        title: seg.title,
        from: seg.from,
        to: seg.to,
        color: colorOf(settings.categoryGroups, seg.category),
        sub: '',
        onPick: () => onPickActual(seg),
        running: seg.live,
      })
    }
    for (const e of events) {
      if (e.allDay || !e.startTime) continue
      const from = toMinutes(e.startTime)
      if (from === null) continue
      const to = e.endTime ? (toMinutes(e.endTime) ?? from + 60) : from + 60
      out.push({
        key: `ev:${e.id}`,
        kind: 'event',
        title: e.title,
        from,
        to: Math.max(to, from + 15),
        color: null,
        sub: e.location,
        onPick: () => onImportEvent(e),
      })
    }
    return out
  }, [tasks, occurrences, events, actual, settings, onEdit, onEditPlan, onImportEvent, onPickActual])

  return (
    <TimelineAxis
      items={items}
      workHours={settings.workHours}
      isToday={isToday}
      nowMin={nowMin}
    />
  )
}
