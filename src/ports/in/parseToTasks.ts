import { dayKey } from '../../lib/date'
import { localParse } from './localParse'
import type { Draft, Source } from '../../types'

/* =========================================================
 * 構造化パイプライン（共通）
 *
 * 音声・キーボード・共有、どの入口から来た自然文もここに集約する。
 * 入口ごとに別々の解析処理を書かない。
 *
 * 解析は端末内で完結させる。外部のAIサービスには送らない
 * （利用者の判断。design.md §10.1）。取引先名・品番・数量を含む
 * 文章が端末から出ないので、送信経路そのものを持たない。
 *
 * 出てきた Draft[] は必ず確認画面（ReviewSheet）に出す。
 * 無確認で登録する経路をここから生やさないこと。
 * =======================================================*/

export interface ParseResult {
  drafts: Draft[]
}

/**
 * 自然文をタスク候補に分解する。
 * 1文＝1タスクを基本とし、期限・時刻・優先度・区分を読み取る。
 */
export function parseToTasks(
  text: string,
  source: Source,
  options: { today?: string } = {},
): ParseResult {
  const body = text.trim()
  if (!body) return { drafts: [] }
  return { drafts: localParse(body, source, options.today ?? dayKey()) }
}
