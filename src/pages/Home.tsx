import { useEffect, useState } from 'react'
import { ClockShort } from '../components/Clock'
import { LangSwitch } from '../components/LangSwitch'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, type Doc } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { daysOfMonth, dmy, eur, monthRange, thisMonth, todayIso } from '../lib/format'
import { currentBalance, docsInRange, DOC_SELECT, zbonsInRange } from '../lib/data'
import { PayTag, Top, useRestaurant } from '../components/ui'
import { QuickReview } from '../components/QuickReview'

/** Biểu tượng theo bộ Lucide (nét 2px), vẽ trực tiếp để không thêm thư viện */
const LU: Record<string, React.ReactNode> = {
  scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>,
  review: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
  archive: <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />,
  book: <><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></>,
  chart: <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></>,
  invoice: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></>,
  people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" /></>,
  chef: <><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" /><path d="M6 17h12" /></>,
  arrow: <><path d="M7 7h10v10" /><path d="M7 17 17 7" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
}
export const Lucide = ({ k }: { k: string }) => (
  <svg className="lu" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{LU[k]}</svg>
)

export default function Home() {
  const { rid } = useParams()
  const t = useT()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { profile } = useApp()
  const { lang } = useLang()
  // Dashboard rộng tối đa 1200px
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xwide'); return () => el?.classList.remove('xwide') }, [])
  const m = canManage(role)
  const [sp] = useSearchParams()
  const view = sp.get('v')
  const [tick, setTick] = useState(0)
  const [s, setS] = useState<{ spend: number; cash: number; card: number; transfer: number; rev: number; bal: number; missing: string[]; review: Doc[]; mine: Doc[]} | null>(null)
  // Ô Bàn đặt: nhớ trên máy quán nào có đặt bàn để ô hiện ngay, không chờ các số liệu khác; tải song song
  const bkKey = `nh-hasbk-${rid}`
  const [hasBk, setHasBk] = useState(() => { try { return localStorage.getItem(bkKey) === '1' } catch { return false } })
  const [bk, setBk] = useState<{ n: number; g: number } | undefined>()
  useEffect(() => {
    if (!m) return
    let live = true
    Promise.all([
      supabase.from('nh_bk_settings').select('restaurant_id').eq('restaurant_id', rid!).maybeSingle(),
      supabase.from('nh_bk_bookings').select('party').eq('restaurant_id', rid!).eq('day', todayIso()).in('status', ['pending', 'confirmed', 'seated']),
    ]).then(([{ data: bs }, { data: bks }]) => {
      if (!live) return
      setHasBk(!!bs); try { localStorage.setItem(bkKey, bs ? '1' : '0') } catch { /* bỏ qua */ }
      setBk(bs && bks?.length ? { n: bks.length, g: bks.reduce((a, b) => a + Number(b.party), 0) } : undefined)
    })
    return () => { live = false }
  }, [rid, m, bkKey, tick])
  // tải sẵn trang đặt bàn để bấm vào mở nhanh
  useEffect(() => {
    if (!hasBk || document.getElementById('bk-prefetch')) return
    for (const [i, href] of ['dat-ban/staff.html', 'dat-ban/vendor/supabase/supabase.js?v=2.45.4', 'dat-ban/config.js'].entries()) {
      const l = document.createElement('link'); l.rel = 'prefetch'; l.href = href; if (!i) l.id = 'bk-prefetch'; document.head.appendChild(l)
    }
  }, [hasBk])

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
        ? await supabase.from('nh_documents').select(DOC_SELECT).eq('restaurant_id', rid!).eq('status', 'uploaded').order('doc_date').limit(100)
        : { data: [] }
      const { data: mine } = !m
        ? await supabase.from('nh_documents').select('*, nh_document_payments(*)').eq('restaurant_id', rid!).eq('created_by', profile.id).order('created_at', { ascending: false }).limit(30)
        : { data: [] }
      setS({ spend: purchase.reduce((a, d) => a + Number(d.gross), 0), cash: sum('cash'), card: sum('card'), transfer: sum('transfer'), rev, bal, missing, review: (review || []) as Doc[], mine: (mine || []) as Doc[] })
    })()
  }, [rid, r, m, profile.id, tick])

  if (!r) return null
  if (m && view === 'review') return (
    <>
      <Top title={`${t('toReview')} (${s?.review.length ?? '…'})`} sub={r.name} back={`/r/${rid}`} />
      <div className="page">{s ? <QuickReview docs={s.review} rid={rid!} onDone={() => setTick((x) => x + 1)} /> : <div className="center"><div className="spinner" /></div>}</div>
    </>
  )
  const de = lang === 'de'
  const tiles: { icon: string; label: string; desc: string; to: string; badge?: number; main?: boolean }[] = [
    { icon: 'scan', label: t('scanTile'), desc: de ? 'Belege scannen und erfassen' : 'Quét và nhập hoá đơn', to: `/r/${rid}/scan`, main: true },
    ...(m ? [
      { icon: 'review', label: t('toReview'), desc: de ? 'Prüfen und bestätigen' : 'Kiểm tra và xác nhận', to: `/r/${rid}?v=review`, badge: s?.review.length },
      { icon: 'archive', label: t('archive'), desc: de ? 'Buchhaltungsunterlagen' : 'Tài liệu kế toán', to: `/r/${rid}/archive` },
      { icon: 'book', label: t('kassenbuch'), desc: de ? 'Kassenbuch führen' : 'Sổ quỹ tiền mặt', to: `/r/${rid}/kb` },
      { icon: 'chart', label: t('reports'), desc: de ? 'Auswertungen und Statistik' : 'Thống kê và phân tích', to: `/r/${rid}/reports` },
      ...(m && hasBk ? [{ icon: 'calendar', label: de ? 'Reservierungen' : 'Bàn đặt', desc: bk ? (de ? `Heute: ${bk.n} Res. · ${bk.g} Gäste` : `Hôm nay: ${bk.n} đơn · ${bk.g} khách`) : (de ? 'Tischreservierungen und Tischplan' : 'Xem và quản lý đặt bàn'), to: `/r/${rid}/bk` }] : []),
      { icon: 'invoice', label: t('invoicing'), desc: de ? 'Rechnungen und Angebote' : 'Hoá đơn và Angebot', to: `/r/${rid}/inv` },
      { icon: 'people', label: t('hr'), desc: de ? 'Personalakten verwalten' : 'Quản lý hồ sơ nhân viên', to: `/r/${rid}/hr` },
    ] : []),
    { icon: 'chef', label: de ? 'Konzepte & Rezepte' : 'Concept & Công thức', desc: m ? (de ? 'Rezepte, Wareneinsatz, Allergene' : 'Công thức, giá vốn, dị ứng') : (de ? 'Rezepte ansehen' : 'Xem công thức món'), to: `/r/${rid}/rc` },
  ]
  return (
    <>
      <Top title={r.name} back={profile.is_owner ? '/restaurants' : undefined}
        right={<div className="hd-right"><ClockShort /><LangSwitch /><Link className="btn hd-gear" to={m ? `/r/${rid}/settings` : '/settings'} aria-label={t('settings')} title={t('settings')}><Lucide k="settings" /></Link></div>} />
      <div className="page dash">
        <div className="dash-grid">
          {tiles.map((x) => (
            <button key={x.to} className={`dcard${x.main ? ' main' : ''}${x.main && tiles.length % 2 === 1 && tiles.length > 1 ? ' wide' : ''}`} onClick={() => nav(x.to)}>
              <span className="dcard-top">
                <span className="dcard-ic"><Lucide k={x.icon} /></span>
                {x.badge ? <span className="dcard-badge" title={de ? 'offen' : 'đang chờ'}>{x.badge}</span> : <span className="dcard-go"><Lucide k="arrow" /></span>}
              </span>
              <span className="dcard-t">{x.label}</span>
              <span className="dcard-d">{x.badge ? `${x.badge} ${de ? 'Belege offen' : 'hoá đơn đang chờ'}` : x.desc}</span>
            </button>
          ))}
        </div>
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
