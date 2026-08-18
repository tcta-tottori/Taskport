import { dayKey } from '../../lib/date'
import { localParse } from './localParse'
import { geminiParse } from './geminiParse'
import { hasKey, type OnStage } from '../../lib/gemini'
import type { CategoryGroup, Draft, Source } from '../../types'

/* =========================================================
 * 構造化パイプライン（共通）
 *
 * 音声・キーボード・共有、どの入口から来た自然文もここに集約する。
 * 入口ごとに別々の解析処理を書かない。
 *
 * 読み手は2つあり、**どちらを通っても出口は Draft[] で、
 * 必ず確認画面（ReviewSheet）に出る**。無確認で登録する経路を生やさない。
 *
 * | 読み手 | いつ通るか | 文章はどこへ |
 * |---|---|---|
 * | 端末内（localParse） | 既定 | どこへも出ない |
 * | Gemini | 設定でキーを入れ、「文章の解析にGeminiを使う」を入れたときだけ | Googleへ出る |
 *
 * Gemini が失敗したときは黙って落ちず、端末内の解析でやり直したうえで
 * 「どちらで読んだか」を返す。画面はそれを確認画面に出す
 * （どこを通ったか分からないまま登録させない）。
 * =======================================================*/

/** どの読み手が出した候補か。確認画面に出す。 */
export type ParseEngine = 'local' | 'gemini'

export interface ParseResult {
  drafts: Draft[]
  engine: ParseEngine
  /** Gemini を使えなかったときの理由（端末内でやり直した旨を画面に出す） */
  warning: string | null
}

export interface ParseOptions {
  today?: string
  categoryGroups?: CategoryGroup[]
  /** Gemini を使う設定か。キーが無ければ、入っていても使わない */
  useGemini?: boolean
  geminiModel?: string
  /** 進み具合。画面に出すためだけに使う */
  onStage?: OnStage
}

/**
 * 自然文をタスク候補に分解する。
 * 1文＝1タスクを基本とし、期限・時刻・優先度・区分を読み取る。
 * 区分は複数当たることがある（先頭が主区分）。
 */
export async function parseToTasks(
  text: string,
  source: Source,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const body = text.trim()
  if (!body) return { drafts: [], engine: 'local', warning: null }

  const today = options.today ?? dayKey()
  const groups = options.categoryGroups ?? []
  const onStage = options.onStage ?? (() => {})

  if (options.useGemini && hasKey()) {
    try {
      const drafts = await geminiParse(body, source, today, groups, options.geminiModel ?? '', onStage)
      if (drafts.length > 0) return { drafts, engine: 'gemini', warning: null }
      // 1件も取れなかった。端末内でやり直す（捨てるより拾えることがある）
      return {
        drafts: localParse(body, source, today, groups),
        engine: 'local',
        warning: 'Geminiからは候補が返らなかったので、端末内で読み直しました。',
      }
    } catch (err) {
      return {
        drafts: localParse(body, source, today, groups),
        engine: 'local',
        warning: `Geminiを使えなかったので端末内で読みました: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }
    }
  }

  return { drafts: localParse(body, source, today, groups), engine: 'local', warning: null }
}
