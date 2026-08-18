import { useEffect, useRef } from 'react'

/* =========================================================
 * 録音中のゲージ（NoteLoop 9.2 と同じ描き方）
 *
 * バーの位置は固定で、周囲の音の大きさに応じてその場で上下に伸びる。
 * 静かになると全部が丸い点に戻る。
 * 本ごとに伸びやすさ・揺れの速さ・乱数の切り替わる間隔を変えてあるので、
 * 同じ音量でも伸びる長さがばらつき、機械的な弧に見えない。
 *
 * prefers-reduced-motion では静止した点だけを描く。
 * =======================================================*/

/** 決まった見た目を再現するための擬似乱数（同じ種なら同じ値） */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * i 本目のバーの、いまの乱数値（0..1）。
 * tn の整数が変わるたびに別の乱数へ、その間はなめらかに繋ぐ。
 * 一定周期の sin と違い、伸びる長さが毎回変わって見える。
 */
function barRandom(i: number, tn: number): number {
  const k = Math.floor(tn)
  const f = tn - k
  const sm = f * f * (3 - 2 * f)
  return noise(i * 17.3 + k * 1.7) * (1 - sm) + noise(i * 17.3 + (k + 1) * 1.7) * sm
}

interface Bar {
  /** いまの高さ 0..1 */
  v: number
  /** 伸びやすさの個体差（大きいほど高く伸びる） */
  gain: number
  /** 揺れの速さ */
  speed: number
  phase: number
  /** 揺れ幅の下限。小さいほど大きく伸び縮みする */
  lo: number
  /** 乱数の切り替わる間隔（秒）。短いほど機敏にパタパタ動く */
  step: number
}

function newBar(i: number): Bar {
  return {
    v: 0,
    gain: 0.55 + noise(i * 3.9) * 1.15,
    speed: 1.6 + noise(i * 1.3) * 5.2,
    phase: noise(i * 2.7) * Math.PI * 2,
    lo: 0.04 + noise(i * 8.7) * 0.34,
    step: 0.085 + noise(i * 4.4) * 0.115,
  }
}

/** 角丸矩形を、組み立て中のパスに足す（まとめて一度に塗るため） */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, h / 2, w / 2)
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function Wave({ active, level }: { active: boolean; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const barsRef = useRef<Bar[]>([])
  const smoothRef = useRef(0)
  const lastDrawRef = useRef(0)
  const levelRef = useRef(level)
  levelRef.current = level
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
        barsRef.current = [] // 幅が変わったら本数を作り直す
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      // 上部は経過時間の表示に譲るため、バーの中心は少し下に置く
      const mid = h * 0.6
      ctx.clearRect(0, 0, w, h)

      // 等間隔・同じ太さで並べる。幅から決めた本数から、
      // 左右の端を2本ずつ減らして余白を作る。
      const full = Math.max(13, Math.min(25, Math.round(w / 40)))
      const pitch = w / (full + 1)
      const count = Math.max(5, full - 4)
      const left = (w - (count - 1) * pitch) / 2
      // 太さ（無音時の「点」の大きさでもある）。高さに対して太くなりすぎないよう抑える。
      const barW = Math.max(4, Math.min(Math.round(pitch * 0.32), Math.round(h * 0.1)))
      const maxH = h * 0.6
      const minH = barW

      if (barsRef.current.length !== count) {
        barsRef.current = Array.from({ length: count }, (_, i) => newBar(i))
      }

      const now = performance.now() / 1000
      ctx.fillStyle = '#ffffff'

      // 1本のパスにまとめて一度に塗る（本ごとに fill すると重い）
      ctx.beginPath()
      for (let i = 0; i < count; i++) {
        const b = barsRef.current[i]
        const t = count > 1 ? i / (count - 1) : 0.5
        // 中央ほど大きく振れる。山はゆるめにして、隣り合う本の差が
        // 「きれいな弧」に見えないようにする。
        const env = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * t), 0.5)
        const rnd = barRandom(i, now / b.step)
        const s1 = Math.sin(now * b.speed + b.phase)
        const wobble = b.lo + (1 - b.lo) * (0.72 * rnd + 0.28 * (0.5 + 0.5 * s1))
        const target = Math.min(1, smoothRef.current * b.gain * env * wobble)
        // 伸びるのは即座に、戻るのも速めに（声にきびきび追従させる）
        b.v += (target - b.v) * (target > b.v ? 1 : 0.5)

        const bh = Math.max(barW, minH + (maxH - minH) * b.v)
        roundedPath(ctx, left + i * pitch - barW / 2, mid - bh / 2, barW, bh, barW / 2)
      }
      ctx.fill()
    }

    if (reduce) {
      smoothRef.current = 0
      draw()
      return () => window.removeEventListener('resize', resize)
    }

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      // 描き替えは 50fps 程度まで。上限が無いと端末によっては描画で詰まる。
      const t = performance.now()
      if (t - lastDrawRef.current < 20) return
      lastDrawRef.current = t

      // 一時停止中はバーを点に戻して止める
      const target = activeRef.current ? levelRef.current : 0
      // 上がるのは即座に、下がるのも速めに
      const k = target > smoothRef.current ? 0.9 : 0.45
      smoothRef.current += (target - smoothRef.current) * k
      draw()
    }
    loop()

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  return <canvas ref={canvasRef} className="tp-wave" aria-hidden="true" />
}
