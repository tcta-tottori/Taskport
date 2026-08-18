import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { cellsOf, readMonth, rowCount, type Rect } from '../lib/calendarPhoto'
import { shiftMonth } from '../lib/workCalendar'
import type { DayKind } from '../lib/workCalendar'

/* =========================================================
 * 写真から休日を読み取る
 *
 * 数字は読まない。年と月から「どのマスが何日か」は計算で分かるので、
 * 写真から要るのは「そのマスが赤いか」だけ（lib/calendarPhoto.ts）。
 *
 *   写真を選ぶ → 年月を合わせる → 日付の並ぶ範囲を四角で囲む → 読む
 *
 * 読んだ結果はその場に出して、押して直せる。直してから取り込む。
 * 写真も判定も端末の中だけで、外へは何も送らない。
 * =======================================================*/

export function PhotoCalendarSheet({
  today,
  onApply,
  onNotify,
  onClose,
}: {
  today: string
  /** 読み取った日を会社カレンダーへ入れる */
  onApply: (entries: { day: string; kind: DayKind }[]) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
  onClose: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [{ year, month1 }, setMonth] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month1: m }
  })
  /** 囲んだ範囲（画像に対する割合）。既定は真ん中あたり */
  const [rect, setRect] = useState<Rect>({ x: 0.08, y: 0.25, w: 0.84, h: 0.6 })
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const [drag, setDrag] = useState<'start' | 'end' | null>(null)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const rows = rowCount(year, month1)

  const choose = (file: File | null) => {
    if (!file) return
    if (src) URL.revokeObjectURL(src)
    setSrc(URL.createObjectURL(file))
    setPicked(null)
  }

  /** 画面の位置を、画像に対する割合へ直す */
  const toRatio = (clientX: number, clientY: number) => {
    const el = imgRef.current
    if (!el) return null
    const b = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (clientY - b.top) / b.height)),
    }
  }

  const onPointer = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toRatio(e.clientX, e.clientY)
    if (!p) return
    setRect((r) =>
      drag === 'start'
        ? { x: p.x, y: p.y, w: Math.max(0.05, r.x + r.w - p.x), h: Math.max(0.05, r.y + r.h - p.y) }
        : { ...r, w: Math.max(0.05, p.x - r.x), h: Math.max(0.05, p.y - r.y) },
    )
  }

  const run = () => {
    const el = imgRef.current
    if (!el) return
    const c = document.createElement('canvas')
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) {
      onNotify('この端末では写真を読み取れませんでした。月の枠から手で入れてください。', 'error')
      return
    }
    g.drawImage(el, 0, 0)
    try {
      const data = g.getImageData(0, 0, c.width, c.height).data
      const res = readMonth(data, c.width, c.height, year, month1, rect)
      setPicked(new Set(res.holidays))
      onNotify(
        res.holidays.length > 0
          ? `${res.holidays.length}日を赤い日として読みました。確かめてから取り込んでください。`
          : '赤い日が見つかりませんでした。囲む範囲を日付だけに合わせてみてください。',
        res.holidays.length > 0 ? 'ok' : 'error',
      )
    } catch {
      onNotify('写真を読み取れませんでした。別の写真を試してください。', 'error')
    }
  }

  const toggle = (day: number) => {
    setPicked((p) => {
      const next = new Set(p ?? [])
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  const apply = () => {
    if (!picked) return
    const pad = (n: number) => String(n).padStart(2, '0')
    const last = new Date(year, month1, 0).getDate()
    const entries: { day: string; kind: DayKind }[] = []
    for (let d = 1; d <= last; d++) {
      entries.push({
        day: `${year}-${pad(month1)}-${pad(d)}`,
        kind: picked.has(d) ? 'holiday' : 'workday',
      })
    }
    onApply(entries)
    onNotify(`${year}年${month1}月を取り込みました（休み ${picked.size}日）`)
  }

  const cells = cellsOf(year, month1, rect, 100, 100)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="写真から休日を読み取る">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>写真から読み取る</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            紙のカレンダーを撮って、<b>その月の日付が並ぶ範囲</b>を四角で囲むと、
            <b>赤い日を休みとして拾います</b>。曜日の見出しや月の名前は囲まないでください。
            数字は読まず色だけを見るので、<b>年と月を必ず合わせて</b>ください。
          </p>
          <p className="tp-hint">写真も判定も端末の中だけで行います。外へは送りません。</p>

          {!src ? (
            <label className="tp-photo-pick">
              <Icon name="calendar" size={22} />
              <b>カレンダーの写真を選ぶ</b>
              <small>カメラで撮るか、保存してある写真から選びます</small>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <>
              <div className="tp-cal-head">
                <button
                  type="button"
                  className="tp-icon-btn"
                  aria-label="前の月"
                  onClick={() => { setMonth(shiftMonth(year, month1, -1)); setPicked(null) }}
                >
                  <Icon name="chevron" size={18} className="tp-flip" />
                </button>
                <b className="tp-mono">{year}年 {month1}月</b>
                <button
                  type="button"
                  className="tp-icon-btn"
                  aria-label="次の月"
                  onClick={() => { setMonth(shiftMonth(year, month1, 1)); setPicked(null) }}
                >
                  <Icon name="chevron" size={18} />
                </button>
              </div>

              <div
                className="tp-photo"
                ref={wrapRef}
                onPointerMove={onPointer}
                onPointerUp={() => setDrag(null)}
                onPointerCancel={() => setDrag(null)}
              >
                <img ref={imgRef} src={src} alt="読み取るカレンダー" />
                {/* 囲んだ範囲と、そこを 7×n に割った線 */}
                <div
                  className="tp-photo-rect"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                >
                  {cells.map((c, i) => (
                    <span
                      key={i}
                      className={`tp-photo-cell${c.day === null ? ' is-blank' : ''}${
                        c.day !== null && picked?.has(c.day) ? ' is-red' : ''
                      }`}
                      style={{
                        left: `${((i % 7) / 7) * 100}%`,
                        top: `${(Math.floor(i / 7) / rows) * 100}%`,
                        width: `${100 / 7}%`,
                        height: `${100 / rows}%`,
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className="tp-photo-h is-tl"
                    aria-label="左上の角を動かす"
                    onPointerDown={() => setDrag('start')}
                  />
                  <button
                    type="button"
                    className="tp-photo-h is-br"
                    aria-label="右下の角を動かす"
                    onPointerDown={() => setDrag('end')}
                  />
                </div>
              </div>
              <p className="tp-hint">
                四隅の丸をつまんで、<b>1日から末日までのマス</b>にぴったり合わせてください
                （{rows}行 × 7列に割ります）。
              </p>

              <div className="tp-row-end">
                <label className="tp-btn-ghost tp-photo-re">
                  写真を選び直す
                  <input type="file" accept="image/*" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
                </label>
                <button type="button" className="tp-btn-primary" onClick={run}>
                  <Icon name="sparkle" size={15} />
                  赤い日を読む
                </button>
              </div>

              {picked && (
                <>
                  <h3 className="tp-cal-h">読み取った結果</h3>
                  <p className="tp-note">
                    赤くなっているのが休みです。<b>違うところは押して直せます。</b>
                    取り込むと、この月のほかの日はすべて出勤になります。
                  </p>
                  <div className="tp-cal" role="group" aria-label="読み取った結果">
                    {['月', '火', '水', '木', '金', '土', '日'].map((w) => (
                      <span key={w} className="tp-cal-w">{w}</span>
                    ))}
                    {cells.map((c, i) =>
                      c.day === null ? (
                        <span key={`b${i}`} className="tp-cal-blank" />
                      ) : (
                        <button
                          key={c.day}
                          type="button"
                          className={`tp-cal-d is-${picked.has(c.day) ? 'holiday' : 'workday'}`}
                          onClick={() => toggle(c.day as number)}
                        >
                          <span className="tp-mono">{c.day}</span>
                        </button>
                      ),
                    )}
                  </div>
                  <p className="tp-cal-count">
                    休み <b className="tp-mono">{picked.size}</b> 日 ／ 出勤{' '}
                    <b className="tp-mono">{new Date(year, month1, 0).getDate() - picked.size}</b> 日
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-ghost" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="tp-btn-primary" disabled={!picked} onClick={() => { apply(); onClose() }}>
            <Icon name="check" size={16} />
            この月を取り込む
          </button>
        </footer>
      </div>
    </div>
  )
}
