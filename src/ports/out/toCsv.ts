import { jobLabel, totalsByJob, NO_JOB } from '../../lib/jobs'
import type { Job, Plan, Task, WorkRun } from '../../types'

/* =========================================================
 * 出口: CSV
 *
 * Excel での集計や上長への共有の逃げ道として、全項目を出す。
 * Excel が UTF-8 と判定できるよう BOM を付ける。
 * =======================================================*/

const HEADERS: { key: keyof Task; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: '件名' },
  { key: 'note', label: 'メモ' },
  { key: 'due', label: '期限' },
  { key: 'dueTime', label: '時刻' },
  { key: 'estimateMin', label: '見込み分' },
  { key: 'actualMin', label: '実績分' },
  { key: 'startedAt', label: '着手日時' },
  { key: 'priority', label: '優先度' },
  { key: 'categories', label: '区分' },
  { key: 'jobId', label: '案件ID' },
  { key: 'status', label: '状態' },
  { key: 'source', label: '入口' },
  { key: 'createdAt', label: '作成日時' },
  { key: 'updatedAt', label: '更新日時' },
  { key: 'doneAt', label: '完了日時' },
]

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  // 区分は複数持てる。カンマだと表計算で列が割れるので中黒でつなぐ
  const s = Array.isArray(value) ? value.join(' ・ ') : String(value)
  // 先頭が = + - @ のセルは表計算ソフトが数式として解釈するので無害化する。
  // 無害化したセルは必ず引用符で囲み、意図が読める形にしておく。
  const neutralized = /^[=+\-@]/.test(s)
  const safe = neutralized ? `'${s}` : s
  return neutralized || /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(tasks: Task[]): string {
  const rows = [
    HEADERS.map((h) => h.label).join(','),
    ...tasks.map((t) => HEADERS.map((h) => cell(t[h.key])).join(',')),
  ]
  return '﻿' + rows.join('\r\n')
}


/* ---------------------------------------------------------
 * 工数（案件ごと）の CSV
 *
 * 上長へ出す形。**実績は押して測った時間だけ**で、見積とは別の列に置く
 * （1つの数字に混ぜると、どちらを見ているか分からなくなる）。
 * ------------------------------------------------------- */

const JOB_HEADERS = [
  '案件',
  '管理番号',
  '相手先',
  '見積時間',
  '実績時間',
  'うち予定',
  '残り見込み',
  '進捗%',
  '件数',
  '未完了',
  '期限',
  '状態',
]

/** 分 → 時間（小数1桁）。日報も工数も時間で書くので、ここで揃える */
function hours(min: number): string {
  return (Math.round((min / 60) * 10) / 10).toFixed(1)
}

export function toJobCsv(
  jobs: Job[],
  tasks: Task[],
  plans: Plan[],
  runs: WorkRun[],
  defaultEstimateMin: number,
): string {
  const totals = totalsByJob(tasks, plans, runs, defaultEstimateMin)
  const rows = [JOB_HEADERS.join(',')]
  for (const j of jobs) {
    const t = totals.get(j.id)
    const actual = t?.actualMin ?? 0
    const pct = j.plannedMin > 0 ? Math.round((actual / j.plannedMin) * 100) : ''
    rows.push(
      [
        cell(jobLabel(j)),
        cell(j.code),
        cell(j.client),
        j.plannedMin > 0 ? hours(j.plannedMin) : '',
        hours(actual),
        hours(t?.planMin ?? 0),
        hours(t?.restMin ?? 0),
        String(pct),
        String(t?.taskCount ?? 0),
        String(t?.openCount ?? 0),
        cell(j.due ?? ''),
        j.closed ? '締め' : '進行中',
      ].join(','),
    )
  }
  // 案件に入れていないぶんも1行出す（合計が合わないと突き合わせができない）
  const loose = totals.get(NO_JOB)
  if (loose && loose.actualMin > 0) {
    rows.push(
      ['案件なし', '', '', '', hours(loose.actualMin), hours(loose.planMin), hours(loose.restMin), '', String(loose.taskCount), String(loose.openCount), '', ''].join(','),
    )
  }
  return '﻿' + rows.join('\r\n')
}
