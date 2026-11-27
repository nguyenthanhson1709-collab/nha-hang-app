// Bảng rộng: mặc định thu nhỏ vừa khung màn hình để thấy hết; nút + / − để phóng to (khi to hơn thì cuộn ngang).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function FitTable({ children, deps }: { children: ReactNode; deps: unknown[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)
  const [user, setUser] = useState(1)

  useLayoutEffect(() => {
    const measure = () => {
      const w = wrap.current, el = inner.current
      if (!w || !el) return
      const prev = el.style.zoom
      el.style.zoom = '1'
      const natural = el.scrollWidth
      el.style.zoom = prev
      const avail = w.clientWidth - 2
      setFit(natural > avail ? Math.max(0.3, avail / natural) : 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, deps) // eslint-disable-line

  const z = Math.min(fit * user, 2)
  const pct = Math.round(z * 100)
  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
        <button className="zoom-btn" disabled={z <= fit + 0.001} onClick={() => setUser((u) => Math.max(1, u / 1.25))}>−</button>
        <span className="small muted" style={{ minWidth: 44, textAlign: 'center' }}>{pct}%</span>
        <button className="zoom-btn" disabled={z >= 2} onClick={() => setUser((u) => u * 1.25)}>+</button>
        {user > 1 && <button className="zoom-btn" onClick={() => setUser(1)}>⤢</button>}
      </div>
      <div className="tbl-wrap fit-wrap" ref={wrap}>
        <div ref={inner} style={{ zoom: z, width: 'max-content', minWidth: '100%' }}>{children}</div>
      </div>
    </>
  )
}
