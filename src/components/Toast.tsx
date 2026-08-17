import { useEffect } from 'react'

export interface ToastMessage {
  id: number
  text: string
  tone: 'ok' | 'error'
}

/** 画面下に短く出す通知。エラーは長めに残して読めるようにする。 */
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const ms = message.tone === 'error' ? 6000 : 2600
    const t = window.setTimeout(onDone, ms)
    return () => window.clearTimeout(t)
  }, [message, onDone])

  if (!message) return null
  return (
    <div className={`tp-toast tp-toast-${message.tone}`} role="status" aria-live="polite">
      {message.text}
    </div>
  )
}
