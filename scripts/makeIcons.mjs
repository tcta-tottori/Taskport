/* =========================================================
 * アイコンの PNG を作り直す
 *
 *   node scripts/makeIcons.mjs
 *
 * 元絵は public/icons/icon.svg の1枚だけ。ここから用途ごとに
 * 倍率を変えて焼く。倍率を変えるのは、maskable（端末が丸く切る）と
 * ファビコン（32pxで潰れる）で、ちょうどよい大きさが違うため。
 *
 * ブラウザ（Chromium）で描いて撮るだけなので、画像ライブラリを足さない。
 * Playwright は開発時にしか使わないので、依存には入れていない
 * （手元に無ければ npm i -D playwright-core して実行する）。
 * =======================================================*/
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8')

/** 出力するもの。scale は絵の拡大率（1 = 安全域ぎりぎり） */
const OUT = [
  { file: 'icon-512-maskable.png', size: 512, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1.14 },
  { file: 'icon-192.png', size: 192, scale: 1.14 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1.14 },
  { file: 'favicon-48.png', size: 48, scale: 1.28 },
  { file: 'favicon-32.png', size: 32, scale: 1.28 },
]

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

for (const { file, size, scale } of OUT) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
       svg{width:${size}px;height:${size}px;display:block}
       /* 絵だけを拡大する。地（rect）は全面のままにしておく */
       #tp-glyph{transform-origin:256px 256px;transform:scale(${scale})}
     </style>${svg}`,
    { waitUntil: 'load' },
  )
  const buf = await page.screenshot({ omitBackground: false })
  writeFileSync(new URL(`../public/icons/${file}`, import.meta.url), buf)
  console.log(`${file}  ${size}px  x${scale}`)
  await page.close()
}
await browser.close()
