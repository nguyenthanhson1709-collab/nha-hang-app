// Vuốt từ mép trái sang phải để quay lại trang trước (giống ứng dụng trên iPhone).
// Chỉ tính khi bắt đầu sát mép trái, để không lẫn với cuộn ngang bảng; phải vuốt quá nửa màn hình mới quay lại.
export function swipeBack() {
  let x0 = 0, y0 = 0, t0 = 0, on = false
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0]
    on = e.touches.length === 1 && t.clientX < 50 && !document.querySelector('.sheet-bg, .scanner')
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now()
  }, { passive: true })
  window.addEventListener('touchend', (e) => {
    if (!on) return
    on = false
    const t = e.changedTouches[0]
    const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0)
    if (dx > window.innerWidth / 2 && dy < dx * 0.6 && Date.now() - t0 < 2000 && location.hash && location.hash !== '#/' && history.length > 1) history.back()
  }, { passive: true })
}
