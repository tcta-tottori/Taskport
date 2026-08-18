/* =========================================================
 * 写真から休日を読み取る
 *
 * 【なぜ文字を読まないか】
 * 紙のカレンダーの数字を読み取る（OCR）のは、小さく写った写真では当てに
 * ならず、外部の文字認識に送るのは §3.1（外へ出さない）に反する。
 *
 * そこで、**数字は読まずに色だけを見る**。
 * 「何日がどのマスか」は年と月から計算で分かる（1日の曜日と日数が決まれば
 * 並びは一意）。だから写真から要るのは「そのマスが赤いか」だけで済む。
 *
 * 手順は、
 *   1. 利用者が、その月の日付が並ぶ範囲を四角で囲む
 *   2. 年と月から 7列×n行 に割る
 *   3. 各マスの「文字の色」を測り、赤ければ休み
 * 端末の中だけで完結し、外部へは何も送らない。
 *
 * 当然、写真の写りに左右される。だから読み取った結果は必ず月の枠に
 * 出して、人が見て直してから保存する（推測をそのまま保存しない）。
 * =======================================================*/

export interface Rect {
  /** 0〜1 の割合（画像の幅・高さに対して） */
  x: number
  y: number
  w: number
  h: number
}

export interface Cell {
  /** その月の何日か。空きマスは null */
  day: number | null
  /** 画像の中の位置（画素） */
  x: number
  y: number
  w: number
  h: number
}

/** 月の頭の空きマス数（月曜はじまり） */
export function leadingBlanks(year: number, month1: number): number {
  return (new Date(year, month1 - 1, 1).getDay() + 6) % 7
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

export function rowCount(year: number, month1: number): number {
  return Math.ceil((leadingBlanks(year, month1) + daysInMonth(year, month1)) / 7)
}

/** 囲んだ範囲を 7列×n行 に割る */
export function cellsOf(year: number, month1: number, rect: Rect, imgW: number, imgH: number): Cell[] {
  const rows = rowCount(year, month1)
  const lead = leadingBlanks(year, month1)
  const last = daysInMonth(year, month1)
  const x0 = rect.x * imgW
  const y0 = rect.y * imgH
  const cw = (rect.w * imgW) / 7
  const ch = (rect.h * imgH) / rows

  const out: Cell[] = []
  for (let i = 0; i < rows * 7; i++) {
    const day = i - lead + 1
    out.push({
      day: day >= 1 && day <= last ? day : null,
      x: x0 + (i % 7) * cw,
      y: y0 + Math.floor(i / 7) * ch,
      w: cw,
      h: ch,
    })
  }
  return out
}

export interface CellReading {
  day: number
  /** 赤み。大きいほど赤い */
  redness: number
  /** 文字らしい画素の割合（画面で確かめるために持つ） */
  ink: number
  /** 文字らしい画素の数。少なすぎると判定できない */
  pixels: number
  red: boolean
}

/**
 * マス1つの色を測る。
 *
 * マスの中で暗い側（＝インク）の画素だけを集め、その平均色の赤みを見る。
 * 紙の地や罫線に引っ張られないよう、明るい画素は数に入れない。
 */
const MARGIN = 0.08
const MIN_INK_PIXELS = 6

export function readCell(data: Uint8ClampedArray, imgW: number, cell: Cell): CellReading {
  // 枠線を拾わないよう、内側だけを見る。
  // ただし狭く取りすぎない。紙のカレンダーは数字がマスの左上に寄っていて、
  // 1桁の日（1・2・8…）は真ん中を見ても何も無いことがある。
  const mx = Math.round(cell.x + cell.w * MARGIN)
  const my = Math.round(cell.y + cell.h * MARGIN)
  const mw = Math.max(1, Math.round(cell.w * (1 - MARGIN * 2)))
  const mh = Math.max(1, Math.round(cell.h * (1 - MARGIN * 2)))

  // まず、そのマスでいちばん明るいところ（紙の地）を知る
  let paper = 0
  for (let y = my; y < my + mh; y++) {
    for (let x = mx; x < mx + mw; x++) {
      const i = (y * imgW + x) * 4
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (L > paper) paper = L
    }
  }
  // 地より十分暗い画素を「インク」とみなす
  const threshold = paper * 0.72

  let n = 0
  let r = 0
  let g = 0
  let b = 0
  for (let y = my; y < my + mh; y++) {
    for (let x = mx; x < mx + mw; x++) {
      const i = (y * imgW + x) * 4
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (L >= threshold) continue
      n++
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
  }
  if (n === 0) return { day: 0, redness: 0, ink: 0, pixels: 0, red: false }
  r /= n
  g /= n
  b /= n
  // 赤みは「赤 − 緑と青の平均」。黒い数字は 0 付近、赤い数字は大きく出る。
  const redness = r - (g + b) / 2
  return { day: 0, redness, ink: n / (mw * mh), pixels: n, red: false }
}

export interface PhotoResult {
  /** 休みと読めた日 */
  holidays: number[]
  /** 判定に使ったしきい値（画面に出して、調整できるようにする） */
  threshold: number
  /** マスごとの測定値（画面で確かめるために返す） */
  readings: CellReading[]
}

/**
 * 囲んだ範囲から、赤い日を拾う。
 *
 * しきい値を決め打ちにすると、写真の色かぶりで総崩れになる。
 * 測った赤みを並べ、いちばん離れているところで切る（大津の方法の考え方）。
 * ただし全部黒（休みが無い）ときに切ってしまわないよう、下限を設ける。
 */
export function readMonth(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  year: number,
  month1: number,
  rect: Rect,
): PhotoResult {
  const cells = cellsOf(year, month1, rect, imgW, imgH)
  const readings: CellReading[] = []
  for (const c of cells) {
    if (c.day === null) continue
    const r = readCell(data, imgW, c)
    readings.push({ ...r, day: c.day })
  }

  const values = readings.map((r) => r.redness).sort((a, b) => a - b)
  const threshold = splitAt(values)
  // 割合ではなく画素の数で足切りする。「1」のように細い数字は、
  // マスに占める割合が小さくても、ちゃんと書かれている。
  for (const r of readings) r.red = r.pixels >= MIN_INK_PIXELS && r.redness >= threshold

  return {
    holidays: readings.filter((r) => r.red).map((r) => r.day).sort((a, b) => a - b),
    threshold,
    readings,
  }
}

/**
 * 並んだ値を2つの群に分ける切れ目。
 * いちばん広い隙間で切る。
 *
 * 隙間が小さいときは群が2つに分かれていない。そこは値の高さで決める。
 *   - 全部が黒寄り（ふつうの月）→ 誰も赤にしない
 *   - 全部が明らかに赤い（年末年始のように、月まるごと休みの月）→ 全部赤
 * 「明らかに赤い」の線を高めに取ってあるのは、電球色の写真で黒い数字が
 * わずかに赤へ寄るため。そこを赤と読むと、出勤日が丸ごと休みになる。
 */
export function splitAt(sorted: number[]): number {
  const MIN_RED = 14 // これ未満の赤みは、印刷のゆらぎとして赤とみなさない
  const ALL_RED = 30 // 群が1つのとき、これ以上なら「まるごと赤い月」とみなす
  if (sorted.length < 4) return Infinity
  let bestGap = 0
  let bestAt = Infinity
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > bestGap) {
      bestGap = gap
      bestAt = (sorted[i] + sorted[i - 1]) / 2
    }
  }
  // 隙間が狭いなら分かれていない
  if (bestGap < 10) return sorted[0] >= ALL_RED ? -Infinity : Infinity
  return Math.max(bestAt, MIN_RED)
}
