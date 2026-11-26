import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Spinner, toast } from '../../components/ui'
import { costPct, fmtEur, fmtPct, recipeAllergens, recipeCost, type Recipe, type Status } from '../rc'
import { refreshPrices, usePhotoUrls, useRc } from '../api'
import { AllergenChips, RcShell, StatusBadge, useL, useRcPerm } from '../ui'

export default function Recipes() {
  const { rid } = useParams()
  const L = useL()
  const nav = useNavigate()
  const { s, err, reload } = useRc()
  const perm = useRcPerm()
  const [sp, setSp] = useSearchParams()
  const concept = sp.get('c') || ''
  const [q, setQ] = useState('')
  const [st, setSt] = useState<Status | 'all'>('all')
  const [kind, setKind] = useState<'dish' | 'base'>(sp.get('k') === 'base' ? 'base' : 'dish')
  const [chain, setChain] = useState(false)
  const showCost = perm.manager

  // Mở trang: cập nhật giá nguyên liệu từ hoá đơn mới nhất
  useEffect(() => {
    if (!perm.anyManager) return
    refreshPrices().then((n) => { if (n) { reload(); toast(L(`Đã cập nhật giá ${n} nguyên liệu từ hoá đơn`, `${n} Zutatenpreise aus Rechnungen aktualisiert`)) } }).catch(() => { /* bỏ qua */ })
  }, [perm.anyManager]) // eslint-disable-line

  const rows = useMemo(() => {
    if (!s) return []
    const t = q.trim().toLowerCase()
    return s.list
      .filter((r) => r.kind === kind)
      .filter((r) => chain || !r.restaurant_ids.length || r.restaurant_ids.includes(rid!))
      .filter((r) => !concept || r.concept_id === concept)
      .filter((r) => st === 'all' || r.status === st)
      .filter((r) => !t || `${r.number || ''} ${r.name} ${r.name_de || ''}`.toLowerCase().includes(t))
      .map((r) => {
        const c = recipeCost(r, s)
        return { r, c, pct: costPct(r, c.perPortion), al: recipeAllergens(r, s) }
      })
  }, [s, q, st, kind, chain, concept, rid])

  const photos = usePhotoUrls(rows.map((x) => x.r.photo))
  const conceptName = s?.concepts.find((c) => c.id === concept)?.name

  if (err) return <RcShell><div className="err-box">{err}</div></RcShell>
  if (!s) return <RcShell><Spinner /></RcShell>

  const warnN = rows.filter((x) => x.c.rising.length || (x.pct != null && x.pct > x.r.target_pct)).length

  return (
    <RcShell>
      <div className="rc-toolbar">
        <input className="grow" placeholder={L('Tìm món…', 'Gericht suchen…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {perm.anyManager && <button className="primary" onClick={() => nav(`/r/${rid}/rc/new${kind === 'base' ? '?k=base' : ''}${concept ? `${kind === 'base' ? '&' : '?'}c=${concept}` : ''}`)}>+ {kind === 'base' ? L('Công thức nền', 'Grundrezept') : L('Món mới', 'Neues Gericht')}</button>}
      </div>
      <div className="rc-chips">
        <button className={kind === 'dish' ? 'sel' : ''} onClick={() => setKind('dish')}>{L('Món ăn', 'Gerichte')}</button>
        <button className={kind === 'base' ? 'sel' : ''} onClick={() => setKind('base')} title={L('Sốt, nước dùng… dùng trong nhiều món', 'Saucen, Brühen… für mehrere Gerichte')}>{L('Công thức nền', 'Grundrezepte')}</button>
        <span className="rc-sep" />
        {(['all', 'active', 'testing', 'stopped'] as const).map((x) => (
          <button key={x} className={st === x ? 'sel' : ''} onClick={() => setSt(x)}>
            {x === 'all' ? L('Mọi trạng thái', 'Alle') : x === 'active' ? L('Đang bán', 'Im Verkauf') : x === 'testing' ? L('Thử nghiệm', 'Test') : L('Ngừng', 'Eingestellt')}
          </button>
        ))}
        {perm.owner && <button className={chain ? 'sel' : ''} onClick={() => setChain(!chain)}>{L('Cả chuỗi quán', 'Alle Filialen')}</button>}
      </div>
      {concept && (
        <div className="rc-filter">
          Concept: <b>{conceptName || '…'}</b>
          <button className="ghost small" onClick={() => { sp.delete('c'); setSp(sp) }}>✕</button>
        </div>
      )}
      {showCost && warnN > 0 && (
        <div className="rc-warn">⚠ {L(`${warnN} món cần xem lại: giá nguyên liệu tăng hoặc giá vốn vượt mục tiêu.`, `${warnN} Gerichte prüfen: Zutatenpreise gestiegen oder Wareneinsatz über Ziel.`)}</div>
      )}
      <p className="muted small">{rows.length} {kind === 'base' ? L('công thức nền', 'Grundrezepte') : L('món', 'Gerichte')}</p>

      <div className="rc-grid">
        {rows.map(({ r, c, pct, al }) => (
          <Link key={r.id} to={`/r/${rid}/rc/${r.id}`} className="rc-card">
            <div className="rc-card-img">
              {r.photo && photos[r.photo] ? <img src={photos[r.photo]} alt="" loading="lazy" /> : <span className="rc-noimg">{initials(r)}</span>}
              <StatusBadge s={r.status} />
            </div>
            <div className="rc-card-b">
              <div className="rc-card-t">{r.number && <span className="muted">{r.number} · </span>}{L(r.name, r.name_de || r.name)}</div>
              {r.kind === 'dish' && r.sell_price != null && <div className="small muted">{L('Giá bán', 'VK')} {fmtEur(r.sell_price)}</div>}
              {showCost && !(s.items.get(r.id) || []).length && <div className="small muted">{L('Chưa có nguyên liệu', 'Noch keine Zutaten')}</div>}
              {showCost && (s.items.get(r.id) || []).length > 0 && (
                <div className="rc-card-cost">
                  <span>{r.kind === 'base' ? L('Cả mẻ', 'Charge') : L('Giá vốn', 'WE')} <b>{fmtEur(r.kind === 'base' ? c.total : c.perPortion)}</b></span>
                  {pct != null && <span className={`rc-pct ${pct > r.target_pct ? 'bad' : 'good'}`}>{fmtPct(pct)}</span>}
                </div>
              )}
              {showCost && (c.rising.length > 0 || c.missing.length > 0) && (
                <div className="small">
                  {c.rising.length > 0 && <span className="rc-tag warn">↑ {c.rising.slice(0, 2).join(', ')}</span>}
                  {c.missing.length > 0 && <span className="rc-tag">{L('thiếu giá', 'Preis fehlt')}: {c.missing.length}</span>}
                </div>
              )}
              <AllergenChips codes={al} />
            </div>
          </Link>
        ))}
      </div>
      {!rows.length && (
        <div className="rc-empty">
          <p>{L('Chưa có món nào.', 'Noch keine Gerichte.')}</p>
          {perm.anyManager && <p className="muted small">{L('Bắt đầu bằng "Nguyên liệu & giá" (nối với hoá đơn đã scan để tự tính giá vốn), rồi tạo món.', 'Beginnen Sie mit „Zutaten & Preise" (mit gescannten Rechnungen verknüpfen), dann Gerichte anlegen.')}</p>}
        </div>
      )}
    </RcShell>
  )
}

export const initials = (r: Recipe) => r.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
