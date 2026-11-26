import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, showLogin, type Restaurant } from '../lib/supabase'
import { useApp } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { Sheet, Top, toast } from '../components/ui'

/** Logo của quán: public/logos/<id>.webp. Chưa có logo thì hiện chữ cái đầu tên quán. */
function RLogo({ r }: { r: Pick<Restaurant, 'id' | 'name'> }) {
  const [bad, setBad] = useState(false)
  if (bad) return <span className="rlogo rlogo-txt">{r.name.replace(/\s*GmbH.*$/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
  return <img className="rlogo" src={`${import.meta.env.BASE_URL}logos/${r.id}.webp`} alt={r.name} loading="lazy" onError={() => setBad(true)} />
}

export default function Restaurants() {
  const t = useT()
  const nav = useNavigate()
  const { restaurants, reload, profile } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')
  const { lang } = useLang()
  const [title, setTitle] = useState<string | null>(null)
  const [er, setEr] = useState<Pick<Restaurant, 'id' | 'name' | 'address'> | null>(null)

  async function saveTitle() {
    const { error } = await supabase.from('nh_profiles').update({ home_title: title?.trim() || null }).eq('id', profile.id)
    if (error) { toast(error.message); return }
    setTitle(null); reload()
  }
  async function saveRest() {
    if (!er?.name.trim()) return
    const { error } = await supabase.from('nh_restaurants').update({ name: er.name.trim(), address: er.address?.trim() || null }).eq('id', er.id)
    if (error) { toast(error.message); return }
    setEr(null); reload()
  }

  async function add() {
    if (!name.trim()) return
    const { data, error } = await supabase.from('nh_restaurants').insert({ name: name.trim(), address: addr || null }).select().single()
    if (error) { toast(error.message); return }
    await reload(); setOpen(false); setName(''); setAddr('')
    nav(`/r/${data.id}/settings`)
  }

  return (
    <>
      <Top title={profile.home_title || t('restaurants')} sub={profile.full_name || showLogin(profile.email)}
        right={<div className="row">{profile.is_owner && <button className="btn" title={t('edit')} onClick={() => setTitle(profile.home_title || t('restaurants'))}>✎</button>}<Link className="btn" to="/settings">⚙︎</Link></div>} />
      <div className="page">
        <div className="tiles">
          {restaurants.map((r) => (
            <Link key={r.id} className="tile rtile" to={`/r/${r.id}`}>
              <RLogo r={r} />
              <span className="rname">{r.name}</span>
              {!r.active && <span className="tag warn">off</span>}
              {profile.is_owner && <button className="ghost small redit" title={t('edit')} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEr({ id: r.id, name: r.name, address: r.address }) }}>✎</button>}
            </Link>
          ))}
        </div>
        {!restaurants.length && <div className="list"><div className="it muted">{t('noData')}</div></div>}
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
      <Sheet open={title !== null} onClose={() => setTitle(null)} title={lang === 'de' ? 'Überschrift ändern' : 'Sửa tiêu đề'}>
        <label className="f"><span>{lang === 'de' ? 'Überschrift' : 'Tiêu đề'}</span><input autoFocus value={title || ''} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle() }} /></label>
        <button className="primary block" onClick={saveTitle}>{t('save')}</button>
      </Sheet>
      <Sheet open={!!er} onClose={() => setEr(null)} title={t('edit')}>
        {er && <>
          <label className="f"><span>{t('name')}</span><input autoFocus value={er.name} onChange={(e) => setEr({ ...er, name: e.target.value })} /></label>
          <label className="f"><span>{t('address')}</span><input value={er.address || ''} onChange={(e) => setEr({ ...er, address: e.target.value })} /></label>
          <button className="primary block" onClick={saveRest}>{t('save')}</button>
        </>}
      </Sheet>
    </>
  )
}
