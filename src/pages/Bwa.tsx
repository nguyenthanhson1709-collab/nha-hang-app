// BWA (betriebswirtschaftliche Auswertung) của Steuerberater: tải lên theo tháng, xem ngay trong app, tải / in
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { dropProps } from '../lib/drop'
import { supabase, errMsg, BUCKET } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { dmy, monthLabel, thisMonth } from '../lib/format'
import { uploadFiles } from '../lib/data'
import { download } from '../lib/pdf'
import { Spinner, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'
import PdfSheet from '../components/PdfSheet'

type B = { id: string; period: string; note: string | null; files: string[]; created_at: string }

export default function Bwa() {
  const { rid } = useParams()
  const t = useT()
  const { lang } = useLang()
  const T = (vi: string, de: string) => (lang === 'de' ? de : vi)
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [period, setPeriod] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) || thisMonth() })
  const [list, setList] = useState<B[] | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [fv, setFv] = useState<{ title: string; blob: Blob; name: string } | null>(null)

  const load = () => supabase.from('nh_bwa').select('*').eq('restaurant_id', rid!).order('period', { ascending: false }).order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) toast(errMsg(error)); setList((data || []) as B[]) })
  useEffect(() => { if (rid) load() }, [rid]) // eslint-disable-line
  const years = useMemo(() => {
    const m = new Map<string, B[]>()
    for (const b of list || []) { const y = b.period.slice(0, 4); m.set(y, [...(m.get(y) || []), b]) }
    return [...m.entries()]
  }, [list])
  if (!r || !canManage(role)) return null

  const title = (b: B) => `BWA ${b.period.slice(5, 7)}/${b.period.slice(0, 4)}`
  async function upload(fl: FileList | null) {
    const files = Array.from(fl || [])
    if (!files.length) return
    setBusy('…')
    try {
      for (const [i, f] of files.entries()) {
        setBusy(`${i + 1}/${files.length}`)
        const paths = await uploadFiles(rid!, `${period}-01`, [f], [f.name])
        const { error } = await supabase.from('nh_bwa').insert({ restaurant_id: rid, period, note: f.name, files: paths })
        if (error) throw error
      }
      setOpen((o) => ({ ...o, [period.slice(0, 4)]: true }))
      toast(t('saved')); load()
    } catch (e) { toast(errMsg(e)) }
    setBusy('')
  }
  async function del(b: B) {
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('nh_bwa').delete().eq('id', b.id)
    if (error) { toast(errMsg(error)); return }
    await supabase.storage.from(BUCKET).remove(b.files); load()
  }
  async function view(b: B) {
    const p = b.files[0]
    if (!p) return
    setBusy(T('Đang mở…', 'Wird geöffnet…'))
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(p)
      if (error || !data) throw error || new Error('download')
      const ext = (p.split('.').pop() || 'pdf').toLowerCase()
      const blob = data.type && data.type !== 'application/octet-stream' ? data : new Blob([data], { type: ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}` })
      setFv({ title: title(b), blob, name: `BWA_${r!.name.replace(/\W+/g, '_')}_${b.period}.${ext}` })
    } catch (e) { toast(errMsg(e)) }
    setBusy('')
  }

  return (
    <>
      <Top title="BWA" sub={r.name} back={`/r/${rid}/reports`} />
      <div className="page">
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>{T('Betriebswirtschaftliche Auswertung từ Steuerberater, lưu theo tháng.', 'Betriebswirtschaftliche Auswertung vom Steuerberater, nach Monat abgelegt.')}</p>
          <MonthBar value={period} onChange={setPeriod} />
          <label className={`btn primary block drop${busy ? ' disabled' : ''}`} style={{ textAlign: 'center' }} {...dropProps((fl) => upload(fl), !!busy)}>
            ⬆ {T('Tải BWA lên', 'BWA hochladen')} ({monthLabel(period)})<span className="drop-hint">{t('dropHint')}</span>
            <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
          </label>
          {busy && <div className="small muted" style={{ marginTop: 6 }}>{busy}</div>}
        </div>
        {!list ? <Spinner /> : !list.length ? <div className="card muted">{t('noData')}</div> : years.map(([y, items], i) => {
          const isOpen = open[y] ?? i === 0
          return (
            <div className="card folder" key={y} style={{ padding: 0, overflow: 'hidden' }}>
              <button className="ghost block" style={{ justifyContent: 'space-between', padding: '14px 16px' }} onClick={() => setOpen({ ...open, [y]: !isOpen })}>
                <b>📁 BWA {y} <span className="muted">({items.length})</span></b><span>{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && <div className="list" style={{ margin: 0 }}>
                {items.map((b) => (
                  <div className="it" key={b.id}>
                    <button className="ghost grow" style={{ justifyContent: 'flex-start', textAlign: 'left', minWidth: 0 }} onClick={() => view(b)}>
                      <div style={{ minWidth: 0 }}><div className="t">📄 {title(b)}</div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.note} · {T('tải lên', 'hochgeladen')} {dmy(b.created_at.slice(0, 10))}</div></div>
                    </button>
                    <button className="ghost" onClick={() => del(b)} aria-label="delete">✕</button>
                  </div>
                ))}
              </div>}
            </div>
          )
        })}
      </div>
      {fv && <PdfSheet pdf={fv.blob} title={fv.title} onClose={() => setFv(null)} actions={[
        { label: T('Tải về', 'Herunterladen'), primary: true, onClick: () => download(fv.blob, fv.name) },
      ]} />}
    </>
  )
}
