// Monatsabrechnung: Liste, neue Abrechnung, Detail (Ermittlung, Anhänge, Status, Protokoll, PDF)
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Money, Sheet, Spinner, toast } from '../components/ui'
import PdfSheet from '../components/PdfSheet'
import { dropProps } from '../lib/drop'
import { todayIso } from '../lib/format'
import { useTg, StatusTag } from './TgApp'
import {
  ACCEPT, chainPayments, createSettlement, deleteTgFile, loadAudit, loadDetail, okFile, prefill, recompute, saveSettlement, setStatus,
  tgErr, tgFileUrl, uploadTgFile, userNames, type Audit, type Line, type Payment, type Settlement, type TgFile,
  downloadBlob,
} from './api'
import { deMonth, dmy, fmtEur, fmtH, FILE_KINDS, isFinal, lastDay, mmYYYY, pdfName, ROUNDING, STATUS, toCents, type FileKind } from './calc'
import { renderTgPdf } from './TgPdf'

type Pre = Awaited<ReturnType<typeof prefill>>

export default function Abrechnung() {
  const { list, period, rid, settings, r } = useTg()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const open = sp.get('neu') === '1'
  const setOpen = (v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('neu', '1'); else n.delete('neu'); setSp(n, { replace: true }) }
  const bs = settings.betriebsstaette || r.name
  const exists = list.some((s) => s.period === period && s.kind === 'original' && s.betriebsstaette === bs && s.status !== 'storniert' && s.status !== 'korrigiert')
  const shown = list.filter((s) => (q ? `${s.beleg_no} ${s.period} ${mmYYYY(s.period)} ${STATUS[s.status]}`.toLowerCase().includes(q.toLowerCase()) : s.period === period))

  return (
    <>
      <div className="row wrap" style={{ margin: '4px 0 10px' }}>
        <button className="primary" disabled={exists} onClick={() => setOpen(true)}>+ Neue Abrechnung erstellen</button>
        <input className="grow" style={{ minWidth: 180 }} placeholder="Suche: Beleg-Nr., Monat (10/2026) …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {exists && !q && <p className="small muted">Für {deMonth(period)} und „{bs}“ besteht bereits eine gültige Abrechnung. Änderungen nach dem Festschreiben nur über Korrektur- oder Stornobeleg.</p>}
      {shown.length === 0 ? <p className="muted">Keine Abrechnung {q ? 'gefunden' : `für ${deMonth(period)}`}.</p> : (
        <div className="list">
          {shown.map((s) => (
            <Link key={s.id} className="it" to={`/r/${rid}/tg/abrechnung/${s.id}?m=${s.period}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{s.beleg_no} · {deMonth(s.period)}</div>
                <div className="small muted">{s.betriebsstaette} · verfügbar {fmtEur(s.available_cents)} · verteilt {fmtEur(s.payout_cents)}</div>
              </div>
              <StatusTag s={s} />
            </Link>
          ))}
        </div>
      )}
      <NewSheet open={open} onClose={() => setOpen(false)} onCreated={(id) => nav(`/r/${rid}/tg/abrechnung/${id}?m=${period}`)} />
    </>
  )
}

function NewSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { rid, r, period: p0, settings, reload } = useTg()
  const [period, setPeriod] = useState(p0)
  const [pre, setPre] = useState<Pre | null>(null)
  const [f, setF] = useState({ betriebsstaette: '', period_from: '', period_to: '', stichtag: '', created_on: todayIso(), terminal: 0, z: 0, z_from: '', z_to: '', cash: 0, carry: 0, corr: 0, corr_reason: '', remarks: '', pos: false })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setPeriod(p0) }, [open, p0])
  useEffect(() => {
    if (!open) return
    setPre(null)
    prefill(rid, period, r.card_source || null).then((x) => {
      setPre(x)
      setF((o) => ({ ...o, betriebsstaette: settings.betriebsstaette || r.name, period_from: `${period}-01`, period_to: lastDay(period), stichtag: lastDay(period),
        terminal: (x.terminal ?? 0) / 100, z: x.z.card / 100, z_from: x.z.from || '', z_to: x.z.to || '', carry: x.carryIn / 100, pos: false }))
    }).catch((e) => toast(tgErr(e)))
  }, [open, period, rid]) // eslint-disable-line
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7))
  const setYM = (yy: number, mm: number) => setPeriod(`${yy}-${String(mm).padStart(2, '0')}`)
  const diff = toCents(f.terminal) - toCents(f.z)
  const karten = (f.pos && pre ? pre.z.posTip : diff) + toCents(f.corr)
  const avail = karten + toCents(f.cash) + toCents(f.carry)

  async function create() {
    if (!pre) return
    if (toCents(f.corr) !== 0 && !f.corr_reason.trim()) { toast('Bitte Begründung der Korrekturen angeben'); return }
    setBusy(true)
    try {
      const src = [pre.terminalSource ? `Kartenterminal: ${pre.terminalSource}` : 'Kartenterminal: manuelle Eingabe lt. Terminalabrechnung', pre.z.count ? `Z-Berichte: ${pre.z.count} Berichte aus der Kasse` : 'Z-Berichte: manuelle Eingabe', 'Arbeitsstunden: Zeiterfassung (Arbeitsplan, Pausen abgezogen)'].join(' · ')
      const base = {
        period, betriebsstaette: f.betriebsstaette.trim() || r.name, period_from: f.period_from, period_to: f.period_to, stichtag: f.stichtag, created_on: f.created_on,
        tip_source: (f.pos ? 'pos' : 'differenz') as Settlement['tip_source'], terminal_cents: toCents(f.terminal), z_cents: toCents(f.z), pos_tip_cents: pre.z.posTip > 0 ? pre.z.posTip : null,
        z_from: f.z_from || null, z_to: f.z_to || null, cash_tip_cents: toCents(f.cash), carry_in_cents: toCents(f.carry), correction_cents: toCents(f.corr),
        correction_reason: f.corr_reason.trim() || null, remarks: f.remarks.trim() || null, rounding: settings.rounding, data_source: src,
      } as Settlement
      const lines = pre.lines.map(({ skipped, ...l }) => { void skipped; return l }) as unknown as Line[]
      const { s, lines: nl } = recompute(base, lines)
      const id = await createSettlement(rid, s, nl.map(({ id, settlement_id, restaurant_id, ...l }) => { void id; void settlement_id; void restaurant_id; return l }))
      await reload(); onClose(); onCreated(id)
    } catch (e) { toast(tgErr(e)) }
    setBusy(false)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Neue Abrechnung erstellen">
      <div className="grid2">
        <label className="f"><span>Abrechnungsmonat</span>
          <select value={m} onChange={(e) => setYM(y, Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{deMonth(`2000-${String(i + 1).padStart(2, '0')}`).replace(' 2000', '')}</option>)}</select></label>
        <label className="f"><span>Abrechnungsjahr</span><input type="number" value={y} onChange={(e) => setYM(Number(e.target.value) || y, m)} /></label>
      </div>
      {!pre ? <Spinner /> : <>
        <label className="f"><span>Betriebsstätte</span><input value={f.betriebsstaette} onChange={(e) => setF({ ...f, betriebsstaette: e.target.value })} /></label>
        <div className="grid2">
          <label className="f"><span>Zeitraum von</span><input type="date" value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} /></label>
          <label className="f"><span>Zeitraum bis</span><input type="date" value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} /></label>
          <label className="f"><span>Abrechnungsstichtag</span><input type="date" value={f.stichtag} onChange={(e) => setF({ ...f, stichtag: e.target.value })} /></label>
          <label className="f"><span>Erstellungsdatum</span><input type="date" value={f.created_on} onChange={(e) => setF({ ...f, created_on: e.target.value })} /></label>
          <label className="f"><span>Kartenzahlungen lt. Kartenterminal{pre.terminalSource ? ' (Viva Wallet)' : ''}</span><Money value={f.terminal} onChange={(v) => setF({ ...f, terminal: v })} /></label>
          <label className="f"><span>Kartenzahlungen lt. Z-Berichten ({pre.z.count})</span><Money value={f.z} onChange={(v) => setF({ ...f, z: v })} /></label>
          <label className="f"><span>Z-Bericht von Nr.</span><input value={f.z_from} onChange={(e) => setF({ ...f, z_from: e.target.value })} /></label>
          <label className="f"><span>Z-Bericht bis Nr.</span><input value={f.z_to} onChange={(e) => setF({ ...f, z_to: e.target.value })} /></label>
          <label className="f"><span>Bartrinkgeld im Trinkgeldpool</span><Money value={f.cash} onChange={(v) => setF({ ...f, cash: v })} /></label>
          <label className="f"><span>Übertrag aus Vormonat{pre.carryFrom ? ` (${mmYYYY(pre.carryFrom)})` : ''}</span><Money value={f.carry} onChange={(v) => setF({ ...f, carry: v })} /></label>
          <label className="f"><span>Sonstige Korrekturen (±)</span><Money value={f.corr} onChange={(v) => setF({ ...f, corr: v })} /></label>
          <label className="f"><span>Begründung der Korrekturen</span><input value={f.corr_reason} onChange={(e) => setF({ ...f, corr_reason: e.target.value })} /></label>
        </div>
        {pre.z.posTip > 0 && (
          <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" checked={f.pos} onChange={(e) => setF({ ...f, pos: e.target.checked })} />
            <span>POS hat Trinkgeld separat erfasst: <b>{fmtEur(pre.z.posTip)}</b> verwenden (Differenz Terminal − Z: {fmtEur(diff)})</span></label>
        )}
        <label className="f"><span>Bemerkungen</span><textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
        <div className="tg-sum">
          <div><span>Differenz</span><b>{fmtEur(diff)}</b></div>
          <div><span>Kartentrinkgeld</span><b>{fmtEur(karten)}</b></div>
          <div><span>Verfügbares Trinkgeld</span><b>{fmtEur(avail)}</b></div>
          <div><span>Mitarbeiter</span><b>{pre.lines.length} · {fmtH(pre.lines.reduce((s, l) => s + l.minutes, 0))}</b></div>
        </div>
        {pre.lines.length === 0 && <div className="alert warn">Keine Mitarbeiter für diesen Monat gefunden (Mitarbeiter-Modul / Arbeitsplan prüfen). Ohne Stunden kann nicht festgeschrieben werden.</div>}
        {pre.lines.some((l) => l.skipped) && <div className="alert warn">{pre.lines.reduce((s, l) => s + l.skipped, 0)} Schicht(en) an Urlaubs-/Krankheitstagen wurden nicht gezählt.</div>}
        {diff < 0 && !f.pos && <div className="alert warn">Die Differenz ist negativ: Terminal und Z-Berichte bitte abstimmen.</div>}
        {!pre.terminalSource && <div className="alert warn">Kartenterminal-Betrag bitte aus der Terminalabrechnung eintragen.</div>}
        <button className="primary block" disabled={busy} onClick={create}>Abrechnung als Entwurf anlegen</button>
      </>}
    </Sheet>
  )
}

const KIND_UP: FileKind[] = ['terminal', 'zbericht', 'abstimmung', 'arbeitszeit', 'sonstige', 'signiert', 'korrektur']

export function AbrechnungDetail() {
  const { id } = useParams()
  const { rid, r, owner, company, list, reload, settings } = useTg()
  const nav = useNavigate()
  const [s, setS] = useState<Settlement | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [before, setBefore] = useState<Line[]>([])
  const [files, setFiles] = useState<TgFile[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [audit, setAudit] = useState<Audit[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [dirty, setDirty] = useState(false)
  const [upKind, setUpKind] = useState<FileKind>('terminal')
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [confirm, setConfirm] = useState<'' | 'lock' | 'storno'>('')
  const [reason, setReason] = useState('')

  async function load() {
    if (!id) return
    try {
      const d = await loadDetail(id)
      setS(d.s); setLines(d.lines); setBefore(d.lines); setFiles(d.files); setDirty(false)
      setPayments(await chainPayments(d.s))
    } catch (e) { toast(tgErr(e)) }
  }
  useEffect(() => { load(); userNames().then(setNames) }, [id]) // eslint-disable-line

  const calc = useMemo(() => (s ? recompute(s, lines) : null), [s, lines])
  if (!s || !calc) return <Spinner />
  const final = isFinal(s.status)
  const edit = s.status === 'entwurf'
  const set = (p: Partial<Settlement>) => { setS({ ...s, ...p }); setDirty(true) }
  const e = calc.e
  const chain = list.filter((x) => x.id !== s.id && (x.id === s.ref_id || (x.ref_id && x.ref_id === (s.ref_id || s.id))))
  const paidActive = payments.filter((p) => !p.cancelled_at)
  const warns: string[] = []
  if (e.differenz < 0 && s.tip_source === 'differenz') warns.push('Die Differenz Terminal − Z-Berichte ist negativ.')
  if (s.pos_tip_cents != null && e.posMismatch !== 0) warns.push(`POS-Trinkgeld (${fmtEur(s.pos_tip_cents)}) weicht von der Terminal-Differenz (${fmtEur(e.differenz)}) um ${fmtEur(e.posMismatch)} ab.`)
  if (s.correction_cents !== 0 && !s.correction_reason?.trim()) warns.push('Korrekturen ohne Begründung.')
  if (calc.d.totalMinutes === 0) warns.push('Gesamtstunden = 0: Festschreiben nicht möglich.')
  if (e.available < 0) warns.push('Verfügbares Trinkgeld ist negativ.')
  if (!s.tip_confirmed && s.kind !== 'storno') warns.push('Bestätigung fehlt, dass die Differenz tatsächlich Trinkgeld ist.')

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    try { await fn(); await load(); await reload() } catch (err) { toast(tgErr(err)) }
    setBusy('')
  }
  const save = () => run('save', async () => { await saveSettlement(s, lines, before); toast('Gespeichert') })
  const markChecked = () => run('check', async () => {
    if (!s.tip_confirmed) throw new Error('Bitte bestätigen, dass die Differenz tatsächlich Trinkgeld ist.')
    if (calc.d.totalMinutes === 0) throw new Error('Gesamtstunden = 0')
    if (s.correction_cents !== 0 && !s.correction_reason?.trim()) throw new Error('Bitte Begründung der Korrekturen angeben')
    if (dirty) await saveSettlement(s, lines, before)
    await setStatus(s.id, 'geprueft')
  })
  const lock = () => run('lock', async () => {
    await setStatus(s.id, 'festgeschrieben')
    // Korrekturbeleg festgeschrieben -> frühere gültige Belege der Kette gelten als korrigiert
    if (s.kind === 'korrektur') for (const x of chain) if (['festgeschrieben', 'teilweise', 'ausgezahlt'].includes(x.status)) await setStatus(x.id, 'korrigiert')
    setConfirm('')
  })
  const correction = () => run('korr', async () => {
    const root = s.ref_id || s.id
    const { id: _i, beleg_no, status, created_at, created_by, checked_at, checked_by, locked_at, locked_by, updated_at, updated_by, ...rest } = s
    void _i; void beleg_no; void status; void created_at; void created_by; void checked_at; void checked_by; void locked_at; void locked_by; void updated_at; void updated_by
    const nid = await createSettlement(rid, { ...rest, kind: 'korrektur', ref_id: root, created_on: todayIso(), tip_confirmed: false, remarks: `Korrektur zu ${s.beleg_no}${s.remarks ? ` · ${s.remarks}` : ''}` },
      lines.map(({ id: _l, settlement_id, restaurant_id, ...l }) => { void _l; void settlement_id; void restaurant_id; return l }))
    nav(`/r/${rid}/tg/abrechnung/${nid}?m=${s.period}`)
  })
  const storno = () => run('storno', async () => {
    if (!reason.trim()) throw new Error('Bitte Grund der Stornierung angeben')
    if (paidActive.length) throw new Error('Es gibt bereits Auszahlungen. Bitte Korrekturbeleg statt Storno erstellen.')
    const { id: _i, beleg_no, status, created_at, created_by, checked_at, checked_by, locked_at, locked_by, updated_at, updated_by, ...rest } = s
    void _i; void status; void created_at; void created_by; void checked_at; void checked_by; void locked_at; void locked_by; void updated_at; void updated_by
    await createSettlement(rid, { ...rest, kind: 'storno', ref_id: s.ref_id || s.id, created_on: todayIso(), remarks: beleg_no, cancel_reason: reason.trim() }, [])
    await setStatus(s.id, 'storniert', { cancel_reason: reason.trim() })
    setConfirm(''); setReason('')
  })
  const delDraft = () => run('del', async () => {
    if (!confirm_('Entwurf endgültig löschen?')) return
    for (const f of files) await deleteTgFile(f)
    const { supabase } = await import('../lib/supabase')
    const x = await supabase.from('nh_tg_settlements').delete().eq('id', s.id)
    if (x.error) throw new Error(x.error.message)
    nav(`/r/${rid}/tg/abrechnung?m=${s.period}`)
  })
  async function showPdf() {
    if (!company) { toast('Firmendaten fehlen (Unternehmenseinstellungen)'); return }
    setBusy('pdf')
    try { setPdf(await renderTgPdf({ company, s: dirty ? calc!.s : s!, lines: dirty ? calc!.lines : lines, payments, restaurantName: r.name })) } catch (err) { toast(tgErr(err)) }
    setBusy('')
  }
  async function archivePdf() {
    if (!pdf) return
    setBusy('arch')
    try { await uploadTgFile(s!, 'abrechnung', pdf, pdfName(s!.beleg_no, company?.name || r.name)); await load(); toast('Im Archiv gespeichert (neue Version, unterschriebene Fassung bleibt erhalten)') } catch (err) { toast(tgErr(err)) }
    setBusy('')
  }
  async function upload(fl: FileList | File[] | null) {
    const arr = Array.from(fl || [])
    const bad = arr.filter((f) => !okFile(f))
    if (bad.length) toast(`Nur PDF, JPG oder PNG: ${bad.map((f) => f.name).join(', ')}`)
    setBusy('up')
    try { for (const f of arr.filter(okFile)) await uploadTgFile(s!, upKind, f, f.name); await load() } catch (err) { toast(tgErr(err)) }
    setBusy('')
  }

  return (
    <>
      <div className="row between wrap" style={{ margin: '4px 0 8px' }}>
        <div><h2 style={{ margin: 0 }}>{s.beleg_no}</h2><div className="small muted">{deMonth(s.period)} · {s.betriebsstaette}</div></div>
        <StatusTag s={s} />
      </div>
      {chain.length > 0 && <div className="small muted" style={{ marginBottom: 8 }}>Verknüpfte Belege: {chain.map((x) => <Link key={x.id} to={`/r/${rid}/tg/abrechnung/${x.id}?m=${x.period}`} style={{ marginRight: 8 }}>{x.beleg_no} ({STATUS[x.status]})</Link>)}</div>}
      {s.kind === 'storno' && <div className="alert err">Stornobeleg zu {s.remarks}. Grund: {s.cancel_reason}</div>}
      {s.status === 'storniert' && <div className="alert err">Storniert. Grund: {s.cancel_reason}</div>}
      {final && s.kind !== 'storno' && s.status !== 'storniert' && s.status !== 'korrigiert' && <div className="alert ok">🔒 Festgeschrieben: Zahlen nicht mehr änderbar. Auszahlungen können weiter erfasst werden; Fehler nur per Korrektur- oder Stornobeleg.</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Kopfdaten</h3>
        <div className="grid2">
          <label className="f"><span>Betriebsstätte</span><input disabled={!edit} value={s.betriebsstaette} onChange={(x) => set({ betriebsstaette: x.target.value })} /></label>
          <label className="f"><span>Erstellungsdatum</span><input type="date" disabled={!edit} value={s.created_on} onChange={(x) => set({ created_on: x.target.value })} /></label>
          <label className="f"><span>Zeitraum von</span><input type="date" disabled={!edit} value={s.period_from} onChange={(x) => set({ period_from: x.target.value })} /></label>
          <label className="f"><span>Zeitraum bis</span><input type="date" disabled={!edit} value={s.period_to} onChange={(x) => set({ period_to: x.target.value })} /></label>
          <label className="f"><span>Abrechnungsstichtag</span><input type="date" disabled={!edit} value={s.stichtag} onChange={(x) => set({ stichtag: x.target.value })} /></label>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Ermittlung des Trinkgeldes</h3>
        <div className="grid2">
          <label className="f"><span>Kartenzahlungen lt. Kartenterminal</span><Money disabled={!edit} value={s.terminal_cents / 100} onChange={(v) => set({ terminal_cents: toCents(v) })} /></label>
          <label className="f"><span>Kartenzahlungen lt. Z-Berichten</span><Money disabled={!edit} value={s.z_cents / 100} onChange={(v) => set({ z_cents: toCents(v) })} /></label>
          <label className="f"><span>Z-Bericht von Nr.</span><input disabled={!edit} value={s.z_from || ''} onChange={(x) => set({ z_from: x.target.value || null })} /></label>
          <label className="f"><span>Z-Bericht bis Nr.</span><input disabled={!edit} value={s.z_to || ''} onChange={(x) => set({ z_to: x.target.value || null })} /></label>
          <label className="f"><span>Bartrinkgeld im Trinkgeldpool</span><Money disabled={!edit} value={s.cash_tip_cents / 100} onChange={(v) => set({ cash_tip_cents: Math.max(0, toCents(v)) })} /></label>
          <label className="f"><span>Übertrag aus Vormonat</span><Money disabled={!edit} value={s.carry_in_cents / 100} onChange={(v) => set({ carry_in_cents: toCents(v) })} /></label>
          <label className="f"><span>Sonstige Korrekturen (±)</span><Money disabled={!edit} value={s.correction_cents / 100} onChange={(v) => set({ correction_cents: toCents(v) })} /></label>
          <label className="f"><span>Begründung der Korrekturen</span><input disabled={!edit} value={s.correction_reason || ''} onChange={(x) => set({ correction_reason: x.target.value || null })} /></label>
        </div>
        {s.pos_tip_cents != null && (
          <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" disabled={!edit} checked={s.tip_source === 'pos'} onChange={(x) => set({ tip_source: x.target.checked ? 'pos' : 'differenz' })} />
            <span>Trinkgeld lt. POS verwenden: <b>{fmtEur(s.pos_tip_cents)}</b> (separat in den Z-Berichten erfasst)</span></label>
        )}
        <label className="f"><span>Bemerkungen</span><textarea disabled={!edit} value={s.remarks || ''} onChange={(x) => set({ remarks: x.target.value || null })} /></label>
        <div className="tg-sum">
          <div><span>Differenz</span><b>{fmtEur(e.differenz)}</b></div>
          <div><span>Kartentrinkgeld</span><b>{fmtEur(e.karten)}</b></div>
          <div><span>Verfügbares Trinkgeld</span><b>{fmtEur(e.available)}</b></div>
        </div>
        <p className="small muted">Datenquelle: {s.data_source || '—'}</p>
        <label className="row"><input type="checkbox" disabled={!edit} checked={s.tip_confirmed} onChange={(x) => set({ tip_confirmed: x.target.checked })} />
          <span>Ich habe geprüft, dass die Differenz tatsächlich Trinkgeld ist (abgestimmt mit Terminalabrechnung).</span></label>
      </div>

      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>2. Verteilung</h3><Link to={`/r/${rid}/tg/verteilung?m=${s.period}&id=${s.id}`}>Mitarbeiter & Stunden →</Link></div>
        <div className="tg-sum" style={{ marginTop: 8 }}>
          <div><span>Gesamtstunden</span><b>{fmtH(calc.d.totalMinutes)}</b></div>
          <div><span>pro Stunde</span><b>{calc.d.totalMinutes ? `${(calc.d.perHourCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €` : '—'}</b></div>
          <div><span>Gesamtauszahlung</span><b>{fmtEur(calc.d.payout)}</b></div>
          <div><span>Rest / Übertrag</span><b>{fmtEur(calc.d.rest)}</b></div>
        </div>
        <div className="f" style={{ marginTop: 8 }}><span>Rundungsmethode</span>
          <div className="seg">{(Object.keys(ROUNDING) as Settlement['rounding'][]).map((k) => <button key={k} disabled={!edit} className={s.rounding === k ? 'sel' : ''} onClick={() => set({ rounding: k })}>{ROUNDING[k]}</button>)}</div>
        </div>
        {settings.rounding !== s.rounding && <p className="small muted">Abweichend von der Standard-Einstellung ({ROUNDING[settings.rounding]}).</p>}
      </div>

      {warns.length > 0 && !final && <div className="alert warn">{warns.map((w) => <div key={w}>⚠ {w}</div>)}</div>}

      <div className="row wrap tg-actions">
        {edit && <button className="primary" disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '…' : 'Speichern'}</button>}
        {s.status === 'entwurf' && <button disabled={!!busy} onClick={markChecked}>Als geprüft markieren</button>}
        {s.status === 'geprueft' && <button disabled={!!busy} onClick={() => run('back', () => setStatus(s.id, 'entwurf'))}>Zurück zu Entwurf</button>}
        {s.status === 'geprueft' && owner && <button className="primary" disabled={!!busy || dirty} onClick={() => setConfirm('lock')}>Festschreiben…</button>}
        {s.status === 'geprueft' && !owner && <span className="small muted">Festschreiben durch die Geschäftsführung.</span>}
        <button disabled={!!busy} onClick={showPdf}>{busy === 'pdf' ? 'PDF wird erstellt…' : 'PDF-Vorschau'}</button>
        {['festgeschrieben', 'teilweise', 'ausgezahlt'].includes(s.status) && s.kind !== 'storno' && <Link className="btn" to={`/r/${rid}/tg/auszahlungen?m=${s.period}&id=${s.id}`}>Auszahlungen</Link>}
        {owner && ['festgeschrieben', 'teilweise', 'ausgezahlt'].includes(s.status) && s.kind !== 'storno' && <button disabled={!!busy} onClick={correction}>Korrekturbeleg erstellen</button>}
        {owner && ['festgeschrieben', 'teilweise', 'ausgezahlt'].includes(s.status) && s.kind !== 'storno' && <button className="danger" disabled={!!busy} onClick={() => setConfirm('storno')}>Stornieren…</button>}
        {s.status === 'entwurf' && <button className="danger" disabled={!!busy} onClick={delDraft}>Entwurf löschen</button>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Belege & Anhänge</h3>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <select style={{ flex: '1 1 200px' }} value={upKind} onChange={(x) => setUpKind(x.target.value as FileKind)}>
            {KIND_UP.filter((k) => !final || ['signiert', 'korrektur', 'sonstige', 'abstimmung'].includes(k)).map((k) => <option key={k} value={k}>{FILE_KINDS[k]}</option>)}
          </select>
          <label className="btn drop" {...dropProps(upload)} style={{ flex: '1 1 200px' }}>
            {busy === 'up' ? 'Lädt…' : '📎 Datei hochladen (PDF, JPG, PNG)'}<span className="drop-hint">oder hierher ziehen</span>
            <input type="file" hidden multiple accept={ACCEPT} onChange={(x) => { upload(x.target.files); x.target.value = '' }} />
          </label>
        </div>
        {files.length === 0 ? <p className="small muted">Noch keine Anhänge.</p> : (
          <div className="list" style={{ marginBottom: 0 }}>
            {files.map((f) => (
              <div key={f.id} className="it">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t">{f.name}</div>
                  <div className="small muted">{FILE_KINDS[f.kind]} · {dmy(f.created_at.slice(0, 10))} · {names[f.created_by || ''] || ''}</div>
                </div>
                <button onClick={async () => { const u = await tgFileUrl(f.path); if (u) window.open(u, '_blank') }}>Öffnen</button>
                {!final && f.kind !== 'signiert' && <button className="ghost" onClick={() => run('delf', () => deleteTgFile(f))} aria-label="Löschen">✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="card" onToggle={(x) => { if ((x.target as HTMLDetailsElement).open && !audit) loadAudit(s.id).then(setAudit) }}>
        <summary><b>Änderungsprotokoll</b> <span className="small muted">Erstellt {dmy(s.created_at.slice(0, 10))} von {names[s.created_by || ''] || '—'}{s.checked_at ? ` · Geprüft ${dmy(s.checked_at.slice(0, 10))} von ${names[s.checked_by || ''] || '—'}` : ''}{s.locked_at ? ` · Festgeschrieben ${dmy(s.locked_at.slice(0, 10))} von ${names[s.locked_by || ''] || '—'}` : ''}</span></summary>
        {!audit ? <Spinner /> : audit.length === 0 ? <p className="small muted">Keine Einträge.</p> : (
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tg-audit">
            <thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Alte Werte</th><th>Neue Werte</th><th>Grund</th></tr></thead>
            <tbody>{audit.map((a) => (
              <tr key={a.id}>
                <td className="small">{new Date(a.at).toLocaleString('de-DE')}</td><td className="small">{names[a.by_user || ''] || '—'}</td>
                <td className="small">{AUD[a.tbl] || a.tbl} · {a.action === 'insert' ? 'angelegt' : a.action === 'update' ? 'geändert' : 'gelöscht'}</td>
                <td className="small">{a.action === 'update' ? vals(a.old_values) : ''}</td><td className="small">{a.action === 'update' ? vals(a.new_values) : a.action === 'insert' ? short(a.new_values) : ''}</td>
                <td className="small">{a.reason || ''}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </details>

      <Sheet open={confirm === 'lock'} onClose={() => setConfirm('')} title="Abrechnung festschreiben?">
        <p>Nach dem Festschreiben können die Zahlen von <b>{s.beleg_no}</b> nicht mehr geändert oder gelöscht werden. Fehler werden nur noch über einen Korrektur- oder Stornobeleg berichtigt.</p>
        <div className="tg-sum"><div><span>Verfügbar</span><b>{fmtEur(calc.e.available)}</b></div><div><span>Verteilt</span><b>{fmtEur(calc.d.payout)}</b></div><div><span>Stunden</span><b>{fmtH(calc.d.totalMinutes)}</b></div><div><span>Übertrag</span><b>{fmtEur(calc.d.rest)}</b></div></div>
        <p className="small muted">Es werden keine Auszahlungen automatisch erfasst.</p>
        <button className="primary block" disabled={!!busy} onClick={lock}>Jetzt festschreiben</button>
      </Sheet>
      <Sheet open={confirm === 'storno'} onClose={() => setConfirm('')} title={`${s.beleg_no} stornieren`}>
        <p>Es wird ein Stornobeleg erstellt, der mit dem Ursprungsbeleg verknüpft ist. Der Ursprungsbeleg bleibt unverändert erhalten.</p>
        <label className="f"><span>Grund der Stornierung</span><textarea value={reason} onChange={(x) => setReason(x.target.value)} /></label>
        <button className="danger block" disabled={!!busy || !reason.trim()} onClick={storno}>Stornobeleg erstellen</button>
      </Sheet>
      {pdf && <PdfSheet pdf={pdf} title={pdfName(s.beleg_no, company?.name || r.name)} onClose={() => setPdf(null)} actions={[
        { label: 'PDF herunterladen', onClick: () => downloadBlob(pdf, pdfName(s.beleg_no, company?.name || r.name)) },
        ...(final ? [{ label: busy === 'arch' ? '…' : 'Im Archiv speichern', onClick: archivePdf, primary: true, disabled: !!busy }] : []),
      ]} />}
    </>
  )
}

const confirm_ = (m: string) => window.confirm(m)
const AUD: Record<string, string> = { nh_tg_settlements: 'Abrechnung', nh_tg_lines: 'Mitarbeiter', nh_tg_payments: 'Auszahlung', nh_tg_files: 'Beleg' }
const LBL: Record<string, string> = {
  minutes: 'Stunden', participates: 'Teilnahme', amount_cents: 'Betrag', status: 'Status', terminal_cents: 'Terminal', z_cents: 'Z-Berichte', cash_tip_cents: 'Bartrinkgeld',
  carry_in_cents: 'Übertrag', correction_cents: 'Korrekturen', correction_reason: 'Begründung', available_cents: 'Verfügbar', payout_cents: 'Verteilt', rest_cents: 'Rest',
  total_minutes: 'Gesamtstunden', rounding: 'Rundung', edit_reason: 'Grund', tip_confirmed: 'Bestätigt', remarks: 'Bemerkungen', cancelled_at: 'Storniert am',
}
function fmtVal(k: string, v: unknown): string {
  if (v == null) return '—'
  if (k.endsWith('_cents')) return fmtEur(Number(v))
  if (k === 'minutes' || k === 'total_minutes' || k === 'minutes_auto') return fmtH(Number(v))
  if (k === 'status') return STATUS[v as Settlement['status']] || String(v)
  if (typeof v === 'boolean') return v ? 'ja' : 'nein'
  return String(v)
}
const SKIP = new Set(['checked_by', 'checked_at', 'locked_by', 'locked_at', 'cash_move_id', 'cancelled_by'])
function vals(o: Record<string, unknown> | null) {
  return Object.entries(o || {}).filter(([k]) => !SKIP.has(k)).map(([k, v]) => `${LBL[k] || k}: ${fmtVal(k, v)}`).join('; ')
}
function short(o: Record<string, unknown> | null) {
  if (!o) return ''
  if ('beleg_no' in o) return String(o.beleg_no)
  if ('amount_cents' in o && 'paid_on' in o) return `${fmtEur(Number(o.amount_cents))} am ${dmy(String(o.paid_on))}`
  if ('last_name' in o) return `${o.last_name}, ${o.first_name}`
  if ('name' in o) return String(o.name)
  return ''
}
