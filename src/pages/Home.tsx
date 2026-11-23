import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, type Doc } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { daysOfMonth, dmy, eur, monthRange, thisMonth, todayIso } from '../lib/format'
import { currentBalance, docsInRange, zbonsInRange } from '../lib/data'
import { PayTag, Top, useRestaurant } from '../components/ui'

export default function Home() {
  const { rid } = useParams()
  const t = useT()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { profile } = useApp()
  const m = canManage(role)
  const [s, setS] = useState<{ spend: number; cash: number; card: number; transfer: number; rev: number; bal: number; missing: string[]; review: Doc[]; mine: Doc[] } | null>(null)

  useEffect(() => {
    if (!r) return
    const p = thisMonth(); const { from, to } = monthRange(p)
    ;(async () => {
      const docs = await docsInRange(rid!, from, to)
      const purchase = docs.filter((d) => d.kind === 'purchase')
      const sum = (meth: string) => purchase.reduce((a, d) => a + (d.nh_document_payments || []).filter((x) => x.method === meth).reduce((b, x) => b + Number(x.amount), 0), 0)
      let rev = 0, bal = 0, missing: string[] = []
      if (m) {
        const zs = await zbonsInRange(rid!, from, to)
        rev = zs.reduce((a, z) => a + Number(z.total), 0)
        bal = await currentBalance(rid!, Number(r.opening_cash))
        const have = new Set(zs.map((z) => z.z_date))
        const today = todayIso()
        missing = daysOfMonth(p).filter((d) => d < today && !have.has(d) && (!r.opening_date || d >= r.opening_date))
      }
      const { data: review } = m
        ? await supabase.from('nh_documents').select('*, nh_document_payments(*)').eq('restaurant_id', rid!).eq('status', 'uploaded').order('created_at').limit(50)
        : { data: [] }
      const { data: mine } = !m
        ? await supabase.from('nh_documents').select('*, nh_document_payments(*)').eq('restaurant_id', rid!).eq('created_by', profile.id).order('created_at', { ascending: false }).limit(30)
        : { data: [] }
      setS({ spend: purchase.reduce((a, d) => a + Number(d.gross), 0), cash: sum('cash'), card: sum('card'), transfer: sum('transfer'), rev, bal, missing, review: (review || []) as Doc[], mine: (mine || []) as Doc[] })
    })()
  }, [rid, r, m, profile.id])

  if (!r) return null
  return (
    <>
      <Top title={r.name} sub={`${t('thisMonth')} · ${thisMonth().slice(5)}/${thisMonth().slice(0, 4)}`} back={profile.is_owner ? '/restaurants' : undefined}
        right={<Link className="btn" to={m ? `/r/${rid}/settings` : '/settings'}>⚙︎</Link>} />
      <div className="page">
        {m && (
          <div className="card" style={{ background: 'var(--brand-2)', borderColor: 'var(--brand)' }}>
            <div className="small muted">{t('cashBalance')} · {t('today')} {dmy(todayIso())}</div>
            <div className="big" style={{ color: s && s.bal < 0 ? 'var(--err)' : undefined }}>{s ? eur(s.bal) : '…'}</div>
          </div>
        )}
        <button className="primary huge" onClick={() => nav(`/r/${rid}/scan`)}>📷 {t('scan')}</button>
        {m && s && (
          <>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div className="stat"><div className="l">{t('spending')}</div><div className="v">{eur(s.spend)}</div></div>
              <div className="stat"><div className="l">{t('revenue')} (Z-Bon)</div><div className="v">{eur(s.rev)}</div></div>
              <div className="stat"><div className="l">{t('spending')} · {t('cash')}</div><div className="v">{eur(s.cash)}</div></div>
              <div className="stat"><div className="l">{t('spending')} · {t('card')} / {t('transfer')}</div><div className="v">{eur(s.card + s.transfer)}</div></div>
            </div>
            {s.missing.length > 0 && (
              <div className="alert warn">
                <b>{t('missingZbon')} ({s.missing.length}):</b> {s.missing.slice(-10).map((d) => d.slice(8) + '.').join(' ')}
                {s.missing.length > 10 && ' …'}
              </div>
            )}
            <h2>{t('toReview')} ({s.review.length})</h2>
            <DocList docs={s.review} rid={rid!} empty={t('noData')} />
          </>
        )}
        {!m && s && (
          <>
            <h2>{t('myUploads')}</h2>
            <DocList docs={s.mine} rid={rid!} empty={t('noData')} />
          </>
        )}
      </div>
    </>
  )
}

export function DocList({ docs, rid, empty }: { docs: Doc[]; rid: string; empty: string }) {
  const t = useT()
  return (
    <div className="list">
      {docs.map((d) => (
        <Link className="it" key={d.id} to={`/r/${rid}/doc/${d.id}`}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t">{d.supplier || '—'}</div>
            <div className="small muted">{dmy(d.doc_date)} · <span className={`tag ${d.status === 'uploaded' ? 'warn' : ''}`}>{t(d.status)}</span></div>
          </div>
          <div className="right">
            <div className="num">{eur(d.gross)}</div>
            <div>{(d.nh_document_payments || []).map((p) => <PayTag key={p.method} m={p.method} />)}</div>
          </div>
        </Link>
      ))}
      {!docs.length && <div className="it muted">{empty}</div>}
    </div>
  )
}
