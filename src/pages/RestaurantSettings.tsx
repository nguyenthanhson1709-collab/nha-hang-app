import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, errMsg, type PayMethod, type Restaurant } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { Sheet, Top, toast, useRestaurant } from '../components/ui'

interface Member { user_id: string; role: 'manager' | 'staff'; nh_profiles: { email: string; full_name: string; lang: 'vi' | 'de' } | null }
interface EditUser { user_id: string; full_name: string; email: string; origEmail: string; lang: 'vi' | 'de'; password: string; roles: Record<string, '' | 'manager' | 'staff'>; orig: Record<string, '' | 'manager' | 'staff'> }

async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('nh-admin', { body })
  if (error) {
    let msg = error.message
    try { msg = (await (error as { context?: Response }).context?.json())?.error || msg } catch { /* */ }
    const vi: Record<string, string> = {
      invalid_input: 'Thiếu thông tin hoặc mật khẩu dưới 8 ký tự / Angaben fehlen oder Passwort unter 8 Zeichen',
      forbidden: 'Không có quyền / Keine Berechtigung',
      email_exists: 'Email này đã có tài khoản khác / E-Mail bereits vergeben',
      invalid_role: 'Vai trò không hợp lệ / Ungültige Rolle',
    }
    throw new Error(vi[msg] || msg)
  }
  return data
}

