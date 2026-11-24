// Thanh chọn tháng: ‹ [Tháng 11 · 2026] ›. Bấm vào giữa để mở bảng 12 tháng theo năm.
import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { addMonths, thisMonth } from '../lib/format'

const NAMES = {
  vi: ['Th 1', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'Th 8', 'Th 9', 'Th 10', 'Th 11', 'Th 12'],
  de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
}
const FULL_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export function MonthBar({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(value.slice(0, 4)))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { setYear(Number(value.slice(0, 4))) }, [value, open])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open])
  const m = Number(value.slice(5, 7))
  const label = lang === 'de' ? `${FULL_DE[m - 1]} ${value.slice(0, 4)}` : `Tháng ${m} · ${value.slice(0, 4)}`
  const now = thisMonth()
  const pick = (p: string) => { onChange(p); setOpen(false) }
  return (
    <div className="monthbar" ref={box}>
      <button className="mb-arrow" aria-label="prev" onClick={() => onChange(addMonths(value, -1))}>‹</button>
      <button className="mb-label" onClick={() => setOpen(!open)}>{label}<span className="mb-caret">{open ? '▴' : '▾'}</span></button>
      <button className="mb-arrow" aria-label="next" onClick={() => onChange(addMonths(value, 1))}>›</button>
      {open && (
        <div className="mb-pop">
          <div className="mb-year">
            <button className="ghost" onClick={() => setYear(year - 1)}>‹</button>
            <b>{year}</b>
            <button className="ghost" onClick={() => setYear(year + 1)}>›</button>
          </div>
          <div className="mb-grid">
            {NAMES[lang === 'de' ? 'de' : 'vi'].map((n, i) => {
              const p = `${year}-${String(i + 1).padStart(2, '0')}`
              return <button key={p} className={`${p === value ? 'sel' : ''} ${p === now ? 'now' : ''}`} onClick={() => pick(p)}>{n}</button>
            })}
          </div>
          <button className="ghost block mb-today" onClick={() => pick(now)}>{lang === 'de' ? 'Aktueller Monat' : 'Tháng này'}</button>
        </div>
      )}
    </div>
  )
}
