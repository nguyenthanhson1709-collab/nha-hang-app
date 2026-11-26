import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from '../../components/ui'
import { listReviews, loadPlan, loadSettings, parseD, saveSettings, tableNames, type BkSettings, type Review, type Table } from '../api'
import { BkShell, LOCALE, useL } from '../ui'

export default function Reviews() {
  const { rid } = useParams()
  const L = useL()
  const [rows, setRows] = useState<Review[] | null>(null)
  const [days, setDays] = useState(90)
  const [tables, setTables] = useState<Table[]>([])
  const [st, setSt] = useState<BkSettings | null>(null)
  const [url, setUrl] = useState('')
  useEffect(() => { listReviews(rid!, days).then(setRows).catch((e) => { toast(e.message); setRows([]) }) }, [rid, days])
  useEffect(() => { loadPlan(rid!).then((p) => setTables(p.tables)).catch(() => {}); loadSettings(rid!).then((s) => { setSt(s); setUrl(s.google_review_url || '') }).catch(() => {}) }, [rid])

  const list = rows || []
  const avg = list.length ? list.reduce((n, r) => n + r.stars, 0) / list.length : 0
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: list.filter((r) => r.stars === s).length }))
  async function saveUrl() {
    if (!st) return
    if (url && !/^https:\/\//i.test(url)) { toast(L('Link phải bắt đầu bằng https://', 'Link muss mit https:// beginnen')); return }
    try { await saveSettings({ ...st, google_review_url: url.trim() || null }); toast(L('Đã lưu', 'Gespeichert')) } catch (e) { toast((e as Error).message) }
  }

  return (
    <BkShell>
      <div className="toolbar">
        <h1 className="ititle grow">{L('Đánh giá của khách', 'Gästebewertungen')}</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
          {[30, 90, 365].map((d) => <option key={d} value={d}>{L(`${d} ngày qua`, `Letzte ${d} Tage`)}</option>)}
        </select>
      </div>
      {!rows ? <div className="center"><div className="spinner" /></div> : (
        <>
          <div className="bk-stats">
            <div className="stat"><div className="l">{L('Điểm trung bình', 'Durchschnitt')}</div><div className="v">{list.length ? `${avg.toFixed(1).replace('.', ',')} ★` : '–'}</div></div>
            <div className="stat"><div className="l">{L('Số đánh giá', 'Bewertungen')}</div><div className="v">{list.length}</div></div>
          </div>
          <div className="card">
            {dist.map(({ s, n }) => (
              <div key={s} className="bk-dist"><span>{s} ★</span><span className="bar"><i style={{ width: `${list.length ? (n / list.length) * 100 : 0}%` }} /></span><span className="num">{n}</span></div>
            ))}
          </div>
          <div className="bk-list">
            {list.map((r) => (
              <div key={r.booking_id} className="bk-rev">
                <div className="row between"><b>{'★'.repeat(r.stars)}<span className="muted">{'★'.repeat(5 - r.stars)}</span></b><span className="muted small">{new Date(r.created_at).toLocaleDateString(LOCALE[L.lang])}</span></div>
                <div className="small">{r.name} · {parseD(r.day).toLocaleDateString(LOCALE[L.lang], { day: '2-digit', month: '2-digit', year: 'numeric' })} {r.slot.slice(0, 5)} · {r.party} P.{r.tables ? ` · ${L('Bàn', 'Tisch')} ${tableNames(r.tables.split(','), tables)}` : ''}</div>
                {r.comment && <p style={{ margin: '6px 0 0' }}>{r.comment}</p>}
              </div>
            ))}
            {!list.length && <div className="bk-empty muted">{L('Chưa có đánh giá.', 'Noch keine Bewertungen.')}</div>}
          </div>
        </>
      )}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{L('Link viết đánh giá Google', 'Google-Bewertungslink')}</h3>
        <p className="muted small">{L('Khách chấm 4–5 sao sẽ được mời viết đánh giá Google bằng link này.', 'Gäste mit 4–5 Sternen werden zu diesem Link eingeladen.')}</p>
        <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" /><button onClick={saveUrl}>{L('Lưu', 'Speichern')}</button></div>
      </div>
    </BkShell>
  )
}
