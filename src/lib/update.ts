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
/** Trang đang mở là bản cũ, phần tải sau (vd. PDF) đã bị thay trên máy chủ: báo người dùng tải lại.
 *  Không tự tải lại để không mất dữ liệu đang nhập dở. */
function staleBanner() {
  if (document.getElementById('stale-banner')) return
  const b = document.createElement('div')
  b.id = 'stale-banner'
  b.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:14px;background:#F88712;color:#1a1208;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,.35)')
  const t = document.createElement('span')
  t.textContent = 'App vừa có bản mới: lưu nháp (nếu đang viết) rồi bấm Tải lại. / Neue Version: Entwurf speichern und neu laden.'
  const btn = document.createElement('button')
  btn.textContent = 'Tải lại / Neu laden'
  btn.setAttribute('style', 'border:0;border-radius:999px;padding:8px 16px;background:#1a1208;color:#fff;font-weight:800;cursor:pointer')
  btn.onclick = () => location.reload()
  b.append(t, btn)
  document.body.append(b)
}

export function watchUpdates() {
  window.addEventListener('vite:preloadError', staleBanner)
  window.addEventListener('unhandledrejection', (e) => {
    if (/dynamically imported module|Importing a module script failed/i.test(String((e.reason as Error)?.message ?? e.reason))) staleBanner()
  })
  check()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  setInterval(check, 5 * 60 * 1000)
}
