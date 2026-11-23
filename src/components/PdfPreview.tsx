// Hiện trực tiếp các trang của file PDF gốc (ảnh), để vừa xem vừa đối chiếu số liệu
import { useEffect, useState } from 'react'
import { pdfToImages } from '../lib/ocr'

export function PdfPreview({ url }: { url: string }) {
  const [pages, setPages] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(url).then((r) => r.blob()).then((b) => pdfToImages(b, 1.4)).then((p) => { if (alive) setPages(p) }).catch(() => alive && setPages([]))
    return () => { alive = false }
  }, [url])
  if (!pages) return <div className="small muted" style={{ padding: 12 }}>…</div>
  return <>{pages.map((p, i) => <a key={i} href={url} target="_blank" rel="noreferrer"><img src={p} alt="" className="pdf-page" /></a>)}</>
}
