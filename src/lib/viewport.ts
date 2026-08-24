/* =========================================================
 * いま見えている範囲（visual viewport）を CSS 変数にする
 *
 * スマホでキーボードが出ると、画面の下側がキーボードに隠れる。
 * ブラウザの既定（interactive-widget=resizes-visual）では、
 * ページの高さも `position: fixed` の面の大きさも変わらないので、
 * ポップアップの下半分（入力欄・決める釦）がキーボードの下に潜って、
 * どこに何を打っているのか見えなくなる。
 *
 * visualViewport から「いま見えている高さ」と「その上端の位置」を取り、
 * `--vv-h` / `--vv-t` として根に置く。ポップアップ（`.tp-sheet`）は
 * これを使って**見えている範囲にぴったり**収まる（app.css）。
 *
 * 対応していない端末では変数を置かない。CSS 側は 100dvh / 0 を既定に
 * 書いてあるので、これまでどおりの見た目になる。
 * =======================================================*/

let started = false

/** 起動時に1度だけ呼ぶ。以後はブラウザが動かすたびに書き換える。 */
export function watchViewport(): void {
  if (started) return
  const vv = window.visualViewport
  if (!vv) return
  started = true

  const root = document.documentElement
  let frame = 0

  const apply = () => {
    frame = 0
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
    root.style.setProperty('--vv-t', `${Math.round(vv.offsetTop)}px`)
  }
  // キーボードの出入りは連続して飛んでくるので、1描画に1回へまとめる
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(apply)
  }

  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  apply()
}
