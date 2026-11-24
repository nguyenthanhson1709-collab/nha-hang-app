// Thanh chọn ngày / quý / năm cùng kiểu với MonthBar: ‹ [nhãn ▾] ›, bấm vào giữa mở bảng chọn.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n'
import { addMonths } from '../lib/format'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const WD_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], WD_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const DAY_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'], DAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MON_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function usePop() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || panel.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h); document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open])
  return { open, setOpen, box, panel }
}

function Bar({ label, onPrev, onNext, pop, children, compact }: { label: ReactNode; onPrev?: () => void; onNext?: () => void; pop: ReturnType<typeof usePop>; children: ReactNode; compact?: boolean }) {
  return (
    <div className={`monthbar${compact ? ' compact' : ''}`} ref={pop.box}>
      {onPrev && <button className="mb-arrow" aria-label="prev" onClick={onPrev}>‹</button>}
      <button className="mb-label" onClick={() => pop.setOpen(!pop.open)}>{label}<span className="mb-caret">{pop.open ? '▴' : '▾'}</span></button>
      {onNext && <button className="mb-arrow" aria-label="next" onClick={onNext}>›</button>}
      {pop.open && <Pop pop={pop}>{children}</Pop>}
    </div>
  )
}

// Không đủ chỗ phía dưới (ví dụ trong khung nhập ở đáy màn hình điện thoại): hiện bảng chọn ở giữa màn hình
function Pop({ pop, children }: { pop: ReturnType<typeof usePop>; children: ReactNode }) {
  const [float] = useState(() => {
    const r = pop.box.current?.getBoundingClientRect()
    return !!r && (window.innerHeight - r.bottom < 430 || !!pop.box.current?.closest('.sheet'))
  })
  if (!float) return <div className="mb-pop" ref={pop.panel}>{children}</div>
  return createPortal(
    <div className="mb-float-bg" onClick={() => pop.setOpen(false)}>
      <div className="mb-pop mb-float" ref={pop.panel} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>, document.body)
}

