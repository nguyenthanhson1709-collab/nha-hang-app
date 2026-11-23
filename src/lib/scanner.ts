// Máy scan trong app: nhận mép giấy, làm thẳng, làm trắng nền (OpenCV.js, tải khi cần)
/* eslint-disable @typescript-eslint/no-explicit-any */
type CV = any
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt] // trên-trái, trên-phải, dưới-phải, dưới-trái
export type Mode = 'scan' | 'gray' | 'color'

let cvP: Promise<CV> | null = null
export function loadCv(): Promise<CV> {
  if (cvP) return cvP
  cvP = new Promise((resolve, reject) => {
    const w = window as any
    // Không await module của Emscripten: nó có .then trả về chính nó -> treo
    const ready = async () => {
      if (w.cv instanceof Promise) w.cv = await w.cv
      const t0 = Date.now()
      const poll = () => {
        const c = w.cv
        // resolve() với object có .then sẽ lặp vô hạn: bỏ .then trước
        if (c?.Mat) { try { delete c.then } catch { c.then = undefined } resolve(c); return }
        if (Date.now() - t0 > 60000) { cvP = null; reject(new Error('opencv timeout')); return }
        setTimeout(poll, 50)
      }
      poll()
    }
    if (w.cv) { ready(); return }
    const s = document.createElement('script')
    s.src = `${import.meta.env.BASE_URL}opencv.js`
    s.async = true
    s.onload = () => ready()
    s.onerror = () => { cvP = null; reject(new Error('opencv')) }
    document.head.appendChild(s)
  })
  return cvP
}

function order(pts: Pt[]): Quad {
  const s = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = s[0], br = s[3]
  const rest = [s[1], s[2]].sort((a, b) => a.y - a.x - (b.y - b.x))
  return [tl, rest[0], br, rest[1]]
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Tìm tứ giác lớn nhất giống tờ giấy trên ảnh (toạ độ theo ảnh nguồn) */
export function detectQuad(cv: CV, src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, sw: number, sh: number): Quad | null {
  const W = 400, s = W / sw, H = Math.round(sh * s)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  c.getContext('2d', { willReadFrequently: true })!.drawImage(src as CanvasImageSource, 0, 0, W, H)
  const img = cv.imread(c)
  const gray = new cv.Mat(), edges = new cv.Mat(), contours = new cv.MatVector(), hier = new cv.Mat()
  let best: Quad | null = null
  try {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    cv.Canny(gray, edges, 40, 120)
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
    cv.dilate(edges, edges, k); k.delete()
    cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    let bestArea = W * H * 0.12
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area > bestArea) {
        const approx = new cv.Mat()
        const peri = cv.arcLength(cnt, true)
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true)
        let pts: Pt[] | null = null
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          pts = []; for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
        } else if (area > W * H * 0.2) {
          // bon dài, mép không thẳng: dùng hình chữ nhật xoay nhỏ nhất
          const r = cv.minAreaRect(cnt)
          const p = cv.RotatedRect.points(r) as Pt[]
          if (cv.contourArea(cnt) / (r.size.width * r.size.height) > 0.8) pts = p.map((q) => ({ x: q.x, y: q.y }))
        }
        if (pts) { best = order(pts.map((p) => ({ x: p.x / s, y: p.y / s }))); bestArea = area }
        approx.delete()
      }
      cnt.delete()
    }
  } finally { img.delete(); gray.delete(); edges.delete(); contours.delete(); hier.delete() }
  return best
}

