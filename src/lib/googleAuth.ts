/* =========================================================
 * Googleカレンダーの認証（Google Identity Services）
 *
 * ブラウザだけで完結させるため、トークンはメモリにだけ置く。
 * localStorage には保存しない（端末を共有された場合に残るため）。
 * 有効期限は1時間ほどで、切れたら黙って取り直す（画面は出さない）。
 * 取り直せなければ、利用者に「接続」を押してもらう。
 *
 * クライアントIDは利用者が自分の Google Cloud で作り、設定画面に入れる。
 * ここに固定値を書かない。
 * =======================================================*/

/**
 * 求める範囲。
 *   calendar.events … 予定の読み書き。カレンダーの設定そのものは触らない
 *   drive.appdata   … 端末どうしの同期に使う置き場。**アプリ専用フォルダだけ**で、
 *                     利用者の Drive のほかのファイルは見えないし触れない
 * 2つまとめて求めるのは、あとから足すと同意を取り直すことになるため。
 */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.appdata',
]
const SCOPE = SCOPES.join(' ')
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}
interface GoogleAccountsOauth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (res: TokenResponse) => void
    error_callback?: (err: { type?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}
interface GoogleGlobal {
  accounts?: { oauth2?: GoogleAccountsOauth2 }
}

function gis(): GoogleAccountsOauth2 | null {
  return (window as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2 ?? null
}

let scriptPromise: Promise<void> | null = null

/** GIS のスクリプトを1回だけ読み込む */
function loadGis(): Promise<void> {
  if (gis()) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = GIS_SRC
    el.async = true
    el.defer = true
    el.onload = () => resolve()
    el.onerror = () => {
      scriptPromise = null
      reject(new Error('Googleの認証スクリプトを読み込めませんでした。通信を確認してください。'))
    }
    document.head.appendChild(el)
  })
  return scriptPromise
}

let token: string | null = null
let expiresAt = 0
let client: TokenClient | null = null
let clientIdInUse = ''

export function isConnected(): boolean {
  return !!token && Date.now() < expiresAt
}

/** いま持っているトークン。切れていれば null。 */
function currentToken(): string | null {
  return isConnected() ? token : null
}

function ensureClient(clientId: string, onToken: (res: TokenResponse) => void): TokenClient {
  const api = gis()
  if (!api) throw new Error('Googleの認証を初期化できませんでした。')
  if (!client || clientIdInUse !== clientId) {
    clientIdInUse = clientId
    client = api.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: onToken,
      error_callback: () => onToken({ error: 'popup_closed' }),
    })
  }
  return client
}

/**
 * トークンを取る。
 * @param interactive true なら同意画面を出す（利用者が「接続」を押したとき）。
 *                    false なら黙って取り直すだけで、駄目なら null を返す。
 */
export async function acquireToken(clientId: string, interactive: boolean): Promise<string | null> {
  const cached = currentToken()
  if (cached) return cached
  if (!clientId.trim()) {
    throw new Error('GoogleのクライアントIDが未設定です。設定画面で登録してください。')
  }
  await loadGis()

  return new Promise<string | null>((resolve, reject) => {
    let settled = false
    const done = (res: TokenResponse) => {
      if (settled) return
      settled = true
      if (res.access_token) {
        token = res.access_token
        // 期限より1分手前で切れた扱いにして、通信の途中で失効しないようにする
        expiresAt = Date.now() + Math.max(0, (res.expires_in ?? 3600) - 60) * 1000
        resolve(token)
        return
      }
      if (!interactive) {
        resolve(null)
        return
      }
      if (res.error === 'popup_closed' || res.error === 'access_denied') {
        reject(new Error('Googleとの接続がキャンセルされました。'))
      } else {
        reject(new Error(`Googleと接続できませんでした（${res.error ?? '不明なエラー'}）。`))
      }
    }

    let c: TokenClient
    try {
      c = ensureClient(clientId.trim(), done)
    } catch (err) {
      reject(err)
      return
    }
    // 同意済みなら prompt なしで黙って取れる。初回だけ同意画面が出る。
    c.requestAccessToken({ prompt: interactive && !token ? 'consent' : '' })
    // 黙って取る場合、応答が来ないことがあるので待ちすぎない
    if (!interactive) {
      window.setTimeout(() => {
        if (!settled) {
          settled = true
          resolve(null)
        }
      }, 4000)
    }
  })
}

export function disconnect(): void {
  const t = token
  token = null
  expiresAt = 0
  if (t) {
    try {
      gis()?.revoke(t)
    } catch {
      /* 失効させられなくても手元からは消える */
    }
  }
}

/** 認証付きで Google API を叩く。切れていたら1度だけ取り直す。 */
export async function googleFetch(
  clientId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let t = await acquireToken(clientId, false)
  if (!t) {
    t = await acquireToken(clientId, true)
  }
  if (!t) throw new Error('Googleと接続できていません。設定画面から接続してください。')

  const call = (bearer: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    })

  let res = await call(t)
  if (res.status === 401) {
    // 期限切れとみなして取り直す
    token = null
    expiresAt = 0
    const fresh = await acquireToken(clientId, true)
    if (!fresh) throw new Error('Googleとの接続が切れました。設定画面から接続し直してください。')
    res = await call(fresh)
  }
  return res
}
