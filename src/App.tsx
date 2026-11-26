import { useCallback, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { fromRecoveryLink, supabase, type Category, type Profile, type Restaurant, type Role } from './lib/supabase'
import { LangCtx, type Lang, useT } from './lib/i18n'
import { AppCtx, type AppState } from './lib/app'
import { BottomNav, Spinner, Toaster } from './components/ui'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Restaurants from './pages/Restaurants'
import Home from './pages/Home'
import Scan from './pages/Scan'
import DocReview from './pages/DocReview'
import ZbonReview from './pages/ZbonReview'
import Kassenbuch from './pages/Kassenbuch'
import Archive from './pages/Archive'
import Contracts from './pages/Contracts'
import Statements from './pages/Statements'
import Reports from './pages/Reports'
import Plan from './pages/Plan'
import Bwa from './pages/Bwa'
import Settings from './pages/Settings'
import RestaurantSettings from './pages/RestaurantSettings'
import Staff from './pages/Staff'
import EmployeePage from './pages/Employee'
import Invoices from './hoadon/pages/Invoices'
import InvoiceEditor from './hoadon/pages/InvoiceEditor'
import InvCustomers from './hoadon/pages/Customers'
import InvArticles from './hoadon/pages/Articles'
import InvSettings from './hoadon/pages/InvSettings'
import BkApp from './datban/BkApp'
import RcRecipes from './congthuc/pages/Recipes'
import RcRecipeView from './congthuc/pages/RecipeView'
import RcRecipeEditor from './congthuc/pages/RecipeEditor'
import RcIngredients from './congthuc/pages/Ingredients'
import RcConcepts from './congthuc/pages/Concepts'

// Mở app mới (tab mới / mở lại từ màn hình chính) -> luôn về trang đầu, không quay lại trang cũ (vd. trang scan).
// Tải lại trang trong cùng một tab thì vẫn giữ trang đang xem.
let freshChecked = false
function openFresh(start: string) {
  if (freshChecked) return
  freshChecked = true
  try {
    if (sessionStorage.getItem('nh-open')) return
    sessionStorage.setItem('nh-open', '1')
  } catch { return }
  if (location.hash.startsWith('#/') && location.hash !== `#${start}`) history.replaceState(null, '', `${location.pathname}${location.search}#${start}`)
}

// Logo Vietbowl nổi ở đáy mọi trang: bấm để về nhanh trang chủ (của quán đang xem, hoặc trang đầu)
function HomeNav({ start }: { start: string }) {
  const path = useLocation().pathname
  const m = path.match(/^\/r\/([^/]+)/)
  // Hồ sơ nhân viên trên điện thoại: ẩn logo để không che nội dung (người dùng yêu cầu 26/11/2026)
  return <BottomNav to={m ? `/r/${m[1]}` : start} hideMobile={/^\/r\/[^/]+\/hr\/[^/]+$/.test(path)} />
}

function RestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Shell({ session }: { session: Session }) {
  const t = useT()
  const [state, setState] = useState<Omit<AppState, 'reload'> | null>(null)
  const [err, setErr] = useState('')
  const { setLang } = useLangSetter()

  const load = useCallback(async () => {
    const uid = session.user.id
    const [p, r, m, c] = await Promise.all([
      supabase.from('nh_profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('nh_restaurants').select('*').order('name'),
      supabase.from('nh_members').select('restaurant_id, role').eq('user_id', uid),
      supabase.from('nh_categories').select('*').order('sort'),
    ])
    if (p.error || !p.data) { setErr(p.error?.message || t('noAccess')); return }
    const roles: Record<string, Role> = {}
    for (const x of m.data || []) roles[x.restaurant_id] = x.role as Role
    setLang(p.data.lang as Lang)
    setState({ profile: p.data as Profile, restaurants: (r.data || []) as Restaurant[], roles, categories: (c.data || []) as Category[] })
  }, [session.user.id]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  if (err) return <div className="center"><div className="card"><p>{err}</p><button onClick={() => supabase.auth.signOut()}>{t('logout')}</button></div></div>
  if (!state) return <Spinner />
  const { profile, restaurants } = state
  const active = restaurants.filter((r) => r.active || profile.is_owner)
  const start = profile.is_owner ? '/restaurants' : active.length ? `/r/${active[0].id}` : null
  if (!start) return <div className="center"><div className="card"><p>{t('noAccess')}</p><button onClick={() => supabase.auth.signOut()}>{t('logout')}</button></div></div>
  openFresh(start)

  return (
    <AppCtx.Provider value={{ ...state, reload: load }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to={start} replace />} />
          <Route path="/restaurants" element={<Restaurants />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/r/:rid" element={<RestLayout><Home /></RestLayout>} />
          <Route path="/r/:rid/scan" element={<RestLayout><Scan /></RestLayout>} />
          <Route path="/r/:rid/doc/:id" element={<RestLayout><DocReview /></RestLayout>} />
          <Route path="/r/:rid/z/:id" element={<RestLayout><ZbonReview /></RestLayout>} />
          <Route path="/r/:rid/kb" element={<RestLayout><Kassenbuch /></RestLayout>} />
          <Route path="/r/:rid/archive" element={<RestLayout><Archive /></RestLayout>} />
          <Route path="/r/:rid/contracts" element={<RestLayout><Contracts /></RestLayout>} />
          <Route path="/r/:rid/statements" element={<RestLayout><Statements /></RestLayout>} />
          <Route path="/r/:rid/reports" element={<RestLayout><Reports /></RestLayout>} />
          <Route path="/r/:rid/bwa" element={<RestLayout><Bwa /></RestLayout>} />
          <Route path="/r/:rid/plan" element={<RestLayout><Plan /></RestLayout>} />
          <Route path="/r/:rid/hr" element={<RestLayout><Staff /></RestLayout>} />
          <Route path="/r/:rid/hr/:eid" element={<RestLayout><EmployeePage /></RestLayout>} />
          <Route path="/r/:rid/inv" element={<RestLayout><Invoices key="i" /></RestLayout>} />
          <Route path="/r/:rid/inv/new" element={<RestLayout><InvoiceEditor key="in" /></RestLayout>} />
          <Route path="/r/:rid/inv/quotes" element={<RestLayout><Invoices docType="quote" key="q" /></RestLayout>} />
          <Route path="/r/:rid/inv/quotes/new" element={<RestLayout><InvoiceEditor docType="quote" key="qn" /></RestLayout>} />
          <Route path="/r/:rid/inv/quotes/:id" element={<RestLayout><InvoiceEditor docType="quote" /></RestLayout>} />
          <Route path="/r/:rid/inv/customers" element={<RestLayout><InvCustomers /></RestLayout>} />
          <Route path="/r/:rid/inv/articles" element={<RestLayout><InvArticles /></RestLayout>} />
          <Route path="/r/:rid/inv/settings" element={<RestLayout><InvSettings /></RestLayout>} />
          <Route path="/r/:rid/inv/:id" element={<RestLayout><InvoiceEditor /></RestLayout>} />
          <Route path="/r/:rid/bk/*" element={<RestLayout><BkApp /></RestLayout>} />
          <Route path="/r/:rid/rc" element={<RestLayout><RcRecipes /></RestLayout>} />
          <Route path="/r/:rid/rc/concepts" element={<RestLayout><RcConcepts /></RestLayout>} />
          <Route path="/r/:rid/rc/ing" element={<RestLayout><RcIngredients /></RestLayout>} />
          <Route path="/r/:rid/rc/new" element={<RestLayout><RcRecipeEditor key="new" /></RestLayout>} />
          <Route path="/r/:rid/rc/:id" element={<RestLayout><RcRecipeView /></RestLayout>} />
          <Route path="/r/:rid/rc/:id/edit" element={<RestLayout><RcRecipeEditor /></RestLayout>} />
          <Route path="/r/:rid/settings" element={<RestLayout><RestaurantSettings /></RestLayout>} />
          <Route path="*" element={<Navigate to={start} replace />} />
        </Routes>
        <HomeNav start={start} />
      </HashRouter>
    </AppCtx.Provider>
  )
}

let setLangRef: (l: Lang) => void = () => {}
function useLangSetter() { return { setLang: setLangRef } }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovery, setRecovery] = useState(fromRecoveryLink)
  const [lang, setLangS] = useState<Lang>(() => { try { return (localStorage.getItem('nh-lang') as Lang) || 'vi' } catch { return 'vi' } })
  const setLang = (l: Lang) => { setLangS(l); try { localStorage.setItem('nh-lang', l) } catch { /* */ } }
  setLangRef = setLang

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (!data.session) setRecovery(false); setSession(data.session) })
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); setSession(s) })
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      {session === undefined ? <Spinner /> : session && recovery ? <SetPassword onDone={() => setRecovery(false)} /> : session ? <Shell key={session.user.id} session={session} /> : <Login />}
      <Toaster />
    </LangCtx.Provider>
  )
}
