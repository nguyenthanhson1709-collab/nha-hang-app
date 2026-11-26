// Nút đổi ngôn ngữ Việt / Đức ở thanh tiêu đề (lưu vào hồ sơ người dùng như trong Cài đặt)
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { useLang, type Lang } from '../lib/i18n'

export function LangSwitch() {
  const { lang, setLang } = useLang()
  const { profile } = useApp()
  const pick = (l: Lang) => {
    if (l === lang) return
    setLang(l)
    supabase.from('nh_profiles').update({ lang: l }).eq('id', profile.id).then(() => {})
  }
  return (
    <div className="lang-sw" role="group" aria-label="Sprache / Ngôn ngữ">
      <button className={lang === 'vi' ? 'on' : ''} aria-pressed={lang === 'vi'} onClick={() => pick('vi')} title="Tiếng Việt">VI</button>
      <button className={lang === 'de' ? 'on' : ''} aria-pressed={lang === 'de'} onClick={() => pick('de')} title="Deutsch">DE</button>
    </div>
  )
}
