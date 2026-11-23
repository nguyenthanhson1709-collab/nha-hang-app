import { useState } from 'react'
import { supabase, errMsg, type Category } from '../lib/supabase'
import { useApp } from '../lib/app'
import { useLang, useT, type Lang } from '../lib/i18n'
import { Sheet, Top, toast } from '../components/ui'

export default function Settings() {
  const t = useT()
  const { lang, setLang } = useLang()
  const { profile, categories, reload } = useApp()
  const [pw, setPw] = useState('')
  const [edit, setEdit] = useState<Partial<Category> | null>(null)

  async function changeLang(l: Lang) {
    setLang(l)
    await supabase.from('nh_profiles').update({ lang: l }).eq('id', profile.id)
  }
  async function changePw() {
    if (pw.length < 8) { toast('≥ 8'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    toast(error ? errMsg(error) : t('saved')); setPw('')
  }
  async function saveCat() {
    if (!edit?.name_vi || !edit.name_de) return
    const row = { name_vi: edit.name_vi, name_de: edit.name_de, skr_account: edit.skr_account || null, kind: edit.kind, parent_id: edit.parent_id ?? null, sort: edit.sort ?? 5 }
    const { error } = edit.id ? await supabase.from('nh_categories').update(row).eq('id', edit.id) : await supabase.from('nh_categories').insert(row)
    if (error) { toast(errMsg(error)); return }
    setEdit(null); reload()
  }
  async function delCat(id: string) {
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('nh_categories').delete().eq('id', id)
    if (error) toast(lang === 'de' ? 'Gruppe wird noch verwendet' : 'Nhóm đang được dùng, không xoá được'); else { setEdit(null); reload() }
  }

  const tops = categories.filter((c) => !c.parent_id)
  return (
    <>
      <Top title={t('settings')} sub={profile.email} back />
      <div className="page">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('language')}</h3>
          <div className="seg"><button className={lang === 'vi' ? 'sel' : ''} onClick={() => changeLang('vi')}>Tiếng Việt</button><button className={lang === 'de' ? 'sel' : ''} onClick={() => changeLang('de')}>Deutsch</button></div>
          <div className="small muted" style={{ marginTop: 6 }}>PDF, Kassenbuch, DATEV: Deutsch</div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('resetPassword')}</h3>
          <div className="row"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><button onClick={changePw}>{t('save')}</button></div>
        </div>

        {profile.is_owner && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('categories')}</h3>
            {tops.map((tp) => (
              <div key={tp.id} style={{ marginBottom: 10 }}>
                <div className="row between"><b>{tp.name_vi} / {tp.name_de}</b>
                  <button className="ghost small" onClick={() => setEdit({ kind: tp.kind, parent_id: tp.id, name_vi: '', name_de: '', skr_account: '' })}>+</button></div>
                <div className="list" style={{ marginTop: 4 }}>
                  {categories.filter((c) => c.parent_id === tp.id).map((c) => (
                    <div className="it" key={c.id} onClick={() => setEdit(c)} style={{ cursor: 'pointer' }}>
                      <div className="grow">{c.name_vi}<div className="small muted">{c.name_de}</div></div>
                      <span className="small muted">{c.skr_account || (tp.kind === 'nonfood' ? '' : '3300 / 3400')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="small muted">SKR03: 3300 = Wareneingang 7 %, 3400 = Wareneingang 19 % (theo mức thuế của dòng hàng).</div>
          </div>
        )}
        <button className="block" onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={t('category')}>
        {edit && <>
          <label className="f"><span>Tiếng Việt</span><input value={edit.name_vi || ''} onChange={(e) => setEdit({ ...edit, name_vi: e.target.value })} /></label>
          <label className="f"><span>Deutsch</span><input value={edit.name_de || ''} onChange={(e) => setEdit({ ...edit, name_de: e.target.value })} /></label>
          <label className="f"><span>{t('account')}</span><input inputMode="numeric" placeholder="3300 / 3400" value={edit.skr_account || ''} onChange={(e) => setEdit({ ...edit, skr_account: e.target.value })} /></label>
          <div className="row">{edit.id && <button className="danger" onClick={() => delCat(edit.id!)}>{t('delete')}</button>}<button className="primary grow" onClick={saveCat}>{t('save')}</button></div>
        </>}
      </Sheet>
    </>
  )
}
