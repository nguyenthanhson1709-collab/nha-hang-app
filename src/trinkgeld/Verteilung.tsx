// Trinkgeld-Verteilung: Mitarbeiter, Stunden (aus Zeiterfassung, änderbar mit Begründung), Teilnahme, Beträge live
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Spinner, toast } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useTT, useVD, useLabels, ROUNDING_VI, PAY_VI } from './i18n'
import { useTg, StatusTag } from './TgApp'
import { activeOf, chainPayments, loadDetail, prefill, recompute, saveSettlement, tgErr, type Line, type Payment, type Settlement } from './api'
import { deMonth, mmYYYY, fmtEur, fmtH, PAY_STATE, parseHours, payState, ROUNDING } from './calc'

type SortK = 'pnr' | 'name' | 'type' | 'dept' | 'hours' | 'amount'

export function usePicked() {
  const { list, period } = useTg()
  const [sp, setSp] = useSearchParams()
  const inMonth = list.filter((s) => s.period === period && s.kind !== 'storno')
  const id = sp.get('id')
  const cur = (id && inMonth.find((s) => s.id === id)) || activeOf(list, period)
  const pick = (nid: string) => { const n = new URLSearchParams(sp); n.set('id', nid); setSp(n, { replace: true }) }
  return { cur, inMonth, pick }
}
export function Picker({ cur, inMonth, pick }: ReturnType<typeof usePicked>) {
  if (inMonth.length < 2 || !cur) return null
  return (
    <select style={{ marginBottom: 8 }} value={cur.id} onChange={(e) => pick(e.target.value)}>
      {inMonth.map((s) => <option key={s.id} value={s.id}>{s.beleg_no}</option>)}
    </select>
  )
}

