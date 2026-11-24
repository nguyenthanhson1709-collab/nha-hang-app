// Kontoauszug: tải sao kê ngân hàng lên theo tháng (Berliner Voba, Viva Wallet…)
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, errMsg, signedUrl, BUCKET } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { dmy, monthLabel, thisMonth } from '../lib/format'
import { uploadFiles } from '../lib/data'
import { download } from '../lib/pdf'
import { PDFDocument } from 'pdf-lib'
import { Spinner, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'

type St = { id: string; period: string; account: string | null; note: string | null; files: string[]; created_at: string }
const ACCOUNTS = ['Bank', 'Viva Wallet', 'Kreditkarte', 'PayPal']

export default function Statements() {
  const { rid } = useParams()
  const t = useT()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [period, setPeriod] = useState(thisMonth())
  const [list, setList] = useState<St[] | null>(null)
  const [account, setAccount] = useState('Bank')
  const [busy, setBusy] = useState('')

  const load = () => { setList(null); supabase.from('nh_bank_statements').select('*').eq('restaurant_id', rid!).eq('period', period).order('account').order('created_at').then(({ data, error }) => { if (error) toast(errMsg(error)); setList((data || []) as St[]) }) }
  useEffect(() => { if (rid) load() }, [rid, period]) // eslint-disable-line
  if (!r || !canManage(role)) return null

  async function upload(fl: FileList | null) {
    const files = Array.from(fl || [])
    if (!files.length) return
    setBusy('…')
    try {
      for (const [i, f] of files.entries()) {
        setBusy(`${i + 1}/${files.length}`)
        const paths = await uploadFiles(rid!, `${period}-01`, [f], [f.name])
        const { error } = await supabase.from('nh_bank_statements').insert({ restaurant_id: rid, period, account: account.trim() || null, note: f.name, files: paths })
        if (error) throw error
      }
      toast(t('saved')); load()
    } catch (e) { toast(errMsg(e)) }
    setBusy('')
  }
  async function del(s: St) {
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('nh_bank_statements').delete().eq('id', s.id)
    if (error) { toast(errMsg(error)); return }
    await supabase.storage.from(BUCKET).remove(s.files); load()
  }
  async function open(p: string) { const u = await signedUrl(p); if (u) window.open(u, '_blank') }
  // Lưu tất cả sao kê trong tháng thành 1 file PDF
  async function saveAll() {
    if (!list?.length) return
    setBusy('PDF…')
    try {
      const out = await PDFDocument.create()
      for (const s of list) for (const p of s.files) {
        const u = await signedUrl(p); const b = await (await fetch(u)).arrayBuffer()
        if (/\.pdf$/i.test(p)) { const src = await PDFDocument.load(b, { ignoreEncryption: true }); for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg) }
        else {
          const img = /\.png$/i.test(p) ? await out.embedPng(b) : await out.embedJpg(b)
          const s2 = Math.min(595 / img.width, 842 / img.height), page = out.addPage([595, 842])
          page.drawImage(img, { x: (595 - img.width * s2) / 2, y: (842 - img.height * s2) / 2, width: img.width * s2, height: img.height * s2 })
        }
      }
      download(new Blob([await out.save() as BlobPart], { type: 'application/pdf' }), `${r!.name.replace(/\W+/g, '_')}_${period}_Kontoauszug.pdf`)
    } catch (e) { toast(errMsg(e)) }
    setBusy('')
  }

  return (
    <>
      <Top title="Kontoauszug" sub={r.name} back={`/r/${rid}/archive`} />
      <div className="page">
        <MonthBar value={period} onChange={setPeriod} />
        <div className="card">
          <label className="f"><span>{t('stAccount')}</span>
            <input list="st-acc" value={account} onChange={(e) => setAccount(e.target.value)} />
            <datalist id="st-acc">{ACCOUNTS.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
          <label className={`btn primary block${busy ? ' disabled' : ''}`} style={{ textAlign: 'center' }}>
            ⬆ {t('stUpload')} ({monthLabel(period)})
            <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
          </label>
          {busy && <div className="small muted" style={{ marginTop: 6 }}>{busy}</div>}
        </div>
        {!list ? <Spinner /> : (
          <>
            <div className="list">
              {list.map((s) => (
                <div className="it" key={s.id}>
                  <button className="ghost grow" style={{ justifyContent: 'flex-start', textAlign: 'left', minWidth: 0 }} onClick={() => open(s.files[0])}>
                    <div style={{ minWidth: 0 }}><div className="t">📄 {s.account || 'Kontoauszug'}</div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.note} · {dmy(s.created_at.slice(0, 10))}</div></div>
                  </button>
                  <button className="ghost" onClick={() => del(s)}>✕</button>
                </div>
              ))}
              {!list.length && <div className="it muted">{t('noData')}</div>}
            </div>
            {list.length > 0 && <button className="block" disabled={!!busy} onClick={saveAll}>📄 {t('exportPdf')}</button>}
          </>
        )}
      </div>
    </>
  )
}
