import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui'
import { loadRules, loadSettings, saveSettings, toHM, toMin, type BkSettings, type PeakRule } from '../api'
import { BkShell, DAY_NAMES, DAY_ORDER, useL } from '../ui'

const toDots = (days: string[]) => days.map((x) => { const [m, d] = x.split('-'); return `${d}.${m}` }).join(', ')
const fromDots = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [d, m] = x.split('.'); return `${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}` }).filter((x) => /^\d\d-\d\d$/.test(x))

export default function BkSettingsPage() {
  const { rid } = useParams()
  const L = useL()
  const [s, setS] = useState<BkSettings | null>(null)
  const [closed, setClosed] = useState('')
  const [rules, setRules] = useState<PeakRule[]>([])
  const [pe, setPe] = useState<Partial<PeakRule> | null>(null)
  const [delSure, setDelSure] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const reloadRules = () => loadRules(rid!).then(setRules).catch((e) => toast(e.message))
  useEffect(() => { loadSettings(rid!).then((x) => { setS(x); setClosed(toDots(x.closed_days)) }).catch((e) => toast(e.message)); reloadRules() }, [rid]) // eslint-disable-line
  if (!s) return <BkShell><div className="center"><div className="spinner" /></div></BkShell>
  const set = (p: Partial<BkSettings>) => setS({ ...s, ...p })
  const num = (k: keyof BkSettings) => ({ value: String(s[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ [k]: Number(e.target.value) } as Partial<BkSettings>) })

  async function save() {
    setErr('')
    if (s!.slug && !/^[a-z0-9-]{2,40}$/.test(s!.slug)) { setErr(L('Tên link chỉ gồm chữ thường a-z, số và dấu -', 'Kurzname nur a-z, 0-9 und -')); return }
    try { await saveSettings({ ...s!, slug: s!.slug || null, closed_days: fromDots(closed) }); toast(L('Đã lưu', 'Gespeichert')) } catch (e) { setErr((e as Error).message) }
  }
  async function saveRule() {
    if (!pe) return
    if (!pe.days?.length) { toast(L('Chọn ít nhất một ngày', 'Mindestens einen Tag wählen')); return }
    if (!pe.start_time || !pe.end_time || pe.end_time <= pe.start_time) { toast(L('Giờ kết thúc phải sau giờ bắt đầu', 'Ende muss nach Beginn liegen')); return }
    const row = { restaurant_id: rid!, days: pe.days, start_time: pe.start_time, end_time: pe.end_time, max_guests: pe.max_guests || 35, block_min: pe.block_min || 30, active: pe.active ?? true, ...(pe.id ? { id: pe.id } : {}) }
    const { error } = await supabase.from('nh_bk_peak_rules').upsert(row)
    if (error) { toast(error.message); return }
    setPe(null); reloadRules()
  }
  async function toggleRule(r: PeakRule) { await supabase.from('nh_bk_peak_rules').update({ active: !r.active }).eq('id', r.id); reloadRules() }
  async function delRule(id: string) { await supabase.from('nh_bk_peak_rules').delete().eq('id', id); setDelSure(null); reloadRules() }
  const dayLabel = (days: number[]) => {
    const idx = DAY_ORDER.map((d) => days.includes(d)), runs: string[] = []
    let i = 0
    while (i < 7) { if (!idx[i]) { i++; continue } let j = i; while (j + 1 < 7 && idx[j + 1]) j++; runs.push(j > i ? `${DAY_NAMES[L.lang][DAY_ORDER[i]]}–${DAY_NAMES[L.lang][DAY_ORDER[j]]}` : DAY_NAMES[L.lang][DAY_ORDER[i]]); i = j + 1 }
    return runs.join(', ')
  }

  return (
    <BkShell>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{L('Nhận đặt bàn', 'Reservierung')}</h3>
        <label className="chk bk-chk"><input type="checkbox" checked={s.auto_confirm} onChange={(e) => set({ auto_confirm: e.target.checked })} /> <span><b>{L('Tự động xác nhận', 'Automatisch bestätigen')}</b><br /><span className="muted small">{L('Tắt: đơn online chờ nhân viên duyệt.', 'Aus: Online-Anfragen müssen bestätigt werden.')}</span></span></label>
        <div className="grid3 mt">
          <label className="f"><span>{L('Thời gian ngồi (phút)', 'Aufenthalt (Min.)')}</span><input type="number" min={30} max={300} step={15} {...num('duration_min')} /></label>
          <label className="f"><span>{L('Online ít nhất (người)', 'Online min. Pers.')}</span><input type="number" min={1} max={50} {...num('min_online')} /></label>
          <label className="f"><span>{L('Online nhiều nhất (người)', 'Online max. Pers.')}</span><input type="number" min={1} max={100} {...num('max_online')} /></label>
          <label className="f"><span>{L('Đặt trước ít nhất (giờ)', 'Vorlauf (Std.)')}</span><input type="number" min={0} max={72} {...num('lead_hours')} /></label>
          <label className="f"><span>{L('Tự chuyển "Đã đến" sau (phút, 0 = tắt)', '"Angekommen" nach (Min., 0 = aus)')}</span><input type="number" min={0} max={180} step={5} {...num('auto_arrive_min')} /></label>
          <label className="f"><span>{L('Bước giờ (phút)', 'Zeitraster (Min.)')}</span><select {...num('slot_step')}>{[15, 30].map((v) => <option key={v}>{v}</option>)}</select></label>
        </div>
        <label className="f"><span>{L('Email liên hệ của quán (nhận bản sao)', 'Kontakt-E-Mail (erhält Kopien)')}</span><input type="email" value={s.contact_email || ''} onChange={(e) => set({ contact_email: e.target.value || null })} /></label>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{L('Giờ mở cửa', 'Öffnungszeiten')}</h3>
        <div className="grid3">
          <label className="f"><span>{L('Mở', 'Öffnet')}</span><input type="time" step={900} value={s.open_time} onChange={(e) => set({ open_time: e.target.value })} /></label>
          <label className="f"><span>{L('Đóng', 'Schließt')}</span><input type="time" step={900} value={s.close_time} onChange={(e) => set({ close_time: e.target.value })} /></label>
          <div className="muted small" style={{ alignSelf: 'end', paddingBottom: 18 }}>{L('Giờ ngồi cuối', 'Letzte Platzierung')}: {toHM(toMin(s.close_time) - s.duration_min)}</div>
        </div>
        <div className="grid3">
          <label className="f"><span>{L('T2–T6 khách đặt online từ', 'Mo–Fr online ab')}</span><input type="time" step={900} value={s.weekday_from || ''} onChange={(e) => set({ weekday_from: e.target.value || null })} /></label>
          <div className="muted small" style={{ gridColumn: 'span 2', alignSelf: 'end', paddingBottom: 18 }}>{L('Để trống = theo giờ mở cửa. Nhân viên vẫn nhập được mọi giờ.', 'Leer = ab Öffnung. Personal kann jederzeit eintragen.')}</div>
        </div>
        <label className="f"><span>{L('Ngày đóng cửa hằng năm (dd.mm, cách nhau dấu phẩy)', 'Jährliche Ruhetage (TT.MM, durch Komma)')}</span><input value={closed} onChange={(e) => setClosed(e.target.value)} placeholder="24.12, 25.12" /></label>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{L('Trang khách đặt online', 'Online-Gästeseite')}</h3>
        <label className="f"><span>{L('Tên link của quán', 'Kurzname der Filiale')}</span><input value={s.slug || ''} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} placeholder="potsdamerplatz" /></label>
        <p className="small" style={{ margin: 0 }}>
          {s.online_enabled
            ? <span className="tag ok">{L('Đang nhận khách online qua hệ thống này', 'Online-Reservierungen aktiv')}</span>
            : <span className="tag warn">{L('Chưa nhận khách online qua hệ thống này (trang khách còn chạy hệ thống cũ)', 'Noch nicht aktiv (Gästeseite läuft auf dem alten System)')}</span>}
        </p>
      </div>
      <div className="sticky-actions"><button className="primary" onClick={save}>{L('Lưu cài đặt', 'Einstellungen speichern')}</button></div>

      <div className="card mt">
        <h3 style={{ marginTop: 0 }}>{L('Giới hạn giờ cao điểm', 'Spitzenzeiten-Limit')}</h3>
        <label className="chk bk-chk"><input type="checkbox" checked={s.peak_enabled} onChange={async (e) => { const v = e.target.checked; set({ peak_enabled: v }); try { await saveSettings({ ...s, peak_enabled: v, closed_days: fromDots(closed) }) } catch (x) { toast((x as Error).message) } }} />
          <span><b>{L('Bật giới hạn', 'Limit aktiv')}</b><br /><span className="muted small">{L('Tối đa N khách trong mỗi khung giờ. Chỉ chủ / phụ trách được vượt.', 'Max. N Gäste je Zeitfenster. Nur Inhaber/Leitung kann überschreiten.')}</span></span></label>
        {rules.map((r) => (
          <div key={r.id} className={`bk-rule${r.active ? '' : ' paused'}`}>
            <div><b>{dayLabel(r.days)}</b> · {r.start_time}–{r.end_time} · {r.max_guests} {L('khách', 'Gäste')} / {r.block_min} {L('phút', 'Min.')}{!r.active && <span className="tag warn" style={{ marginLeft: 6 }}>{L('Tạm dừng', 'Pausiert')}</span>}</div>
            <div className="row">
              <button className="sm" onClick={() => toggleRule(r)}>{r.active ? L('Tạm dừng', 'Pausieren') : L('Bật lại', 'Aktivieren')}</button>
              <button className="sm" onClick={() => setPe({ ...r })}>{L('Sửa', 'Bearbeiten')}</button>
              {delSure === r.id ? <button className="sm danger" onClick={() => delRule(r.id)}>{L('Chắc chắn xoá?', 'Wirklich löschen?')}</button> : <button className="sm danger" onClick={() => setDelSure(r.id)}>{L('Xoá', 'Löschen')}</button>}
            </div>
          </div>
        ))}
        {!rules.length && <p className="muted small">{L('Chưa có luật nào.', 'Noch keine Regeln.')}</p>}
        {pe ? (
          <div className="bk-ruleform">
            <div className="bk-days">
              {DAY_ORDER.map((d) => (
                <label key={d} className="chk"><input type="checkbox" checked={pe.days?.includes(d) || false} onChange={(e) => setPe({ ...pe, days: e.target.checked ? [...(pe.days || []), d] : (pe.days || []).filter((x) => x !== d) })} /> {DAY_NAMES[L.lang][d]}</label>
              ))}
            </div>
            <div className="grid2 mt">
              <label className="f"><span>{L('Từ', 'Von')}</span><input type="time" step={900} value={pe.start_time || ''} onChange={(e) => setPe({ ...pe, start_time: e.target.value })} /></label>
              <label className="f"><span>{L('Đến', 'Bis')}</span><input type="time" step={900} value={pe.end_time || ''} onChange={(e) => setPe({ ...pe, end_time: e.target.value })} /></label>
              <label className="f"><span>{L('Tối đa khách', 'Max. Gäste')}</span><input type="number" min={1} max={999} value={pe.max_guests || ''} onChange={(e) => setPe({ ...pe, max_guests: Number(e.target.value) })} /></label>
              <label className="f"><span>{L('Mỗi khung', 'Je Fenster')}</span><select value={pe.block_min || 30} onChange={(e) => setPe({ ...pe, block_min: Number(e.target.value) })}>{[15, 30, 60].map((b) => <option key={b} value={b}>{b} {L('phút', 'Min.')}</option>)}</select></label>
            </div>
            <div className="row"><button className="primary" onClick={saveRule}>{L('Lưu luật', 'Regel speichern')}</button><button onClick={() => setPe(null)}>{L('Huỷ', 'Abbrechen')}</button></div>
          </div>
        ) : <button onClick={() => setPe({ days: [1, 2, 3, 4, 5], start_time: '18:00', end_time: '21:00', max_guests: 35, block_min: 30, active: true })}>+ {L('Thêm luật', 'Regel hinzufügen')}</button>}
      </div>
    </BkShell>
  )
}