export default function Verteilung() {
  const vd = useVD()
  const { pick } = useLabels()
  const tr = useTT()
  const { rid, period, r, reload } = useTg()
  const pk = usePicked()
  const { cur } = pk
  const [s, setS] = useState<Settlement | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [before, setBefore] = useState<Line[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ k: SortK; asc: boolean }>({ k: 'name', asc: true })
  const [hourText, setHourText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  async function load() {
    if (!cur) { setS(null); return }
    const d = await loadDetail(cur.id)
    setS(d.s); setLines(d.lines); setBefore(d.lines); setHourText({})
    setPayments(await chainPayments(d.s))
  }
  useEffect(() => { load().catch((e) => toast(tgErr(e))) }, [cur?.id]) // eslint-disable-line

  const calc = useMemo(() => (s ? recompute(s, lines) : null), [s, lines])
  const amountOf = useMemo(() => new Map((calc?.lines || []).map((l) => [l.id, l.amount_cents])), [calc])
  if (!cur) return <p className="muted">{vd(`Tháng ${mmYYYY(period)} chưa có quyết toán.`, `Für ${deMonth(period)} gibt es keine Abrechnung.`)} <Link to={`/r/${rid}/tg/abrechnung?m=${period}&neu=1`}>{tr('Neue Abrechnung erstellen')}</Link></p>
  if (!s || !calc) return <Spinner />
  const edit = s.status === 'entwurf'
  const dirty = JSON.stringify(lines.map((l) => [l.minutes, l.participates, l.edit_reason || ''])) !== JSON.stringify(before.map((l) => [l.minutes, l.participates, l.edit_reason || '']))
  const paidOf = (l: Line) => payments.filter((p) => !p.cancelled_at && (p.line_id === l.id || (l.employee_id && p.employee_id === l.employee_id))).reduce((a, p) => a + p.amount_cents, 0)
  const upd = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const missingReason = lines.filter((l) => l.minutes !== l.minutes_auto && !l.edit_reason?.trim())

  const val = (l: Line, k: SortK): string | number => k === 'pnr' ? Number(l.personnel_no) || 0 : k === 'name' ? `${l.last_name} ${l.first_name}`.toLowerCase() : k === 'type' ? l.emp_type || '' : k === 'dept' ? l.department || '' : k === 'hours' ? l.minutes : amountOf.get(l.id) || 0
  const shown = lines.filter((l) => !q || `${l.personnel_no || ''} ${l.first_name} ${l.last_name} ${l.department || ''} ${l.emp_type || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1) })
  const th = (k: SortK, l: string, cls = '') => <th className={`tg-sort ${cls}`} onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : true })}>{l}{sort.k === k ? (sort.asc ? ' ▲' : ' ▼') : ''}</th>

  async function save() {
    if (missingReason.length) { toast(tr('Für geänderte Stunden ist eine Begründung erforderlich')); return }
    setBusy('save')
    try { await saveSettlement(s!, lines, before); await load(); await reload(); toast(tr('Gespeichert')) } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  async function refreshHours() {
    setBusy('hrs')
    try {
      const pre = await prefill(rid, s!.period, r.card_source || null)
      const byEmp = new Map(pre.lines.map((l) => [l.employee_id, l]))
      for (const l of lines) {
        const p = l.employee_id ? byEmp.get(l.employee_id) : null
        const auto = p?.minutes || 0
        const manual = l.minutes !== l.minutes_auto
        const r1 = await supabase.from('nh_tg_lines').update({ minutes_auto: auto, ...(manual ? {} : { minutes: auto }) }).eq('id', l.id)
        if (r1.error) throw new Error(r1.error.message)
      }
      const have = new Set(lines.map((l) => l.employee_id))
      const add = pre.lines.filter((l) => !have.has(l.employee_id)).map(({ skipped, ...l }, i) => { void skipped; return { ...l, settlement_id: s!.id, restaurant_id: s!.restaurant_id, sort: lines.length + i } })
      if (add.length) { const r2 = await supabase.from('nh_tg_lines').insert(add); if (r2.error) throw new Error(r2.error.message) }
      const d = await loadDetail(s!.id)
      await saveSettlement(d.s, d.lines, d.lines)
      await load(); await reload()
      toast(vd(`Đã cập nhật giờ từ lịch làm${add.length ? `, thêm ${add.length} nhân viên` : ''}`, `Stunden aus der Zeiterfassung aktualisiert${add.length ? `, ${add.length} Mitarbeiter ergänzt` : ''}`))
    } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }

  return (
    <>
      <Picker {...pk} />
      <div className="row between wrap" style={{ margin: '4px 0 8px' }}>
        <div><b>{s.beleg_no}</b> <span className="small muted">· {pick(ROUNDING, ROUNDING_VI, s.rounding)}</span></div>
        <StatusTag s={s} />
      </div>
      <div className="tg-sum sticky">
        <div><span>{tr('Verfügbar')}</span><b>{fmtEur(calc.e.available)}</b></div>
        <div><span>{tr('Gesamtstunden')}</span><b>{fmtH(calc.d.totalMinutes)}</b></div>
        <div><span>{tr('pro Stunde')}</span><b>{calc.d.totalMinutes ? `${(calc.d.perHourCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €` : '—'}</b></div>
        <div><span>{tr('Gesamtauszahlung')}</span><b>{fmtEur(calc.d.payout)}</b></div>
        <div><span>{tr('Rundungsrest → Übertrag')}</span><b>{fmtEur(calc.d.rest)}</b></div>
      </div>
      {calc.d.totalMinutes === 0 && <div className="alert warn">{tr('Gesamtstunden = 0: Verteilung und Festschreiben nicht möglich.')}</div>}
      {calc.d.payout > calc.e.available && <div className="alert err">{tr('Verteilung übersteigt das verfügbare Trinkgeld.')}</div>}
      {lines.length === 0 && <div className="alert warn">{tr('Keine Mitarbeiter in dieser Abrechnung.')}</div>}
      {!edit && <div className="alert ok">{tr('Nur im Entwurf änderbar.')}{s.status === 'geprueft' ? vd(' (Bấm „Trở lại bản nháp“ ở Quyết toán tháng.)', ' (Zurück zu Entwurf in der Monatsabrechnung.)') : ''}</div>}
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <input className="grow" style={{ minWidth: 180 }} placeholder={tr('Mitarbeiter suchen…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {edit && <button disabled={!!busy} onClick={refreshHours}>{busy === 'hrs' ? '…' : tr('Stunden aus Zeiterfassung neu laden')}</button>}
        {edit && <button className="primary" disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '…' : tr('Speichern')}</button>}
      </div>
      <div className="tbl-wrap fit-wrap"><table className="tg-tbl">
        <thead><tr>
          {th('pnr', tr('Pers.-Nr.'))}<th>{tr('Vorname')}</th>{th('name', tr('Nachname'))}{th('type', tr('Beschäftigungsart'))}{th('dept', tr('Abteilung'))}
          {th('hours', tr('Stunden'), 'num')}<th>{tr('Teilnahme')}</th>{th('amount', tr('Betrag'), 'num')}<th>{tr('Status')}</th>
        </tr></thead>
        <tbody>{shown.map((l) => {
          const changed = l.minutes !== l.minutes_auto
          const st = payState(amountOf.get(l.id) || 0, paidOf(l))
          return (
            <tr key={l.id} className={l.participates ? '' : 'tg-off'}>
              <td>{l.personnel_no || '—'}</td><td>{l.first_name}</td>
              <td>{l.last_name}{l.exit_date && l.exit_date <= s.period_to && <div className="small muted">{tr('Austritt')} {l.exit_date.split('-').reverse().join('.')}</div>}</td>
              <td className="small">{l.emp_type || '—'}</td><td className="small">{l.department || '—'}</td>
              <td className="num">
                {edit ? <input className="tg-h" inputMode="decimal" value={hourText[l.id] ?? fmtH(l.minutes, false)}
                  onChange={(e) => { setHourText({ ...hourText, [l.id]: e.target.value }); const m = parseHours(e.target.value); if (m != null) upd(l.id, { minutes: m }) }}
                  onBlur={() => setHourText((h) => { const n = { ...h }; delete n[l.id]; return n })} /> : fmtH(l.minutes, false)}
                {changed && <div className="small muted">{tr('Zeiterf.:')} {fmtH(l.minutes_auto, false)}</div>}
                {changed && edit && <input className={`tg-reason${l.edit_reason?.trim() ? '' : ' err-field'}`} placeholder={tr('Begründung (Pflicht)')} value={l.edit_reason || ''} onChange={(e) => upd(l.id, { edit_reason: e.target.value })} />}
                {changed && !edit && l.edit_reason && <div className="small muted">{tr('Grund:')} {l.edit_reason}</div>}
              </td>
              <td><input type="checkbox" disabled={!edit} checked={l.participates} onChange={(e) => upd(l.id, { participates: e.target.checked })} aria-label={tr('Teilnahme am Trinkgeldpool')} /></td>
              <td className="num"><b>{fmtEur(amountOf.get(l.id) || 0)}</b></td>
              <td>{st ? <span className={`tag ${st === 'ausgezahlt' ? 'ok' : st === 'teilweise' ? 'warn' : ''}`}>{pick(PAY_STATE, PAY_VI, st)}</span> : <span className="small muted">—</span>}</td>
            </tr>
          )
        })}</tbody>
        <tfoot><tr><td colSpan={5}>{tr('Summe')} ({lines.filter((l) => l.participates && l.minutes > 0).length} {tr('Mitarbeiter im Pool')})</td><td className="num">{fmtH(calc.d.totalMinutes, false)}</td><td /><td className="num">{fmtEur(calc.d.payout)}</td><td /></tr></tfoot>
      </table></div>
      <p className="small muted">{tr('Stunden aus dem Arbeitsplan (tatsächliche Schichten, unbezahlte Pausen abgezogen). Urlaub, Krankheit, Feiertage ohne Arbeit und sonstige Abwesenheiten zählen nicht. Minijobber werden nicht automatisch ausgeschlossen; Teilnahme gemäß vereinbarter Trinkgeldregelung festlegen.')}</p>
    </>
  )
}