/** Lịch một tháng để chọn ngày */
function Calendar({ value, onPick }: { value: string; onPick: (d: string) => void }) {
  const { lang } = useLang()
  const [ym, setYm] = useState((value || today()).slice(0, 7))
  const first = new Date(ym + '-01T12:00:00Z')
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const now = today()
  const m = Number(ym.slice(5))
  return (
    <>
      <div className="mb-year">
        <button className="ghost" onClick={() => setYm(addMonths(ym, -1))}>‹</button>
        <b>{lang === 'de' ? `${MON_DE[m - 1]} ${ym.slice(0, 4)}` : `Tháng ${m} · ${ym.slice(0, 4)}`}</b>
        <button className="ghost" onClick={() => setYm(addMonths(ym, 1))}>›</button>
      </div>
      <div className="mb-cal">
        {(lang === 'de' ? WD_DE : WD_VI).map((w, i) => <span key={w} className={`mb-wd${i > 4 ? ' we' : ''}`}>{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, '0')}`
          return <button key={d} className={`${d === value ? 'sel' : ''} ${d === now ? 'now' : ''}`} onClick={() => onPick(d)}>{i + 1}</button>
        })}
      </div>
      <button className="ghost block mb-today" onClick={() => onPick(now)}>{lang === 'de' ? 'Heute' : 'Hôm nay'}</button>
    </>
  )
}

export function dayLabel(d: string, lang: string) {
  const wd = new Date(d + 'T12:00:00Z').getUTCDay()
  const s = `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
  return lang === 'de' ? `${DAY_DE[wd]}, ${s}` : `${DAY_VI[wd]}, ${s}`
}

export function DayBar({ value, onChange, arrows = true, prefix }: { value: string; onChange: (d: string) => void; arrows?: boolean; prefix?: string }) {
  const { lang } = useLang()
  const pop = usePop()
  return (
    <Bar pop={pop} compact={!arrows} label={<>{prefix && <span className="mb-prefix">{prefix}</span>}{dayLabel(value, lang)}</>}
      onPrev={arrows ? () => onChange(addDays(value, -1)) : undefined} onNext={arrows ? () => onChange(addDays(value, 1)) : undefined}>
      <Calendar value={value} onPick={(d) => { onChange(d); pop.setOpen(false) }} />
    </Bar>
  )
}

/** value = tháng đầu bất kỳ trong quý (YYYY-MM) */
export function QuarterBar({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const { lang } = useLang()
  const pop = usePop()
  const y = Number(value.slice(0, 4)), q = Math.floor((Number(value.slice(5)) - 1) / 3) + 1
  const [year, setYear] = useState(y)
  useEffect(() => setYear(y), [y, pop.open])
  const nowM = today().slice(0, 7), nowY = Number(nowM.slice(0, 4)), nowQ = Math.floor((Number(nowM.slice(5)) - 1) / 3) + 1
  const pick = (yy: number, qq: number) => { onChange(`${yy}-${String((qq - 1) * 3 + 1).padStart(2, '0')}`); pop.setOpen(false) }
  const MON = lang === 'de' ? ['Jan–Mär', 'Apr–Jun', 'Jul–Sep', 'Okt–Dez'] : ['Th 1–3', 'Th 4–6', 'Th 7–9', 'Th 10–12']
  return (
    <Bar pop={pop} label={lang === 'de' ? `${q}. Quartal ${y}` : `Quý ${q} · ${y}`} onPrev={() => onChange(addMonths(value, -3))} onNext={() => onChange(addMonths(value, 3))}>
      <div className="mb-year"><button className="ghost" onClick={() => setYear(year - 1)}>‹</button><b>{year}</b><button className="ghost" onClick={() => setYear(year + 1)}>›</button></div>
      <div className="mb-grid q">
        {[1, 2, 3, 4].map((qq) => <button key={qq} className={`${year === y && qq === q ? 'sel' : ''} ${year === nowY && qq === nowQ ? 'now' : ''}`} onClick={() => pick(year, qq)}>
          <b>Q{qq}</b><span className="small">{MON[qq - 1]}</span></button>)}
      </div>
      <button className="ghost block mb-today" onClick={() => pick(nowY, nowQ)}>{lang === 'de' ? 'Aktuelles Quartal' : 'Quý này'}</button>
    </Bar>
  )
}

/** value = YYYY-MM (chỉ dùng năm) */
export function YearBar({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const { lang } = useLang()
  const pop = usePop()
  const y = Number(value.slice(0, 4))
  const [start, setStart] = useState(y - 7)
  useEffect(() => setStart(y - 7), [y, pop.open])
  const nowY = Number(today().slice(0, 4))
  const pick = (yy: number) => { onChange(`${yy}-01`); pop.setOpen(false) }
  return (
    <Bar pop={pop} label={lang === 'de' ? `Jahr ${y}` : `Năm ${y}`} onPrev={() => onChange(addMonths(value, -12))} onNext={() => onChange(addMonths(value, 12))}>
      <div className="mb-year"><button className="ghost" onClick={() => setStart(start - 12)}>‹</button><b>{start}–{start + 11}</b><button className="ghost" onClick={() => setStart(start + 12)}>›</button></div>
      <div className="mb-grid">
        {Array.from({ length: 12 }, (_, i) => start + i).map((yy) => <button key={yy} className={`${yy === y ? 'sel' : ''} ${yy === nowY ? 'now' : ''}`} onClick={() => pick(yy)}>{yy}</button>)}
      </div>
      <button className="ghost block mb-today" onClick={() => pick(nowY)}>{lang === 'de' ? 'Aktuelles Jahr' : 'Năm nay'}</button>
    </Bar>
  )
}

/** Ô chọn ngày trong biểu mẫu (cùng kiểu), có thể để trống nếu allowEmpty */
export function DateField({ value, onChange, allowEmpty }: { value: string | null; onChange: (d: string | null) => void; allowEmpty?: boolean }) {
  const { lang } = useLang()
  const pop = usePop()
  return (
    <Bar pop={pop} compact label={value ? dayLabel(value, lang) : <span className="muted">—</span>}>
      <Calendar value={value || ''} onPick={(d) => { onChange(d); pop.setOpen(false) }} />
      {allowEmpty && value && <button className="ghost block" style={{ color: 'var(--err)' }} onClick={() => { onChange(null); pop.setOpen(false) }}>{lang === 'de' ? 'Kein Datum' : 'Bỏ ngày'}</button>}
    </Bar>
  )
}

export const mondayOf = (d: string) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7))
export const weekDays = (mon: string) => Array.from({ length: 7 }, (_, i) => addDays(mon, i))
function isoWeek(d: string) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7))
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((t.getTime() - y.getTime()) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7)
}
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`

// Chọn tuần (Thứ Hai đến Chủ nhật): ‹ [KW 48 · 24.11. – 30.11. ▾] ›
export function WeekBar({ value, onChange }: { value: string; onChange: (monday: string) => void }) {
  const { lang } = useLang()
  const pop = usePop()
  const mon = mondayOf(value)
  return (
    <Bar pop={pop} label={<>{lang === 'de' ? 'KW' : 'Tuần'} {isoWeek(mon)} · {dm(mon)} – {dm(addDays(mon, 6))}</>}
      onPrev={() => onChange(addDays(mon, -7))} onNext={() => onChange(addDays(mon, 7))}>
      <Calendar value={mon} onPick={(d) => { onChange(mondayOf(d)); pop.setOpen(false) }} />
    </Bar>
  )
}
