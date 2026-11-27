// Module Trinkgeld: Menü (Übersicht, Monatsabrechnung, Trinkgeld-Verteilung, Auszahlungen, Archiv, Einstellungen). Oberfläche auf Deutsch.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useRole } from '../lib/app'
import { supabase, type Restaurant } from '../lib/supabase'
import type { Company } from '../hoadon/types'
import { Spinner, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'
import { thisMonth, addMonths } from '../lib/format'
import { activeOf, chainPayments, listSettlements, loadCompany, loadSettings, saveSettings, tgErr, type Payment, type Settlement, type TgSettings } from './api'
import { deMonth, fmtEur, fmtH, mmYYYY, ROUNDING, STATUS, STATUS_TAG, ermittlung, type Rounding } from './calc'
import Abrechnung, { AbrechnungDetail } from './Abrechnung'
import Verteilung from './Verteilung'
import Auszahlungen from './Auszahlungen'
import Archiv from './Archiv'
import './tg.css'

export interface TgCtx {
  rid: string; r: Restaurant; owner: boolean; settings: TgSettings; company: Company | null
  list: Settlement[]; reload: () => Promise<void>; period: string; setPeriod: (p: string) => void
}
const Ctx = createContext<TgCtx>(null as unknown as TgCtx)
export const useTg = () => useContext(Ctx)

const TABS: [string, string][] = [['', 'Übersicht'], ['abrechnung', 'Monatsabrechnung'], ['verteilung', 'Trinkgeld-Verteilung'], ['auszahlungen', 'Auszahlungen'], ['archiv', 'Archiv'], ['einstellungen', 'Einstellungen']]

export default function TgApp() {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const nav = useNavigate()
  const loc = useLocation()
  const [sp, setSp] = useSearchParams()
  const period = /^\d{4}-\d{2}$/.test(sp.get('m') || '') ? sp.get('m')! : addMonths(thisMonth(), -1)
  const setPeriod = useCallback((p: string) => { const n = new URLSearchParams(sp); n.set('m', p); n.delete('id'); setSp(n, { replace: true }) }, [sp, setSp])
  const [settings, setSettings] = useState<TgSettings | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [list, setList] = useState<Settlement[] | null>(null)

  const reload = useCallback(async () => {
    if (!rid) return
    try {
      const [s, c, l] = await Promise.all([loadSettings(rid), loadCompany(rid), listSettlements(rid)])
      setSettings(s); setCompany(c); setList(l)
    } catch (e) { toast(tgErr(e)) }
  }, [rid])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('wide'); return () => el?.classList.remove('wide') }, [])

  if (!r || !rid) return null
  if (role !== 'owner' && role !== 'manager') return <><Top title="Trinkgeld" back={`/r/${rid}/archive`} /><div className="page"><div className="alert warn">Kein Zugriff. Trinkgelddaten sehen nur Geschäftsführung und Verantwortliche.</div></div></>
  if (!settings || !list) return <Spinner />
  const sub = loc.pathname.replace(`/r/${rid}/tg`, '').replace(/^\//, '').split('/')[0]
  const go = (t: string) => nav(`/r/${rid}/tg${t ? '/' + t : ''}?m=${period}`)
  const ctx: TgCtx = { rid, r, owner: role === 'owner', settings, company, list, reload, period, setPeriod }

  return (
    <Ctx.Provider value={ctx}>
      <Top title="Trinkgeld" sub={r.name} back={sub && sub !== '' ? `/r/${rid}/tg?m=${period}` : `/r/${rid}/archive`} />
      <div className="page tg">
        <div className="ptabs tg-tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" className={sub === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}
        </div>
        {sub !== 'einstellungen' && sub !== 'archiv' && <MonthBar value={period} onChange={setPeriod} />}
        {!company?.name && <div className="alert warn">Firmendaten fehlen. Bitte unter „Viết hoá đơn → Einstellungen“ (Unternehmenseinstellungen) pflegen; sie werden für die Belege übernommen.</div>}
        <Routes>
          <Route index element={<Uebersicht />} />
          <Route path="abrechnung" element={<Abrechnung />} />
          <Route path="abrechnung/:id" element={<AbrechnungDetail />} />
          <Route path="verteilung" element={<Verteilung />} />
          <Route path="auszahlungen" element={<Auszahlungen />} />
          <Route path="archiv" element={<Archiv />} />
          <Route path="einstellungen" element={<Einstellungen />} />
        </Routes>
      </div>
    </Ctx.Provider>
  )
}

