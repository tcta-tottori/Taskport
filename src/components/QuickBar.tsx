import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon, type IconName } from './Icon'
import type { Routine } from '../lib/routines'

/* =========================================================
 * 画面下に固定するボタン
 *
 * 右下の ＋ だけ。録音もこの中（扇のマイク）から始める。
 *
 * ＋を押す（または長押しする）と、＋の周り 1/4 の円に沿って7つの入口が開く。
 * **2層**にしてある（v1.22.0。利用者の指示）。
 *
 *   1層目（＋に近い側）… 区分・始める・予定 ＝ **いま動かす／その日に入れる**
 *   2層目（奥側）      … 手描き・記憶・文章・マイク ＝ **あとでやることを作る**
 *
 * よく押すものを近くに置き、1層目は指を伸ばさずに届く。
 * 2層目の角度は1層目の隙間に来るように 15° ずらしてあるので、
 * 名前が前の層の丸と重ならない。
 * いちばん指の届く左端はマイクに残す（長押しのまま左へ滑らせて録音、が v1.12.1 からの手癖）。
 *
 * **長押しはそのまま滑らせて選べる。** 指を置いたまま扇が開き、
 * 目当てのアイコンまで滑らせて離すと、そこが動く。指を離す位置で決まるので、
 * 押す→離す→また押す、の3手が1手で済む。
 * どのアイコンにも乗っていないまま離したときは、開いたままにして待つ
 * （狙いを外しただけで閉じられると、もう一度長押しからやり直しになる）。
 *
 * **よくやる業務**（v1.32.0。利用者の指示）は、名前の見える札で並ぶ。
 * 実行の画面に置いていたときは「次の作業」を押し下げていたので、ここへ移した。
 * v1.33.0（利用者の指示）で**画面の真ん中あたり**へ置き、時間の表示をやめた。
 * 出すのは何をやるか（項目の名前）だけ。扇と同じで、長押しのまま滑らせて選べる。
 *
 * v1.10 までの統合バー（下辺いっぱいのバー）は廃止済み。
 * 左下に別で置いていた録音ボタンも v1.12.1 で外した。同じ形の丸が2つあると
 * どちらを押したのか分からなくなるうえ、マイクは扇の中にもう1つある。
 * =======================================================*/

/**
 * ＋から開く入口。
 *   始める … 区分から（cat）／タスクから（task）。押した時点で時間を数え始める
 *   作る   … 予定（plan）・手描き（form）・記憶（memory）・文章（text）・マイク（voice）
 */
export type MakeMode = 'catStart' | 'taskStart' | 'plan' | 'form' | 'memory' | 'text' | 'voice'

/**
 * 扇で選べるもの。よくやる業務は件名が人によって違うので、
 * 決め打ちの入口とは分けて `routine:<番号>` で表す。
 */
type FanPick = MakeMode | `routine:${number}`

/** タスクを作る画面を開く3つ（マイク・予定・始める系は別の道なので外してある） */
export type SheetMode = 'form' | 'memory' | 'text'

/**
 * 扇の並び。角度は数学の向き（90°＝真上、180°＝真横の左）。
 * `ring` が層（1＝＋に近い側、2＝奥）。半径は CSS の --fan-r1 / --fan-r2。
 */
const ITEMS: {
  mode: MakeMode
  label: string
  icon: IconName
  /** 層。1 が手前 */
  ring: 1 | 2
  angle: number
  hint: string
  /** 「始める」の組。色を分けて、作る系と見分けられるようにする */
  start?: boolean
}[] = [
  // 1層目 — いま動かす／その日に入れる
  { mode: 'catStart', label: '区分', icon: 'grid', ring: 1, angle: 90, hint: '区分から1件立てて、いま始める', start: true },
  { mode: 'taskStart', label: '始める', icon: 'play', ring: 1, angle: 130, hint: 'タスクを選んで、いま始める', start: true },
  { mode: 'plan', label: '予定', icon: 'calendar', ring: 1, angle: 170, hint: '打合せなど、その時間そこにいるものを入れる' },
  // 2層目 — あとでやることを作る
  { mode: 'form', label: '手描き', icon: 'pencil', ring: 2, angle: 90, hint: '自分で書いて1件作る' },
  { mode: 'memory', label: '記憶', icon: 'checklist', ring: 2, angle: 118, hint: '記憶したタスクから呼び出す' },
  { mode: 'text', label: '文章', icon: 'sparkle', ring: 2, angle: 146, hint: '文章からまとめて作る' },
  { mode: 'voice', label: 'マイク', icon: 'mic', ring: 2, angle: 174, hint: '話してタスクにする' },
]

