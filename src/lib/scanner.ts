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

// iPhone (Safari) giới hạn tổng bộ nhớ canvas: dùng lại một canvas thay vì tạo mới mỗi khung hình
let work: HTMLCanvasElement | null = null
function workCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!work) work = document.createElement('canvas')
  if (work.width !== w) work.width = w
  if (work.height !== h) work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas')
  return ctx
}
/** Giải phóng bộ nhớ canvas ngay (Safari không tự dọn kịp) */
export function freeCanvas(c: HTMLCanvasElement) { c.width = 0; c.height = 0 }

function order(pts: Pt[]): Quad {
  const s = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = s[0], br = s[3]
  const rest = [s[1], s[2]].sort((a, b) => a.y - a.x - (b.y - b.x))
  return [tl, rest[0], br, rest[1]]
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

function quadFromEdges(cv: CV, edges: CV, W: number, H: number): Pt[] | null {
  const contours = new cv.MatVector(), hier = new cv.Mat()
  let best: Pt[] | null = null
  try {
    cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    let bestArea = W * H * 0.12
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area > bestArea && area < W * H * 0.97) {
        const approx = new cv.Mat()
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true)
        let pts: Pt[] | null = null
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          pts = []; for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
        } else if (area > W * H * 0.2) {
          // bon dài, mép không thẳng: dùng hình chữ nhật xoay nhỏ nhất
          const r = cv.minAreaRect(cnt)
          if (area / (r.size.width * r.size.height) > 0.8) pts = (cv.RotatedRect.points(r) as Pt[]).map((q) => ({ x: q.x, y: q.y }))
        }
        if (pts) { best = pts; bestArea = area }
        approx.delete()
      }
      cnt.delete()
    }
  } finally { contours.delete(); hier.delete() }
  return best
}

/** Giấy trắng trên nền trắng: không thấy mép, lấy vùng có chữ rồi nới ra một chút */
function quadFromText(cv: CV, gray: CV, W: number, H: number): Pt[] | null {
  const grad = new cv.Mat(), bw = new cv.Mat(), contours = new cv.MatVector(), hier = new cv.Mat()
  try {
    const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.morphologyEx(gray, grad, cv.MORPH_GRADIENT, k3); k3.delete()
    cv.threshold(grad, bw, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)
    // nối các chữ thành một khối
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.round(W / 25), Math.round(W / 40)))
    cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, k); k.delete()
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.morphologyEx(bw, bw, cv.MORPH_OPEN, k2); k2.delete()
    cv.findContours(bw, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    // gộp các khối lớn nằm gần khối lớn nhất (dòng chữ cách nhau)
    const boxes: { r: CV; area: number; cnt: CV }[] = []
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i), area = cv.contourArea(cnt)
      if (area > W * H * 0.002) boxes.push({ r: cv.boundingRect(cnt), area, cnt }); else cnt.delete()
    }
    if (!boxes.length) return null
    boxes.sort((a, b) => b.area - a.area)
    const main = boxes[0].r
    let x0 = main.x, y0 = main.y, x1 = main.x + main.width, y1 = main.y + main.height
    const pts: number[] = []
    for (const b of boxes) {
      const r = b.r
      const near = r.x < x1 + W * 0.05 && r.x + r.width > x0 - W * 0.05 && r.y < y1 + H * 0.06 && r.y + r.height > y0 - H * 0.06
      if (near) {
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height)
        for (let j = 0; j < b.cnt.rows; j++) pts.push(b.cnt.data32S[j * 2], b.cnt.data32S[j * 2 + 1])
      }
      b.cnt.delete()
    }
    if ((x1 - x0) * (y1 - y0) < W * H * 0.08 || (x1 - x0) * (y1 - y0) > W * H * 0.9) return null
    const m = cv.matFromArray(pts.length / 2, 1, cv.CV_32SC2, pts)
    const r = cv.minAreaRect(m); m.delete()
    // nới lề 5%
    r.size = { width: r.size.width * 1.08 + W * 0.02, height: r.size.height * 1.06 + W * 0.02 }
    return (cv.RotatedRect.points(r) as Pt[]).map((q) => ({ x: Math.max(0, Math.min(W, q.x)), y: Math.max(0, Math.min(H, q.y)) }))
  } finally { grad.delete(); bw.delete(); contours.delete(); hier.delete() }
}

/** Tìm tứ giác lớn nhất giống tờ giấy trên ảnh (toạ độ theo ảnh nguồn) */
export function detectQuad(cv: CV, src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, sw: number, sh: number): Quad | null {
  const W = 400, s = W / sw, H = Math.round(sh * s)
  const ctx = workCanvas(W, H)
  ctx.drawImage(src as CanvasImageSource, 0, 0, W, H)
  const img = cv.imread(ctx.canvas)
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat()
  let pts: Pt[] | null = null
  try {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0)
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
    // mép rõ trước, rồi mép mờ (giấy sáng trên nền sáng)
    for (const [lo, hi] of [[40, 120], [12, 36]]) {
      cv.Canny(blur, edges, lo, hi)
      cv.dilate(edges, edges, k)
      pts = quadFromEdges(cv, edges, W, H)
      if (pts) break
    }
    k.delete()
    if (!pts) pts = quadFromText(cv, gray, W, H)
  } finally { img.delete(); gray.delete(); blur.delete(); edges.delete() }
  return pts ? order(pts.map((p) => ({ x: p.x / s, y: p.y / s }))) : null
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
  const ctx = workCanvas(W, H)
  ctx.drawImage(video, 0, 0, W, H)
  const img = cv.imread(ctx.canvas), g = new cv.Mat(), lap = new cv.Mat(), mean = new cv.Mat(), sd = new cv.Mat()
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
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', q))
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
    const out = warpAndEnhance(cv, c, quad, mode)
    freeCanvas(c)
    try { return await canvasToBlob(out) } finally { freeCanvas(out) }
  } finally { URL.revokeObjectURL(url) }
}
