// Trang Ngân hàng của quán: kết nối tài khoản (vd. Berliner Volksbank) qua Open Banking - Enable Banking, CHỈ ĐỌC.
// Chủ đăng nhập trên trang của ngân hàng (SecureGo plus), app không bao giờ thấy PIN. Số dư mặc định che mờ + nút con mắt.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy, eur, monthRange, r2, thisMonth } from '../lib/format'
import { dropProps } from '../lib/drop'
import { Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'

interface BankApp { app_id: string; has_key: boolean; updated_at: string }
interface Link { id: string; restaurant_id: string; aspsp_name: string; status: 'pending' | 'active' | 'expired' | 'error'; valid_until: string | null; last_sync_at: string | null; last_error: string | null; last_error_at: string | null; created_at: string }
interface Account { uid: string; link_id: string; iban: string | null; name: string | null; currency: string | null; balance: number | null; balance_type: string | null; balance_at: string | null; enabled: boolean }
interface Tx { id: string; iban: string | null; booking_date: string | null; value_date: string | null; amount: number; currency: string | null; counterparty: string | null; counterparty_iban: string | null; purpose: string | null; status: string | null }
interface Aspsp { name: string; country: string; logo?: string; psu_types?: string[]; beta?: boolean; max_days?: number | null }

const REDIRECT = location.hostname === 'localhost' ? 'http://localhost:5173/' : 'https://app.vietbowlmitte.de/'

const ERR: Record<string, [string, string]> = {
  forbidden: ['Không có quyền', 'Keine Berechtigung'],
  no_app: ['Chưa cài đặt Enable Banking (chủ cần nhập Application ID và khoá .pem)', 'Enable Banking ist noch nicht eingerichtet'],
  invalid_app_id: ['Application ID không hợp lệ', 'Application ID ungültig'],
  invalid_key: ['File khoá không đúng (cần file .pem có "BEGIN PRIVATE KEY")', 'Schlüsseldatei ungültig (.pem mit "BEGIN PRIVATE KEY")'],
  no_key: ['Chưa có file khoá .pem', 'Keine .pem-Schlüsseldatei'],
  eb_auth: ['Enable Banking từ chối: Application ID và file khoá không khớp', 'Enable Banking lehnt ab: Application ID und Schlüssel passen nicht zusammen'],
  invalid_redirect: ['Địa chỉ quay về không hợp lệ', 'Ungültige Rücksprung-Adresse'],
  unknown_bank: ['Không tìm thấy ngân hàng này', 'Bank nicht gefunden'],
  unknown_state: ['Kết nối này đã hết hạn, hãy thử lại', 'Vorgang abgelaufen, bitte erneut versuchen'],
  cancelled: ['Đã huỷ kết nối ở trang ngân hàng', 'Verbindung bei der Bank abgebrochen'],
  expired: ['Quyền đọc đã hết hạn, hãy bấm "Xác nhận lại"', 'Zustimmung abgelaufen – bitte erneut bestätigen'],
  rate_limit: ['Ngân hàng giới hạn số lần đọc, thử lại sau vài giờ', 'Abruflimit der Bank erreicht, später erneut versuchen'],
}

async function bankCall(body: Record<string, unknown>, de: boolean) {
  const { data, error } = await supabase.functions.invoke('nh-bank', { body: { user_agent: navigator.userAgent, language: de ? 'de' : 'vi', ...body } })
  if (error) {
    let code = error.message, message = '', extra: Record<string, unknown> = {}
    try { const j = await (error as { context?: Response }).context?.json(); code = j?.error || code; message = j?.message || ''; extra = j || {} } catch { /* */ }
    const e = new Error(ERR[code]?.[de ? 1 : 0] || message || code) as Error & { data?: Record<string, unknown> }
    e.data = extra
    throw e
  }
  return data
}

const fmtTs = (s: string | null, de: boolean) => s ? new Date(s).toLocaleString(de ? 'de-DE' : 'vi-VN', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtIban = (s: string | null) => (s || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
const daysLeft = (s: string | null) => s ? Math.floor((new Date(s).getTime() - Date.now()) / 86400000) : null

function Eye({ open }: { open: boolean }) {
  return (
    <svg className="lu" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {open
        ? <><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>
        : <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>}
    </svg>
  )
}

export default function Bank() {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { profile } = useApp()
  const owner = profile.is_owner
  const { lang } = useLang()
  const de = lang === 'de'
  const [app, setApp] = useState<BankApp | null | undefined>(undefined)
  const [links, setLinks] = useState<Link[] | undefined>(undefined)
  const [accs, setAccs] = useState<Account[]>([])
  const [txs, setTxs] = useState<Tx[]>([])
  const [period, setPeriod] = useState(thisMonth())
  const [iban, setIban] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [showBal, setShowBal] = useState(false)
  const [setup, setSetup] = useState<{ app_id: string; pem: string; file: string } | null>(null)
  const [pick, setPick] = useState<{ list: Aspsp[] | null; q: string; err: string } | null>(null)
  const [choose, setChoose] = useState<{ link: Link; on: Set<string> } | null>(null)
  const autoSynced = useRef(false)
  const autoChoose = useRef(false)

  const load = useCallback(async () => {
    const { from, to } = monthRange(period)
    const [a, l, ac, t] = await Promise.all([
      owner ? supabase.from('nh_bank_app').select('*').eq('id', 1).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('nh_bank_links').select('*').eq('restaurant_id', rid!).order('created_at'),
      supabase.from('nh_bank_accounts').select('*').eq('restaurant_id', rid!).order('iban'),
      supabase.from('nh_bank_tx').select('id, iban, booking_date, value_date, amount, currency, counterparty, counterparty_iban, purpose, status').eq('restaurant_id', rid!).gte('booking_date', from).lte('booking_date', to).order('booking_date', { ascending: false }).limit(2000),
    ])
    setApp((a.data as BankApp) || null)
    setLinks(((l.data || []) as Link[]).filter((x) => x.status !== 'pending' || Date.now() - new Date(x.created_at).getTime() < 3600000))
    setAccs((ac.data || []) as Account[])
    setTxs((t.data || []) as Tx[])
  }, [rid, period, owner])
  useEffect(() => { if (r) load() }, [r, load])

  const sync = useCallback(async (quiet = false) => {
    setBusy('sync')
    try {
      const res = await bankCall({ action: 'sync', restaurant_id: rid }, de)
      const errs = (res.results || []).filter((x: { error?: string }) => x.error)
      if (errs.length) toast(errs.map((x: { bank: string; error: string; message: string }) => `${x.bank}: ${ERR[x.error]?.[de ? 1 : 0] || x.message}`).join(' · '))
      else if (!quiet) toast(de ? 'Aktualisiert' : 'Đã cập nhật')
    } catch (e) { if (!quiet) toast(errMsg(e)) }
    setBusy(''); load()
  }, [rid, de, load])

  // Mở trang: nếu lần lấy cuối đã quá 1 giờ thì tự lấy lại (chủ đang online nên không bị giới hạn 4 lần/ngày)
  useEffect(() => {
    if (!links || autoSynced.current) return
    const act = links.filter((l) => l.status === 'active')
    if (act.length && act.some((l) => !l.last_sync_at || Date.now() - new Date(l.last_sync_at).getTime() > 3600000)) { autoSynced.current = true; sync(true) }
  }, [links, sync])

  // Kết nối trả về nhiều tài khoản mà chưa chọn cái nào: mở luôn bảng chọn cho chủ
  useEffect(() => {
    if (!owner || !links || autoChoose.current) return
    const l = links.find((x) => x.status === 'active' && accs.some((a) => a.link_id === x.id) && !accs.some((a) => a.link_id === x.id && a.enabled))
    if (l) { autoChoose.current = true; setChoose({ link: l, on: new Set() }) }
  }, [owner, links, accs])

  if (!r || !canManage(role)) return null
  const ready = !!app?.has_key

  async function readPem(fl: FileList | null | undefined) {
    const f = fl?.[0]
    if (!f || !setup) return
    if (f.size > 20000) { toast(de ? 'Datei zu groß – bitte die .pem-Datei wählen' : 'File quá lớn – hãy chọn file .pem'); return }
    const text = await f.text()
    if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) { toast(ERR.invalid_key[de ? 1 : 0]); return }
    const id = f.name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || ''
    setSetup((s) => s && { ...s, pem: text, file: f.name, app_id: s.app_id.trim() || id })
  }
  async function saveSetup() {
    if (!setup) return
    if (!setup.app_id.trim()) { toast('Application ID'); return }
    if (!app?.has_key && !setup.pem) { toast(ERR.no_key[de ? 1 : 0]); return }
    setBusy('setup')
    try {
      const res = await bankCall({ action: 'config_save', app_id: setup.app_id.trim(), private_key: setup.pem }, de)
      toast((de ? 'Gespeichert' : 'Đã lưu') + (res.name ? ` · ${res.name}` : '') + (res.active === false ? (de ? ' · App noch nicht aktiviert' : ' · ứng dụng chưa kích hoạt') : ''))
      setSetup(null)
    } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }
  async function openPick() {
    setPick({ list: null, q: 'Volksbank', err: '' })
    try { const res = await bankCall({ action: 'aspsps', country: 'DE' }, de); setPick((p) => p && { ...p, list: res.aspsps || [] }) }
    catch (e) { setPick((p) => p && { ...p, list: [], err: errMsg(e) }) }
  }
  async function connect(name: string) {
    setBusy('connect')
    try {
      const res = await bankCall({ action: 'connect', restaurant_id: rid, aspsp_name: name, country: 'DE', redirect_url: REDIRECT }, de)
      try { sessionStorage.setItem('nh-bank-rid', rid!) } catch { /* */ }
      location.href = res.url
    } catch (e) { toast(errMsg(e)); setBusy('') }
  }
  async function saveChoose() {
    if (!choose) return
    setBusy('choose')
    try {
      const res = await bankCall({ action: 'select_accounts', link_id: choose.link.id, uids: [...choose.on] }, de)
      toast(res.sync_error || (de ? 'Gespeichert' : 'Đã lưu'))
      setChoose(null)
    } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }
  async function remove(l: Link) {
    if (!confirm(de ? `Verbindung zu ${l.aspsp_name} trennen? Bereits geladene Umsätze bleiben gespeichert.` : `Ngắt kết nối ${l.aspsp_name}? Giao dịch đã lấy về vẫn được giữ.`)) return
    setBusy('remove')
    try { await bankCall({ action: 'remove', link_id: l.id }, de) } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }

  const off = new Set(accs.filter((a) => !a.enabled && !accs.some((b) => b.enabled && b.iban === a.iban)).map((a) => a.iban))
  const shown = txs.filter((t) => !off.has(t.iban) && (!iban || t.iban === iban) && (!q || `${t.counterparty} ${t.purpose} ${t.counterparty_iban}`.toLowerCase().includes(q.toLowerCase())))
  const inSum = r2(shown.filter((t) => t.amount > 0).reduce((a, t) => a + Number(t.amount), 0))
  const outSum = r2(shown.filter((t) => t.amount < 0).reduce((a, t) => a + Number(t.amount), 0))
  const ibans = [...new Set([...accs.filter((a) => a.enabled).map((a) => a.iban), ...txs.map((t) => t.iban)].filter((x) => x && !off.has(x)))] as string[]
  const filteredBanks = (pick?.list || []).filter((a) => !pick?.q || a.name.toLowerCase().includes(pick.q.toLowerCase()))

  return (
    <>
      <Top title={de ? 'Bankkonto' : 'Ngân hàng'} sub={r.name} back={`/r/${rid}`} />
      <div className="page">
        {links === undefined || app === undefined ? <Spinner /> : <>
          {owner && !ready && <div className="card">
            <h3 style={{ marginTop: 0 }}>{de ? 'Einmalig einrichten' : 'Cài đặt một lần'}</h3>
            <ol className="small" style={{ paddingLeft: 18, margin: '0 0 10px' }}>
              {de ? <>
                <li>Auf <a href="https://enablebanking.com/sign-in/" target="_blank" rel="noreferrer">enablebanking.com</a> kostenlos anmelden → „API applications“ → neue App, Umgebung <b>Production</b>, Redirect-URL <code>{REDIRECT}</code>.</li>
                <li>Der Browser lädt eine Datei <code>&lt;Application-ID&gt;.pem</code> herunter.</li>
                <li>In der App-Liste „Activate by linking accounts“ klicken und die Konten bei der Bank verknüpfen (kostenlos für eigene Konten).</li>
                <li>Hier „Einrichten“ drücken und die .pem-Datei hineinziehen.</li>
              </> : <>
                <li>Đăng ký miễn phí ở <a href="https://enablebanking.com/sign-in/" target="_blank" rel="noreferrer">enablebanking.com</a> → „API applications“ → tạo ứng dụng mới, môi trường <b>Production</b>, Redirect URL <code>{REDIRECT}</code>.</li>
                <li>Trình duyệt tự tải về file <code>&lt;Application-ID&gt;.pem</code>.</li>
                <li>Trong danh sách ứng dụng bấm „Activate by linking accounts“ và nối các tài khoản ngân hàng (miễn phí cho tài khoản của chính mình).</li>
                <li>Bấm „Cài đặt“ dưới đây và kéo thả file .pem vào.</li>
              </>}
            </ol>
            <button className="primary" onClick={() => setSetup({ app_id: app?.app_id || '', pem: '', file: '' })}>{de ? 'Einrichten' : 'Cài đặt'}</button>
          </div>}
          {!owner && !links.length && <div className="card small muted">{de ? 'Noch kein Bankkonto verbunden. Nur der Inhaber kann ein Konto verbinden.' : 'Chưa kết nối tài khoản ngân hàng. Chỉ chủ mới kết nối được.'}</div>}

          {links.map((l) => {
            const left = daysLeft(l.valid_until)
            const all = accs.filter((a) => a.link_id === l.id)
            const la = all.filter((a) => a.enabled)
            return (
              <div className="card" key={l.id}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t"><b>{l.aspsp_name}</b></div>
                    <div className="small muted">
                      {l.status === 'active' ? (de ? '✓ Verbunden' : '✓ Đã kết nối') : l.status === 'pending' ? (de ? 'Wartet auf Bestätigung bei der Bank' : 'Đang chờ xác nhận ở ngân hàng') : (de ? 'Abgelaufen' : 'Đã hết hạn')}
                      {l.status === 'active' && left != null && <> · {de ? `gültig bis ${dmy(l.valid_until!.slice(0, 10))}` : `hiệu lực đến ${dmy(l.valid_until!.slice(0, 10))}`}</>}
                    </div>
                    {l.status === 'active' && <div className="small muted">{de ? 'Zuletzt abgerufen' : 'Lấy lần cuối'}: {fmtTs(l.last_sync_at, de)}{de ? ' · täglich automatisch' : ' · tự động mỗi sáng'}</div>}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {la.length > 0 && <button className="ghost small" onClick={() => setShowBal(!showBal)} aria-label={showBal ? (de ? 'Ausblenden' : 'Ẩn') : (de ? 'Anzeigen' : 'Hiện')} title={showBal ? (de ? 'Ausblenden' : 'Ẩn') : (de ? 'Anzeigen' : 'Hiện')}><Eye open={showBal} /></button>}
                    {l.status === 'active' && <button className="ghost small" disabled={!!busy} onClick={() => sync()} title={de ? 'Aktualisieren' : 'Tải lại'}>{busy === 'sync' ? '…' : '↻'}</button>}
                  </div>
                </div>
                {l.status === 'active' && left != null && left <= 14 && <div className="alert warn small">{de ? `Die Zustimmung läuft in ${Math.max(0, left)} Tagen ab.` : `Quyền đọc còn ${Math.max(0, left)} ngày.`} {owner && <button className="small" style={{ marginLeft: 6 }} disabled={!!busy} onClick={() => connect(l.aspsp_name)}>{de ? 'Erneut bestätigen' : 'Xác nhận lại'}</button>}</div>}
                {l.status === 'expired' && <div className="alert warn small">{de ? 'Die Bank verlangt eine neue Bestätigung (alle 90–180 Tage, per SecureGo plus).' : 'Ngân hàng cần xác nhận lại (90–180 ngày một lần, bằng SecureGo plus).'} {owner && <button className="small" style={{ marginLeft: 6 }} disabled={!!busy} onClick={() => connect(l.aspsp_name)}>{de ? 'Erneut bestätigen' : 'Xác nhận lại'}</button>}</div>}
                {l.last_error && l.status !== 'expired' && <div className="alert err small">{fmtTs(l.last_error_at, de)}: {l.last_error}</div>}
                {la.map((a) => (
                  <div key={a.uid} className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div><b>{a.name || (de ? 'Konto' : 'Tài khoản')}</b></div>
                      {a.iban && <div className="small muted">{fmtIban(a.iban)}</div>}
                    </div>
                    <div className="right">
                      <div className="num" style={{ fontSize: '1.25rem', filter: showBal ? undefined : 'blur(8px)', userSelect: showBal ? undefined : 'none', transition: 'filter .2s', cursor: 'pointer' }}
                        onClick={() => setShowBal(!showBal)} aria-hidden={!showBal}><b>{a.balance != null ? eur(Number(a.balance)) : '—'}</b></div>
                      <div className="small muted">{a.balance_type && ['ITAV', 'CLAV', 'XPCD'].includes(a.balance_type) ? (de ? 'verfügbar' : 'khả dụng') : (de ? 'Kontostand' : 'số dư sổ sách')}</div>
                    </div>
                  </div>
                ))}
                {l.status === 'active' && all.length > 0 && !la.length && <div className="small muted" style={{ marginTop: 8 }}>{de ? `${all.length} Konten gefunden – bitte wählen, welche zu diesem Restaurant gehören.` : `Tìm thấy ${all.length} tài khoản – hãy chọn tài khoản nào thuộc quán này.`}</div>}
                {l.status === 'active' && !all.length && <div className="small muted" style={{ marginTop: 8 }}>{de ? 'Keine Konten freigegeben. Bei Enable Banking müssen die Konten zuerst mit „Activate by linking accounts“ verknüpft sein.' : 'Ngân hàng không trả về tài khoản nào. Trên Enable Banking cần nối tài khoản trước bằng „Activate by linking accounts“.'}</div>}
                {owner && <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>{all.length > 1 && <button className="small" disabled={!!busy} onClick={() => setChoose({ link: l, on: new Set(la.map((a) => a.uid)) })}>{de ? `Konten wählen (${la.length}/${all.length})` : `Chọn tài khoản (${la.length}/${all.length})`}</button>}<button className="ghost small" disabled={!!busy} onClick={() => remove(l)}>{de ? 'Verbindung trennen' : 'Ngắt kết nối'}</button></div>}
              </div>
            )
          })}

          {owner && ready && <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="primary" disabled={!!busy} onClick={openPick}>{busy === 'connect' ? '…' : (links.length ? (de ? '+ Weitere Bank verbinden' : '+ Kết nối thêm ngân hàng') : (de ? 'Bankkonto verbinden' : 'Kết nối tài khoản ngân hàng'))}</button>
            <button className="ghost" onClick={() => setSetup({ app_id: app?.app_id || '', pem: '', file: '' })}>{de ? 'Enable Banking Einstellungen' : 'Cài đặt Enable Banking'}</button>
          </div>}

          {(txs.length > 0 || accs.some((a) => a.enabled)) && <>
            <MonthBar value={period} onChange={setPeriod} />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {ibans.length > 1 && <select value={iban} onChange={(e) => setIban(e.target.value)} style={{ width: 'auto' }}>
                <option value="">{de ? 'Alle Konten' : 'Tất cả tài khoản'}</option>
                {ibans.map((x) => <option key={x} value={x}>{fmtIban(x)}</option>)}
              </select>}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={de ? 'Suchen (Name, Verwendungszweck)' : 'Tìm (tên, nội dung)'} style={{ flex: 1, minWidth: 160 }} />
            </div>
            <div className="row small" style={{ gap: 16, marginBottom: 8 }}>
              <span>{de ? 'Eingänge' : 'Tiền vào'}: <b className="num" style={{ color: 'var(--ok, #16a34a)' }}>{eur(inSum)}</b></span>
              <span>{de ? 'Ausgänge' : 'Tiền ra'}: <b className="num" style={{ color: 'var(--err, #dc2626)' }}>{eur(outSum)}</b></span>
            </div>
            <div className="tbl-wrap">
              <table className="kb">
                <thead><tr>
                  <th>{de ? 'Datum' : 'Ngày'}</th>
                  <th>{de ? 'Empfänger / Auftraggeber · Verwendungszweck' : 'Người nhận / người gửi · Nội dung'}</th>
                  <th className="num">{de ? 'Betrag' : 'Số tiền'}</th>
                </tr></thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.booking_date ? dmy(t.booking_date) : '—'}{t.status === 'PDNG' ? <div className="small muted">{de ? 'vorgemerkt' : 'đang chờ'}</div> : null}</td>
                      <td style={{ minWidth: 200 }}>
                        <div><b>{t.counterparty || '—'}</b></div>
                        {t.purpose && <div className="small muted" style={{ wordBreak: 'break-word' }}>{t.purpose}</div>}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap', color: t.amount < 0 ? 'var(--err, #dc2626)' : 'var(--ok, #16a34a)' }}>{t.amount > 0 ? '+' : ''}{eur(Number(t.amount))}</td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={3} className="muted">{de ? 'Keine Umsätze in diesem Monat' : 'Tháng này chưa có giao dịch'}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="small muted">{de ? 'Nur Lesezugriff: aus der App können keine Überweisungen ausgeführt werden.' : 'Chỉ đọc: app không chuyển tiền đi được.'}</div>
          </>}
        </>}
      </div>

      <Sheet open={!!setup} onClose={() => setSetup(null)} title={de ? 'Enable Banking einrichten' : 'Cài đặt Enable Banking'}>
        {setup && <>
          <div className="small muted" style={{ marginBottom: 10 }}>{de
            ? 'Application ID und die .pem-Datei stammen aus dem Enable Banking Control Panel („API applications“). Die Datei nur hier hochladen, nicht per Chat oder E-Mail weitergeben.'
            : 'Application ID và file .pem lấy từ Enable Banking Control Panel („API applications“). Chỉ tải file vào đây, đừng gửi qua chat hay email.'}</div>
          <label className={`btn block drop${busy ? ' disabled' : ''}`} style={{ textAlign: 'center', marginBottom: 10 }} {...dropProps((fl) => readPem(fl), !!busy)}>
            {setup.file ? `✓ ${setup.file}` : app?.has_key ? (de ? '•••• Schlüssel gespeichert – neue .pem-Datei wählen' : '•••• đã lưu khoá – chọn file .pem mới') : (de ? '⬆ .pem-Datei wählen' : '⬆ Chọn file .pem')}
            <span className="drop-hint">{de ? 'oder hierher ziehen' : 'hoặc kéo thả vào đây'}</span>
            <input type="file" accept=".pem,.key,application/x-pem-file,text/plain" hidden onChange={(e) => { readPem(e.target.files); e.target.value = '' }} />
          </label>
          <label className="f"><span>Application ID</span><input value={setup.app_id} autoComplete="off" spellCheck={false} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(e) => setSetup({ ...setup, app_id: e.target.value })} /></label>
          <div className="small muted" style={{ margin: '-4px 0 10px' }}>{de ? 'Der Schlüssel wird nur auf dem Server gespeichert und nie wieder angezeigt.' : 'Khoá chỉ cất trên máy chủ, app không bao giờ hiện lại.'}</div>
          <button className="primary block" disabled={!!busy} onClick={saveSetup}>{busy === 'setup' ? '…' : (de ? 'Prüfen und speichern' : 'Kiểm tra và lưu')}</button>
        </>}
      </Sheet>

      <Sheet open={!!choose} onClose={() => setChoose(null)} title={de ? 'Konten für dieses Restaurant' : 'Tài khoản của quán này'}>
        {choose && <>
          <div className="small muted" style={{ marginBottom: 10 }}>{de ? `Nur die markierten Konten werden bei ${r.name} angezeigt und abgerufen.` : `Chỉ tài khoản được tích mới hiện và được lấy số ở ${r.name}.`}</div>
          {accs.filter((a) => a.link_id === choose.link.id).map((a) => (
            <label key={a.uid} className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={choose.on.has(a.uid)} onChange={(e) => { const on = new Set(choose.on); if (e.target.checked) on.add(a.uid); else on.delete(a.uid); setChoose({ ...choose, on }) }} />
              <span><b>{fmtIban(a.iban) || a.uid}</b>{a.name ? <span className="small muted"> · {a.name}</span> : null}</span>
            </label>
          ))}
          <button className="primary block" disabled={!!busy} onClick={saveChoose}>{busy === 'choose' ? '…' : (de ? 'Speichern' : 'Lưu')}</button>
        </>}
      </Sheet>

      <Sheet open={!!pick} onClose={() => setPick(null)} title={de ? 'Bank wählen' : 'Chọn ngân hàng'}>
        {pick && <>
          <input value={pick.q} onChange={(e) => setPick({ ...pick, q: e.target.value })} placeholder={de ? 'Bank suchen' : 'Tìm ngân hàng'} autoFocus style={{ marginBottom: 8 }} />
          {pick.err && <div className="alert err small">{pick.err}</div>}
          {!pick.list ? <Spinner /> : <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {filteredBanks.slice(0, 80).map((a) => (
              <button key={a.name} className="block ghost" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }} disabled={!!busy} onClick={() => connect(a.name)}>
                {a.logo ? <img src={a.logo} alt="" width={28} height={28} style={{ objectFit: 'contain' }} /> : <span style={{ width: 28 }} />}
                <span style={{ flex: 1 }}>{a.name}{a.beta ? <span className="tag" style={{ marginLeft: 6 }}>beta</span> : null}</span>
                {a.max_days ? <span className="small muted">{a.max_days} {de ? 'Tage' : 'ngày'}</span> : null}
              </button>
            ))}
            {!filteredBanks.length && <div className="small muted">{de ? 'Keine Bank gefunden' : 'Không tìm thấy ngân hàng'}</div>}
          </div>}
          <div className="small muted" style={{ marginTop: 8 }}>{de ? 'Sie werden zur Bank weitergeleitet und bestätigen dort (z. B. mit SecureGo plus). Die App sieht Ihre PIN nie.' : 'Anh sẽ được chuyển sang trang ngân hàng để đăng nhập và xác nhận (vd. SecureGo plus). App không bao giờ thấy PIN.'}</div>
        </>}
      </Sheet>
    </>
  )
}

