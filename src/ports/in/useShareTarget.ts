import { useEffect, useState } from 'react'

/* =========================================================
 * 他アプリからの共有（Web Share Target）
 *
 * manifest の share_target が GET なので、共有すると
 *   /taskport/share?title=...&text=...&url=...
 * に遷移してくる。ここでその本文を拾い、構造化パイプラインへ渡す。
 * 拾ったあとは履歴を書き換えて、リロードで二重に取り込まれないようにする。
 * =======================================================*/

function pickShared(search: string, pathname: string): string | null {
  const params = new URLSearchParams(search)
  const isShareRoute = pathname.endsWith('/share')
  const title = params.get('title') ?? ''
  const text = params.get('text') ?? ''
  const url = params.get('url') ?? ''
  if (!isShareRoute && !title && !text && !url) return null
  const body = [title, text, url].map((s) => s.trim()).filter(Boolean).join('\n')
  return body || null
}

/**
 * 共有で飛び込んできた本文を1回だけ返す。
 * 取り込み済みかどうかは呼び出し側が consume() で伝える。
 */
export function useShareTarget(): { sharedText: string | null; consume: () => void } {
  const [sharedText, setSharedText] = useState<string | null>(null)

  useEffect(() => {
    const body = pickShared(window.location.search, window.location.pathname)
    if (!body) return
    setSharedText(body)
    // クエリを消してアプリ本体のURLへ戻す（リロードでの二重取り込みを防ぐ）
    const base = import.meta.env.BASE_URL || '/'
    window.history.replaceState(null, '', base)
  }, [])

  return { sharedText, consume: () => setSharedText(null) }
}
