// Tháng trên đường dẫn (?m=YYYY-MM), để trợ lý giọng nói mở thẳng đúng tháng
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useMonthParam(): string | null {
  const [sp] = useSearchParams()
  const m = sp.get('m') || ''
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : null
}

/** Khi ?m= đổi (trợ lý mở lại cùng trang với tháng khác) thì chuyển sang tháng đó */
export function useFollowMonth(set: (m: string) => void) {
  const m = useMonthParam()
  useEffect(() => { if (m) set(m) }, [m]) // eslint-disable-line
  return m
}
