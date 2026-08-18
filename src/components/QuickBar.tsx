import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon, type IconName } from './Icon'

/* =========================================================
 * 画面下に固定するボタン
 *
 * 左下＝録音、右下＝＋（作り方を選ぶ）。
 *
 * ＋を押す（または長押しする）と、＋の周り 1/4 の円に沿って
 * 4つの入口が開く。真上から左へ順に
 *   手描き（自分で書く）→ 記憶（控えから呼び出す）→ 文章（自然文）→ マイク
 * 並びは利用者のスケッチのとおり。親指の届く扇に収める。
 *
 * **長押しはそのまま滑らせて選べる。** 指を置いたまま扇が開き、
 * 目当てのアイコンまで滑らせて離すと、そこが動く。指を離す位置で決まるので、
 * 押す→離す→また押す、の3手が1手で済む。
 * どのアイコンにも乗っていないまま離したときは、開いたままにして待つ
 * （狙いを外しただけで閉じられると、もう一度長押しからやり直しになる）。
 *
 * v1.10 までの統合バー（下辺いっぱいのバー）は廃止済み。
 * =======================================================*/

/** ＋から開く入口。どれもタスクを作る道で、開く先が違うだけ。 */
export type MakeMode = 'form' | 'memory' | 'text' | 'voice'

/**
 * 扇の並び。角度は数学の向き（90°＝真上、180°＝真横の左）。
 * 30°ずつ空けて 1/4 円に4つ置く。
 */
const ITEMS: { mode: MakeMode; label: string; icon: IconName; angle: number; hint: string }[] = [
  { mode: 'form', label: '手描き', icon: 'pencil', angle: 90, hint: '自分で書いて1件作る' },
  { mode: 'memory', label: '記憶', icon: 'checklist', angle: 120, hint: '記憶したタスクから呼び出す' },
  { mode: 'text', label: '文章', icon: 'sparkle', angle: 150, hint: '文章からまとめて作る' },
  { mode: 'voice', label: 'マイク', icon: 'mic', angle: 180, hint: '話してタスクにする' },
]

/** ここまで押し続けたら「長押し」とみなす（ミリ秒） */
const HOLD_MS = 300

export function QuickBar({
  onStartVoice,
  onCreate,
  busy,
  voiceSupported,
}: {
  /** 録音を始める（画面は App 側の録音オーバーレイに切り替わる） */
  onStartVoice: () => void
  /** タスクを作る画面を、選んだ入口で開く */
  onCreate: (mode: Exclude<MakeMode, 'voice'>) => void
  busy: boolean
  voiceSupported: boolean
}) {
  const [open, setOpen] = useState(false)
  /** 滑らせている指がいま乗っているアイコン */
  const [hot, setHot] = useState<MakeMode | null>(null)
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
  const hotRef = useRef<MakeMode | null>(null)

  // 開いている間は Esc で閉じる（PC）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const clearHold = () => {
    if (holdRef.current !== null) {
      window.clearTimeout(holdRef.current)
      holdRef.current = null
    }
  }
  useEffect(() => clearHold, [])

  const setHover = (mode: MakeMode | null) => {
    hotRef.current = mode
    setHot(mode)
  }

  const pick = (mode: MakeMode) => {
    setOpen(false)
    setHover(null)
    if (mode === 'voice') onStartVoice()
    else onCreate(mode)
  }

  /** 指の下にあるアイコンを拾う（扇は＋の外にあるので、座標で見る） */
  const hitTest = (x: number, y: number): MakeMode | null => {
    const el = document.elementFromPoint(x, y)
    const btn = el instanceof Element ? el.closest('.tp-fan-btn') : null
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return null
    return (btn.dataset.mode as MakeMode) ?? null
  }

  return (
    <div className={`tp-quick${open ? ' is-open' : ''}`}>
      {/* 開いている間は、外を押すと閉じる面を敷く */}
      {open && (
        <button
          type="button"
          className="tp-fan-backdrop"
          aria-label="閉じる"
          onClick={() => setOpen(false)}
        />
      )}

      <button
        type="button"
        className="tp-quick-btn tp-quick-mic"
        disabled={busy || !voiceSupported}
        aria-label={voiceSupported ? '音声で入力する' : '音声は使えません'}
        title={voiceSupported ? '音声で入力' : '音声は未対応'}
        onClick={onStartVoice}
      >
        <span className="tp-fab-ring" aria-hidden="true" />
        <Icon name="mic" size={26} strokeWidth={2} />
      </button>

      <div className="tp-fan">
        {open &&
          ITEMS.map((it, i) => {
            const rad = (it.angle * Math.PI) / 180
            const disabled = it.mode === 'voice' && (busy || !voiceSupported)
            return (
              <div
                key={it.mode}
                className="tp-fan-item"
                style={
                  {
                    // 半径は CSS が持つ（画面幅で変える）。ここは向きだけを渡す。
                    '--fx': Math.cos(rad).toFixed(4),
                    '--fy': (-Math.sin(rad)).toFixed(4),
                    '--i': i,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className={`tp-fan-btn${hot === it.mode ? ' is-hot' : ''}`}
                  data-mode={it.mode}
                  disabled={disabled}
                  aria-label={`${it.label}：${it.hint}`}
                  title={it.hint}
                  onClick={() => pick(it.mode)}
                >
                  <Icon name={it.icon} size={22} strokeWidth={2} />
                </button>
                <span className="tp-fan-label">{it.label}</span>
              </div>
            )
          })}

        <button
          type="button"
          className={`tp-quick-btn tp-quick-add${open ? ' is-on' : ''}`}
          aria-expanded={open}
          aria-label={open ? '作り方を閉じる' : 'タスクを作る'}
          title={open ? '閉じる' : 'タスクを作る'}
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
              setOpen(true)
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
            setOpen((v) => !v)
          }}
        >
          <Icon name="plus" size={28} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
