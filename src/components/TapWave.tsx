import { useEffect } from 'react'

/* =========================================================
 * タップの波（NoteLoop 9.2 と同じ挙動）
 *
 * 端末が出す四角いハイライトの代わりに、押した位置から丸い波を広げる。
 * 画面のいちばん上に重ねた層へ描くので、ボタンの形や重なりに影響しない。
 * prefers-reduced-motion では CSS 側で非表示にする。
 * =======================================================*/

const TAP_TARGETS = 'button, [role="button"], a[href], summary, label.tp-pick'

export function TapWave() {
  useEffect(() => {
    let layer: HTMLDivElement | null = null

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target as Element | null
      const el = target?.closest?.(TAP_TARGETS) as HTMLElement | null
      if (!el || (el as HTMLButtonElement).disabled) return

      if (!layer) {
        layer = document.createElement('div')
        layer.className = 'tp-wave-layer'
        document.body.appendChild(layer)
      }
      const r = el.getBoundingClientRect()
      const x = e.clientX || r.left + r.width / 2
      const y = e.clientY || r.top + r.height / 2
      // 押した位置から、その要素を覆うくらいまで広がる（広がりすぎない上限つき）
      const size = Math.max(44, Math.min(Math.hypot(r.width, r.height) * 1.15, 240))
      const w = document.createElement('span')
      w.className = 'tp-tap-wave'
      w.style.left = `${x - size / 2}px`
      w.style.top = `${y - size / 2}px`
      w.style.width = `${size}px`
      w.style.height = `${size}px`
      w.addEventListener('animationend', () => w.remove())
      layer.appendChild(w)
    }

    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      layer?.remove()
    }
  }, [])

  return null
}
