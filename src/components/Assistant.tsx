// Trợ lý giọng nói kiểu Siri: nút micro nổi trên mọi trang. Nói (hoặc gõ) câu lệnh, app tự tìm và mở trang.
// Nhận giọng nói bằng Web Speech API của trình duyệt (Chrome, Edge, Safari). Không có thì gõ chữ / bấm micro trên bàn phím.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp, canManage as canManageRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { todayIso } from '../lib/format'
import { aiIntent, loadEmployees, parseLocal, planIntent, type AsCtx, type AsEmp, type Plan } from '../lib/assistant'
import { toast } from './ui'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null }
const RecCtor: (new () => Rec) | undefined = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined

type Phase = 'idle' | 'listen' | 'think' | 'pick' | 'msg'

const EX = {
  vi: ['Bảng lương tháng 10 của Lina', 'Mở Kassenbuch tháng trước', 'Chứng từ tiền mặt tháng 9', 'Hồ sơ nhân viên Nam', 'Đặt bàn hôm nay', 'Scan Z-Bon'],
  de: ['Lohnabrechnung Oktober von Lina', 'Kassenbuch letzten Monat', 'Belege Bargeld September', 'Personalakte Nam', 'Reservierungen', 'Z-Bon scannen'],
}

export default function Assistant() {
  const app = useApp()
  const { lang } = useLang()
  const de = lang === 'de'
  const T = (vi: string, g: string) => (de ? g : vi)
  const nav = useNavigate()
  const path = useLocation().pathname
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState<Plan | null>(null)
  const [recLang, setRecLang] = useState<'vi' | 'de'>(() => { try { return (localStorage.getItem('nh-as-lang') as 'vi' | 'de') || lang } catch { return lang } })
  const rec = useRef<Rec | null>(null)
  const emps = useRef<AsEmp[] | null>(null)
  const viaVoice = useRef(false)
  const inp = useRef<HTMLInputElement>(null)

  const currentRid = path.match(/^\/r\/([^/]+)/)?.[1] || null
  const isManagerSomewhere = app.profile.is_owner || Object.values(app.roles).some((r) => canManageRole(r))

  useEffect(() => () => rec.current?.abort(), [])
  useEffect(() => { try { localStorage.setItem('nh-as-lang', recLang) } catch { /* */ } }, [recLang])
  // Tải sẵn danh sách nhân viên khi mở trợ lý (chỉ chủ / người phụ trách)
  useEffect(() => { if (open && !emps.current && isManagerSomewhere) loadEmployees().then((l) => { emps.current = l }) }, [open]) // eslint-disable-line

  function ctx(): AsCtx {
    const visible = app.restaurants.filter((r) => r.active || app.profile.is_owner)
    return {
      lang, today: todayIso(), currentRid,
      restaurants: visible.map((r) => ({ id: r.id, name: r.name })),
      employees: emps.current || [],
      isOwner: app.profile.is_owner,
      canManage: (rid) => app.profile.is_owner || canManageRole(app.roles[rid] || null),
    }
  }

  function speak(s: string) {
    if (!viaVoice.current || !('speechSynthesis' in window)) return
    try {
      const u = new SpeechSynthesisUtterance(s.split(' · ')[0])
      u.lang = de ? 'de-DE' : 'vi-VN'
      speechSynthesis.cancel(); speechSynthesis.speak(u)
    } catch { /* không đọc được thì thôi */ }
  }

  function close() { rec.current?.abort(); setOpen(false); setPhase('idle'); setText(''); setMsg(''); setPick(null) }

  function run(p: Plan) {
    if (p.kind === 'go') { close(); nav(p.to); toast(p.label); speak(p.label); return }
    if (p.kind === 'pickEmp' || p.kind === 'pickRest') { setPick(p); setPhase('pick'); speak(p.kind === 'pickEmp' ? T('Nhân viên nào?', 'Welcher Mitarbeiter?') : T('Nhà hàng nào?', 'Welches Restaurant?')); return }
    if (p.kind === 'deny') { setMsg(p.msg); setPhase('msg'); speak(p.msg); return }
    const m = T('Chưa hiểu câu lệnh. Thử nói tên trang và tên người, ví dụ "Bảng lương tháng 10 của Lina".', 'Befehl nicht verstanden. Z.B. „Lohnabrechnung Oktober von Lina“.')
    setMsg(m); setPhase('msg'); speak(T('Chưa hiểu, nói lại giúp nhé', 'Nicht verstanden, bitte noch einmal'))
  }

  async function handle(raw: string) {
    const s = raw.trim()
    if (!s) return
    setText(s); setPhase('think'); setMsg('')
    if (isManagerSomewhere && !emps.current) emps.current = await loadEmployees()
    const c = ctx()
    const local = parseLocal(s, c)
    if (local.sure) { run(planIntent(local, c)); return }
    const ai = await aiIntent(s, c)
    if (ai && ai.page !== 'unknown') { run(planIntent(ai, c)); return }
    if (local.page !== 'unknown') { run(planIntent(local, c)); return }
    if (ai?.reply) { setMsg(ai.reply); setPhase('msg'); speak(ai.reply); return }
    run({ kind: 'unknown' })
  }

  function listen() {
    if (!RecCtor) { setPhase('idle'); setTimeout(() => inp.current?.focus(), 50); return }
    rec.current?.abort()
    const r = new RecCtor()
    r.lang = recLang === 'de' ? 'de-DE' : 'vi-VN'
    r.interimResults = true; r.continuous = false; r.maxAlternatives = 1
    let final = '', got = false
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) final += x[0].transcript; else interim += x[0].transcript
      }
      setText((final + interim).trim())
    }
    r.onerror = (e) => {
      got = true
      const err = String(e?.error || '')
      if (err === 'no-speech' || err === 'aborted') { setPhase('idle'); return }
      setMsg(err === 'not-allowed' || err === 'service-not-allowed'
        ? T('Trình duyệt chưa cho dùng micro. Cho phép micro trong cài đặt trình duyệt, hoặc gõ câu lệnh bên dưới (bàn phím iPhone cũng có nút micro để đọc).', 'Mikrofon nicht erlaubt. Bitte im Browser erlauben oder den Befehl unten eintippen (die iPhone-Tastatur hat auch ein Mikrofon).')
        : T('Không nghe được. Thử lại hoặc gõ câu lệnh bên dưới.', 'Nicht verstanden. Nochmal versuchen oder eintippen.'))
      setPhase('msg')
    }
    r.onend = () => {
      rec.current = null
      if (got) return
      if (final.trim()) { viaVoice.current = true; handle(final) } else setPhase('idle')
    }
    rec.current = r
    setText(''); setMsg(''); setPick(null); setPhase('listen')
    try { r.start() } catch { setPhase('idle') }
  }

  function openIt() { setOpen(true); viaVoice.current = false; if (RecCtor) listen(); else setTimeout(() => inp.current?.focus(), 50) }

  // Phím tắt trên máy tính: Ctrl/⌘ + K
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!open) openIt() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }) // eslint-disable-line

  const choose = (p: Plan, id: string) => {
    if (p.kind === 'pickEmp') run(planIntent({ ...p.intent, empIds: [id], rid: null }, ctx()))
    if (p.kind === 'pickRest') run(planIntent({ ...p.intent, rid: id }, ctx()))
  }
  const restName = (rid: string) => app.restaurants.find((r) => r.id === rid)?.name || ''

  return <>
    <button className={`as-fab${/^\/r\/[^/]+\/hr\/[^/]+$/.test(path) ? ' hide-m' : ''}`} onClick={openIt} aria-label={T('Trợ lý giọng nói', 'Sprachassistent')} title={T('Trợ lý giọng nói (Ctrl+K)', 'Sprachassistent (Strg+K)')}>
      <MicIcon />
    </button>
    {open && (
      <div className="sheet-bg" onClick={close}>
        <div className="sheet as-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>{T('Trợ lý', 'Assistent')}</h2>
            <div className="row" style={{ gap: 6 }}>
              {RecCtor && <div className="seg as-lang" title={T('Ngôn ngữ nói', 'Sprache')}>
                {(['vi', 'de'] as const).map((l) => <button key={l} className={recLang === l ? 'sel' : ''} onClick={() => { setRecLang(l); if (phase === 'listen') setTimeout(listen, 0) }}>{l.toUpperCase()}</button>)}
              </div>}
              <button className="ghost" onClick={close} aria-label="close">✕</button>
            </div>
          </div>

          <div className="as-stage">
            <button className={`as-mic${phase === 'listen' ? ' on' : ''}${phase === 'think' ? ' think' : ''}`} disabled={phase === 'think'}
              onClick={() => (phase === 'listen' ? rec.current?.stop() : listen())} aria-label={T('Nói', 'Sprechen')}>
              {phase === 'think' ? <span className="spinner sm" /> : <MicIcon />}
            </button>
            <div className="as-said">{text || <span className="muted">{phase === 'listen' ? T('Đang nghe…', 'Ich höre zu…') : RecCtor ? T('Bấm micro rồi nói', 'Mikrofon tippen und sprechen') : T('Gõ câu lệnh bên dưới', 'Befehl unten eintippen')}</span>}</div>
            {phase === 'think' && <div className="small muted">{T('Đang tìm…', 'Suche…')}</div>}
          </div>

          {msg && <div className="alert warn">{msg}</div>}

          {phase === 'pick' && pick?.kind === 'pickEmp' && <>
            <div className="small muted" style={{ marginBottom: 6 }}>{T('Có nhiều nhân viên trùng tên, chọn một:', 'Mehrere Treffer, bitte wählen:')}</div>
            <div className="list">{pick.options.map((e) => (
              <button key={e.id} className="it as-opt" onClick={() => choose(pick, e.id)}>
                <b>{e.first_name} {e.last_name}</b><span className="muted small">{[e.personnel_no && `#${e.personnel_no}`, restName(e.restaurant_id)].filter(Boolean).join(' · ')}</span>
              </button>))}</div>
          </>}
          {phase === 'pick' && pick?.kind === 'pickRest' && <>
            <div className="small muted" style={{ marginBottom: 6 }}>{T('Nhà hàng nào?', 'Welches Restaurant?')}</div>
            <div className="list">{pick.options.map((r) => <button key={r.id} className="it as-opt" onClick={() => choose(pick, r.id)}><b>{r.name}</b></button>)}</div>
          </>}

          <form className="row as-form" onSubmit={(e) => { e.preventDefault(); rec.current?.abort(); viaVoice.current = false; handle(inp.current?.value || '') }}>
            <input ref={inp} key={text} defaultValue={text} enterKeyHint="go" placeholder={T('Ví dụ: bảng lương tháng 10 của Lina', 'Z.B. Lohnabrechnung Oktober von Lina')} />
            <button className="primary" type="submit" disabled={phase === 'think'}>{T('Tìm', 'Los')}</button>
          </form>

          {(phase === 'idle' || phase === 'msg') && <div className="as-ex">
            {EX[de ? 'de' : 'vi'].map((x) => <button key={x} className="chip" onClick={() => { viaVoice.current = false; handle(x) }}>{x}</button>)}
          </div>}
        </div>
      </div>
    )}
  </>
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /><path d="M8 21h8" />
  </svg>
}
