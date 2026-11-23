// Tự tải lại khi trên máy chủ có bản mới
declare const __BUILD__: string
async function check() {
  if (import.meta.env.DEV) return
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    const { build } = await r.json()
    if (build && build !== __BUILD__ && !sessionStorage.getItem('reloaded-' + build)) {
      sessionStorage.setItem('reloaded-' + build, '1')
      location.reload()
    }
  } catch { /* mất mạng: bỏ qua */ }
}
export function watchUpdates() {
  check()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  setInterval(check, 5 * 60 * 1000)
}
