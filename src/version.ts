/* =========================================================
 * 版とビルド時刻
 *
 * どちらも vite.config.ts の define でビルド時に埋め込む。
 * メニュー下部と設定画面に出し、「端末に届いているのがどの版か」を
 * 目で確認できるようにする（更新が反映されないときの切り分けに使う）。
 * =======================================================*/

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const BUILD_ISO: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** 「2026.8.18 01:35」。端末のローカル時刻で出す。 */
export function buildLabel(): string {
  if (!BUILD_ISO) return '—'
  const d = new Date(BUILD_ISO)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