/** Cắt theo tứ giác, làm thẳng, tăng chất lượng. Trả về canvas. */
export function warpAndEnhance(cv: CV, src: HTMLCanvasElement, quad: Quad | null, mode: Mode, maxSide = 2200): HTMLCanvasElement {
  const img = cv.imread(src)
  let out = new cv.Mat()
  try {
    if (quad) {
      const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]))
      const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]))
      const sc = Math.min(1, maxSide / Math.max(w, h))
      const ow = Math.round(w * sc), oh = Math.round(h * sc)
      const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]))
      const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, ow, 0, ow, oh, 0, oh])
      const M = cv.getPerspectiveTransform(from, to)
      cv.warpPerspective(img, out, M, new cv.Size(ow, oh), cv.INTER_LINEAR, cv.BORDER_REPLICATE)
      from.delete(); to.delete(); M.delete()
    } else {
      const sc = Math.min(1, maxSide / Math.max(img.cols, img.rows))
      cv.resize(img, out, new cv.Size(Math.round(img.cols * sc), Math.round(img.rows * sc)))
    }
    if (mode !== 'color') {
      const g = new cv.Mat()
      cv.cvtColor(out, g, cv.COLOR_RGBA2GRAY)
      if (mode === 'scan') {
        // chia cho nền (bóng, ánh sáng không đều) -> giấy trắng, chữ đậm
        const bg = new cv.Mat()
        const k = Math.max(31, (Math.round(Math.min(g.cols, g.rows) / 12) | 1))
        const el = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15))
        cv.morphologyEx(g, bg, cv.MORPH_CLOSE, el); el.delete()
        cv.GaussianBlur(bg, bg, new cv.Size(k, k), 0)
        cv.divide(g, bg, g, 255)
        cv.normalize(g, g, 0, 255, cv.NORM_MINMAX)
        // làm đậm chữ nhạt của giấy in nhiệt
        const lut = cv.matFromArray(1, 256, cv.CV_8U, Array.from({ length: 256 }, (_, i) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(i / 255, 1.5))))))
        cv.LUT(g, lut, g); lut.delete(); bg.delete()
      } else {
        const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8)); clahe.apply(g, g); clahe.delete()
      }
      out.delete(); out = g
    }
    const c = document.createElement('canvas')
    cv.imshow(c, out)
    return c
  } finally { img.delete(); out.delete() }
}

/** Độ nét nhanh trên khung nhỏ */
export function frameSharpness(cv: CV, video: HTMLVideoElement, quad: Quad | null): number {
  const vw = video.videoWidth, vh = video.videoHeight
  const W = 480, s = W / vw, H = Math.round(vh * s)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, W, H)
  const img = cv.imread(c), g = new cv.Mat(), lap = new cv.Mat(), mean = new cv.Mat(), sd = new cv.Mat()
  try {
    cv.cvtColor(img, g, cv.COLOR_RGBA2GRAY)
    let roi = g
    if (quad) {
      const xs = quad.map((p) => p.x * s), ys = quad.map((p) => p.y * s)
      const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys))
      const w = Math.min(W - x, Math.max(...xs) - x), h = Math.min(H - y, Math.max(...ys) - y)
      if (w > 20 && h > 20) roi = g.roi(new cv.Rect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h)))
    }
    cv.Laplacian(roi, lap, cv.CV_64F)
    cv.meanStdDev(lap, mean, sd)
    if (roi !== g) roi.delete()
    return sd.data64F[0] ** 2
  } finally { img.delete(); g.delete(); lap.delete(); mean.delete(); sd.delete() }
}

export function quadMoved(a: Quad | null, b: Quad | null, size: number) {
  if (!a || !b) return Infinity
  return Math.max(...a.map((p, i) => dist(p, b[i]))) / size
}

export function canvasToBlob(c: HTMLCanvasElement, q = 0.85): Promise<Blob> {
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', q))
}

/** Ảnh chụp sẵn (camera hệ thống / thư viện): tự cắt mép và làm thẳng */
export async function autoScanImage(file: Blob, mode: Mode = 'scan'): Promise<Blob> {
  const cv = await loadCv()
  const url = URL.createObjectURL(file)
  try {
    const img = new Image(); img.src = url; await img.decode()
    const max = 3000, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const quad = detectQuad(cv, c, c.width, c.height)
    return canvasToBlob(warpAndEnhance(cv, c, quad, mode))
  } finally { URL.revokeObjectURL(url) }
}
