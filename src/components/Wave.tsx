import { useEffect, useRef } from 'react'

/* =========================================================
 * 録音中のウェーブアニメーション（NoteLoop と同じ描き方）
 *
 * 3層の線を重ね、端に向かって振幅を細くして背景に溶け込ませる。
 * 声が大きいほど速く・大きく揺れる。アタックは速くリリースはゆっくり。
 * prefers-reduced-motion では静止した線だけを描く。
 * =======================================================*/

const LAYERS = [
  { amp: 0.42, freq: 1.3, speed: 0.8, varName: '--brand2', alpha: 0.42 },
  { amp: 0.3, freq: 1.9, speed: -1.1, varName: '--brand1', alpha: 0.38 },
  { amp: 0.2, freq: 2.7, speed: 1.5, varName: '--brand3', alpha: 0.3 },
]

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#4f6ef7'
}

export function Wave({ active, level }: { active: boolean; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const phaseRef = useRef(0)
  const smoothRef = useRef(0.12)
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const colors = LAYERS.map((l) => cssVar(l.varName))
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      const mid = h * 0.52
      ctx.clearRect(0, 0, w, h)
      const step = Math.max(2, w / 240)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      LAYERS.forEach((L, i) => {
        ctx.beginPath()
        for (let x = 0; x <= w; x += step) {
          const t = x / w
          const env = Math.sin(t * Math.PI) // 端で0 → 中央でふくらむ
          const y =
            mid +
            Math.sin(t * Math.PI * 2 * L.freq + phaseRef.current * L.speed) *
              (h * L.amp * (0.05 + smoothRef.current)) *
              env
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = colors[i]
        ctx.globalAlpha = L.alpha
        ctx.lineWidth = Math.max(2.5, w * 0.0045)
        ctx.shadowColor = colors[i]
        ctx.shadowBlur = 14
        ctx.stroke()
      })
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    if (reduce) {
      smoothRef.current = 0.14
      draw()
      return () => window.removeEventListener('resize', resize)
    }

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const target = active ? levelRef.current : 0.12 + Math.sin(phaseRef.current * 1.4) * 0.04
      // アタックは速く、リリースはゆっくり → 自然な揺れ
      const k = target > smoothRef.current ? 0.4 : 0.06
      smoothRef.current += (target - smoothRef.current) * k
      phaseRef.current += 0.02 + smoothRef.current * 0.055
      draw()
    }
    loop()

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [active])

  return <canvas ref={canvasRef} className="tp-wave" aria-hidden="true" />
}