export function StatusTag({ s }: { s: Settlement }) {
  return <span className={`tag ${STATUS_TAG[s.status]}`}>{s.kind === 'korrektur' ? 'Korrektur · ' : s.kind === 'storno' ? 'Storno · ' : ''}{STATUS[s.status]}</span>
}

function Kpi({ l, v, hint, strong }: { l: string; v: string; hint?: string; strong?: boolean }) {
  return <div className={`stat tg-kpi${strong ? ' strong' : ''}`}><div className="l">{l}</div><div className="v">{v}</div>{hint && <div className="small muted">{hint}</div>}</div>
}

function Uebersicht() {
  const { list, period, rid } = useTg()
  const nav = useNavigate()
  const cur = activeOf(list, period)
  const [paid, setPaid] = useState<Payment[]>([])
  useEffect(() => { if (cur) chainPayments(cur).then(setPaid).catch(() => setPaid([])); else setPaid([]) }, [cur?.id]) // eslint-disable-line
  const [nEmp, setNEmp] = useState<number | null>(null)
  useEffect(() => {
    setNEmp(null)
    if (cur) supabase.from('nh_tg_lines').select('id', { count: 'exact', head: true }).eq('settlement_id', cur.id).eq('participates', true).gt('minutes', 0).then((r) => setNEmp(r.count ?? 0))
  }, [cur?.id]) // eslint-disable-line
  const paidSum = paid.filter((p) => !p.cancelled_at).reduce((s, p) => s + p.amount_cents, 0)
  const e = cur ? ermittlung(cur) : null
  // 12 Monate bis zum gewählten Monat
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(period, i - 11)), [period])
  const series = months.map((m) => { const s = activeOf(list, m); return { m, avail: s?.available_cents || 0, payout: s?.payout_cents || 0 } })
  const max = Math.max(1, ...series.map((x) => x.avail))
  const hist = list.filter((s) => s.period <= period).slice(0, 24)

  return (
    <>
      {!cur && <div className="alert warn">Für {deMonth(period)} gibt es noch keine Abrechnung. <button className="ghost" style={{ minHeight: 0, padding: '0 4px', color: 'inherit', textDecoration: 'underline' }} onClick={() => nav(`/r/${rid}/tg/abrechnung?m=${period}&neu=1`)}>Neue Abrechnung erstellen</button></div>}
      {cur && <div className="row between" style={{ margin: '4px 0 8px' }}><span className="small muted">{cur.beleg_no}</span><StatusTag s={cur} /></div>}
      <div className="tg-kpis">
        <Kpi l="Trinkgeld im aktuellen Monat" v={e ? fmtEur(e.karten + (cur!.cash_tip_cents)) : '—'} hint="Karte + bar, ohne Übertrag" />
        <Kpi l="Trinkgeld über Kartenzahlung" v={e ? fmtEur(e.karten) : '—'} />
        <Kpi l="Bartrinkgeld" v={cur ? fmtEur(cur.cash_tip_cents) : '—'} />
        <Kpi l="Übertrag aus Vormonat" v={cur ? fmtEur(cur.carry_in_cents) : '—'} />
        <Kpi l="Verfügbares Trinkgeld" v={e ? fmtEur(e.available) : '—'} strong />
        <Kpi l="Gesamtarbeitsstunden" v={cur ? fmtH(cur.total_minutes) : '—'} />
        <Kpi l="Trinkgeld pro Stunde" v={cur && cur.total_minutes ? `${(cur.available_cents / 100 / (cur.total_minutes / 60)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '—'} />
        <Kpi l="Bereits ausgezahlt" v={cur ? fmtEur(paidSum) : '—'} />
        <Kpi l="Noch auszuzahlen" v={cur ? fmtEur(Math.max(0, cur.payout_cents - paidSum)) : '—'} strong />
        <Kpi l="Restbetrag (Übertrag)" v={cur ? fmtEur(cur.rest_cents) : '—'} />
        <Kpi l="Anzahl der Mitarbeiter" v={cur ? (nEmp == null ? '…' : String(nEmp)) : '—'} hint={cur ? 'mit Stunden im Pool' : undefined} />
      </div>

      <div className="card">
        <div className="row between"><b>Trinkgeld der letzten 12 Monate</b><span className="small muted"><span className="tg-dot a" /> Verfügbar <span className="tg-dot b" /> Verteilt</span></div>
        <div className="tg-chart" role="img" aria-label="Trinkgeld der letzten 12 Monate">
          {series.map((x) => (
            <div key={x.m} className="tg-col" title={`${mmYYYY(x.m)}: verfügbar ${fmtEur(x.avail)}, verteilt ${fmtEur(x.payout)}`}>
              <div className="tg-bars">
                <div className="tg-bar a" style={{ height: `${(Math.max(0, x.avail) / max) * 100}%` }} />
                <div className="tg-bar b" style={{ height: `${(Math.max(0, x.payout) / max) * 100}%` }} />
              </div>
              <span className={x.m === period ? 'on' : ''}>{x.m.slice(5)}/{x.m.slice(2, 4)}</span>
            </div>
          ))}
        </div>
      </div>

      <h3>Abrechnungshistorie</h3>
      {hist.length === 0 ? <p className="muted small">Noch keine Abrechnungen.</p> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Beleg-Nr.</th><th>Monat</th><th>Status</th><th className="num">Verfügbar</th><th className="num">Stunden</th><th className="num">Verteilt</th><th className="num">Rest</th></tr></thead>
          <tbody>{hist.map((s) => (
            <tr key={s.id} className="tg-click" onClick={() => nav(`/r/${rid}/tg/abrechnung/${s.id}?m=${s.period}`)}>
              <td>{s.beleg_no}</td><td>{mmYYYY(s.period)}</td><td><StatusTag s={s} /></td>
              <td className="num">{fmtEur(s.available_cents)}</td><td className="num">{fmtH(s.total_minutes)}</td><td className="num">{fmtEur(s.payout_cents)}</td><td className="num">{fmtEur(s.rest_cents)}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

function Einstellungen() {
  const { settings, owner, reload, r } = useTg()
  const [s, setS] = useState(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setS(settings), [settings])
  const dis = !owner
  async function save() {
    setBusy(true)
    try { await saveSettings(s); await reload(); toast('Gespeichert') } catch (e) { toast(tgErr(e)) }
    setBusy(false)
  }
  return (
    <div className="card">
      {!owner && <div className="alert warn">Nur die Geschäftsführung kann die Einstellungen ändern.</div>}
      <div className="f"><span>Rundungsmethode (nur der Endbetrag je Mitarbeiter wird gerundet)</span>
        <div className="seg">{(Object.keys(ROUNDING) as Rounding[]).map((k) => <button key={k} disabled={dis} className={s.rounding === k ? 'sel' : ''} onClick={() => setS({ ...s, rounding: k })}>{ROUNDING[k]}</button>)}</div>
      </div>
      <label className="f"><span>Betriebsstätte (Standard)</span><input disabled={dis} value={s.betriebsstaette || ''} placeholder={r.name} onChange={(e) => setS({ ...s, betriebsstaette: e.target.value })} /></label>
      <h3>Kassenbuch</h3>
      <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" disabled={dis} checked={s.kassenbuch} onChange={(e) => setS({ ...s, kassenbuch: e.target.checked })} /> <span>Barauszahlungen als Eintrag im Kassenbuch buchen (mit Prüfung des Kassenbestands)</span></label>
      <div className="grid2">
        <label className="f"><span>Konto Trinkgeld-Auszahlung</span><input disabled={dis} value={s.konto_trinkgeld || ''} placeholder="lt. Steuerberater" onChange={(e) => setS({ ...s, konto_trinkgeld: e.target.value.trim() || null })} /></label>
        <label className="f"><span>Gegenkonto Kasse</span><input disabled={dis} value={s.konto_kasse || ''} placeholder="lt. Steuerberater" onChange={(e) => setS({ ...s, konto_kasse: e.target.value.trim() || null })} /></label>
      </div>
      <p className="small muted">Die Kontonummern werden nicht vorgegeben (kein SKR03/SKR04-Zwang) und bitte mit dem Steuerberater abstimmen. Trinkgeld-Auszahlungen werden weder als Umsatz noch als Betriebsausgabe gebucht, sondern als durchlaufender Posten auf dem hier eingetragenen Konto.</p>
      {r.card_source !== 'viva' && <div className="alert warn">Dieses Restaurant bucht das Kartentrinkgeld im Kassenbuch bereits täglich als „Trinkgeld (Karte) an Personal ausgezahlt“ (Z-Bon). Um Doppelbuchungen zu vermeiden, Kassenbuch-Buchung hier nur mit dem Steuerberater abgestimmt einschalten.</div>}
      <p className="small muted">Firmendaten (Logo, Adresse, Register, Bank) stammen aus den Unternehmenseinstellungen (Viết hoá đơn → Einstellungen) und werden nicht doppelt gespeichert.</p>
      <button className="primary" disabled={dis || busy} onClick={save}>Speichern</button>
    </div>
  )
}
