import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { useT } from '../lib/i18n'
import { Sheet, Top, toast } from '../components/ui'

export default function Restaurants() {
  const t = useT()
  const nav = useNavigate()
  const { restaurants, reload, profile } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')

  async function add() {
    if (!name.trim()) return
    const { data, error } = await supabase.from('nh_restaurants').insert({ name: name.trim(), address: addr || null }).select().single()
    if (error) { toast(error.message); return }
    await reload(); setOpen(false); setName(''); setAddr('')
    nav(`/r/${data.id}/settings`)
  }

  return (
    <>
      <Top title={t('restaurants')} sub={profile.full_name || profile.email} right={<Link className="btn" to="/settings">⚙︎</Link>} />
      <div className="page">
        <div className="list">
          {restaurants.map((r) => (
            <Link key={r.id} className="it" to={`/r/${r.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{r.name} {!r.active && <span className="tag warn">off</span>}</div>
                {r.address && <div className="small muted">{r.address}</div>}
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
