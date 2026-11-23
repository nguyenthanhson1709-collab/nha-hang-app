import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg, signedUrl, BUCKET, type ZBon } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { eur, monthLabel, r2, todayIso } from '../lib/format'
import { lockedPeriods } from '../lib/data'
import type { ParsedZ } from '../lib/ocr'
import { Money, Spinner, Top, toast, useRestaurant } from '../components/ui'
import { PdfPreview } from '../components/PdfPreview'

type Z = Omit<ZBon, 'id' | 'restaurant_id' | 'period' | 'cash_revenue' | 'created_by' | 'created_at'>

const empty = (): Z => ({
  z_date: todayIso(), z_no: null, net7: 0, tax7: 0, gross7: 0, net19: 0, tax19: 0, gross19: 0, gross0: 0, total: 0,
  cash_pos: 0, card_pos: 0, card_terminal: null, tip: 0, tip_card: 0, storno: 0, storno_count: 0, details: {}, files: [], ocr_text: null,
})

export default function ZbonReview() {
  const { rid, id } = useParams()
  const loc = useLocation()
  const t = useT()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [z, setZ] = useState<Z | null>(null)
  const [period, setPeriod] = useState('')
  const [locked, setLocked] = useState(false)
  const [urls, setUrls] = useState<{ path: string; url: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      let v: Z
      if (id === 'new') {
        const st = loc.state as { parsed: ParsedZ; files: string[]; ocr_text: string } | null
        v = { ...empty(), ...(st?.parsed || {}), z_date: st?.parsed?.z_date || todayIso(), files: st?.files || [], ocr_text: st?.ocr_text || null }
        if (r?.tip_paid_cash === false) v.tip_card = 0
      } else {
        const { data, error } = await supabase.from('nh_zbons').select('*').eq('id', id!).single()
        if (error) { toast(errMsg(error)); return }
        const { id: _i, restaurant_id: _r, period: p, cash_revenue: _c, created_by: _cb, created_at: _ca, ...rest } = data as ZBon
        v = rest as Z
        for (const k of Object.keys(v) as (keyof Z)[]) if (typeof v[k] === 'string' && /^-?\d+(\.\d+)?$/.test(v[k] as string) && !['z_date', 'z_no'].includes(k)) (v as Record<string, unknown>)[k] = Number(v[k])
        setPeriod(p)
        setLocked((await lockedPeriods(rid!)).has(p))
      }
      setZ(v)
      setUrls(await Promise.all(v.files.map(async (p) => ({ path: p, url: await signedUrl(p) }))))
    })()
  }, [id]) // eslint-disable-line

  if (!z || !r) return <Spinner />
  if (!canManage(role)) return null
  const set = (k: keyof Z, v: number | string | null) => setZ({ ...z, [k]: v })
  const cardRev = z.card_terminal == null ? z.card_pos : r2(z.card_terminal - z.tip_card)
  const cashRev = r2(z.total - cardRev)
  const diff = z.card_terminal == null ? 0 : r2(z.card_pos - cardRev)
  const bad7 = Math.abs(z.net7 + z.tax7 - z.gross7) > 0.02
  const bad19 = Math.abs(z.net19 + z.tax19 - z.gross19) > 0.02
  const badTotal = Math.abs(z.gross7 + z.gross19 - z.total) > 0.02
  const badPay = Math.abs(z.cash_pos + z.card_pos - z.total) > 0.02
  const readOnly = locked

  async function save() {
    if (!z) return
    setBusy(true)
    try {
      const row = { ...z, restaurant_id: rid, period: z.z_date.slice(0, 7) }
      const q = id === 'new' ? supabase.from('nh_zbons').insert(row) : supabase.from('nh_zbons').update(row).eq('id', id!)
      const { error } = await q
      if (error) {
        if (error.code === '23505') throw new Error(t('zExists'))
        throw error
      }
      toast(t('saved')); nav(`/r/${rid}/kb`)
    } catch (e) { toast(errMsg(e)) }
    setBusy(false)
  }
  async function del() {
    if (!confirm(t('confirmDelete'))) return
    if (id !== 'new') { const { error } = await supabase.from('nh_zbons').delete().eq('id', id!); if (error) { toast(errMsg(error)); return } }
    if (z?.files.length) await supabase.storage.from(BUCKET).remove(z.files)
    nav(`/r/${rid}`)
  }

  const Row = ({ label, k, bad }: { label: string; k: keyof Z; bad?: boolean }) => (
    <label className="f"><span>{label}</span><Money value={z[k] as number | null} onChange={(v) => set(k, v)} className={bad ? 'err-field' : ''} /></label>
  )

  return (
    <>
      <Top title={t('scanZbon')} sub={r.name} back />
      <div className="page review">
        <div className="img-col">
          {urls.map((u) => /\.pdf$/i.test(u.path)
            ? <div key={u.path}><a className="btn block" href={u.url} target="_blank" rel="noreferrer">📄 PDF</a><PdfPreview url={u.url} /></div>
            : <a key={u.path} href={u.url} target="_blank" rel="noreferrer"><img src={u.url} alt="" /></a>)}
        </div>
        <div>
          {locked && <div className="alert warn">🔒 {t('locked')} ({monthLabel(period)})</div>}
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="card">
              <div className="grid2">
                <label className="f"><span>{t('zDate')}</span><input type="date" value={z.z_date} onChange={(e) => set('z_date', e.target.value)} /></label>
                <label className="f"><span>{t('zNo')}</span><input value={z.z_no || ''} onChange={(e) => set('z_no', e.target.value || null)} /></label>
              </div>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('revenue7')}</h3>
              <div className="grid3"><Row label={t('net')} k="net7" /><Row label={t('tax')} k="tax7" bad={bad7} /><Row label={t('gross')} k="gross7" /></div>
              <h3>{t('revenue19')}</h3>
              <div className="grid3"><Row label={t('net')} k="net19" /><Row label={t('tax')} k="tax19" bad={bad19} /><Row label={t('gross')} k="gross19" /></div>
              <Row label={t('totalRevenue')} k="total" bad={badTotal} />
              {(bad7 || bad19 || badTotal) && <div className="alert err">{t('mismatch')}</div>}
            </div>
            <div className="card">
              <div className="grid2"><Row label={t('cashPos')} k="cash_pos" bad={badPay} /><Row label={t('cardPos')} k="card_pos" bad={badPay} /></div>
              <div className="grid2"><Row label={t('tip')} k="tip" /><Row label={`${t('storno')} (€)`} k="storno" /></div>
            </div>
            <div className="card" style={{ borderColor: 'var(--brand)' }}>
              <Row label={t('cardTerminal')} k="card_terminal" />
              <Row label={t('tipCard')} k="tip_card" />
              <div className="row between"><span>{t('cashRevenue')}</span><b className="num">{eur(cashRev)}</b></div>
              {z.card_terminal != null && Math.abs(diff) > 0.01 && <div className="alert warn">{t('cardDiff')}: {eur(diff)}</div>}
              {r.tip_paid_cash && z.tip_card > 0 && <div className="small muted" style={{ marginTop: 6 }}>Kassenbuch: − {eur(z.tip_card)} Trinkgeld</div>}
            </div>
          </fieldset>
          {!readOnly && (
            <div className="row">
              <button className="danger" onClick={del}>{t('delete')}</button>
              <button className="primary grow" disabled={busy} onClick={save}>✓ {t('save')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
