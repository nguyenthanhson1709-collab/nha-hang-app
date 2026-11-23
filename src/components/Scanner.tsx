import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { canvasToBlob, detectQuad, frameSharpness, loadCv, quadMoved, warpAndEnhance, type Mode, type Quad } from '../lib/scanner'

export interface ScannedPage { blob: Blob; preview: string }

const TXT = {
  vi: { loading: 'Đang mở máy scan…', hold: 'Đưa cả tờ giấy vào khung', steady: 'Giữ yên…', shot: 'Đã chụp', next: 'Đã chụp. Đổi sang trang tiếp hoặc bấm Xong', done: 'Xong', auto: 'Tự chụp', noCam: 'Không mở được camera. Hãy cho phép dùng camera, hoặc dùng nút chụp ảnh thường.', pages: 'trang', modes: { scan: 'Scan', gray: 'Xám', color: 'Màu' } },
  de: { loading: 'Scanner wird geladen…', hold: 'Ganzes Blatt in den Rahmen', steady: 'Ruhig halten…', shot: 'Aufgenommen', next: 'Aufgenommen. Nächste Seite oder Fertig', done: 'Fertig', auto: 'Auto', noCam: 'Kamera nicht verfügbar. Bitte Zugriff erlauben oder normales Foto nutzen.', pages: 'Seiten', modes: { scan: 'Scan', gray: 'Grau', color: 'Farbe' } },
}

