import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { canManage, useRole } from '../../lib/app'
import { toast } from '../../components/ui'
import {
  ACTIVE, addDays, busyTables, CHANNEL, deleteBooking, loadDays, loadLog, loadNotes, loadPlan, loadRules, loadSettings, noteKey, parseD,
  peakCheck, saveBooking, saveNote, setCalled, setStatus, setTables, staffSlots, tableNames, toMin, today,
  type Area, type BkSettings, type Booking, type LogRow, type PeakRule, type Status, type Table,
} from '../api'
import { BkShell, errText, LOCALE, MonthCal, SOURCE_LABEL, STATUS_LABEL, StatusPill, useL } from '../ui'
import { Plan } from '../Plan'

const monthOf = (d: string) => d.slice(0, 7)
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}` }

export interface BkData {
  settings: BkSettings; rules: PeakRule[]; areas: Area[]; tables: Table[]; notes: Record<string, string>
  bookings: Booking[]; reload: () => Promise<void>; ensureMonth: (m: string) => void
}

/** Tải dữ liệu đặt bàn của quán, tự cập nhật khi có đơn mới (Realtime) và mỗi phút */
export function useBkData(rid: string, day: string): BkData | null {
  const [base, setBase] = useState<Omit<BkData, 'bookings' | 'reload' | 'ensureMonth'> | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const months = useRef(new Set<string>())
  const L = useL()

  const loadMonths = useCallback(async (ms: string[]) => {
    const rows = await Promise.all(ms.map((m) => loadDays(rid, `${m}-01`, monthEnd(m))))
    setBookings((old) => [...old.filter((b) => !ms.includes(monthOf(b.day))), ...rows.flat()])
  }, [rid])
  const reload = useCallback(async () => {
    const [s, r, p, n] = await Promise.all([loadSettings(rid), loadRules(rid), loadPlan(rid), loadNotes(rid)])
    setBase({ settings: s, rules: r, areas: p.areas, tables: p.tables, notes: n })
    await loadMonths([...months.current])
  }, [rid, loadMonths])
  const ensureMonth = useCallback((m: string) => {
    if (months.current.has(m)) return
    months.current.add(m); loadMonths([m]).catch(() => {})
  }, [loadMonths])

  useEffect(() => {
    months.current = new Set([monthOf(day), monthOf(addDays(day, 14))])
    reload().catch((e) => toast(String(e.message || e)))
  }, [rid]) // eslint-disable-line
  useEffect(() => { ensureMonth(monthOf(day)) }, [day, ensureMonth])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const ch = supabase.channel(`bk-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nh_bk_bookings', filter: `restaurant_id=eq.${rid}` }, (pl) => {
        const n = pl.new as Partial<Booking> | undefined
        if (pl.eventType === 'INSERT' && n?.source === 'online') toast(`${L('Đặt bàn online mới', 'Neue Online-Reservierung')}: ${n.name} · ${n.party} P.`)
        clearTimeout(t); t = setTimeout(() => loadMonths([...months.current]).catch(() => {}), 400)
      }).subscribe()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') loadMonths([...months.current]).catch(() => {}) }, 60000)
    return () => { clearTimeout(t); clearInterval(iv); supabase.removeChannel(ch) }
  }, [rid, loadMonths]) // eslint-disable-line

  return base ? { ...base, bookings, reload, ensureMonth } : null
}

