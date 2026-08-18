/* =========================================================
 * Service Worker の登録と更新
 *
 * vite-plugin-pwa が差し込む1行の登録スクリプトは register するだけで、
 * 更新確認も再読み込みもしない。そのため新しい版をデプロイしても
 * 端末には古いキャッシュが出続ける。ここで自前に登録し、
 *   - sw.js を HTTP キャッシュから読ませない（updateViaCache: 'none'）
 *   - 復帰時と一定間隔で更新を確認する
 *   - 新しい版が有効になったら1回だけ再読み込みする
 * を行う。sw.js 側は skipWaiting + clientsClaim なので、
 * 新しい版は待機せずすぐ有効になる。
 * =======================================================*/

/** 更新確認の間隔。頻繁すぎても意味がないので1分に1回。 */
const CHECK_INTERVAL_MS = 60_000

let registration: ServiceWorkerRegistration | null = null

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  // 初回インストール時にも controllerchange は起きる。
  // そのときは再読み込みしない（画面が二度出てしまうため）。
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  const base = import.meta.env.BASE_URL || '/'
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then((reg) => {
      registration = reg
      const check = () => {
        reg.update().catch(() => {
          /* 圏外などで失敗しても次の機会に確認するので黙って流す */
        })
      }
      check()
      window.setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    })
    .catch(() => {
      /* 登録できなくてもアプリ本体は動く */
    })
}

/** 設定画面などから手で更新を確認する。新しい版があれば true。 */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) return false
  try {
    await registration.update()
    return !!(registration.installing || registration.waiting)
  } catch {
    return false
  }
}
