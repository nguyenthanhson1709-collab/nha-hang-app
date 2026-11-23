import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { useT } from '../lib/i18n'
import { eur, monthRange, thisMonth } from '../lib/format'
import { Sheet, Top, toast } from '../components/ui'

export default function Restaurants() {
  const t = useT()
  const nav = useNavigate()
  const { restaurants, reload, profile } = useApp()
  const [sums, setSums] = useState<Record<string, { spend: number; rev: number }>>({})
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')

  useEffect(() => {
    const { from, to } = monthRange(thisMonth())
    Promise.all([
      supabase.from('nh_documents').select('restaurant_id, gross').eq('kind', 'purchase').gte('doc_date', from).lte('doc_date', to),
      supabase.from('nh_zbons').select('restaurant_id, total').gte('z_date', from).lte('z_date', to),
    ]).then(([d, z]) => {
      const s: Record<string, { spend: number; rev: number }> = {}
      for (const x of d.data || []) { s[x.restaurant_id] ??= { spend: 0, rev: 0 }; s[x.restaurant_id].spend += Number(x.gross) }
      for (const x of z.data || []) { s[x.restaurant_id] ??= { spend: 0, rev: 0 }; s[x.restaurant_id].rev += Number(x.total) }
      setSums(s)
    })
  }, [])

  async function add() {
    if (!name.trim()) return
    const { data, error } = await supabase.from('nh_restaurants').insert({ name: name.trim(), address: addr || null }).select().single()
    if (error) { toast(error.message); return }
    await reload(); setOpen(false); setName(''); setAddr('')
    nav(`/r/${data.id}/settings`)
  }

  const tot = Object.values(sums).reduce((a, b) => ({ spend: a.spend + b.spend, rev: a.rev + b.rev }), { spend: 0, rev: 0 })

  return (
    <>
      <Top title={t('restaurants')} sub={profile.full_name || profile.email} right={<Link className="btn" to="/settings">⚙︎</Link>} />
      <div className="page">
        <div className="grid2" style={{ marginBottom: 12 }}>
          <div className="stat"><div className="l">{t('spending')} · {t('thisMonth')}</div><div className="v">{eur(tot.spend)}</div></div>
          <div className="stat"><div className="l">{t('revenue')} · {t('thisMonth')}</div><div className="v">{eur(tot.rev)}</div></div>
        </div>
        <div className="list">
          {restaurants.map((r) => (
            <Link key={r.id} className="it" to={`/r/${r.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{r.name} {!r.active && <span className="tag warn">off</span>}</div>
                <div className="small muted">{t('spending')} {eur(sums[r.id]?.spend)} · {t('revenue')} {eur(sums[r.id]?.rev)}</div>
              </div>
              <span className="muted">›</span>
            </Link>
          ))}
          {!restaurants.length && <div className="it muted">{t('noData')}</div>}
        </div>
        <div className="row wrap">
          <button className="primary" onClick={() => setOpen(true)}>+ {t('addRestaurant')}</button>
          <Link className="btn" to="/reports">{t('reports')} · {t('allRestaurants')}</Link>
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('addRestaurant')}>
        <label className="f"><span>{t('name')}</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="f"><span>{t('address')}</span><input value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
        <button className="primary block" onClick={add}>{t('save')}</button>
      </Sheet>
    </>
  )
}
