import type { Task } from '../../types'

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
  { key: 'priority', label: '優先度' },
  { key: 'category', label: '区分' },
  { key: 'status', label: '状態' },
  { key: 'source', label: '入口' },
  { key: 'createdAt', label: '作成日時' },
  { key: 'updatedAt', label: '更新日時' },
  { key: 'doneAt', label: '完了日時' },
]

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
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
