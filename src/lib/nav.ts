import type { NavigateFunction } from 'react-router-dom'

/** Quay lại trang trước (danh sách vừa mở); nếu mở thẳng bằng đường dẫn thì về trang dự phòng */
export function goBack(nav: NavigateFunction, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  if (idx > 0) nav(-1)
  else nav(fallback, { replace: true })
}
