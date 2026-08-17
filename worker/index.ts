import Anthropic from '@anthropic-ai/sdk'

/* =========================================================
 * Taskport — AI構造化プロキシ（Cloudflare Workers）
 *
 * ここが APIキーを持つ唯一の場所。クライアントには一切置かない。
 * 受け取るのは認識後のテキストだけで、音声データは扱わない。
 * リクエスト本文はログに残さない（取引先名・品番・数量が含まれるため）。
 * =======================================================*/

export interface Env {
  /** wrangler secret put ANTHROPIC_API_KEY で設定する */
  ANTHROPIC_API_KEY: string
  /** 呼び出しを許可するオリジン。カンマ区切り。空なら同一オリジンのみ想定 */
  ALLOWED_ORIGINS?: string
  /** 使うモデル。未設定なら CLAUDE.md §5 の既定 */
  MODEL?: string
  /** レート制限のカウンタ（任意）。未設定なら制限しない */
  RATE_LIMIT_KV?: KVNamespace
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** 1オリジンあたり 1分間に許す回数 */
const RATE_LIMIT = 20
const RATE_WINDOW_SEC = 60

/** 入力の上限。長すぎる貼り付けでコストが跳ねるのを防ぐ */
const MAX_TEXT_LEN = 6000

/** AI に守らせる出力の形。返ってきた値はクライアント側でも再検証する。 */
const TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '「〜する」で終わる実行形の件名' },
          note: { type: 'string', description: '相手先・品番・数量・背景などの補足。無ければ空文字' },
          due: {
            type: ['string', 'null'],
            description: '期限。"YYYY-MM-DD" 形式。期限の言及がなければ null',
          },
          dueTime: {
            type: ['string', 'null'],
            description: '時刻。"HH:mm" 形式。時刻の指定がなければ null',
          },
          estimateMin: {
            type: ['integer', 'null'],
            description: '見込み所要時間（分）。読み取れなければ null',
          },
          priority: { type: 'string', enum: ['high', 'mid', 'low'] },
          category: {
            type: 'string',
            description: '発注 / 納期確認 / 在庫 / 社内資料 / 会議 / 通関 / 連絡 など。判らなければ空文字',
          },
        },
        required: ['title', 'note', 'due', 'dueTime', 'estimateMin', 'priority', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
} as const

function systemPrompt(today: string, weekday: string): string {
  return [
    'あなたは製造業の生産管理担当者のメモを、実行可能なタスクに分解する担当です。',
    '',
    `今日は ${today}（${weekday}曜日）です。相対的な日付表現はこの日を基準に実日付へ変換してください。`,
    '',
    '守ること:',
    '- 複数の用件を含む文は、用件ごとに別のタスクに分ける。',
    '- title は「〜する」で終わる実行形にし、期限や優先度を表す語は title に残さない。',
    '- 「明日」「来週月曜」「今月末」などは実日付 "YYYY-MM-DD" に変換する。',
    '- 期限の言及がなければ due は null にする。推測で日付を入れない。',
    '- 時刻の指定があるときだけ dueTime を "HH:mm" で入れる。無ければ null。',
    '- 「至急」「今日中」は priority を high、数日以内の期限があるものは mid、それ以外は low。',
    '- 相手先・品番・数量・背景は note に入れる。',
    '- 用件として読み取れない挨拶や相槌はタスクにしない。',
    '- 入力に無い情報を作らない。判らない項目は null か空文字にする。',
  ].join('\n')
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // 許可リストが未設定なら開発中とみなして通す。本番では必ず設定する。
  const ok = allowed.length === 0 || (origin !== null && allowed.includes(origin))
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : allowed[0] ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

/** 呼び出し元ごとの簡易レート制限。KV が無いときは何もしない。 */
async function overLimit(env: Env, key: string): Promise<boolean> {
  if (!env.RATE_LIMIT_KV) return false
  const bucket = `rl:${key}:${Math.floor(Date.now() / (RATE_WINDOW_SEC * 1000))}`
  const current = Number((await env.RATE_LIMIT_KV.get(bucket)) ?? '0')
  if (current >= RATE_LIMIT) return true
  await env.RATE_LIMIT_KV.put(bucket, String(current + 1), { expirationTtl: RATE_WINDOW_SEC * 2 })
  return false
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') {
      return json({ error: 'POST で呼び出してください。' }, 405, cors)
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'サーバ側の設定が未完了です（APIキー未設定）。' }, 500, cors)
    }

    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length > 0 && (!origin || !allowed.includes(origin))) {
      return json({ error: 'このオリジンからの呼び出しは許可されていません。' }, 403, cors)
    }

    const client =
      request.headers.get('CF-Connecting-IP') ?? origin ?? 'anonymous'
    if (await overLimit(env, client)) {
      return json({ error: '短時間に呼び出しすぎました。少し待ってからお試しください。' }, 429, cors)
    }

    let payload: { text?: unknown; today?: unknown; weekday?: unknown }
    try {
      payload = (await request.json()) as typeof payload
    } catch {
      return json({ error: 'リクエストを読めませんでした。' }, 400, cors)
    }

    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    const today = typeof payload.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
      ? payload.today
      : new Date().toISOString().slice(0, 10)
    const weekday = typeof payload.weekday === 'string' ? payload.weekday.slice(0, 2) : ''

    if (!text) return json({ error: '文章が空です。' }, 400, cors)
    if (text.length > MAX_TEXT_LEN) {
      return json({ error: `文章が長すぎます（${MAX_TEXT_LEN}文字まで）。分けて入力してください。` }, 413, cors)
    }

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

    try {
      const message = await anthropic.messages.create({
        model: env.MODEL ?? DEFAULT_MODEL,
        max_tokens: 4096,
        system: systemPrompt(today, weekday),
        messages: [{ role: 'user', content: text }],
        // 出力の形を JSON スキーマで固定する。前置きや ```json フェンスが混ざらない。
        output_config: { format: { type: 'json_schema', schema: TASK_SCHEMA } },
      })

      const content = message.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')

      // クライアントは content を JSON.parse して検証する（返り値を信用しない）
      return json({ content }, 200, cors)
    } catch (err) {
      // 本文はログに残さない。種類だけ分かるようにする。
      const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 0
      console.error('anthropic call failed', { status })
      if (status === 429) {
        return json({ error: 'AIの利用上限に達しました。少し待ってからお試しください。' }, 429, cors)
      }
      return json({ error: 'AI構造化に失敗しました。キーボード入力で登録してください。' }, 502, cors)
    }
  },
}
