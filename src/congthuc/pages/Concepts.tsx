import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Spinner } from '../../components/ui'
import { useApp } from '../../lib/app'
import type { Concept } from '../rc'
import { deleteConcept, saveConcept, usePhotoUrls, useRc } from '../api'
import { PhotoInput, RcShell, StatusBadge, useL, useRcPerm } from '../ui'

export default function Concepts() {
  const { rid } = useParams()
  const L = useL()
  const nav = useNavigate()
  const { restaurants } = useApp()
  const perm = useRcPerm()
  const { s, err, reload } = useRc()
  const [edit, setEdit] = useState<Partial<Concept> | null>(null)
  const [e2, setE2] = useState('')
  const photos = usePhotoUrls([...(s?.concepts.map((c) => c.cover) || []), edit?.cover])

  if (err) return <RcShell><div className="err-box">{err}</div></RcShell>
  if (!s) return <RcShell><Spinner /></RcShell>

  const shown = s.concepts.filter((c) => perm.owner || !c.restaurant_ids.length || c.restaurant_ids.includes(rid!))
  const myRests = restaurants.filter((x) => perm.manageable.includes(x.id))
  const restName = (ids: string[]) => (!ids.length ? L('Mọi quán', 'Alle Filialen') : ids.map((i) => restaurants.find((r) => r.id === i)?.name).filter(Boolean).join(', '))

  async function save() {
    if (!edit?.name?.trim()) { setE2(L('Cần có tên.', 'Name fehlt.')); return }
    try { await saveConcept({ ...edit, name: edit.name.trim() }); setEdit(null); reload() } catch (e) { setE2((e as Error).message) }
  }
  async function del() {
    if (!edit?.id || !confirm(L(`Xoá concept "${edit.name}"? Các món vẫn giữ lại.`, `Konzept „${edit.name}" löschen? Gerichte bleiben erhalten.`))) return
    try { await deleteConcept(edit.id); setEdit(null); reload() } catch (e) { setE2((e as Error).message) }
  }

  return (
    <RcShell>
      <div className="rc-toolbar">
        <p className="muted small grow" style={{ margin: 0 }}>{L('Mỗi concept là một bộ sưu tập món (vd. "Phở & Bún", "Menu trưa", "Sushi"). Bấm vào để xem các món.', 'Ein Konzept ist eine Sammlung von Gerichten (z. B. „Pho & Bun", „Mittagskarte"). Antippen zum Öffnen.')}</p>
        {perm.anyManager && <button className="primary" onClick={() => { setE2(''); setEdit({ name: '', status: 'active', restaurant_ids: perm.owner ? [] : [rid!] }) }}>+ Concept</button>}
      </div>
      <div className="rc-cgrid">
        {shown.map((c) => {
          const n = s.list.filter((r) => r.concept_id === c.id && r.kind === 'dish').length
          return (
            <div key={c.id} className="rc-concept" onClick={() => nav(`/r/${rid}/rc?c=${c.id}`)}>
              <div className="rc-concept-img">
                {c.cover && photos[c.cover] ? <img src={photos[c.cover]} alt="" /> : <span className="rc-noimg big">{c.name.slice(0, 1).toUpperCase()}</span>}
                <StatusBadge s={c.status} />
              </div>
              <div className="rc-card-b">
                <div className="row between">
                  <div className="rc-card-t">{c.name}</div>
                  {perm.canEdit(c.restaurant_ids) && <button className="ghost small" onClick={(e) => { e.stopPropagation(); setE2(''); setEdit(c) }}>✎</button>}
                </div>
                {c.description && <div className="small muted rc-clamp">{c.description}</div>}
                <div className="small">{n} {L('món', 'Gerichte')} · <span className="muted">{restName(c.restaurant_ids)}</span></div>
              </div>
            </div>
          )
        })}
      </div>
      {!shown.length && <div className="rc-empty"><p>{L('Chưa có concept.', 'Noch keine Konzepte.')}</p></div>}

      {edit && (
        <div className="inv-modal-bg rc-modal-bg" onClick={() => setEdit(null)}>
          <div className="rc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><h2 style={{ margin: 0 }}>{edit.id ? L('Sửa concept', 'Konzept bearbeiten') : L('Concept mới', 'Neues Konzept')}</h2><button className="ghost" onClick={() => setEdit(null)}>✕</button></div>
            {e2 && <div className="err-box">{e2}</div>}
            <label className="f"><span>{L('Tên', 'Name')} *</span><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></label>
            <label className="f"><span>{L('Mô tả, ý tưởng', 'Beschreibung, Idee')}</span><textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value || null })} /></label>
            <div className="f"><span>{L('Ảnh bìa', 'Titelbild')}</span><PhotoInput path={edit.cover || null} url={edit.cover ? photos[edit.cover] : undefined} onChange={(p) => setEdit({ ...edit, cover: p })} label={L('Ảnh bìa', 'Titelbild')} /></div>
            <label className="f"><span>{L('Trạng thái', 'Status')}</span>
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Concept['status'] })}>
                <option value="active">{L('Đang bán', 'Im Verkauf')}</option><option value="testing">{L('Thử nghiệm', 'In Testphase')}</option><option value="stopped">{L('Ngừng bán', 'Eingestellt')}</option>
              </select>
            </label>
            <div className="f"><span>{L('Quán dùng', 'Filialen')}</span>
              <div className="rc-chips">
                {perm.owner && <button type="button" className={!edit.restaurant_ids?.length ? 'sel' : ''} onClick={() => setEdit({ ...edit, restaurant_ids: [] })}>{L('Mọi quán', 'Alle Filialen')}</button>}
                {myRests.map((x) => {
                  const ids = edit.restaurant_ids || []
                  const on = ids.includes(x.id)
                  return <button type="button" key={x.id} className={on ? 'sel' : ''} onClick={() => setEdit({ ...edit, restaurant_ids: on ? ids.filter((y) => y !== x.id) : [...ids, x.id] })}>{x.name}</button>
                })}
              </div>
            </div>
            <div className="rc-actions">
              {edit.id && perm.owner && <button className="danger" onClick={del}>{L('Xoá', 'Löschen')}</button>}
              <span className="grow" />
              <button onClick={() => setEdit(null)}>{L('Huỷ', 'Abbrechen')}</button>
              <button className="primary" onClick={save}>{L('Lưu', 'Speichern')}</button>
            </div>
          </div>
        </div>
      )}
    </RcShell>
  )
}
