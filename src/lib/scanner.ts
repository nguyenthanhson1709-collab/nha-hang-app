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
    let bestArea = W * H * 0.25 // khung nhỏ hơn 1/4 ảnh thường là ô trong tờ giấy (bảng, khung chữ), không phải mép giấy
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
    // Không còn đoán mép theo vùng chữ: hay cắt mất đầu/cuối hoá đơn. Không chắc thì giữ cả ảnh.
  } finally { img.delete(); gray.delete(); blur.delete(); edges.delete() }
  if (!pts) return null
  const q = order(pts.map((p) => ({ x: p.x / s, y: p.y / s })))
  return pageLike(q, sw, sh) ? expand(q, sw, sh, 0.015) : null
}

/** Tờ giấy chụp dọc: cao ít nhất 0,8 lần rộng. Dải ngang (một đoạn bảng, ô ngân hàng...) bị loại để không cắt mất nội dung. */
function pageLike(q: Quad, sw: number, sh: number) {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
  return w * h >= sw * sh * 0.22 && h >= w * 0.8
}
/** Nới khung ra một chút để chữ sát mép không bị cắt */
function expand(q: Quad, sw: number, sh: number, f: number): Quad {
  const cx = q.reduce((a, p) => a + p.x, 0) / 4, cy = q.reduce((a, p) => a + p.y, 0) / 4
  return q.map((p) => ({ x: Math.max(0, Math.min(sw, p.x + (p.x - cx) * f * 2)), y: Math.max(0, Math.min(sh, p.y + (p.y - cy) * f * 2)) })) as Quad
}

/** Cỡ ảnh lưu: đủ đọc chữ, không nặng. Giới hạn theo số điểm ảnh (không theo cạnh dài) để bon dài vẫn đủ rộng. */
export const MAX_PIXELS = 2.4e6
export const MAX_SIDE = 3200
export function fitScale(w: number, h: number, maxPx = MAX_PIXELS, maxSide = MAX_SIDE) {
  return Math.min(1, Math.sqrt(maxPx / Math.max(1, w * h)), maxSide / Math.max(w, h))
}
/** Chất lượng JPEG: ảnh scan/xám nén mạnh hơn ảnh màu (khoảng 150-350 KB một trang) */
export const jpegQuality = (mode: Mode) => (mode === 'color' ? 0.78 : 0.7)

/** Cắt theo tứ giác, làm thẳng, tăng chất lượng. Trả về canvas. */
export function warpAndEnhance(cv: CV, src: HTMLCanvasElement, quad: Quad | null, mode: Mode): HTMLCanvasElement {
  const img = cv.imread(src)
  let out = new cv.Mat()
  try {
    if (quad) {
      const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]))
      const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]))
      const sc = fitScale(w, h)
      const ow = Math.round(w * sc), oh = Math.round(h * sc)
      const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]))
      const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, ow, 0, ow, oh, 0, oh])
      const M = cv.getPerspectiveTransform(from, to)
      cv.warpPerspective(img, out, M, new cv.Size(ow, oh), cv.INTER_LINEAR, cv.BORDER_REPLICATE)
      from.delete(); to.delete(); M.delete()
    } else {
      const sc = fitScale(img.cols, img.rows)
      cv.resize(img, out, new cv.Size(Math.round(img.cols * sc), Math.round(img.rows * sc)))
    }
    if (mode !== 'color') {
      const g = new cv.Mat()
      cv.cvtColor(out, g, cv.COLOR_RGBA2GRAY)
      if (mode === 'scan') {
        // chia cho nền (bóng, ánh sáng không đều) -> giấy trắng, chữ đậm
        // Nền tính trên ảnh nhỏ 1/4 rồi phóng lại: nhanh hơn ~15 lần trên điện thoại, kết quả gần như nhau
        const small = new cv.Mat(), bg = new cv.Mat()
        const f = 4
        cv.resize(g, small, new cv.Size(Math.max(8, Math.round(g.cols / f)), Math.max(8, Math.round(g.rows / f))), 0, 0, cv.INTER_AREA)
        const k = Math.max(9, (Math.round(Math.min(small.cols, small.rows) / 12) | 1))
        const el = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5))
        cv.morphologyEx(small, small, cv.MORPH_CLOSE, el); el.delete()
        cv.GaussianBlur(small, small, new cv.Size(k, k), 0)
        cv.resize(small, bg, new cv.Size(g.cols, g.rows), 0, 0, cv.INTER_LINEAR); small.delete()
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

/** Vùng trong khung có giống tờ giấy không: sáng, ít màu, đủ lớn. Tránh tự chụp bàn phím, mặt bàn, đồ vật tối. */
export function looksLikePaper(video: HTMLVideoElement, quad: Quad): boolean {
  const vw = video.videoWidth, vh = video.videoHeight
  const W = 160, s = W / vw, H = Math.max(1, Math.round(vh * s))
  // diện tích tứ giác (công thức dây giày) so với khung hình
  let a = 0
  for (let i = 0; i < 4; i++) { const p = quad[i], q = quad[(i + 1) % 4]; a += p.x * q.y - q.x * p.y }
  if (Math.abs(a) / 2 < vw * vh * 0.12) return false
  const ctx = workCanvas(W, H)
  ctx.drawImage(video, 0, 0, W, H)
  const xs = quad.map((p) => p.x * s), ys = quad.map((p) => p.y * s)
  // lấy phần giữa của khung bao (bỏ 20% mép) để không dính nền
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const ix = Math.max(0, Math.floor(x0 + (x1 - x0) * 0.2)), iy = Math.max(0, Math.floor(y0 + (y1 - y0) * 0.2))
  const iw = Math.min(W - ix, Math.ceil((x1 - x0) * 0.6)), ih = Math.min(H - iy, Math.ceil((y1 - y0) * 0.6))
  if (iw < 4 || ih < 4) return false
  const d = ctx.getImageData(ix, iy, iw, ih).data
  let lum = 0, sat = 0, n = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    lum += 0.299 * r + 0.587 * g + 0.114 * b
    sat += Math.max(r, g, b) - Math.min(r, g, b); n++
  }
  lum /= n; sat /= n
  return lum > 85 && sat < 70 // giấy dưới đèn yếu ~100, bàn phím/mặt bàn tối ~50
}

/** Độ nét nhanh (không cần OpenCV): năng lượng cạnh trên ảnh xám nhỏ. Dùng để chọn khung ít rung nhất khi chụp. */
export function quickSharpness(video: HTMLVideoElement): number {
  const W = 240, H = Math.max(1, Math.round(video.videoHeight * W / video.videoWidth))
  const ctx = workCanvas(W, H)
  ctx.drawImage(video, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const g = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  let e = 0
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]
    e += l * l
  }
  return e / (W * H)
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
    // ảnh điện thoại 12 MP: thu về ~6 MP trước khi xử lý (đủ nét, nhanh hơn nhiều)
    const s = fitScale(img.naturalWidth, img.naturalHeight, 6e6, 4000)
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const quad = detectQuad(cv, c, c.width, c.height)
    const out = warpAndEnhance(cv, c, quad, mode)
    freeCanvas(c)
    try { return await canvasToBlob(out, jpegQuality(mode)) } finally { freeCanvas(out) }
  } finally { URL.revokeObjectURL(url) }
}