/** ここまで押し続けたら「長押し」とみなす（ミリ秒） */
const HOLD_MS = 300
/** 閉じるアニメーションの長さ（CSS の tpFanOut ＋ ずらしぶんと合わせる） */
const CLOSE_MS = 320

export function QuickBar({
  onStartVoice,
  onCreate,
  onAddPlan,
  onStart,
  onStartRoutine,
  routines,
  busy,
  voiceSupported,
}: {
  /** 録音を始める（画面は App 側の録音オーバーレイに切り替わる） */
  onStartVoice: () => void
  /** タスクを作る画面を、選んだ入口で開く */
  onCreate: (mode: SheetMode) => void
  /** 予定を入れる画面を開く（今日を下敷きにする） */
  onAddPlan: () => void
  /** 「始める」の画面を開く。タスクから／区分から を選んだ側で開く */
  onStart: (mode: 'task' | 'category') => void
  /** よくやる業務を1押しで始める */
  onStartRoutine: (routine: Routine) => void
  /** よくやる業務（上位5件）。空なら札は出さない */
  routines: Routine[]
  busy: boolean
  voiceSupported: boolean
}) {
  const [open, setOpen] = useState(false)
  /** 閉じている最中（吸い込まれるアニメーションを見せてから消す） */
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  /** 滑らせている指がいま乗っているアイコン（または業務の札） */
  const [hot, setHot] = useState<FanPick | null>(null)
  const holdRef = useRef<number | null>(null)
  /**
   * 次の click を1回だけ捨てる。
   * 長押しで開いたときと、滑らせて選んだときは、指を離した直後に click が続けて
   * 飛んでくる。そのまま通すと開いた扇がその場で閉じる（＝選べない）。
   */
  const swallowClick = useRef(false)
  /** 指を置いたまま選んでいる最中か */
  const draggingRef = useRef(false)
  /** 離した瞬間の値を読むための控え（state は次の描画まで古いことがある） */
  const hotRef = useRef<FanPick | null>(null)

  /** 閉じる。アニメーションを見せてから外す */
  const close = useCallback(() => {
    setClosing((wasClosing) => {
      if (wasClosing) return true
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null
        setOpen(false)
        setClosing(false)
      }, CLOSE_MS)
      return true
    })
  }, [])

  /** 開く。閉じかけていたら引き戻す */
  const openFan = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosing(false)
    setOpen(true)
  }, [])

  // 開いている間は Esc で閉じる（PC）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const clearHold = () => {
    if (holdRef.current !== null) {
      window.clearTimeout(holdRef.current)
      holdRef.current = null
    }
  }
  useEffect(() => clearHold, [])

  const setHover = (next: FanPick | null) => {
    hotRef.current = next
    setHot(next)
  }

  const pick = (p: FanPick) => {
    close()
    setHover(null)
    if (p.startsWith('routine:')) {
      const r = routines[Number(p.slice('routine:'.length))]
      if (r) onStartRoutine(r)
      return
    }
    const mode = p as MakeMode
    if (mode === 'voice') onStartVoice()
    else if (mode === 'plan') onAddPlan()
    else if (mode === 'catStart') onStart('category')
    else if (mode === 'taskStart') onStart('task')
    else onCreate(mode)
  }

  /** 指の下にあるアイコン（または業務の札）を拾う。扇は＋の外にあるので、座標で見る */
  const hitTest = (x: number, y: number): FanPick | null => {
    const el = document.elementFromPoint(x, y)
    const btn = el instanceof Element ? el.closest('.tp-fan-btn, .tp-fan-run') : null
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return null
    return (btn.dataset.mode as FanPick) ?? null
  }

  return (
    <div className={`tp-quick${open && !closing ? ' is-open' : ''}`}>
      {/* 開いている間は、外を押すと閉じる面を敷く */}
      {open && (
        <button
          type="button"
          className="tp-fan-backdrop"
          aria-label="閉じる"
          onClick={close}
        />
      )}

      <div className="tp-fan">
        {/* よくやる業務（上位5件）。扇の上に**名前の見える札**で出す（v1.32.0。利用者の指示）。
            丸のアイコンでは件名が読めないので、ここだけ形を変えてある。
            下から順に「よくやる順」。いちばん押すものが親指のいちばん近くに来る。 */}
        {open && routines.length > 0 && (
          <div className="tp-fan-runs-wrap">
            <ul className="tp-fan-runs" aria-label="よくやる業務">
              {routines.map((r, i) => {
                const key: FanPick = `routine:${i}`
                return (
                  <li
                    key={r.key}
                    className={`tp-fan-run-item${closing ? ' is-out' : ''}`}
                    style={{ '--i': i } as CSSProperties}
                  >
                    <button
                      type="button"
                      className={`tp-fan-run${hot === key ? ' is-hot' : ''}`}
                      data-mode={key}
                      aria-label={`${r.title} を始める`}
                      title={`${r.title} を始める`}
                      onClick={() => pick(key)}
                    >
                      <Icon name="play" size={15} strokeWidth={2} />
                      <span className="tp-fan-run-title">{r.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {open &&
          ITEMS.map((it, i) => {
            const rad = (it.angle * Math.PI) / 180
            const disabled = it.mode === 'voice' && (busy || !voiceSupported)
            return (
              <div
                key={it.mode}
                className={`tp-fan-item${closing ? ' is-out' : ''} tp-ring-${it.ring}`}
                style={
                  {
                    // 半径は CSS が持つ（層と画面幅で変える）。ここは向きだけを渡す。
                    '--fx': Math.cos(rad).toFixed(4),
                    '--fy': (-Math.sin(rad)).toFixed(4),
                    '--i': i,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className={`tp-fan-btn${it.mode === 'plan' ? ' is-plan' : ''}${
                    it.start ? ' is-start' : ''
                  }${hot === it.mode ? ' is-hot' : ''}`}
                  data-mode={it.mode}
                  disabled={disabled}
                  aria-label={`${it.label}：${it.hint}`}
                  title={it.hint}
                  onClick={() => pick(it.mode)}
                >
                  <Icon name={it.icon} size={19} strokeWidth={2} />
                  <span className="tp-fan-label">{it.label}</span>
                </button>
              </div>
            )
          })}

        <button
          type="button"
          className={`tp-quick-btn tp-quick-add${open && !closing ? ' is-on' : ''}`}
          aria-expanded={open && !closing}
          aria-label={open && !closing ? '作り方を閉じる' : 'タスクを作る'}
          title={open && !closing ? '閉じる' : 'タスクを作る'}
          onPointerDown={(e) => {
            swallowClick.current = false
            setHover(null)
            clearHold()
            // 指を離すまで動きを追い続けるために、この指をこのボタンに預ける
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* 対応していない端末では、そのまま下の hitTest だけで動く */
            }
            // 長押し: 指を置いたまま開き、そのまま滑らせて選べる
            holdRef.current = window.setTimeout(() => {
              holdRef.current = null
              swallowClick.current = true
              draggingRef.current = true
              openFan()
            }, HOLD_MS)
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return
            setHover(hitTest(e.clientX, e.clientY))
          }}
          onPointerUp={(e) => {
            clearHold()
            if (!draggingRef.current) return
            draggingRef.current = false
            const mode = hitTest(e.clientX, e.clientY) ?? hotRef.current
            setHover(null)
            // アイコンの上で離したら、そこが動く。外していたら開いたまま待つ
            if (mode) {
              swallowClick.current = true
              pick(mode)
            }
          }}
          onPointerCancel={() => {
            clearHold()
            draggingRef.current = false
            setHover(null)
          }}
          onClick={() => {
            clearHold()
            if (swallowClick.current) {
              swallowClick.current = false
              return
            }
            if (open && !closing) close()
            else openFan()
          }}
        >
          <Icon name="plus" size={28} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
