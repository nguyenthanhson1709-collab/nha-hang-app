// Hợp đồng ghi nợ tự động (Lastschrift): công ty tự rút tiền hàng tháng từ tài khoản
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, errMsg, signedUrl, BUCKET } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { dmy, eur, todayIso } from '../lib/format'
import { uploadFiles } from '../lib/data'
import { Money, Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'

type Interval = 'monthly' | 'quarterly' | 'yearly' | 'other'
type Contract = { id?: string; company: string; title: string | null; amount: number | null; interval: Interval; start_date: string | null; end_date: string | null; contract_no: string | null; note: string | null; files: string[] }
const IV: Record<Interval, [string, string, string]> = { monthly: ['hàng tháng', 'monatlich', '/Monat'], quarterly: ['hàng quý', 'vierteljährlich', '/Quartal'], yearly: ['hàng năm', 'jährlich', '/Jahr'], other: ['khác', 'sonstige', ''] }
const empty = (): Contract => ({ company: '', title: null, amount: null, interval: 'monthly', start_date: todayIso(), end_date: null, contract_no: null, note: null, files: [] })

export default function Contracts() {
  const { rid } = useParams()
  const t = useT()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [list, setList] = useState<(Contract & { id: string })[] | null>(null)
  const [edit, setEdit] = useState<Contract | null>(null)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const lang = useLang().lang === 'de' ? 1 : 0

  const load = () => supabase.from('nh_contracts').select('*').eq('restaurant_id', rid!).order('company').then(({ data, error }) => { if (error) toast(errMsg(error)); setList((data || []) as never) })
  useEffect(() => { if (rid) load() }, [rid]) // eslint-disable-line

  if (!r || !canManage(role)) return null
  const today = todayIso()
  const active = (c: Contract) => !c.end_date || c.end_date >= today
  const monthly = (list || []).filter(active).reduce((s, c) => s + (Number(c.amount) || 0) / (c.interval === 'quarterly' ? 3 : c.interval === 'yearly' ? 12 : 1) * (c.interval === 'other' ? 0 : 1), 0)

  async function save() {
    if (!edit || !edit.company.trim()) { toast(t('ctCompany')); return }
    setBusy(true)
    try {
      const add = newFiles.length ? await uploadFiles(rid!, edit.start_date || today, newFiles, newFiles.map((f) => f.name)) : []
      const row = { ...edit, restaurant_id: rid, company: edit.company.trim(), files: [...edit.files, ...add] }
      const { error } = edit.id ? await supabase.from('nh_contracts').update(row).eq('id', edit.id) : await supabase.from('nh_contracts').insert(row)
      if (error) throw error
      setEdit(null); setNewFiles([]); load(); toast(t('saved'))
    } catch (e) { toast(errMsg(e)) }
    setBusy(false)
  }
  async function del() {
    if (!edit?.id || !confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('nh_contracts').delete().eq('id', edit.id)
    if (error) { toast(errMsg(error)); return }
    if (edit.files.length) await supabase.storage.from(BUCKET).remove(edit.files)
    setEdit(null); load()
  }
  async function open(p: string) { const u = await signedUrl(p); if (u) window.open(u, '_blank') }

  return (
    <>
      <Top title={t('contracts')} sub={r.name} back={`/r/${rid}/archive`} />
      <div className="page">
        <div className="alert ok">{t('ctMonthly')}: <b>{eur(monthly)}</b></div>
        <button className="primary block" style={{ marginBottom: 12 }} onClick={() => { setEdit(empty()); setNewFiles([]) }}>+ {t('ctAdd')}</button>
        {!list ? <Spinner /> : (
          <div className="list">
            {list.map((c) => (
              <button key={c.id} className="it" style={{ width: '100%', textAlign: 'left', opacity: active(c) ? 1 : 0.55 }} onClick={() => { setEdit({ ...c, amount: c.amount == null ? null : Number(c.amount) }); setNewFiles([]) }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t">{c.company}{c.title && <span className="muted"> · {c.title}</span>}</div>
                  <div className="small muted">{IV[c.interval][lang]}{c.start_date && ` · ${t('ctFrom')} ${dmy(c.start_date)}`}{c.end_date && ` · ${t('ctTo')} ${dmy(c.end_date)}`}{c.files.length > 0 && ` · 📎 ${c.files.length}`}</div>
                </div>
                {c.amount != null && <div className="num">{eur(Number(c.amount))}<span className="small muted">{IV[c.interval][2]}</span></div>}
              </button>
            ))}
            {!list.length && <div className="it muted">{t('noData')}</div>}
          </div>
        )}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.company : t('ctAdd')}>
        {edit && <>
          <label className="f"><span>{t('ctCompany')}</span><input value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} placeholder="Telekom, Vattenfall, Allianz…" /></label>
          <label className="f"><span>{t('description')}</span><input value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value || null })} placeholder="Internet, Strom, Versicherung…" /></label>
          <div className="grid2">
            <label className="f"><span>{t('amount')}</span><Money value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v || null })} /></label>
            <label className="f"><span>{t('ctInterval')}</span>
              <select value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value as Interval })}>
                {(Object.keys(IV) as Interval[]).map((k) => <option key={k} value={k}>{IV[k][lang]}</option>)}
              </select></label>
          </div>
          <div className="grid2">
            <label className="f"><span>{t('ctFrom')}</span><input type="date" value={edit.start_date || ''} onChange={(e) => setEdit({ ...edit, start_date: e.target.value || null })} /></label>
            <label className="f"><span>{t('ctTo')}</span><input type="date" value={edit.end_date || ''} onChange={(e) => setEdit({ ...edit, end_date: e.target.value || null })} /></label>
          </div>
          <label className="f"><span>{t('ctNo')}</span><input value={edit.contract_no || ''} onChange={(e) => setEdit({ ...edit, contract_no: e.target.value || null })} /></label>
          <label className="f"><span>{t('note')}</span><textarea value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value || null })} /></label>
          <div className="f"><span>{t('ctFiles')}</span>
            {edit.files.map((p, i) => (
              <div key={p} className="row" style={{ marginBottom: 4 }}>
                <button className="ghost grow" style={{ justifyContent: 'flex-start' }} onClick={() => open(p)}>📎 {t('ctFile')} {i + 1}</button>
                <button className="ghost" onClick={() => setEdit({ ...edit, files: edit.files.filter((x) => x !== p) })}>✕</button>
              </div>
            ))}
            {newFiles.map((f, i) => <div key={i} className="small">➕ {f.name} <button className="ghost" onClick={() => setNewFiles(newFiles.filter((_, j) => j !== i))}>✕</button></div>)}
            <label className="btn block" style={{ marginTop: 4 }}>📄 {t('ctUpload')}
              <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => { setNewFiles([...newFiles, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
            </label>
          </div>
          <button className="primary block" disabled={busy} onClick={save}>{busy ? '…' : t('save')}</button>
          {edit.id && <button className="danger block" style={{ marginTop: 8 }} onClick={del}>{t('delete')}</button>}
        </>}
      </Sheet>
    </>
  )
}
