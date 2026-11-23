import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang, useT } from '../lib/i18n'

export default function Login() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [noOwner, setNoOwner] = useState(false)
  const [setup, setSetup] = useState(false)

  useEffect(() => { supabase.rpc('nh_has_owner').then(({ data }) => setNoOwner(data === false)) }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    if (setup) {
      const { error } = await supabase.auth.signUp({ email, password: pw, options: { data: { lang } } })
      if (error) { setErr(error.message); setBusy(false); return }
      const { error: e2 } = await supabase.rpc('nh_claim_owner')
      if (e2) setErr(e2.message)
      // nếu Supabase yêu cầu xác nhận email, phiên chưa có: báo người dùng
      const { data } = await supabase.auth.getSession()
      if (!data.session) setErr(lang === 'de' ? 'Bitte E-Mail bestätigen und dann anmelden.' : 'Hãy mở email xác nhận rồi đăng nhập.')
    } else {
      // Đăng nhập xong luôn vào trang chủ, không quay lại trang cũ (vd. cài đặt)
      history.replaceState(null, '', location.pathname + location.search + '#/')
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
      if (error) setErr(t('loginFailed'))
    }
    setBusy(false)
  }

  return (
    <div className="center">
      <form className="card" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h1>{t('appName')}</h1>
          <select style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value as 'vi')}>
            <option value="vi">Tiếng Việt</option><option value="de">Deutsch</option>
          </select>
        </div>
        {setup && <div className="alert ok">{lang === 'de' ? 'Erstes Konto: wird Inhaber mit vollem Zugriff.' : 'Tài khoản đầu tiên: sẽ là Chủ, có toàn quyền.'}</div>}
        <label className="f"><span>{t('email')}</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="f"><span>{t('password')}</span><input type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        {err && <div className="alert err">{err}</div>}
        <button className="primary block" disabled={busy}>{setup ? (lang === 'de' ? 'Inhaber-Konto anlegen' : 'Tạo tài khoản chủ') : t('login')}</button>
        {noOwner && !setup && <button type="button" className="ghost block" style={{ marginTop: 8 }} onClick={() => setSetup(true)}>{lang === 'de' ? 'Ersteinrichtung' : 'Cài đặt lần đầu'}</button>}
      </form>
    </div>
  )
}