export function DateNav({ day, setDay, data }: { day: string; setDay: (d: string) => void; data: BkData }) {
  const L = useL()
  const [cal, setCal] = useState(false)
  const [calM, setCalM] = useState(monthOf(day))
  const isT = day === today()
  const pax = (d: string) => data.bookings.filter((b) => b.day === d && ACTIVE.includes(b.status)).reduce((n, b) => n + b.party, 0)
  return (
    <div className="bk-datenav">
      <div className="row">
        <button className="sm" onClick={() => setDay(addDays(day, -1))} aria-label="‹">‹</button>
        <button className={`bk-daybox${isT ? ' is-today' : ''}`} onClick={() => { setCalM(monthOf(day)); setCal(!cal) }}>
          {isT && <small>{L('Hôm nay', 'Heute')}</small>}
          <span>{parseD(day).toLocaleDateString(LOCALE[L.lang], { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
        </button>
        <button className="sm" onClick={() => setDay(addDays(day, 1))} aria-label="›">›</button>
        {!isT && <button className="sm ghost" onClick={() => setDay(today())}>{L('Hôm nay', 'Heute')}</button>}
      </div>
      {cal && (
        <div className="bk-pop">
          <MonthCal month={calM} value={day} onMonth={(m) => { setCalM(m); data.ensureMonth(m) }} onPick={(d) => { setDay(d); setCal(false) }} pax={pax} closed={(d) => data.settings.closed_days.includes(d.slice(5))} />
        </div>
      )}
    </div>
  )
}

export default function Bookings() {
  const { rid } = useParams()
  const L = useL()
  const role = useRole(rid)
  const mgr = canManage(role)
  const [sp, setSp] = useSearchParams()
  const day = sp.get('d') || today()
  const setDay = (d: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('d', d); return n }, { replace: true })
  const data = useBkData(rid!, day)
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [pick, setPick] = useState<Booking | null>(null)
  const [sure, setSure] = useState<string | null>(null)

  const dayRows = useMemo(() => (data?.bookings || []).filter((b) => b.day === day).sort((a, b) => a.slot.localeCompare(b.slot) || a.created_at.localeCompare(b.created_at)), [data, day])
  if (!data) return <BkShell><div className="center"><div className="spinner" /></div></BkShell>
  const { settings: st, tables } = data
  const act = dayRows.filter((b) => ACTIVE.includes(b.status))
  const pending = dayRows.filter((b) => b.status === 'pending').length
  const filters: ('all' | Status)[] = ['all', ...(st.auto_confirm && !pending ? [] : ['pending' as const]), 'confirmed', 'seated', 'noshow', ...(dayRows.some((b) => b.status === 'rejected') ? ['rejected' as const] : []), 'cancelled']
  const shown = filter === 'all' ? dayRows.filter((b) => b.status !== 'cancelled' && b.status !== 'rejected') : dayRows.filter((b) => b.status === filter)

  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { toast(errText(e, L)) } await data.reload() }

  // dải giờ cao điểm: khách theo từng giờ
  const hours = [...new Set(act.map((b) => Math.floor(toMin(b.slot) / 60)))].sort((a, b) => a - b)

  return (
    <BkShell>
      <div className="toolbar bk-top">
        <DateNav day={day} setDay={setDay} data={data} />
        <span className="grow" />
        <button className="primary" onClick={() => setEdit(newEdit(day))}>+ {L('Đặt bàn mới', 'Neue Reservierung')}</button>
      </div>
      {!st.online_enabled && (
        <div className="alert warn small">{L('Trang khách vẫn chạy trên hệ thống đặt bàn cũ. Đơn khách đặt online sẽ hiện ở đây sau khi chuyển dữ liệu.', 'Die Gästeseite läuft noch auf dem alten System. Online-Reservierungen erscheinen hier nach der Datenübernahme.')}</div>
      )}
      <div className="bk-stats">
        <div className="stat"><div className="l">{L('Số đơn', 'Reservierungen')}</div><div className="v">{act.length}</div></div>
        <div className="stat"><div className="l">{L('Số khách', 'Gäste')}</div><div className="v">{act.reduce((n, b) => n + b.party, 0)}</div></div>
        {(!st.auto_confirm || pending > 0) && <div className="stat"><div className="l">{L('Chờ duyệt', 'Anfragen')}</div><div className="v">{pending}</div></div>}
      </div>
      {hours.length > 0 && (
        <div className="bk-loads">
          {hours.map((h) => {
            const hb = act.filter((b) => Math.floor(toMin(b.slot) / 60) === h)
            return (
              <span key={h} className="load"><b>{h}h</b>
                {[...new Set(hb.map((b) => b.slot))].map((tm) => (
                  <span key={tm} className="lt"><i>{tm}</i>{hb.filter((b) => b.slot === tm).map((b, i) => <span key={b.id} className={b.status === 'seated' ? 'arr' : ''}>{i ? '/' : ''}{b.party}</span>)}</span>
                ))}
              </span>
            )
          })}
        </div>
      )}
      <div className="bk-filters">
        {filters.map((f) => {
          const c = f === 'all' ? dayRows.filter((b) => b.status !== 'cancelled' && b.status !== 'rejected').length : dayRows.filter((b) => b.status === f).length
          return <button key={f} className={`sm${filter === f ? ' sel' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? L('Tất cả', 'Alle') : STATUS_LABEL[L.lang][f]} ({c})</button>
        })}
      </div>

      <div className="bk-list">
        {shown.length > 0 && (
          <div className="bk-row head" aria-hidden>
            <span>{L('Giờ', 'Zeit')}</span><span>{L('Tên', 'Name')}</span><span>{L('Người', 'Pers.')}</span><span>{L('Bàn', 'Tisch')}</span><span>{L('Nguồn', 'Quelle')}</span><span>{L('Trạng thái', 'Status')}</span>
          </div>
        )}
        {shown.map((b) => {
          const gn = data.notes[noteKey(b.name)]
          const sub = [b.note, gn ? `★ ${gn}` : ''].filter(Boolean).join(' · ')
          const tel = (b.phone || '').replace(/[^0-9+]/g, '')
          const dead = b.status === 'cancelled' || b.status === 'rejected'
          return (
            <div key={b.id} className={`bk-row st-row-${b.status}${b.status === 'seated' || b.status === 'noshow' ? ' is-done' : ''}`} onClick={() => setEdit(fromBooking(b, data.notes))}>
              <span className="time">{b.slot}</span>
              <span className="who">
                <b>
                  <span className="nm">{b.name}</span>
                  {tel.length >= 5 && <>
                    <button type="button" className={`called${b.called ? ' on' : ''}`} title={b.called ? L('Đã gọi được', 'Gast erreicht') : L('Chưa gọi được', 'Noch nicht erreicht')}
                      onClick={(e) => { e.stopPropagation(); run(() => setCalled(b.id, !b.called)) }}>{b.called ? '✓' : '✕'}</button>
                    <a className="call" href={`tel:${tel}`} title={b.phone || ''} onClick={(e) => e.stopPropagation()}>☎</a>
                  </>}
                </b>
                {sub && <small>{sub}</small>}
              </span>
              <span className="pax">{b.party}<span className="mob"> P.</span></span>
              {dead ? <span /> : (
                <button type="button" className={`tbx${b.tables.length ? '' : ' empty'}`} title={L('Chọn bàn', 'Tisch wählen')} onClick={(e) => { e.stopPropagation(); setPick(b) }}>
                  {b.tables.length ? tableNames(b.tables, tables) : L('Bàn', 'Tisch')}
                </button>
              )}
              <span className="src" title={b.source === 'online' ? `Online${b.channel ? ` · ${CHANNEL[b.channel] || b.channel}` : ''}` : `${SOURCE_LABEL[L.lang][b.source]}${b.created_by_name ? ` · ${b.created_by_name}` : ''}`}>
                {b.source === 'online' ? <>🌐{b.channel && <i className={`chb ch-${b.channel}`}>{(CHANNEL[b.channel] || b.channel).slice(0, 1)}</i>}</> : <span className="muted small">{b.created_by_name || SOURCE_LABEL[L.lang][b.source]}</span>}
              </span>
              <span className="acts" onClick={(e) => e.stopPropagation()}>
                {dead ? <StatusPill s={b.status} /> : (
                  <>
                    <select className={`bk-st st-${b.status}`} value={b.status} onChange={(e) => run(() => setStatus(b.id, e.target.value as Status))}>
                      {(b.status === 'pending' ? ['pending', 'confirmed', 'seated', 'noshow'] : ['confirmed', 'seated', 'noshow']).map((k) => <option key={k} value={k} disabled={k === 'pending'}>{STATUS_LABEL[L.lang][k as Status]}</option>)}
                    </select>
                    {b.status === 'pending' && (
                      <button type="button" className={`sm danger${sure === b.id ? ' sure' : ''}`} onClick={() => { if (sure === b.id) { setSure(null); run(() => setStatus(b.id, 'rejected')) } else setSure(b.id) }}>
                        {sure === b.id ? L('Chắc chắn từ chối?', 'Wirklich ablehnen?') : `✕ ${L('Từ chối', 'Ablehnen')}`}
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          )
        })}
        {!shown.length && <div className="bk-empty muted">{L('Chưa có đặt bàn cho ngày này.', 'Keine Reservierungen an diesem Tag.')}</div>}
      </div>

      {edit && <BookingModal rid={rid!} data={data} init={edit} mgr={mgr} onClose={() => setEdit(null)} />}
      {pick && (
        <TablePicker data={data} booking={pick} onClose={() => setPick(null)}
          onSave={(ids) => { const id = pick.id; setPick(null); run(() => setTables(id, ids)) }} />
      )}
    </BkShell>
  )
}

// ---------- tạo / sửa đơn ----------
export interface EditState { id: string | null; day: string; slot: string; party: number; name: string; phone: string; email: string; note: string; source: string; tables: string[]; gnote: string; status: Status; b?: Booking }
export const newEdit = (day: string, preset?: Partial<EditState>): EditState => ({ id: null, day, slot: '19:00', party: 4, name: '', phone: '', email: '', note: '', source: 'phone', tables: [], gnote: '', status: 'confirmed', ...preset })
const fromBooking = (b: Booking, notes: Record<string, string>): EditState => ({ id: b.id, day: b.day, slot: b.slot, party: b.party, name: b.name, phone: b.phone || '', email: b.email || '', note: b.note || '', source: b.source, tables: b.tables, gnote: notes[noteKey(b.name)] || '', status: b.status, b })

export function BookingModal({ rid, data, init, mgr, onClose }: { rid: string; data: BkData; init: EditState; mgr: boolean; onClose: () => void }) {
  const L = useL()
  const [m, setM] = useState<EditState>(init)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cal, setCal] = useState(false)
  const [calM, setCalM] = useState(monthOf(init.day))
  const [plan, setPlan] = useState(false)
  const [other, setOther] = useState(init.party > 20)
  const [log, setLog] = useState<LogRow[]>([])
  const [delSure, setDelSure] = useState(false)
  const st = data.settings
  useEffect(() => { if (init.id && mgr) loadLog(init.id).then(setLog) }, [init.id, mgr])
  useEffect(() => { data.ensureMonth(monthOf(m.day)) }, [m.day]) // eslint-disable-line
  const set = (p: Partial<EditState>) => setM((x) => ({ ...x, ...p }))
  const dead = m.status === 'cancelled' || m.status === 'rejected'
  const pc = peakCheck(st, data.rules, data.bookings, m.day, m.slot, m.party, m.id)
  const busyT = busyTables(st, data.bookings, m.day, m.slot, m.id)
  const slots = staffSlots(st)

  async function save() {
    if (!m.name.trim()) { setErr(L('Cần có tên khách.', 'Name fehlt.')); return }
    if (m.party < 1) { setErr(L('Số người phải từ 1.', 'Personenzahl ab 1.')); return }
    setBusy(true); setErr('')
    try {
      await saveBooking(rid, { id: m.id, day: m.day, slot: m.slot, party: m.party, name: m.name, phone: m.phone, email: m.email, note: m.note, source: m.source, tables: dead ? null : m.tables }, mgr)
      if ((data.notes[noteKey(m.name)] || '') !== m.gnote.trim()) await saveNote(rid, noteKey(m.name), m.gnote)
      await data.reload(); toast(L('Đã lưu', 'Gespeichert')); onClose()
    } catch (e) { setErr(errText(e, L)) }
    setBusy(false)
  }
  async function del() {
    setBusy(true)
    try { await deleteBooking(m.id!); await data.reload(); toast(L('Đã xoá', 'Gelöscht')); onClose() } catch (e) { setErr(errText(e, L)) }
    setBusy(false)
  }
  const fmtAt = (s: string) => new Date(s).toLocaleString(LOCALE[L.lang], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="inv-modal-bg" onClick={onClose}>
      <div className="inv-modal bk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{m.id ? L('Sửa đặt bàn', 'Reservierung bearbeiten') : L('Đặt bàn mới', 'Neue Reservierung')}</h2>
          <button className="ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        {init.b && (
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            {init.b.code} · <StatusPill s={init.b.status} /> · {init.b.source === 'online' ? `Online${init.b.channel ? ` (${CHANNEL[init.b.channel] || init.b.channel})` : ''}` : `${SOURCE_LABEL[L.lang][init.b.source]}${init.b.created_by_name ? `, ${L('người nhập', 'erfasst von')} ${init.b.created_by_name}` : ''}`}
            {init.b.review_ok && ` · ${L('đồng ý nhận mail đánh giá', 'Bewertungs-Mail erlaubt')}`}
          </p>
        )}
        {err && <div className="err">{err}</div>}

        <span className="lbl">{L('Ngày', 'Datum')}</span>
        <button type="button" className="bk-daybox wide" onClick={() => setCal(!cal)}>{parseD(m.day).toLocaleDateString(LOCALE[L.lang], { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</button>
        {cal && <MonthCal month={calM} value={m.day} onMonth={setCalM} onPick={(d) => { set({ day: d }); setCal(false) }} closed={(d) => st.closed_days.includes(d.slice(5))} />}

        <span className="lbl mt">{L('Giờ', 'Uhrzeit')}</span>
        <div className="bk-slots">
          {slots.map((s) => {
            const p = peakCheck(st, data.rules, data.bookings, m.day, s, m.party, m.id)
            return <button key={s} type="button" className={`sm${s === m.slot ? ' sel' : ''}${p && !p.ok ? ' full' : ''}`} onClick={() => set({ slot: s })}>{s}</button>
          })}
        </div>

        <span className="lbl mt">{L('Số người', 'Personen')}</span>
        <div className="bk-party">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <button key={n} type="button" className={`sm${!other && m.party === n ? ' sel' : ''}`} onClick={() => { setOther(false); set({ party: n }) }}>{n}</button>)}
          <button type="button" className={`sm${other ? ' sel' : ''}`} onClick={() => setOther(true)}>{L('Khác', 'Andere')}</button>
          {other && <input type="number" min={1} max={300} value={m.party} onChange={(e) => set({ party: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 90 }} />}
        </div>
        {pc && (
          <div className={`alert ${pc.ok ? 'ok' : 'err'} small`}>
            {L('Khung', 'Fenster')} {pc.from}–{pc.to}: {pc.used}/{pc.max} {L('khách', 'Gäste')}
            {!pc.ok && (mgr ? ` · ${L('Vượt giới hạn: chủ / phụ trách vẫn lưu được.', 'Limit überschritten: Inhaber/Leitung kann trotzdem speichern.')}` : ` · ${L('Vượt giới hạn cao điểm.', 'Spitzenzeit-Limit überschritten.')}`)}
          </div>
        )}

        <div className="frow mt">
          <div><span className="lbl">{L('Tên khách', 'Name')}</span><input value={m.name} onChange={(e) => set({ name: e.target.value, gnote: data.notes[noteKey(e.target.value)] ?? m.gnote })} /></div>
          <div><span className="lbl">{L('Điện thoại', 'Telefon')}</span><input type="tel" value={m.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
        </div>
        <div className="frow mt">
          <div><span className="lbl">E-Mail</span><input type="email" value={m.email} onChange={(e) => set({ email: e.target.value })} /></div>
          {m.source !== 'online' && (
            <div><span className="lbl">{L('Nguồn', 'Quelle')}</span>
              <select value={m.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="phone">{SOURCE_LABEL[L.lang].phone}</option><option value="walkin">{SOURCE_LABEL[L.lang].walkin}</option>
              </select>
            </div>
          )}
        </div>
        <div className="mt"><span className="lbl">{L('Ghi chú đơn', 'Notiz zur Reservierung')}</span><textarea value={m.note} onChange={(e) => set({ note: e.target.value })} /></div>
        <div className="mt"><span className="lbl">{L('Ghi chú lâu dài cho khách (VIP, dị ứng…)', 'Dauerhafte Gastnotiz (VIP, Allergien …)')}</span><input value={m.gnote} onChange={(e) => set({ gnote: e.target.value })} /></div>

        {!dead && (
          <div className="mt">
            <button type="button" className="sm" onClick={() => setPlan(!plan)}>🪑 {m.tables.length ? `${L('Bàn', 'Tisch')} ${tableNames(m.tables, data.tables)}` : L('Chọn bàn trên sơ đồ', 'Tisch im Plan wählen')}</button>
            {plan && (
              <div className="bk-planbox">
                <Plan tables={data.tables} decor={data.settings.slug === 'potsdamerplatz'} de={L.de} picked={new Set(m.tables)}
                  cls={(t) => (busyT.has(t.id) && !m.tables.includes(t.id) ? 'busy' : 'free')}
                  onTap={(id) => set({ tables: m.tables.includes(id) ? m.tables.filter((x) => x !== id) : [...m.tables, id] })} />
              </div>
            )}
          </div>
        )}

        {mgr && log.length > 0 && (
          <div className="bk-log mt">
            <h3>{L('Lịch sử thao tác', 'Verlauf')}</h3>
            {log.slice().reverse().map((r) => (
              <div key={r.id} className="bk-log-r">
                <span className="muted">{fmtAt(r.at)}</span>
                <span>{r.kind === 'status' ? <StatusPill s={r.new_value as Status} /> : <>🪑 <b>{r.new_value ? tableNames(r.new_value.split(','), data.tables) : '–'}</b></>}</span>
                <span>{r.staff_name || (r.kind === 'status' && r.new_value === 'cancelled' ? L('Khách', 'Gast') : L('Tự động', 'Automatisch'))}</span>
              </div>
            ))}
          </div>
        )}

        <div className="sticky-actions">
          {mgr && m.id && (delSure
            ? <button className="danger" disabled={busy} onClick={del}>{L('Xoá hẳn đơn này?', 'Endgültig löschen?')}</button>
            : <button className="danger" onClick={() => setDelSure(true)}>{L('Xoá', 'Löschen')}</button>)}
          <span className="grow" />
          <button onClick={onClose}>{L('Huỷ', 'Abbrechen')}</button>
          <button className="primary" disabled={busy || (!!pc && !pc.ok && !mgr)} onClick={save}>{L('Lưu', 'Speichern')}</button>
        </div>
      </div>
    </div>
  )
}

/** Chọn bàn nhanh từ danh sách */
function TablePicker({ data, booking, onClose, onSave }: { data: BkData; booking: Booking; onClose: () => void; onSave: (ids: string[]) => void }) {
  const L = useL()
  const [sel, setSel] = useState<string[]>(booking.tables)
  const busyT = busyTables(data.settings, data.bookings, booking.day, booking.slot, booking.id)
  return (
    <div className="inv-modal-bg" onClick={onClose}>
      <div className="inv-modal bk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{L('Chọn bàn', 'Tisch wählen')}</h2>
          <button className="ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="small"><b>{booking.name}</b> <span className="muted">· {booking.slot} · {booking.party} P.{sel.length ? ` · ${L('Bàn', 'Tisch')} ${tableNames(sel, data.tables)}` : ''}</span></p>
        <div className="bk-planbox">
          <Plan tables={data.tables} decor={data.settings.slug === 'potsdamerplatz'} de={L.de} picked={new Set(sel)}
            cls={(t) => (busyT.has(t.id) && !sel.includes(t.id) ? 'busy' : 'free')}
            onTap={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
        </div>
        <div className="sticky-actions">
          {sel.length > 0 && <button onClick={() => setSel([])}>{L('Bỏ chọn', 'Auswahl löschen')}</button>}
          <span className="grow" />
          <button onClick={onClose}>{L('Huỷ', 'Abbrechen')}</button>
          <button className="primary" onClick={() => onSave(sel)}>{L('Lưu', 'Speichern')}</button>
        </div>
      </div>
    </div>
  )
}
