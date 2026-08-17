/* =========================================================
 * 出口の共通処理: ファイル保存とクリップボード
 * =======================================================*/

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke が早すぎると保存に失敗する端末があるので少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** クリップボードへコピー。navigator.clipboard が使えない環境では代替手段に落とす。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 代替手段を試す */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
