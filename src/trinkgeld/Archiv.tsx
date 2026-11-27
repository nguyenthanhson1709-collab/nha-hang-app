// Archiv: Trinkgeld/YYYY/MM-Monat/<Unterordner>, Suche, PDF/Excel/CSV, Monats-ZIP. Unterschriebene PDFs werden nie überschrieben.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { Spinner, toast } from '../components/ui'
import PdfSheet from '../components/PdfSheet'
import { supabase } from '../lib/supabase'
import { useTT, useVD, useLabels, FILE_VI } from './i18n'
import { useTg, StatusTag } from './TgApp'
import { chainPayments, loadDetail, tgErr, tgFileBlob, tgFileUrl, type Line, type Payment, type Settlement, type TgFile, downloadBlob } from './api'
import { ARCHIVE_DIR, ARCHIVE_DIRS, archiveDir, deMonth, dmy, FILE_KINDS, fileSafe, fmtH, pdfName, PAY_STATE, payState, STATUS } from './calc'
import { renderTgPdf } from './TgPdf'

interface LineHit { settlement_id: string; first_name: string; last_name: string; personnel_no: string | null }

export default function Archiv() {
  const vd = useVD()
  const { pick } = useLabels()
  const tr = useTT()
  const { rid, list, company, r } = useTg()
  const years = useMemo(() => [...new Set(list.map((s) => s.period.slice(0, 4)))].sort().reverse(), [list])
  const [year, setYear] = useState(years[0] || String(new Date().getFullYear()))
  const [files, setFiles] = useState<TgFile[] | null>(null)
  const [hits, setHits] = useState<LineHit[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [pdf, setPdf] = useState<{ blob: Blob; name: string } | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('nh_tg_files').select('*').eq('restaurant_id', rid).order('created_at'),
      supabase.from('nh_tg_lines').select('settlement_id, first_name, last_name, personnel_no').eq('restaurant_id', rid),
    ]).then(([f, l]) => { setFiles((f.data || []) as TgFile[]); setHits((l.data || []) as LineHit[]) })
  }, [rid, list])

  if (!files) return <Spinner />
  const co = company?.name || r.name
  const ql = q.trim().toLowerCase()
  const match = (s: Settlement) => !ql || `${s.beleg_no} ${s.period} ${s.period.slice(5)}/${s.period.slice(0, 4)} ${deMonth(s.period)}`.toLowerCase().includes(ql)
    || hits.some((h) => h.settlement_id === s.id && `${h.first_name} ${h.last_name} ${h.personnel_no || ''}`.toLowerCase().includes(ql))
  const shown = list.filter((s) => (ql ? true : s.period.startsWith(year)) && match(s))
  const months = [...new Set(shown.map((s) => s.period))].sort().reverse()

  async function genPdf(s: Settlement) {
    const d = await loadDetail(s.id)
    const pays = await chainPayments(d.s)
    return renderTgPdf({ company: company!, s: d.s, lines: d.lines, payments: pays, restaurantName: r.name })
  }
  async function preview(s: Settlement) {
    if (!company) { toast(tr('Firmendaten fehlen')); return }
    setBusy(s.id)
    try { setPdf({ blob: await genPdf(s), name: pdfName(s.beleg_no, co) }) } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  async function exportTable(s: Settlement, kind: 'csv' | 'xlsx') {
    setBusy(s.id)
    try {
      const d = await loadDetail(s.id)
      const pays = await chainPayments(d.s)
      const blob = tableBlob(d.s, d.lines, pays, kind)
      downloadBlob(blob, `${s.beleg_no}_${fileSafe(co)}_Trinkgeldverteilung.${kind}`)
    } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  async function zipMonth(period: string) {
    if (!company) { toast(tr('Firmendaten fehlen')); return }
    setBusy(period)
    try {
      const zip = new JSZip()
      const root = archiveDir(period)
      for (const d of ARCHIVE_DIRS) zip.folder(`${root}/${d}`)
      for (const s of list.filter((x) => x.period === period)) {
        const isKorr = s.kind !== 'original'
        zip.file(`${root}/${isKorr ? 'Korrekturbelege' : 'Trinkgeldabrechnung'}/${pdfName(s.beleg_no, co, s.kind === 'storno' ? 'Stornobeleg' : s.kind === 'korrektur' ? 'Korrekturbeleg' : 'Trinkgeldabrechnung')}`, await genPdf(s))
        const d = await loadDetail(s.id)
        zip.file(`${root}/Trinkgeldabrechnung/${s.beleg_no}_${fileSafe(co)}_Trinkgeldverteilung.csv`, tableBlob(d.s, d.lines, await chainPayments(d.s), 'csv'))
        for (const f of files!.filter((x) => x.settlement_id === s.id)) {
          const dir = f.kind === 'abrechnung' ? 'Trinkgeldabrechnung/erstellt' : ARCHIVE_DIR[f.kind]
          zip.file(`${root}/${dir}/${dmy(f.created_at.slice(0, 10))}_${f.name.replace(/[\\/]/g, '-')}`, await tgFileBlob(f.path))
        }
      }
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `Trinkgeld_${period}_${fileSafe(co)}.zip`)
    } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <select style={{ flex: '0 0 120px' }} value={year} onChange={(e) => setYear(e.target.value)} disabled={!!ql}>
          {(years.length ? years : [year]).map((y) => <option key={y}>{y}</option>)}
        </select>
        <input className="grow" style={{ minWidth: 180 }} placeholder={tr('Suche: Monat, Jahr, Mitarbeiter, Beleg-Nr.')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="small muted">📁 Trinkgeld / {ql ? vd('Kết quả tìm', 'Suchergebnis') : year}</p>
      {months.length === 0 && <p className="muted">{tr('Keine Belege.')}</p>}
      {months.map((m) => {
        const ss = shown.filter((s) => s.period === m)
        const fs = files.filter((f) => ss.some((s) => s.id === f.settlement_id))
        return (
          <details key={m} className="card tg-folder" open={months.length === 1 || !!ql}>
            <summary className="row between">
              <b>📁 {archiveDir(m).split('/').slice(2).join('')}</b>
              <span className="small muted">{ss.length} Abrechnung(en) · {fs.length} Datei(en)</span>
            </summary>
            <div className="row wrap" style={{ margin: '8px 0' }}>
              <button disabled={!!busy} onClick={() => zipMonth(m)}>{busy === m ? vd('Đang tạo ZIP…', 'ZIP wird erstellt…') : `⬇ ${tr('Monat als ZIP')}`}</button>
            </div>
            {ss.map((s) => (
              <div key={s.id} className="tg-arch">
                <div className="row between wrap">
                  <Link to={`/r/${rid}/tg/abrechnung/${s.id}?m=${s.period}`}><b>{s.beleg_no}</b></Link><StatusTag s={s} />
                </div>
                <div className="row wrap" style={{ margin: '6px 0' }}>
                  <button className="tg-mini" disabled={!!busy} onClick={() => preview(s)}>{busy === s.id ? '…' : tr('PDF-Vorschau / Drucken')}</button>
                  <button className="tg-mini" disabled={!!busy} onClick={() => exportTable(s, 'xlsx')}>{tr('Excel')}</button>
                  <button className="tg-mini" disabled={!!busy} onClick={() => exportTable(s, 'csv')}>{tr('CSV')}</button>
                </div>
                {ARCHIVE_DIRS.map((dir) => {
                  const inDir = files.filter((f) => f.settlement_id === s.id && ARCHIVE_DIR[f.kind] === dir)
                  if (!inDir.length) return null
                  return (
                    <div key={dir} className="tg-sub">
                      <div className="small muted">📂 {dir}</div>
                      {inDir.map((f) => (
                        <a key={f.id} href="#" className="tg-file" onClick={async (e) => { e.preventDefault(); const u = await tgFileUrl(f.path); if (u) window.open(u, '_blank') }}>
                          📄 {f.name} <span className="small muted">· {pick(FILE_KINDS, FILE_VI, f.kind)} · {dmy(f.created_at.slice(0, 10))}</span>
                        </a>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </details>
        )
      })}
      <p className="small muted">{tr('Unterschriebene PDFs bitte in der Monatsabrechnung unter „Belege & Anhänge“ als „Trinkgeldabrechnung (unterschrieben)“ hochladen. Sie werden nie überschrieben oder gelöscht; neu erzeugte PDFs werden als weitere Version abgelegt.')}</p>
      {pdf && <PdfSheet pdf={pdf.blob} title={pdf.name} onClose={() => setPdf(null)} actions={[{ label: tr('PDF herunterladen'), onClick: () => downloadBlob(pdf.blob, pdf.name), primary: true }]} />}
    </>
  )
}

function tableBlob(s: Settlement, lines: Line[], pays: Payment[], kind: 'csv' | 'xlsx'): Blob {
  const active = pays.filter((p) => !p.cancelled_at)
  const head = ['Beleg-Nr.', 'Monat', 'Pers.-Nr.', 'Nachname', 'Vorname', 'Beschäftigungsart', 'Abteilung', 'Stunden', 'Teilnahme', 'Betrag (€)', 'Ausgezahlt (€)', 'Offen (€)', 'Status', 'Auszahlungsdaten', 'Abrechnungsstatus']
  const rows = lines.map((l) => {
    const ps = active.filter((p) => p.line_id === l.id || (l.employee_id && p.employee_id === l.employee_id))
    const paid = ps.reduce((a, p) => a + p.amount_cents, 0)
    const st = payState(l.amount_cents, paid)
    return [s.beleg_no, `${s.period.slice(5)}/${s.period.slice(0, 4)}`, l.personnel_no || '', l.last_name, l.first_name, l.emp_type || '', l.department || '',
      l.minutes / 60, l.participates ? 'ja' : 'nein', l.amount_cents / 100, paid / 100, Math.max(0, l.amount_cents - paid) / 100, st ? PAY_STATE[st] : '',
      ps.map((p) => `${dmy(p.paid_on)} ${p.method === 'bar' ? 'bar' : 'Überweisung'} ${(p.amount_cents / 100).toFixed(2).replace('.', ',')}`).join('; '), STATUS[s.status]]
  })
  if (kind === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows])
    ws['!cols'] = [12, 9, 9, 18, 16, 16, 12, 9, 9, 11, 13, 11, 18, 40, 18].map((wch) => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Verteilung')
    return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }
  const cell = (v: unknown) => typeof v === 'number' ? (Number.isInteger(v * 100) ? v.toFixed(2) : String(v)).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`
  const hours = (v: unknown, i: number) => (i === 7 && typeof v === 'number' ? fmtH(v * 60, false) : cell(v))
  const csv = [head.map(cell).join(';'), ...rows.map((r) => r.map(hours).join(';'))].join('\r\n')
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
}
