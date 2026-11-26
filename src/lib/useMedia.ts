import { useEffect, useState } from 'react'

/** true khi màn hình khớp media query (vd. điện thoại: max-width 640px) */
export function useMedia(q: string) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)
  const [m, setM] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
export const MOBILE_Q = '(max-width: 640px)'
