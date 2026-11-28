// Giấy tờ (Dokumente): thư mục tự đặt tên, lồng nhau được, trong đó tải PDF / Word / Excel lên
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy } from '../lib/format'
import { dropProps } from '../lib/drop'
import { Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import PdfSheet from '../components/PdfSheet'

export const PAPERS_BUCKET = 'nh-papers'
type Folder = { id: string; parent_id: string | null; name: string; created_at: string }
type PFile = { id: string; folder_id: string; name: string; path: string; size: number | null; mime: string | null; created_at: string }

const OK_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'odt', 'ods']
const ACCEPT = OK_EXT.map((e) => '.' + e).join(',')
const ext = (n: string) => (n.split('.').pop() || '').toLowerCase()
const kindOf = (n: string) => { const e = ext(n); return e === 'pdf' ? 'pdf' : ['doc', 'docx', 'odt'].includes(e) ? 'word' : 'excel' }
const KIND_STYLE: Record<string, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: '#E5484D' }, word: { label: 'DOC', color: '#3E7BFA' }, excel: { label: 'XLS', color: '#30A46C' },
}
const kb = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`)
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' })

const FolderIc = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
)

export default function Papers() {
  const { rid, fid } = useParams()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const T = (vi: string, g: string) => (de ? g : vi)
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [files, setFiles] = useState<PFile[]>([])
  const [nameEdit, setNameEdit] = useState<{ mode: 'new' | 'folder' | 'file'; id?: string; value: string } | null>(null)
  const [menu, setMenu] = useState<{ type: 'folder'; it: Folder } | { type: 'file'; it: PFile } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<{ blob: Blob; f: PFile } | null>(null)

  const load = async () => {
    const [{ data: fo, error }, { data: fi }] = await Promise.all([
      supabase.from('nh_paper_folders').select('id,parent_id,name,created_at').eq('restaurant_id', rid!),
      supabase.from('nh_paper_files').select('id,folder_id,name,path,size,mime,created_at').eq('restaurant_id', rid!),
    ])
    if (error) toast(errMsg(error))
    setFolders((fo || []) as Folder[]); setFiles((fi || []) as PFile[])
  }
  useEffect(() => { if (rid) load() }, [rid]) // eslint-disable-line

  const cur = useMemo(() => (fid && folders ? folders.find((f) => f.id === fid) || null : null), [fid, folders])
  const trail = useMemo(() => {
    const out: Folder[] = []; let x = cur
    while (x && out.length < 50) { out.unshift(x); x = folders?.find((f) => f.id === x!.parent_id) || null }
    return out
  }, [cur, folders])
  const subOf = (id: string | null) => (folders || []).filter((f) => f.parent_id === id).sort(byName)
  const descendants = (id: string): string[] => [id, ...subOf(id).flatMap((f) => descendants(f.id))]
  const countIn = (id: string) => { const ids = new Set(descendants(id)); return files.filter((f) => ids.has(f.folder_id)).length }

  if (!r || !canManage(role)) return null
  if (fid && folders && !cur) return <><Top title={T('Giấy tờ', 'Dokumente')} back={`/r/${rid}/papers`} /><div className="page muted">{T('Không tìm thấy thư mục', 'Ordner nicht gefunden')}</div></>

  const here = fid || null
  const subs = subOf(here)
  const myFiles = files.filter((f) => f.folder_id === fid).sort(byName)
  const back = cur ? (cur.parent_id ? `/r/${rid}/papers/${cur.parent_id}` : `/r/${rid}/papers`) : `/r/${rid}`

  async function saveName() {
    if (!nameEdit) return
    let name = nameEdit.value.trim()
    if (!name) { toast(T('Nhập tên', 'Namen eingeben')); return }
    if (nameEdit.mode === 'file') { const old = files.find((f) => f.id === nameEdit.id); if (old && ext(name) !== ext(old.name)) name += '.' + ext(old.name) }
    const q = nameEdit.mode === 'new'
      ? supabase.from('nh_paper_folders').insert({ restaurant_id: rid, parent_id: here, name })
      : nameEdit.mode === 'folder'
        ? supabase.from('nh_paper_folders').update({ name }).eq('id', nameEdit.id!)
        : supabase.from('nh_paper_files').update({ name }).eq('id', nameEdit.id!)
    const { error } = await q
    if (error) { toast(errMsg(error)); return }
    setNameEdit(null); load()
  }

  async function upload(list: FileList | File[]) {
    if (!fid) return
    const all = Array.from(list)
    const ok = all.filter((f) => OK_EXT.includes(ext(f.name)))
    if (ok.length < all.length) toast(T('Chỉ nhận PDF, Word, Excel', 'Nur PDF, Word und Excel'))
    const big = ok.filter((f) => f.size > 50 * 1024 * 1024)
    if (big.length) toast(T(`File quá 50 MB: ${big[0].name}`, `Datei über 50 MB: ${big[0].name}`))
    const go = ok.filter((f) => f.size <= 50 * 1024 * 1024)
    if (!go.length) return
    let done = 0
    for (const f of go) {
      setBusy(`${T('Đang tải', 'Lade hoch')} ${++done}/${go.length}…`)
      const path = `${rid}/${fid}/${crypto.randomUUID()}.${ext(f.name)}`
      const { error } = await supabase.storage.from(PAPERS_BUCKET).upload(path, f, { contentType: f.type || undefined })
      if (error) { toast(`${f.name}: ${errMsg(error)}`); continue }
      const { error: e2 } = await supabase.from('nh_paper_files').insert({ restaurant_id: rid, folder_id: fid, name: f.name, path, size: f.size, mime: f.type || null })
      if (e2) { toast(errMsg(e2)); await supabase.storage.from(PAPERS_BUCKET).remove([path]) }
    }
    setBusy(null); load()
  }

  async function fetchBlob(f: PFile) {
    const { data, error } = await supabase.storage.from(PAPERS_BUCKET).download(f.path)
    if (error || !data) { toast(errMsg(error || 'download')); return null }
    return f.mime && !data.type ? new Blob([data], { type: f.mime }) : data
  }
  function save(blob: Blob, name: string) {
    const u = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 5000)
  }
  async function open(f: PFile) {
    setBusy(T('Đang mở…', 'Öffne…'))
    const b = await fetchBlob(f); setBusy(null)
    if (!b) return
    if (kindOf(f.name) === 'pdf') setView({ blob: b.type === 'application/pdf' ? b : new Blob([b], { type: 'application/pdf' }), f })
    else save(b, f.name)
  }
  async function download(f: PFile) { const b = await fetchBlob(f); if (b) save(b, f.name) }

  async function delFile(f: PFile) {
    if (!confirm(T(`Xoá file "${f.name}"?`, `Datei „${f.name}“ löschen?`))) return
    const { error } = await supabase.from('nh_paper_files').delete().eq('id', f.id)
    if (error) { toast(errMsg(error)); return }
    await supabase.storage.from(PAPERS_BUCKET).remove([f.path])
    setMenu(null); load()
  }
  async function delFolder(fo: Folder) {
    const ids = new Set(descendants(fo.id))
    const inside = files.filter((f) => ids.has(f.folder_id))
    const msg = inside.length || ids.size > 1
      ? T(`Xoá thư mục "${fo.name}" cùng ${ids.size - 1} thư mục con và ${inside.length} file bên trong?`, `Ordner „${fo.name}“ mit ${ids.size - 1} Unterordnern und ${inside.length} Dateien löschen?`)
      : T(`Xoá thư mục "${fo.name}"?`, `Ordner „${fo.name}“ löschen?`)
    if (!confirm(msg)) return
    const { error } = await supabase.from('nh_paper_folders').delete().eq('id', fo.id)
    if (error) { toast(errMsg(error)); return }
    if (inside.length) await supabase.storage.from(PAPERS_BUCKET).remove(inside.map((f) => f.path))
    setMenu(null)
    if (fid && ids.has(fid)) nav(fo.parent_id ? `/r/${rid}/papers/${fo.parent_id}` : `/r/${rid}/papers`)
    load()
  }

  const crumbs = (
    <span className="pp-crumbs">
      <Link to={`/r/${rid}/papers`}>{T('Giấy tờ', 'Dokumente')}</Link>
      {trail.slice(0, -1).map((f) => <span key={f.id}> › <Link to={`/r/${rid}/papers/${f.id}`}>{f.name}</Link></span>)}
    </span>
  )

  return (
    <>
      <Top title={cur ? cur.name : T('Giấy tờ', 'Dokumente')} sub={cur ? crumbs : r.name} back={back}
        right={cur && <button className="ghost" aria-label={T('Tuỳ chọn', 'Optionen')} onClick={() => setMenu({ type: 'folder', it: cur })}>⋯</button>} />
      <div className="page">
        {!folders ? <Spinner /> : <>
          <button className={cur ? 'block' : 'primary block'} style={{ marginBottom: 12 }} onClick={() => setNameEdit({ mode: 'new', value: '' })}>
            + {cur ? T('Thư mục con', 'Unterordner') : T('Thư mục mới', 'Neuer Ordner')}
          </button>

          {subs.length > 0 && (
            <div className="pp-grid">
              {subs.map((f) => {
                const n = countIn(f.id); const s = subOf(f.id).length
                return (
                  <div key={f.id} className="pp-folder">
                    <button className="pp-folder-main" onClick={() => nav(`/r/${rid}/papers/${f.id}`)}>
                      <span className="pp-folder-ic"><FolderIc /></span>
                      <span className="pp-folder-t">{f.name}</span>
                      <span className="small muted">{[s ? `${s} ${T('thư mục', s === 1 ? 'Ordner' : 'Ordner')}` : '', `${n} ${T('file', n === 1 ? 'Datei' : 'Dateien')}`].filter(Boolean).join(' · ')}</span>
                    </button>
                    <button className="ghost pp-more" aria-label={T('Tuỳ chọn', 'Optionen')} onClick={() => setMenu({ type: 'folder', it: f })}>⋯</button>
                  </div>
                )
              })}
            </div>
          )}

          {!cur && !subs.length && <div className="alert">{T('Chưa có thư mục nào. Bấm "+ Thư mục mới" để tạo, ví dụ: Gewerbe, Mietvertrag, Versicherung, Steuer.', 'Noch keine Ordner. Mit „+ Neuer Ordner“ anlegen, z. B. Gewerbe, Mietvertrag, Versicherung, Steuer.')}</div>}

          {cur && <>
            <label className={`btn block drop${busy ? ' disabled' : ''}`} style={{ margin: '4px 0 12px' }} {...dropProps(upload, !!busy)}>
              📄 {busy || T('Tải file lên (PDF, Word, Excel)', 'Dateien hochladen (PDF, Word, Excel)')}
              <span className="drop-hint">{T('hoặc kéo thả file vào đây', 'oder Dateien hierher ziehen')}</span>
              <input type="file" accept={ACCEPT} multiple hidden disabled={!!busy} onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
            </label>
            <div className="list">
              {myFiles.map((f) => {
                const k = KIND_STYLE[kindOf(f.name)]
                return (
                  <div key={f.id} className="it">
                    <button className="pp-file" onClick={() => open(f)}>
                      <span className="pp-badge" style={{ background: k.color }}>{k.label}</span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: 'block' }}>{f.name}</span>
                        <span className="small muted">{dmy(f.created_at.slice(0, 10))}{f.size ? ` · ${kb(f.size)}` : ''}</span>
                      </span>
                    </button>
                    <button className="ghost" aria-label={T('Tuỳ chọn', 'Optionen')} onClick={() => setMenu({ type: 'file', it: f })}>⋯</button>
                  </div>
                )
              })}
              {!myFiles.length && <div className="it muted">{T('Chưa có file nào trong thư mục này', 'Noch keine Dateien in diesem Ordner')}</div>}
            </div>
          </>}
        </>}
      </div>

      <Sheet open={!!nameEdit} onClose={() => setNameEdit(null)}
        title={nameEdit?.mode === 'new' ? (cur ? T('Thư mục con mới', 'Neuer Unterordner') : T('Thư mục mới', 'Neuer Ordner')) : nameEdit?.mode === 'file' ? T('Đổi tên file', 'Datei umbenennen') : T('Đổi tên thư mục', 'Ordner umbenennen')}>
        {nameEdit && <form onSubmit={(e) => { e.preventDefault(); saveName() }}>
          <label className="f"><span>{T('Tên', 'Name')}</span>
            <input autoFocus value={nameEdit.value} onChange={(e) => setNameEdit({ ...nameEdit, value: e.target.value })} placeholder={nameEdit.mode === 'file' ? '' : 'Mietvertrag, Versicherung…'} /></label>
          <button className="primary block" type="submit">{T('Lưu', 'Speichern')}</button>
        </form>}
      </Sheet>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.it.name}>
        {menu?.type === 'folder' && <>
          <button className="block" onClick={() => { setNameEdit({ mode: 'folder', id: menu.it.id, value: menu.it.name }); setMenu(null) }}>✎ {T('Đổi tên', 'Umbenennen')}</button>
          <button className="danger block" style={{ marginTop: 8 }} onClick={() => delFolder(menu.it)}>{T('Xoá thư mục', 'Ordner löschen')}</button>
        </>}
        {menu?.type === 'file' && <>
          <button className="block" onClick={() => { open(menu.it); setMenu(null) }}>{T('Mở', 'Öffnen')}</button>
          <button className="block" style={{ marginTop: 8 }} onClick={() => { download(menu.it); setMenu(null) }}>⬇ {T('Tải về', 'Herunterladen')}</button>
          <button className="block" style={{ marginTop: 8 }} onClick={() => { setNameEdit({ mode: 'file', id: menu.it.id, value: menu.it.name }); setMenu(null) }}>✎ {T('Đổi tên', 'Umbenennen')}</button>
          <button className="danger block" style={{ marginTop: 8 }} onClick={() => delFile(menu.it)}>{T('Xoá file', 'Datei löschen')}</button>
        </>}
      </Sheet>

      {view && <PdfSheet pdf={view.blob} title={view.f.name} onClose={() => setView(null)}
        actions={[{ label: T('Tải về', 'Herunterladen'), primary: true, onClick: () => save(view.blob, view.f.name) }]} />}
    </>
  )
}
