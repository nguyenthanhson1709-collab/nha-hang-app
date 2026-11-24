// Nhập Viva Wallet (Kartenzahlung) theo tuần: 7 ngày xếp dọc, mỗi ngày một ô số tiền.
import { useEffect, useState } from 'react'
import { supabase, errMsg, type CashMove, type ZBon } from '../lib/supabase'
import { lockedPeriods } from '../lib/data'
import { eur, r2, todayIso } from '../lib/format'
import { useLang } from '../lib/i18n'
import { Money, Sheet, Spinner, toast } from './ui'
import { WeekBar, mondayOf, weekDays } from './PeriodBar'

const WD_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], WD_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export function VivaWeek({ rid, start, vivaMode, open, onClose, onSaved }: { rid: string; start: string; vivaMode: boolean; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { lang } = useLang()
  const [mon, setMon] = useState(mondayOf(start))
  const [orig, setOrig] = useState<Record<string, number> | null>(null)
  const [val, setVal] = useState<Record<string, number>>({})
  const [zcard, setZcard] = useState<Record<string, number>>({})
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const days = weekDays(mon)

  useEffect(() => { if (open) setMon(mondayOf(start)) }, [open, start])
  useEffect(() => {
    if (!open) return
    let off = false
    setOrig(null)
    const from = days[0], to = days[6]
    Promise.all([
      supabase.from('nh_cash_moves').select('*').eq('restaurant_id', rid).eq('channel', 'viva').gte('move_date', from).lte('move_date', to),
      supabase.from('nh_zbons').select('*').eq('restaurant_id', rid).gte('z_date', from).lte('z_date', to),
      lockedPeriods(rid),
    ]).then(([mv, zq, lk]) => {
      if (off) return
      const o: Record<string, number> = {}
      for (const m of (mv.data || []) as CashMove[]) o[m.move_date] = r2((o[m.move_date] || 0) + Number(m.amount))
      const z: Record<string, number> = {}
      for (const x of (zq.data || []) as ZBon[]) z[x.z_date] = r2((z[x.z_date] || 0) + Number(x.total) - Number(x.cash_revenue))
      setOrig(o); setVal(o); setZcard(z); setLocked(lk)
    })
    return () => { off = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mon, rid])

  async function save() {
    if (!orig) return
    const changed = days.filter((d) => r2(val[d] || 0) !== r2(orig[d] || 0) && !locked.has(d.slice(0, 7)))
    if (!changed.length) { onClose(); return }
    setSaving(true)
    try {
      for (const d of changed) {
        const del = await supabase.from('nh_cash_moves').delete().eq('restaurant_id', rid).eq('channel', 'viva').eq('move_date', d)
        if (del.error) throw del.error
        const v = r2(val[d] || 0)
        if (v > 0) {
          const ins = await supabase.from('nh_cash_moves').insert({ restaurant_id: rid, move_date: d, period: d.slice(0, 7), type: 'geldtransit', amount: v, description: 'Kartenzahlung', channel: 'viva' })
          if (ins.error) throw ins.error
        }
      }
      toast(lang === 'de' ? 'Gespeichert' : 'Đã lưu')
      onSaved(); onClose()
    } catch (e) { toast(errMsg(e)) } finally { setSaving(false) }
  }

  const sum = r2(days.reduce((s, d) => s + (val[d] || 0), 0))
  const now = todayIso()
  return (
    <Sheet open={open} onClose={onClose} title="Viva Wallet (Kartenzahlung)">
      <WeekBar value={mon} onChange={setMon} />
      {!orig ? <Spinner /> : <>
        <div className="viva-week">
          {days.map((d, i) => {
            const lk = locked.has(d.slice(0, 7))
            const zc = zcard[d]
            const tip = zc != null && val[d] ? r2(val[d] - zc) : null
            return (
              <div key={d} className={`vw-row${i > 4 ? ' we' : ''}${d === now ? ' now' : ''}`}>
                <div className="vw-day"><b>{(lang === 'de' ? WD_DE : WD_VI)[i]}</b><span>{d.slice(8, 10)}.{d.slice(5, 7)}.</span></div>
                <div className="vw-in">
                  <Money value={val[d] || 0} disabled={lk} onChange={(v) => setVal((s) => ({ ...s, [d]: v }))} />
                  {(zc != null || lk) && <div className="small muted">
                    {lk ? '🔒 ' : ''}{zc != null && <>Z-Bon Karte {eur(zc)}{vivaMode && tip != null && <> · Trinkgeld {eur(Math.max(0, tip))}</>}</>}
                  </div>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}><span className="muted">{lang === 'de' ? 'Summe Woche' : 'Tổng tuần'}</span><b>{eur(sum)}</b></div>
        <button className="primary block" disabled={saving} onClick={save}>{saving ? '…' : (lang === 'de' ? 'Speichern' : 'Lưu')}</button>
      </>}
    </Sheet>
  )
}
