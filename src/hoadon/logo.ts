// Logo hoá đơn: cắt viền trắng / trong suốt quanh logo để logo in to và rõ trên PDF

/** Cắt viền trắng hoặc trong suốt, thu nhỏ vừa maxW × maxH, trả về PNG data URL */
export function trimToDataUrl(src: CanvasImageSource & { width: number; height: number }, maxW = 600, maxH = 300): string {
  const w0 = src.width, h0 = src.height
  const full = document.createElement('canvas'); full.width = w0; full.height = h0
  const fx = full.getContext('2d')!
  fx.drawImage(src, 0, 0)
  const d = fx.getImageData(0, 0, w0, h0).data
  let x0 = w0, y0 = h0, x1 = -1, y1 = -1
  for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
    const i = (y * w0 + x) * 4
    if (d[i + 3] > 16 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < x0) { x0 = 0; y0 = 0; x1 = w0 - 1; y1 = h0 - 1 }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const scale = Math.min(1, maxW / cw, maxH / ch)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cw * scale)); canvas.height = Math.max(1, Math.round(ch * scale))
  canvas.getContext('2d')!.drawImage(full, x0, y0, cw, ch, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

const cache = new Map<string, string>()
/** Logo đã lưu (data URL hoặc đường dẫn) -> bản đã cắt viền. Lỗi thì trả lại nguyên bản. */
export async function trimLogoUrl(url: string): Promise<string> {
  if (typeof document === 'undefined') return url
  const hit = cache.get(url)
  if (hit) return hit
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const out = trimToDataUrl(img, 1200, 600)
    cache.set(url, out)
    return out
  } catch { return url }
}
