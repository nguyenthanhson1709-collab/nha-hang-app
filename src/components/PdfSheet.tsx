import { useEffect, useMemo, useRef } from 'react'
import { useLang } from '../lib/i18n'

/** Xem trước PDF ngay trong app (toàn màn hình), rồi mới lưu / in / tải về */
export default function PdfSheet({ pdf, title, onClose, actions }: {
  pdf: Blob; title: string; onClose: () => void
  actions: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[]
}) {
  const { lang } = useLang()
  const T = (vi: string, de: string) => (lang === 'de' ? de : vi)
  const url = useMemo(() => URL.createObjectURL(pdf), [pdf])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const frame = useRef<HTMLIFrameElement>(null)
  const print = () => {
    if (pdf.type.startsWith('image/')) {
      const w = window.open('', '_blank')
      if (!w) return
      w.document.write(`<title>${title.replace(/</g, '')}</title><style>@page{margin:10mm}body{margin:0}img{max-width:100%}</style><img src="${url}" onload="setTimeout(()=>print(),200)">`)
      w.document.close()
      return
    }
    try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() } catch { window.open(url, '_blank') }
  }
  return (
    <div className="pv-bg" role="dialog" aria-label={title}>
      <div className="pv">
        <div className="pv-h">
          <b className="grow">{title}</b>
          <button className="ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        {pdf.type.startsWith('image/')
          ? <div className="pv-frame pv-img"><img src={url} alt={title} /></div>
          : <iframe ref={frame} className="pv-frame" src={`${url}#view=FitH`} title={title} />}
        <div className="pv-f">
          <button onClick={() => window.open(url, '_blank')}>{T('Mở toàn trang', 'In neuem Tab öffnen')}</button>
          <button onClick={print}>{T('In', 'Drucken')}</button>
          {actions.map((a) => <button key={a.label} className={a.primary ? 'primary' : ''} disabled={a.disabled} onClick={a.onClick}>{a.label}</button>)}
        </div>
      </div>
    </div>
  )
}