export default function RestaurantSettings() {
  const { rid } = useParams()
  const t = useT()
  const { lang } = useLang()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { profile, reload, restaurants } = useApp()
  const owner = profile.is_owner
  const [f, setF] = useState<Restaurant | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [add, setAdd] = useState<{ email: string; full_name: string; password: string; role: 'manager' | 'staff' } | null>(null)
  const [pwFor, setPwFor] = useState<{ user_id: string; password: string } | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [ed, setEd] = useState<EditUser | null>(null)
  const [busy, setBusy] = useState(false)

  const loadMembers = () => supabase.from('nh_members').select('user_id, role, nh_profiles(email, full_name, lang)').eq('restaurant_id', rid!).then(({ data }) => setMembers((data || []) as unknown as Member[]))
  useEffect(() => { if (r) setF({ ...r }); loadMembers() }, [r]) // eslint-disable-line

  if (!r || !f || !canManage(role)) return null

  async function save() {
    const { id: _id, ...rest } = f!
    const { error } = await supabase.from('nh_restaurants').update({ ...rest, opening_cash: Number(rest.opening_cash) || 0, opening_date: rest.opening_date || null }).eq('id', rid!)
    if (error) toast(errMsg(error)); else { toast(t('saved')); reload() }
  }
  async function createUser() {
    if (!add) return
    if (add.password.length < 8) { toast(t('password') + ': ≥ 8'); return }
    if (!/^\S+@\S+\.\S+$/.test(add.email.trim())) { toast(t('email') + '?'); return }
    try { await adminCall({ action: 'create_user', restaurant_id: rid, ...add, lang }); setAdd(null); loadMembers(); toast(t('added')) }
    catch (e) { toast(errMsg(e)) }
  }
  async function setPassword() {
    if (!pwFor) return
    try { await adminCall({ action: 'set_password', restaurant_id: rid, ...pwFor }); setPwFor(null); toast(t('saved')) } catch (e) { toast(errMsg(e)) }
  }
  async function remove(uid: string) {
    if (!confirm(t('remove') + '?')) return
    try { await adminCall({ action: 'remove_member', restaurant_id: rid, user_id: uid }); loadMembers() } catch (e) { toast(errMsg(e)) }
  }
  async function setRole(uid: string, role: string) {
    try { await adminCall({ action: 'set_role', restaurant_id: rid, user_id: uid, role }); loadMembers(); toast(t('saved')) } catch (e) { toast(errMsg(e)) }
  }
  async function openEdit(m: Member) {
    const { data } = await supabase.from('nh_members').select('restaurant_id, role').eq('user_id', m.user_id)
    const roles: EditUser['roles'] = {}
    for (const x of restaurants) roles[x.id] = ''
    for (const x of data || []) roles[x.restaurant_id] = x.role as 'manager' | 'staff'
    const email = m.nh_profiles?.email || ''
    setEd({ user_id: m.user_id, full_name: m.nh_profiles?.full_name || '', email, origEmail: email, lang: m.nh_profiles?.lang || 'vi', password: '', roles, orig: { ...roles } })
  }
  async function saveEdit() {
    if (!ed) return
    if (ed.password && ed.password.length < 8) { toast(t('password') + ': ≥ 8'); return }
    if (!/^\S+@\S+\.\S+$/.test(ed.email.trim())) { toast(t('email') + '?'); return }
    if (ed.email.trim().toLowerCase() !== ed.origEmail.toLowerCase() && !confirm(lang === 'de'
      ? 'E-Mail ändern? Die Person meldet sich danach mit der neuen E-Mail an (auch in der Rechnungs-App).'
      : 'Đổi email? Người này sẽ đăng nhập bằng email mới (cả ở app viết hoá đơn).')) return
    setBusy(true)
    try {
      await adminCall({ action: 'update_user', user_id: ed.user_id, full_name: ed.full_name, email: ed.email, lang: ed.lang, password: ed.password || undefined })
      for (const [rest, ro] of Object.entries(ed.roles)) {
        if (ro !== ed.orig[rest]) await adminCall({ action: 'set_member', restaurant_id: rest, user_id: ed.user_id, role: ro || null })
      }
      setEd(null); loadMembers(); toast(t('saved'))
    } catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }
  const map = f.pos_payment_map || {}

  return (
    <>
      <Top title={t('restaurantSettings')} sub={r.name} back={`/r/${rid}`} right={<Link className="btn" to="/settings">{t('language')}</Link>} />
      <div className="page">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('users')}</h3>
          <div className="list">
            {members.map((m) => (
              <div className="it" key={m.user_id}>
                <div className="grow" style={{ minWidth: 0 }}><div className="t">{m.nh_profiles?.full_name || m.nh_profiles?.email}</div><div className="small muted">{m.nh_profiles?.email}{!owner && ` · ${t(m.role)}`}</div>
                  {owner && <select value={m.role} onChange={(e) => setRole(m.user_id, e.target.value)} style={{ marginTop: 6, maxWidth: 220 }}>
                    <option value="manager">{t('manager')}</option><option value="staff">{t('staff')}</option>
                  </select>}
                </div>
                {owner && <button className="ghost small" title={t('edit')} onClick={() => openEdit(m)}>✎</button>}
                {(owner || m.role === 'staff') && <>
                  <button className="ghost small" onClick={() => setPwFor({ user_id: m.user_id, password: '' })}>🔑</button>
                  <button className="ghost small" onClick={() => remove(m.user_id)}>✕</button>
                </>}
              </div>
            ))}
            {!members.length && <div className="it muted">{t('noData')}</div>}
          </div>
          <button onClick={() => setAdd({ email: '', full_name: '', password: '', role: 'staff' })}>+ {t('addUser')}</button>
        </div>

        <fieldset disabled={!owner} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="card">
            <label className="f"><span>{t('name')}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="f"><span>{t('address')}</span><input value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
            <label className="f"><span>{t('taxNumber')}</span><input value={f.tax_number || ''} onChange={(e) => setF({ ...f, tax_number: e.target.value })} /></label>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{lang === 'de' ? 'Kartenzahlung im Kassenbuch' : 'Kartenzahlung trong Kassenbuch'}</h3>
            <div className="seg" style={{ marginBottom: 8 }}>
              <button className={(f.card_source || 'zbon') === 'zbon' ? 'sel' : ''} onClick={() => setF({ ...f, card_source: 'zbon' })}>{lang === 'de' ? 'lt. Z-Bon' : 'Theo Z-Bon'}</button>
              <button className={f.card_source === 'viva' ? 'sel' : ''} onClick={() => setF({ ...f, card_source: 'viva' })}>{lang === 'de' ? 'lt. Viva Wallet' : 'Theo Viva Wallet'}</button>
            </div>
            <div className="small muted">{(f.card_source || 'zbon') === 'zbon'
              ? (lang === 'de' ? 'Umsatz, Kartenzahlung und Trinkgeld lt. Z-Bon. Trinkgeld steht direkt unter der Kartenzahlung.' : 'Umsatz, Kartenzahlung và Trinkgeld đều lấy theo Z-Bon. Trinkgeld ghi ngay dưới dòng Kartenzahlung.')
              : (lang === 'de' ? 'Umsatz und Kartenzahlung lt. Z-Bon. Viva Wallet im Kassenbuch eintragen: Trinkgeld = Viva Wallet − Kreditzahlung Z-Bon, direkt unter der Kartenzahlung.' : 'Umsatz và Kartenzahlung theo Z-Bon. Nhập số Viva Wallet ở Kassenbuch (nút − Viva Wallet): Trinkgeld = Viva Wallet − Kreditzahlung trên Z-Bon, ghi ở Ausgaben ngay dưới dòng Kartenzahlung.')}</div>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('posMap')}</h3>
            {Object.entries(map).map(([k, v]) => (
              <div className="row" key={k} style={{ marginBottom: 6 }}>
                <code className="grow">{k}</code>
                <select style={{ width: 140 }} value={v} onChange={(e) => setF({ ...f, pos_payment_map: { ...map, [k]: e.target.value as PayMethod } })}>
                  <option value="cash">{t('cash')}</option><option value="card">{t('card')}</option><option value="transfer">{t('transfer')}</option>
                </select>
                <button className="ghost" onClick={() => { const n = { ...map }; delete n[k]; setF({ ...f, pos_payment_map: n }) }}>✕</button>
              </div>
            ))}
            <div className="row"><input placeholder="z.B. allO Pay" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} /><button onClick={() => { if (newLabel.trim()) { setF({ ...f, pos_payment_map: { ...map, [newLabel.trim()]: 'card' } }); setNewLabel('') } }}>+</button></div>
          </div>
          <div className="card">
            <div className="grid2">
              <label className="f"><span>{t('datevConsultant')}</span><input inputMode="numeric" value={f.datev_consultant_no || ''} onChange={(e) => setF({ ...f, datev_consultant_no: e.target.value })} /></label>
              <label className="f"><span>{t('datevClient')}</span><input inputMode="numeric" value={f.datev_client_no || ''} onChange={(e) => setF({ ...f, datev_client_no: e.target.value })} /></label>
            </div>
          </div>
          {owner && <button className="primary block" onClick={save}>{t('save')}</button>}
        </fieldset>
        <button className="block" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
      </div>

      <Sheet open={!!add} onClose={() => setAdd(null)} title={t('addUser')}>
        {add && <>
          {owner && <div className="seg" style={{ marginBottom: 10 }}>
            <button className={add.role === 'manager' ? 'sel' : ''} onClick={() => setAdd({ ...add, role: 'manager' })}>{t('manager')}</button>
            <button className={add.role === 'staff' ? 'sel' : ''} onClick={() => setAdd({ ...add, role: 'staff' })}>{t('staff')}</button>
          </div>}
          <label className="f"><span>{t('fullName')}</span><input value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} /></label>
          <label className="f"><span>{t('email')}</span><input type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></label>
          <label className="f"><span>{t('password')} (≥ 8)</span><input value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} /></label>
          {add.role === 'manager' && members.some((m) => m.role === 'manager') && <div className="alert warn">{lang === 'de' ? 'Die bisherige Filialleitung wird ersetzt.' : 'Người phụ trách hiện tại sẽ được thay.'}</div>}
          <button className="primary block" onClick={createUser}>{t('save')}</button>
        </>}
      </Sheet>
      <Sheet open={!!ed} onClose={() => setEd(null)} title={lang === 'de' ? 'Benutzer bearbeiten' : 'Sửa thông tin'}>
        {ed && <>
          <label className="f"><span>{t('fullName')}</span><input value={ed.full_name} onChange={(e) => setEd({ ...ed, full_name: e.target.value })} /></label>
          <label className="f"><span>{t('email')}</span><input type="email" value={ed.email} onChange={(e) => setEd({ ...ed, email: e.target.value })} /></label>
          <div className="f"><span>{t('language')}</span>
            <div className="seg"><button className={ed.lang === 'vi' ? 'sel' : ''} onClick={() => setEd({ ...ed, lang: 'vi' })}>Tiếng Việt</button><button className={ed.lang === 'de' ? 'sel' : ''} onClick={() => setEd({ ...ed, lang: 'de' })}>Deutsch</button></div>
          </div>
          <label className="f"><span>{lang === 'de' ? 'Neues Passwort (leer = unverändert)' : 'Mật khẩu mới (để trống = giữ nguyên)'}</span><input value={ed.password} onChange={(e) => setEd({ ...ed, password: e.target.value })} /></label>
          <h3>{lang === 'de' ? 'Filialen & Rolle' : 'Quán làm việc & vai trò'}</h3>
          <div className="list" style={{ marginBottom: 12 }}>
            {restaurants.map((x) => (
              <div className="it" key={x.id}>
                <div className="grow" style={{ minWidth: 0 }}>{x.name}</div>
                <select style={{ width: 170 }} value={ed.roles[x.id] || ''} onChange={(e) => setEd({ ...ed, roles: { ...ed.roles, [x.id]: e.target.value as '' | 'manager' | 'staff' } })}>
                  <option value="">—</option><option value="staff">{t('staff')}</option><option value="manager">{t('manager')}</option>
                </select>
              </div>
            ))}
          </div>
          {restaurants.some((x) => ed.roles[x.id] === 'manager' && ed.orig[x.id] !== 'manager') && <div className="alert warn">{lang === 'de' ? 'Die bisherige Filialleitung wird zu Mitarbeiter.' : 'Người phụ trách cũ của quán sẽ thành nhân viên.'}</div>}
          <button className="primary block" disabled={busy} onClick={saveEdit}>{t('save')}</button>
        </>}
      </Sheet>
      <Sheet open={!!pwFor} onClose={() => setPwFor(null)} title={t('resetPassword')}>
        {pwFor && <>
          <label className="f"><span>{t('password')} (≥ 8)</span><input value={pwFor.password} onChange={(e) => setPwFor({ ...pwFor, password: e.target.value })} /></label>
          <button className="primary block" onClick={setPassword}>{t('save')}</button>
        </>}
      </Sheet>
    </>
  )
}
