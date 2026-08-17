import { cloneElement, isValidElement, useEffect, useRef, type ReactElement } from 'react'

/**
 * 子要素をビューポート進入時に「下から浮かび上がる」演出で出す。
 * ラッパー要素を挟まず、子に .tp-reveal / .tp-reveal-in を付けるだけ。
 * グラフの棒・折れ線は表示に合わせて 0 から伸びる（app.css 側）。
 * prefers-reduced-motion では即時表示にする。
 */
export function Reveal({ children }: { children: ReactElement }) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const show = () => el.classList.add('tp-reveal-in')

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || typeof IntersectionObserver === 'undefined') {
      show()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show()
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!isValidElement(children)) return children
  const child = children as ReactElement<{ className?: string }>
  const merged = child.props.className ? `tp-reveal ${child.props.className}` : 'tp-reveal'
  return cloneElement(child, { ref, className: merged } as Record<string, unknown>)
}

export default Reveal