export default function Scanner({ onDone, onCancel }: { onDone: (pages: ScannedPage[]) => void; onCancel: () => void }) {
  const { lang } = useLang()
  const T = TXT[lang]
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hint, setHint] = useState(T.loading)
  const [pages, setPages] = useState<ScannedPage[]>([])
  const [auto, setAuto] = useState(true)
  const [mode, setMode] = useState<Mode>('scan')
  const [flash, setFlash] = useState(false)
  const [torch, setTorch] = useState<boolean | null>(null)
  const st = useRef({ quad: null as Quad | null, shotQuad: null as Quad | null, stable: 0, busy: false, lastShot: 0, auto: true, mode: 'scan' as Mode, stream: null as MediaStream | null })

  useEffect(() => { st.current.auto = auto }, [auto])
  useEffect(() => { st.current.mode = mode }, [mode])

  useEffect(() => {
    let stop = false, timer = 0
    ;(async () => {
      try {
        const [cv, stream] = await Promise.all([
          loadCv(),
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } }),
        ])
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
        st.current.stream = stream
        const v = video.current!
        v.srcObject = stream
        await v.play()
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() || {}) as { torch?: boolean }
        if (caps.torch) setTorch(false)
        setStatus('ready'); setHint(T.hold)
        const loop = () => {
          if (stop) return
          if (!st.current.busy && v.videoWidth) {
            const q = detectQuad(cv, v, v.videoWidth, v.videoHeight)
            const moved = quadMoved(q, st.current.quad, Math.max(v.videoWidth, v.videoHeight))
            st.current.stable = q && moved < 0.015 ? st.current.stable + 1 : 0
            st.current.quad = q
            // sau khi chụp: chờ đổi sang tờ khác (giấy rời khỏi khung hoặc dịch chuyển nhiều) mới tự chụp tiếp
            if (st.current.shotQuad && (!q || quadMoved(q, st.current.shotQuad, Math.max(v.videoWidth, v.videoHeight)) > 0.12)) st.current.shotQuad = null
            draw(q, v)
            if (q && st.current.stable >= 2) {
              setHint(T.steady)
              if (st.current.shotQuad) setHint(T.next)
              else if (st.current.auto && st.current.stable >= 4 && Date.now() - st.current.lastShot > 1500 && frameSharpness(cv, v, q) > 60) capture(cv)
            } else setHint(st.current.shotQuad ? T.next : q ? T.steady : T.hold)
          }
          timer = window.setTimeout(loop, 220)
        }
        loop()
      } catch {
        setStatus('error'); setHint(T.noCam)
      }
    })()
    return () => { stop = true; clearTimeout(timer); st.current.stream?.getTracks().forEach((t) => t.stop()) }
  }, []) // eslint-disable-line

  function draw(q: Quad | null, v: HTMLVideoElement) {
    const c = overlay.current; if (!c) return
    const r = v.getBoundingClientRect()
    c.width = r.width; c.height = r.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (!q) return
    // video dùng object-fit: cover
    const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight)
    const ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2
    ctx.beginPath()
    q.forEach((p, i) => (i ? ctx.lineTo(p.x * s + ox, p.y * s + oy) : ctx.moveTo(p.x * s + ox, p.y * s + oy)))
    ctx.closePath()
    ctx.fillStyle = 'rgba(79,179,147,0.18)'; ctx.fill()
    ctx.lineWidth = 3; ctx.strokeStyle = st.current.stable >= 2 ? '#4fb393' : '#f0a640'; ctx.stroke()
  }

  async function capture(cvIn?: unknown) {
    const v = video.current; if (!v || st.current.busy) return
    st.current.busy = true
    try {
      const cv = cvIn || (await loadCv())
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      const q = st.current.quad || detectQuad(cv, c, c.width, c.height)
      const out = warpAndEnhance(cv, c, q, st.current.mode)
      const blob = await canvasToBlob(out)
      setPages((p) => [...p, { blob, preview: URL.createObjectURL(blob) }])
      setFlash(true); setTimeout(() => setFlash(false), 180)
      setHint(T.shot)
      st.current.lastShot = Date.now(); st.current.stable = 0; st.current.shotQuad = q
      navigator.vibrate?.(40)
    } finally { st.current.busy = false }
  }

  async function toggleTorch() {
    const track = st.current.stream?.getVideoTracks()[0]
    if (!track) return
    const on = !torch
    try { await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); setTorch(on) } catch { /* */ }
  }

  const bar: React.CSSProperties = { position: 'absolute', left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }
  const pill = (on: boolean): React.CSSProperties => ({ minHeight: 36, padding: '4px 12px', borderRadius: 999, background: on ? '#fff' : 'rgba(255,255,255,.15)', color: on ? '#000' : '#fff', border: 0 })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#000', color: '#fff' }}>
      <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <canvas ref={overlay} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {flash && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.7 }} />}

      <div style={{ ...bar, top: 0, paddingTop: 'max(10px, env(safe-area-inset-top))', background: 'linear-gradient(rgba(0,0,0,.6), transparent)' }}>
        <button onClick={onCancel} style={{ ...pill(false), minHeight: 40 }} aria-label="close">✕</button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{hint}</div>
        {torch !== null && <button onClick={toggleTorch} style={pill(!!torch)} aria-label="torch">🔦</button>}
      </div>

      {status === 'loading' && <div className="center" style={{ position: 'absolute', inset: 0 }}><div className="spinner" /></div>}

      <div style={{ ...bar, bottom: 0, flexDirection: 'column', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', background: 'linear-gradient(transparent, rgba(0,0,0,.75))' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['scan', 'gray', 'color'] as Mode[]).map((m) => <button key={m} style={pill(mode === m)} onClick={() => setMode(m)}>{T.modes[m]}</button>)}
          <button style={pill(auto)} onClick={() => setAuto(!auto)}>{T.auto} {auto ? '✓' : ''}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', gap: 6, overflowX: 'auto' }}>
            {pages.map((p, i) => (
              <img key={i} src={p.preview} alt="" onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))}
                style={{ height: 56, width: 42, objectFit: 'cover', borderRadius: 6, border: '2px solid #fff' }} />
            ))}
          </div>
          <button aria-label="shutter" disabled={status !== 'ready'} onClick={() => capture()}
            style={{ width: 72, height: 72, borderRadius: '50%', border: '4px solid #fff', background: 'rgba(255,255,255,.25)', minHeight: 0, padding: 0 }} />
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <button disabled={!pages.length} onClick={() => onDone(pages)} style={{ ...pill(true), minHeight: 44, fontWeight: 700 }}>
              {T.done}{pages.length ? ` (${pages.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