/** Ngân hàng chuyển về đây sau khi chủ xác nhận: đổi mã lấy quyền đọc, lấy số dư + giao dịch, rồi về trang Ngân hàng của quán */
export function BankCallback() {
  const loc = useLocation()
  const nav = useNavigate()
  const { lang } = useLang()
  const de = lang === 'de'
  const [err, setErr] = useState('')
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const p = new URLSearchParams(loc.search)
    let back = ''
    try { back = sessionStorage.getItem('nh-bank-rid') || '' } catch { /* */ }
    ;(async () => {
      try {
        const res = await bankCall({ action: 'callback', code: p.get('code'), state: p.get('state'), error: p.get('error'), error_description: p.get('error_description') }, de)
        toast(res.accounts > 1 && !res.enabled ? (de ? `Verbunden · ${res.accounts} Konten gefunden – bitte wählen` : `Đã kết nối · tìm thấy ${res.accounts} tài khoản – hãy chọn tài khoản của quán`) : (de ? `Verbunden · ${res.enabled ?? res.accounts} Konto/Konten` : `Đã kết nối · ${res.enabled ?? res.accounts} tài khoản`))
        if (res.sync_error) toast(res.sync_error)
        nav(`/r/${res.restaurant_id}/bank`, { replace: true })
      } catch (e) {
        const rid = ((e as { data?: { restaurant_id?: string } }).data?.restaurant_id) || back
        toast(errMsg(e))
        if (rid) nav(`/r/${rid}/bank`, { replace: true }); else setErr(errMsg(e))
      }
    })()
  }, [loc.search, nav, de])
  return <div className="center"><div className="card">{err ? <><p>{err}</p><button onClick={() => nav('/', { replace: true })}>OK</button></> : <><Spinner /><p className="small muted">{de ? 'Verbindung wird eingerichtet…' : 'Đang hoàn tất kết nối…'}</p></>}</div></div>
}
