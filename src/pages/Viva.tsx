// Trang Viva Wallet của quán: kết nối API (chủ nhập Merchant ID + API Key), lấy tiền thẻ từng ngày,
// đối chiếu với Kreditzahlung theo Z-Bon. Số lấy về tự điền vào ô Viva Wallet trong Kassenbuch.
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, errMsg, type CashMove, type ZBon } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { daysOfMonth, dmy, eur, monthRange, r2, thisMonth, todayIso } from '../lib/format'
import { Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'

export interface VivaAccount {
  restaurant_id: string; merchant_id: string; has_key: boolean; source_codes: string | null; terminal_ids: string | null
  cutoff_hour: number; auto_sync: boolean; demo: boolean; last_sync_at: string | null; last_error: string | null; last_error_at: string | null
  webhook_token?: string; wallets?: Wallet[] | null; wallets_at?: string | null; last_hook_at?: string | null
}
interface Wallet { id: string; name: string; iban: string; primary: boolean; amount: number; available: number; overdraft: number; currency: string }
interface VivaDay { day: string; amount: number; tip: number; refunds: number; n_tx: number }

const ERR: Record<string, [string, string]> = {
  forbidden: ['Không có quyền', 'Keine Berechtigung'],
  invalid_merchant: ['Merchant ID không hợp lệ', 'Merchant ID ungültig'],
  not_connected: ['Chưa kết nối Viva Wallet', 'Viva Wallet nicht verbunden'],
  no_key: ['Chưa lưu API Key', 'Kein API-Schlüssel gespeichert'],
  viva_auth: ['Viva từ chối: Merchant ID hoặc API Key sai', 'Viva lehnt ab: Merchant ID oder API-Schlüssel falsch'],
  invalid_range: ['Khoảng ngày không hợp lệ (tối đa 62 ngày)', 'Ungültiger Zeitraum (max. 62 Tage)'],
}

async function vivaCall(body: Record<string, unknown>, de: boolean) {
  const { data, error } = await supabase.functions.invoke('nh-viva', { body })
  if (error) {
    let code = error.message, message = ''
    try { const j = await (error as { context?: Response }).context?.json(); code = j?.error || code; message = j?.message || '' } catch { /* */ }
    throw new Error(ERR[code]?.[de ? 1 : 0] || message || code)
  }
  return data
}

const fmtTs = (s: string | null, de: boolean) => s ? new Date(s).toLocaleString(de ? 'de-DE' : 'vi-VN', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export default function Viva() {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { profile, reload } = useApp()
  const owner = profile.is_owner
  const { lang } = useLang()
  const de = lang === 'de'
  const [period, setPeriod] = useState(thisMonth())
  const [acc, setAcc] = useState<VivaAccount | null | undefined>(undefined)
  const [days, setDays] = useState<Record<string, VivaDay>>({})
  const [zcard, setZcard] = useState<Record<string, number>>({})
  const [kb, setKb] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState('')
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [walletErr, setWalletErr] = useState('')
  // Số dư mặc định che mờ, bấm con mắt để xem (không nhớ lại, mở trang lần sau lại mờ)
  const [showBal, setShowBal] = useState(false)
  const [edit, setEdit] = useState<{ merchant_id: string; api_key: string; source_codes: string; terminal_ids: string; cutoff_hour: number; auto_sync: boolean } | null>(null)

  const load = useCallback(async () => {
    const { from, to } = monthRange(period)
    const [a, d, z, m] = await Promise.all([
      supabase.from('nh_viva_accounts').select('*').eq('restaurant_id', rid!).maybeSingle(),
      supabase.from('nh_viva_days').select('*').eq('restaurant_id', rid!).gte('day', from).lte('day', to),
      supabase.from('nh_zbons').select('z_date, total, cash_revenue').eq('restaurant_id', rid!).gte('z_date', from).lte('z_date', to),
      supabase.from('nh_cash_moves').select('move_date, amount').eq('restaurant_id', rid!).eq('channel', 'viva').gte('move_date', from).lte('move_date', to),
    ])
    setAcc((a.data as VivaAccount) || null)
    const dd: Record<string, VivaDay> = {}
    for (const x of (d.data || []) as VivaDay[]) dd[x.day] = x
    const zz: Record<string, number> = {}
    for (const x of (z.data || []) as Pick<ZBon, 'z_date' | 'total' | 'cash_revenue'>[]) zz[x.z_date] = r2((zz[x.z_date] || 0) + Number(x.total) - Number(x.cash_revenue))
    const kk: Record<string, number> = {}
    for (const x of (m.data || []) as Pick<CashMove, 'move_date' | 'amount'>[]) kk[x.move_date] = r2((kk[x.move_date] || 0) + Number(x.amount))
    setDays(dd); setZcard(zz); setKb(kk)
  }, [rid, period])
  useEffect(() => { if (r) load() }, [r, load])
  // Guthaben: hỏi Viva mỗi lần mở trang (khi đã có khoá)
  const loadWallets = useCallback(async () => {
    setWalletErr('')
    try { const res = await vivaCall({ action: 'wallets', restaurant_id: rid }, lang === 'de'); setWallets(res.wallets || []) }
    catch (e) { setWalletErr(errMsg(e)) }
  }, [rid, lang])
  const hasKey = !!acc?.has_key
  useEffect(() => { if (hasKey) loadWallets() }, [hasKey, loadWallets])

  if (!r || !canManage(role)) return null
  const connected = !!acc?.has_key

  async function sync() {
    const { from } = monthRange(period)
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
    const end = monthRange(period).to < yesterday ? monthRange(period).to : yesterday
    if (end < from) { toast(de ? 'Noch keine abgeschlossenen Tage in diesem Monat' : 'Tháng này chưa có ngày nào kết thúc'); return }
    setBusy('sync')
    try {
      const res = await vivaCall({ action: 'sync', restaurant_id: rid, from, to: end }, de)
      toast(de ? `${res.days} Tage mit Umsatz · ${eur(res.total)} · ${res.written} ins Kassenbuch` : `${res.days} ngày có tiền · ${eur(res.total)} · ${res.written} ngày ghi vào Kassenbuch`)
      if (res.skippedLocked) toast(de ? `${res.skippedLocked} Tage in abgeschlossenem Monat nicht geändert` : `${res.skippedLocked} ngày thuộc tháng đã khoá sổ, không đổi`)
    } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }
  async function test() {
    setBusy('test')
    try {
      const res = await vivaCall({ action: 'test', restaurant_id: rid }, de)
      toast(de ? `Verbindung OK · ${dmy(res.day)}: ${res.n} Zahlungen, ${eur(res.amount)}` : `Kết nối được · ${dmy(res.day)}: ${res.n} giao dịch, ${eur(res.amount)}`)
    } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }
  async function save() {
    if (!edit) return
    if (!edit.merchant_id.trim()) { toast('Merchant ID'); return }
    if (!acc?.has_key && !edit.api_key.trim()) { toast(de ? 'API-Schlüssel fehlt' : 'Thiếu API Key'); return }
    setBusy('save')
    try {
      await vivaCall({ action: 'save', restaurant_id: rid, ...edit }, de)
      toast(de ? 'Gespeichert' : 'Đã lưu'); setEdit(null)
    } catch (e) { toast(errMsg(e)); setBusy(''); load(); return }
    setBusy('')
    // Lưu khoá mới xong: lấy luôn số từng ngày của tháng đang xem
    if (edit.api_key.trim()) await sync(); else load()
  }
  async function remove() {
    if (!confirm(de ? 'Verbindung zu Viva Wallet trennen? Der API-Schlüssel wird gelöscht. Bereits übernommene Beträge bleiben im Kassenbuch.' : 'Ngắt kết nối Viva Wallet? API Key sẽ bị xoá. Số đã ghi vào Kassenbuch vẫn giữ.')) return
    setBusy('save')
    try { await vivaCall({ action: 'remove', restaurant_id: rid }, de); setEdit(null) } catch (e) { toast(errMsg(e)) }
    setBusy(''); load()
  }
  async function useViva() {
    const { error } = await supabase.from('nh_restaurants').update({ card_source: 'viva' }).eq('id', rid!)
    if (error) toast(errMsg(error)); else { await reload(); toast(de ? 'Kassenbuch rechnet jetzt lt. Viva Wallet' : 'Kassenbuch giờ tính theo Viva Wallet') }
  }
  const openEdit = () => setEdit({ merchant_id: acc?.merchant_id || '', api_key: '', source_codes: acc?.source_codes || '', terminal_ids: acc?.terminal_ids || '', cutoff_hour: acc?.cutoff_hour ?? 4, auto_sync: acc?.auto_sync ?? true })

  const today = todayIso()
  const list = daysOfMonth(period).filter((d) => d < today && (!r.opening_date || d >= r.opening_date))
  const sum = (f: (d: string) => number | undefined) => r2(list.reduce((a, d) => a + (f(d) || 0), 0))
  const anyTip = list.some((d) => (days[d]?.tip || 0) > 0)

  return (
    <>
      <Top title="Viva Wallet" sub={r.name} back={`/r/${rid}`} />
      <div className="page">
        {acc === undefined ? <Spinner /> : <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div className="t"><b>{connected ? (de ? '✓ Verbunden' : '✓ Đã kết nối') : (de ? 'Nicht verbunden' : 'Chưa kết nối')}</b></div>
                {acc && <div className="small muted">Merchant ID {acc.merchant_id}{acc.source_codes ? ` · Source ${acc.source_codes}` : ''}{acc.terminal_ids ? ` · Terminal ${acc.terminal_ids}` : ''}</div>}
                {connected && <div className="small muted">{de ? 'Zuletzt abgerufen' : 'Lấy lần cuối'}: {fmtTs(acc!.last_sync_at, de)}{acc!.auto_sync ? (de ? ' · täglich automatisch' : ' · tự động mỗi sáng') : ''}</div>}
              </div>
              {owner && <button onClick={openEdit}>{acc ? (de ? 'Einstellungen' : 'Cài đặt') : (de ? 'Verbinden' : 'Kết nối')}</button>}
            </div>
            {acc?.last_error && <div className="alert err small">{fmtTs(acc.last_error_at, de)}: {acc.last_error}</div>}
            {!acc && <div className="small muted" style={{ marginTop: 8 }}>{owner
              ? (de ? 'Merchant ID und API-Schlüssel finden Sie im Viva-Konto unter Einstellungen → API-Zugang. Den Schlüssel nur hier eintragen, nicht per Chat oder E-Mail weitergeben.' : 'Merchant ID và API Key nằm trong tài khoản Viva, mục Einstellungen → API-Zugang (Settings → API Access). Chỉ dán khoá vào đây, đừng gửi qua chat hay email.')
              : (de ? 'Nur der Inhaber kann Viva Wallet verbinden.' : 'Chỉ chủ mới kết nối được Viva Wallet.')}</div>}
            {connected && <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="primary" disabled={!!busy} onClick={sync}>{busy === 'sync' ? '…' : (de ? 'Monat jetzt abrufen' : 'Lấy số tháng này')}</button>
              <button disabled={!!busy} onClick={test}>{busy === 'test' ? '…' : (de ? 'Verbindung testen' : 'Thử kết nối')}</button>
            </div>}
          </div>

          {connected && r.card_source !== 'viva' && <div className="alert warn small">
            {de ? 'Das Kassenbuch rechnet die Kartenzahlung gerade lt. Z-Bon: Viva-Beträge werden gespeichert, aber nicht verwendet.' : 'Kassenbuch đang tính Kartenzahlung theo Z-Bon: số Viva vẫn được lưu nhưng chưa dùng.'}
            {owner && <> <button className="small" style={{ marginLeft: 6 }} onClick={useViva}>{de ? 'lt. Viva Wallet rechnen' : 'Chuyển sang theo Viva Wallet'}</button></>}
          </div>}

          {connected && <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{de ? 'Verfügbares Guthaben' : 'Số dư khả dụng'}</h3>
              <div className="row" style={{ gap: 4 }}>
                <button className="ghost small" onClick={() => setShowBal(!showBal)} aria-label={showBal ? (de ? 'Ausblenden' : 'Ẩn') : (de ? 'Anzeigen' : 'Hiện')} title={showBal ? (de ? 'Ausblenden' : 'Ẩn') : (de ? 'Anzeigen' : 'Hiện')}>
                  <svg className="lu" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {showBal
                      ? <><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>
                      : <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>}
                  </svg>
                </button>
                <button className="ghost small" onClick={loadWallets} title={de ? 'Aktualisieren' : 'Tải lại'}>↻</button>
              </div>
            </div>
            {walletErr ? <div className="alert err small">{walletErr}</div>
              : !wallets ? <div className="small muted">…</div>
              : !wallets.length ? <div className="small muted">{de ? 'Kein Wallet gefunden' : 'Không thấy ví nào'}</div>
              : wallets.map((w) => (
                <div key={w.id} className="row" style={{ justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div><b>{w.name || 'Wallet'}</b>{w.primary ? <span className="tag" style={{ marginLeft: 6 }}>{de ? 'Haupt' : 'Chính'}</span> : null}</div>
                    {w.iban && <div className="small muted">{w.iban}</div>}
                  </div>
                  <div className="right">
                    <div className="num" style={{ fontSize: '1.25rem', filter: showBal ? undefined : 'blur(8px)', userSelect: showBal ? undefined : 'none', transition: 'filter .2s', cursor: 'pointer' }}
                      onClick={() => setShowBal(!showBal)} aria-hidden={!showBal}><b>{eur(w.available)}</b></div>
                  </div>
                </div>
              ))}
          </div>}

          <MonthBar value={period} onChange={setPeriod} />
          <div className="tbl-wrap">
            <table className="kb">
              <thead><tr>
                <th>{de ? 'Datum' : 'Ngày'}</th>
                <th className="num">Viva</th>
                {anyTip && <th className="num">{de ? 'davon Trinkgeld' : 'trong đó Trinkgeld'}</th>}
                <th className="num">{de ? 'Kreditzahlung Z-Bon' : 'Thẻ theo Z-Bon'}</th>
                <th className="num">{de ? 'Differenz' : 'Chênh lệch'}</th>
                <th className="num">Kassenbuch</th>
              </tr></thead>
              <tbody>
                {list.map((d) => {
                  const v = days[d], z = zcard[d], k = kb[d]
                  const diff = v && v.n_tx > 0 && z != null ? r2(v.amount - z) : null
                  return (
                    <tr key={d}>
                      <td>{dmy(d)}</td>
                      <td className="num">{v ? (v.n_tx ? <span title={`${v.n_tx} ${de ? 'Zahlungen' : 'giao dịch'}${v.refunds ? ` · ${de ? 'Erstattung' : 'hoàn'} ${eur(v.refunds)}` : ''}`}>{eur(v.amount)}</span> : <span className="muted">0</span>) : <span className="muted">—</span>}</td>
                      {anyTip && <td className="num">{v?.tip ? eur(v.tip) : ''}</td>}
                      <td className="num">{z != null ? eur(z) : <span className="muted">—</span>}</td>
                      <td className="num">{diff != null ? eur(diff) : ''}</td>
                      <td className="num">{k != null ? <span className={v && v.n_tx && r2(v.amount) !== k ? 'warn' : ''} title={v && v.n_tx && r2(v.amount) !== k ? (de ? 'Weicht vom Viva-Betrag ab' : 'Khác số Viva') : ''}>{eur(k)}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  )
                })}
                {!list.length && <tr><td colSpan={6} className="muted">{de ? 'Keine Tage' : 'Chưa có ngày nào'}</td></tr>}
              </tbody>
              {list.length > 0 && <tfoot><tr>
                <th>{de ? 'Summe' : 'Tổng'}</th>
                <th className="num">{eur(sum((d) => days[d]?.amount))}</th>
                {anyTip && <th className="num">{eur(sum((d) => days[d]?.tip))}</th>}
                <th className="num">{eur(sum((d) => zcard[d]))}</th>
                <th className="num">{eur(r2(list.reduce((a, d) => a + (days[d]?.n_tx && zcard[d] != null ? days[d].amount - zcard[d] : 0), 0)))}</th>
                <th className="num">{eur(sum((d) => kb[d]))}</th>
              </tr></tfoot>}
            </table>
          </div>
          <div className="small muted">
            {de ? 'Differenz = Viva − Kreditzahlung lt. Z-Bon (meist Trinkgeld). Beträge aus der API werden automatisch als Kartenzahlung ins Kassenbuch übernommen (nicht in abgeschlossenen Monaten). Korrekturen: ' : 'Chênh lệch = Viva − thẻ theo Z-Bon (thường là Trinkgeld). Số lấy từ API tự ghi vào ô Viva Wallet của Kassenbuch (trừ tháng đã khoá sổ). Muốn sửa tay: '}
            <Link to={`/r/${rid}/kb`}>Kassenbuch → − Viva Wallet</Link>
          </div>
        </>}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={de ? 'Viva Wallet verbinden' : 'Kết nối Viva Wallet'}>
        {edit && <>
          <div className="small muted" style={{ marginBottom: 10 }}>{de
            ? 'Viva-Konto → Einstellungen → API-Zugang: dort stehen Merchant ID und API-Schlüssel. Jedes Restaurant mit eigenem Viva-Konto braucht eigene Zugangsdaten.'
            : 'Tài khoản Viva → Einstellungen → API-Zugang: ở đó có Merchant ID và API Key. Mỗi quán có tài khoản Viva riêng thì cần bộ khoá riêng.'}</div>
          <label className="f"><span>Merchant ID</span><input value={edit.merchant_id} autoComplete="off" spellCheck={false} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(e) => setEdit({ ...edit, merchant_id: e.target.value })} /></label>
          <label className="f"><span>{de ? 'API-Schlüssel' : 'API Key'}</span><input type="password" value={edit.api_key} autoComplete="new-password" spellCheck={false}
            placeholder={acc?.has_key ? (de ? '•••••• gespeichert (leer lassen = behalten)' : '•••••• đã lưu (để trống = giữ nguyên)') : ''} onChange={(e) => setEdit({ ...edit, api_key: e.target.value })} /></label>
          <div className="small muted" style={{ margin: '-4px 0 10px' }}>{de ? 'Der Schlüssel wird verschlüsselt gespeichert und in der App nie wieder angezeigt.' : 'Khoá được cất riêng trên máy chủ, app không bao giờ hiện lại.'}</div>
          <details style={{ marginBottom: 10 }}>
            <summary className="small">{de ? 'Erweitert (ein Viva-Konto für mehrere Restaurants)' : 'Nâng cao (một tài khoản Viva cho nhiều quán)'}</summary>
            <label className="f"><span>Source Code</span><input value={edit.source_codes} placeholder={de ? 'leer = alle' : 'trống = tất cả'} onChange={(e) => setEdit({ ...edit, source_codes: e.target.value })} /></label>
            <label className="f"><span>Terminal-ID</span><input value={edit.terminal_ids} placeholder={de ? 'leer = alle, mehrere mit Komma' : 'trống = tất cả, nhiều máy cách nhau dấu phẩy'} onChange={(e) => setEdit({ ...edit, terminal_ids: e.target.value })} /></label>
            <label className="f"><span>{de ? 'Tageswechsel (Zahlungen davor zählen zum Vortag)' : 'Giờ chốt ngày (giao dịch trước giờ này tính vào hôm trước)'}</span>
              <select value={edit.cutoff_hour} onChange={(e) => setEdit({ ...edit, cutoff_hour: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select></label>
          </details>
          <label className="row" style={{ gap: 8, marginBottom: 12 }}><input type="checkbox" checked={edit.auto_sync} onChange={(e) => setEdit({ ...edit, auto_sync: e.target.checked })} style={{ width: 'auto' }} />
            <span>{de ? 'Jeden Morgen automatisch abrufen (letzte 3 Tage)' : 'Tự lấy mỗi sáng (3 ngày gần nhất)'}</span></label>
          <button className="primary block" disabled={!!busy} onClick={save}>{busy === 'save' ? '…' : (de ? 'Speichern' : 'Lưu')}</button>
          {acc && <button className="block" style={{ marginTop: 8 }} disabled={!!busy} onClick={remove}>{de ? 'Verbindung trennen' : 'Ngắt kết nối'}</button>}
        </>}
      </Sheet>
    </>
  )
}
