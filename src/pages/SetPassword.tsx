import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

// Hiện sau khi mở link "đặt lại mật khẩu" trong email: đã đăng nhập tạm, cần đặt mật khẩu mới.
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    if (pw.length < 8) { setErr(t('pwTooShort')); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    history.replaceState(null, '', location.pathname + '#/')
    onDone()
  }

  return (
    <div className="center">
      <form className="card" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <h1 style={{ marginBottom: 14 }}>{t('setNewPw')}</h1>
        <label className="f"><span>{t('newPassword')} (≥ 8)</span><input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></label>
        {err && <div className="alert err">{err}</div>}
        <button className="primary block" disabled={busy}>{t('save')}</button>
      </form>
    </div>
  )
}
