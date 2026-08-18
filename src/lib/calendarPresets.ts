/* =========================================================
 * 配ってあるカレンダーの写し
 *
 * 【CLAUDE.md §3.1 の例外】
 * 「実データをコミットしない」を、利用者の明示の指示で外している。
 * 紙のカレンダーを毎回入れ直すのが手間だという理由。
 * 会社名は入れず、日付だけを持つ（どこの会社のものかは分からない状態にする）。
 *
 * 【この数字の出どころ】
 * 配布された紙のカレンダー（2026年7〜12月）を読み取ったもの。
 * 読み違いが黙って稼働率を狂わせるので、次の2つで裏を取ってある。
 *   - 平日の休みが、すべて祝日の名前か、紙に書かれた一斉有給（8/12・8/13・
 *     8/14・11/2）と一致すること
 *   - 7〜12月の稼働122日・休62日が、紙の「年間稼働251日・年間休日114日」と
 *     矛盾しないこと（1〜6月に稼働129日・休52日＝計181日が残り、実日数と合う）
 * それでも写し取りである以上、取り込んだあとに月ごとの内訳を見て
 * 紙と突き合わせてもらう（取り込み画面に月ごとの日数を出している）。
 *
 * 1〜6月は紙が手元に無いので入っていない。別の紙が出てきたら、
 * 写真からの取り込み（PhotoCalendarSheet）か月の枠の手入力で足せる。
 * =======================================================*/

export interface CalendarPreset {
  id: string
  label: string
  /** 対象の範囲（画面に出して、どこまで入るかを分かるようにする） */
  range: string
  holidays: string[]
  workdays: string[]
}

const d = (m: number, days: number[]): string[] =>
  days.map((n) => `2026-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`)

export const PRESET_2026_H2: CalendarPreset = {
  id: '2026-h2',
  label: '2026年 7〜12月',
  range: '2026-07-01 〜 2026-12-31',
  holidays: [
    // 7月: 土日 ＋ 海の日(20)
    ...d(7, [4, 5, 11, 12, 18, 19, 20, 25, 26]),
    // 8月: 土日 ＋ 山の日(11) ＋ 一斉有給(12・13・14)
    ...d(8, [1, 2, 8, 9, 11, 12, 13, 14, 15, 16, 22, 23, 29, 30]),
    // 9月: 土日（19・26 は出勤）＋ 敬老の日(21)・国民の休日(22)・秋分の日(23)
    ...d(9, [5, 6, 12, 13, 20, 21, 22, 23, 27]),
    // 10月: 土日（31 は出勤）＋ スポーツの日(12)
    ...d(10, [3, 4, 10, 11, 12, 17, 18, 24, 25]),
    // 11月: 土日（7 は出勤）＋ 一斉有給(2)・文化の日(3)・勤労感謝の日(23)
    ...d(11, [1, 2, 3, 8, 14, 15, 21, 22, 23, 28, 29]),
    // 12月: 土日 ＋ 年末(30・31)
    ...d(12, [5, 6, 12, 13, 19, 20, 26, 27, 30, 31]),
  ],
  workdays: [
    // 出勤の土曜
    ...d(9, [19, 26]),
    ...d(10, [31]),
    ...d(11, [7]),
  ],
}

export const PRESETS: CalendarPreset[] = [PRESET_2026_H2]

/** 月ごとの内訳。紙と1行ずつ突き合わせるために出す。 */
export interface MonthCount {
  year: number
  month1: number
  /** その月の日数 */
  days: number
  work: number
  off: number
}

export function monthCounts(
  from: string,
  to: string,
  isWork: (day: string) => boolean,
): MonthCount[] {
  const out: MonthCount[] = []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    const days = new Date(y, m, 0).getDate()
    let work = 0
    for (let i = 1; i <= days; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(i).padStart(2, '0')}`
      if (isWork(key)) work++
    }
    out.push({ year: y, month1: m, days, work, off: days - work })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}
