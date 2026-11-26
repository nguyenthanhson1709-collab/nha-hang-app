import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui'
import { ACTIVE, staffSlots, tableState, today, toHM, toMin, type Area, type Table } from '../api'
import { BkShell, StatusPill, useL } from '../ui'
import { Plan } from '../Plan'
import { BookingModal, DateNav, newEdit, useBkData, type EditState } from './Bookings'

const STATE_LABEL = {
  vi: { free: 'Trống', reserved: 'Đã đặt', pending: 'Chờ duyệt', seated: 'Đang ngồi' },
  de: { free: 'Frei', reserved: 'Reserviert', pending: 'Anfrage', seated: 'Besetzt' },
}

export default function Floor() {
  const { rid } = useParams()
  const L = useL()
  const [sp, setSp] = useSearchParams()
  const day = sp.get('d') || today()
  const setDay = (d: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('d', d); return n }, { replace: true })
  const data = useBkData(rid!, day)
  const [time, setTime] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [edit, setEdit] = useState<EditState | null>(null)
  const [plan, setPlan] = useState<{ tables: Table[]; areas: Area[] } | null>(null) // đang sửa sơ đồ
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data || time) return
    const st = data.settings
    if (day === today()) { const n = new Date(); const m = Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15; setTime(toHM(Math.max(toMin(st.open_time), Math.min(toMin(st.close_time) - 15, m)))) }
    else setTime('19:00')
  }, [data, day, time])
  const times = useMemo(() => (data ? staffSlots(data.settings) : []), [data])
  if (!data) return <BkShell wide><div className="center"><div className="spinner" /></div></BkShell>
  const { settings: st } = data
  const decor = st.slug === 'potsdamerplatz'
  const tables = plan ? plan.tables : data.tables
  const areas = plan ? plan.areas : data.areas
  const t = time || '19:00'
  const free = data.tables.filter((x) => tableState(st, data.bookings, x.id, day, t).state === 'free').length

  // ---- sửa sơ đồ (chủ / phụ trách) ----
  const upd = (id: string, p: Partial<Table>) => setPlan((x) => x && { ...x, tables: x.tables.map((z) => (z.id === id ? { ...z, ...p } : z)) })
  const cur = plan && sel ? plan.tables.find((x) => x.id === sel) : null
  async function savePlan() {
    if (!plan) return
    setBusy(true)
    try {
      const old = new Map(data!.tables.map((x) => [x.id, x]))
      const keep = new Set(plan.tables.map((x) => x.id))
      const gone = data!.tables.filter((x) => !keep.has(x.id)).map((x) => x.id)
      const ar = await supabase.from('nh_bk_areas').upsert(plan.areas.map((a, i) => ({ ...a, sort: i + 1 })))
      if (ar.error) throw ar.error
      const goneA = data!.areas.filter((a) => !plan.areas.some((b) => b.id === a.id)).map((a) => a.id)
      if (goneA.length) await supabase.from('nh_bk_areas').delete().eq('restaurant_id', rid!).in('id', goneA)
      const changed = plan.tables.filter((x) => JSON.stringify(old.get(x.id)) !== JSON.stringify(x))
      if (changed.length) { const r = await supabase.from('nh_bk_tables').upsert(changed); if (r.error) throw r.error }
      // bàn bỏ đi: ẩn (giữ lịch sử đơn cũ)
      if (gone.length) { const r = await supabase.from('nh_bk_tables').update({ active: false }).eq('restaurant_id', rid!).in('id', gone); if (r.error) throw r.error }
      await data!.reload(); setPlan(null); setSel(null); toast(L('Đã lưu sơ đồ', 'Plan gespeichert'))
    } catch (e) { toast(String((e as Error).message || e)) }
    setBusy(false)
  }
  function addTable() {
    if (!plan) return
    const nums = plan.tables.map((x) => parseInt(x.label)).filter((n) => !isNaN(n))
    const n = String((nums.length ? Math.max(...nums) : 0) + 1)
    let id = `t${n}`; while (plan.tables.some((x) => x.id === id) || data!.tables.some((x) => x.id === id)) id += 'b'
    const [vx, vy] = decor ? [700, 900] : [200, 200]
    const tb: Table = { restaurant_id: rid!, id, label: n, area_id: plan.areas[0]?.id || null, x: vx, y: vy, w: 50, h: 50, rot: 0, seats: 2, flip: false, active: true }
    setPlan({ ...plan, tables: [...plan.tables, tb] }); setSel(id)
  }

  const pk = picked.map((id) => data.tables.find((x) => x.id === id)).filter(Boolean) as Table[]
  const one = pk.length === 1 ? pk[0] : null
  const oneState = one ? tableState(st, data.bookings, one.id, day, t) : null
  const atTable = one ? data.bookings.filter((b) => b.day === day && b.tables.includes(one.id) && b.status !== 'cancelled' && b.status !== 'rejected').sort((a, b) => a.slot.localeCompare(b.slot)) : []

  return (
    <BkShell wide>
      <div className="toolbar">
        {plan ? (
          <>
            <p className="muted small grow" style={{ margin: 0 }}>{L('Kéo bàn để đổi chỗ. Bấm vào bàn để sửa số, kích thước, góc xoay, khu.', 'Tische ziehen zum Verschieben. Tisch antippen zum Bearbeiten.')}</p>
            <button onClick={addTable}>+ {L('Thêm bàn', 'Tisch hinzufügen')}</button>
            <button onClick={() => { setPlan(null); setSel(null) }}>{L('Huỷ', 'Abbrechen')}</button>
            <button className="primary" disabled={busy} onClick={savePlan}>{L('Lưu sơ đồ', 'Plan speichern')}</button>
          </>
        ) : (
          <>
            <DateNav day={day} setDay={(d) => { setDay(d); setPicked([]) }} data={data} />
            <label className="row" style={{ gap: 6 }}><span className="muted small">{L('Lúc', 'Um')}</span>
              <select value={t} onChange={(e) => setTime(e.target.value)} style={{ width: 'auto' }}>{times.map((x) => <option key={x}>{x}</option>)}</select>
            </label>
            <span className="grow" />
            {!st.mirror_old && <button onClick={() => { setPlan({ tables: data.tables.map((x) => ({ ...x })), areas: data.areas.map((a) => ({ ...a })) }); setPicked([]) }}>{L('Sửa sơ đồ', 'Plan bearbeiten')}</button>}
          </>
        )}
      </div>
      {!plan && (
        <div className="bk-legend">
          {(['free', 'reserved', 'pending', 'seated'] as const).map((k) => <span key={k}><i className={`lg ${k}`} />{STATE_LABEL[L.lang][k]}</span>)}
          <b>{L(`${free}/${data.tables.length} bàn trống lúc ${t}`, `${free}/${data.tables.length} Tische frei um ${t}`)}</b>
        </div>
      )}
      <div className="bk-floor">
        <div className="card bk-planwrap">
          {plan
            ? <Plan tables={tables} decor={decor} de={L.de} sel={sel} cls={() => 'edit'} onTap={setSel} onMove={(id, x, y) => upd(id, { x, y })} />
            : <Plan tables={tables} decor={decor} de={L.de} picked={new Set(picked)} cls={(x) => tableState(st, data.bookings, x.id, day, t).state}
                onTap={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />}
        </div>
        <aside className="card bk-side">
          {plan ? (
            cur ? (
              <>
                <h3>{L('Bàn', 'Tisch')} {cur.label}</h3>
                <div className="grid2">
                  <label className="f"><span>{L('Số bàn', 'Tischnummer')}</span><input value={cur.label} onChange={(e) => upd(cur.id, { label: e.target.value })} /></label>
                  <label className="f"><span>{L('Số ghế', 'Plätze')}</span><input type="number" min={0} max={40} value={cur.seats ?? 0} onChange={(e) => upd(cur.id, { seats: Number(e.target.value) })} /></label>
                  <label className="f"><span>{L('Rộng', 'Breite')}</span><input type="number" min={20} max={300} step={2} value={cur.w} onChange={(e) => upd(cur.id, { w: Number(e.target.value) })} /></label>
                  <label className="f"><span>{L('Sâu', 'Tiefe')}</span><input type="number" min={20} max={300} step={2} value={cur.h} onChange={(e) => upd(cur.id, { h: Number(e.target.value) })} /></label>
                  <label className="f"><span>{L('Góc xoay', 'Drehung')}</span><input type="number" min={-180} max={180} step={5} value={cur.rot} onChange={(e) => upd(cur.id, { rot: Number(e.target.value) })} /></label>
                  <label className="f"><span>{L('Khu', 'Bereich')}</span>
                    <select value={cur.area_id || ''} onChange={(e) => upd(cur.id, { area_id: e.target.value || null })}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  </label>
                </div>
                <button className="danger" onClick={() => { setPlan({ ...plan, tables: plan.tables.filter((x) => x.id !== cur.id) }); setSel(null) }}>{L('Xoá bàn', 'Tisch entfernen')}</button>
              </>
            ) : (
              <>
                <h3>{L('Khu vực', 'Bereiche')}</h3>
                {areas.map((a) => (
                  <div key={a.id} className="row" style={{ marginBottom: 6 }}>
                    <input value={a.name} onChange={(e) => setPlan({ ...plan, areas: plan.areas.map((z) => (z.id === a.id ? { ...z, name: e.target.value } : z)) })} />
                    {!plan.tables.some((x) => x.area_id === a.id) && <button className="sm danger" onClick={() => setPlan({ ...plan, areas: plan.areas.filter((z) => z.id !== a.id) })}>✕</button>}
                  </div>
                ))}
                <button className="sm" onClick={() => { let i = plan.areas.length + 1; while (plan.areas.some((a) => a.id === `a${i}`)) i++; setPlan({ ...plan, areas: [...plan.areas, { restaurant_id: rid!, id: `a${i}`, name: L('Khu mới', 'Neuer Bereich'), sort: i }] }) }}>+ {L('Thêm khu', 'Bereich hinzufügen')}</button>
              </>
            )
          ) : !pk.length ? (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>{L('Bấm vào bàn để xem đơn, chọn nhiều bàn để đặt.', 'Tisch antippen für Details, mehrere wählen zum Reservieren.')}</p>
              <h3>{L('Khu vực', 'Bereiche')}</h3>
              {data.areas.map((a) => <div key={a.id} className="row between small"><span>{a.name}</span><span className="muted">{data.tables.filter((x) => x.area_id === a.id).length} {L('bàn', 'Tische')}</span></div>)}
            </>
          ) : one && oneState ? (
            <>
              <h3>{L('Bàn', 'Tisch')} {one.label}</h3>
              <p className="small" style={{ margin: 0 }}><span className={`bk-pill tb-${oneState.state}`}>{STATE_LABEL[L.lang][oneState.state]}</span> <span className="muted">{t} · {data.areas.find((a) => a.id === one.area_id)?.name}{one.seats ? ` · ${one.seats} ${L('ghế', 'Plätze')}` : ''}</span></p>
              <h3>{L('Đơn trong ngày ở bàn này', 'Reservierungen an diesem Tisch')}</h3>
              {atTable.map((b) => (
                <button key={b.id} className="block bk-atb" onClick={() => setEdit({ ...newEdit(day), id: b.id, day: b.day, slot: b.slot, party: b.party, name: b.name, phone: b.phone || '', email: b.email || '', note: b.note || '', source: b.source, tables: b.tables, gnote: data.notes[b.name.trim().toLowerCase()] || '', status: b.status, b })}>
                  <span>{b.slot} · {b.name}</span><StatusPill s={b.status} />
                </button>
              ))}
              {!atTable.length && <p className="muted small">{L('Chưa có', 'Keine')}</p>}
              <button className="primary block" onClick={() => setEdit(newEdit(day, { slot: t, tables: picked }))}>+ {L('Đặt bàn này', 'Diesen Tisch reservieren')}</button>
              <button className="ghost sm" onClick={() => setPicked([])}>{L('Bỏ chọn', 'Auswahl löschen')}</button>
            </>
          ) : (
            <>
              <h3>{L(`Đã chọn ${pk.length} bàn`, `${pk.length} Tische gewählt`)}</h3>
              <p className="small">{pk.map((x) => x.label).join(', ')} · {pk.reduce((n, x) => n + (x.seats || 0), 0)} {L('ghế', 'Plätze')}</p>
              {pk.some((x) => tableState(st, data.bookings, x.id, day, t).state !== 'free') && <p className="err small">{L('Có bàn đang bận lúc này', 'Einige Tische sind belegt')}</p>}
              <button className="primary block" onClick={() => setEdit(newEdit(day, { slot: t, tables: picked, party: Math.max(1, pk.reduce((n, x) => n + (x.seats || 0), 0)) }))}>+ {L('Đặt các bàn này', 'Diese Tische reservieren')}</button>
              <button className="ghost sm" onClick={() => setPicked([])}>{L('Bỏ chọn', 'Auswahl löschen')}</button>
            </>
          )}
        </aside>
      </div>
      {edit && <BookingModal rid={rid!} data={data} init={edit} mgr onClose={() => { setEdit(null); setPicked([]) }} />}
      {!plan && data.bookings.some((b) => b.day === day && ACTIVE.includes(b.status) && !b.tables.length) && (
        <p className="muted small">{L('Một số đơn hôm nay chưa xếp bàn (xem ở mục Đặt bàn).', 'Einige Reservierungen haben noch keinen Tisch.')}</p>
      )}
    </BkShell>
  )
}
