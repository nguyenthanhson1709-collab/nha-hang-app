// Trợ lý giọng nói: hiểu câu lệnh (Việt / Đức) và tìm trang cần mở.
// Bước 1 đọc nhanh trên máy (từ khoá, tên quán, tên nhân viên, tháng). Không chắc thì hỏi AI (edge function nh-assist).
// Quyền: chỉ chọn trong quán / nhân viên mà tài khoản đang thấy, và kiểm tra vai trò trước khi mở.
import { supabase } from './supabase'

export type PageKey =
  | 'home' | 'restaurants' | 'allReports' | 'settings'
  | 'scan' | 'scanZ' | 'scanSales' | 'review' | 'archive' | 'kb' | 'viva' | 'reports' | 'bwa' | 'statements' | 'contracts'
  | 'hr' | 'employee' | 'payslip' | 'empContract' | 'leave' | 'plan'
  | 'bk' | 'inv' | 'invNew' | 'quotes' | 'customers' | 'articles' | 'rc' | 'ingredients' | 'concepts'

export type AsLang = 'vi' | 'de' | 'en'
export type Folder = 'Bargeld' | 'Rechnungseingang' | 'Rechnungsausgang'
export interface AsEmp { id: string; first_name: string; last_name: string; restaurant_id: string; personnel_no: string | null }
export interface AsRest { id: string; name: string }
export interface AsCtx {
  lang: AsLang
  today: string // YYYY-MM-DD (Berlin)
  restaurants: AsRest[]
  currentRid: string | null
  employees: AsEmp[]
  isOwner: boolean
  canManage: (rid: string) => boolean
}
export interface Intent { page: PageKey | 'unknown'; rid: string | null; empIds: string[]; month: string | null; folder?: Folder | null }

type Scope = 'rest' | 'global'
interface PageDef { scope: Scope; vi: string; de: string; en: string; kw: string[]; manage?: boolean; owner?: boolean; emp?: boolean; month?: boolean }

/** Danh mục trang. kw: từ khoá đã bỏ dấu, viết thường (so khớp nguyên từ). */
export const PAGES: Record<PageKey, PageDef> = {
  home: { scope: 'rest', vi: 'Trang chủ', de: 'Startseite', en: 'Home', kw: ['trang chu', 've trang chu', 'startseite', 'home', 'home page', 'go home', 'start page'] },
  restaurants: { scope: 'global', owner: true, vi: 'Danh sách nhà hàng', de: 'Restaurantliste', en: 'Restaurant list', kw: ['danh sach nha hang', 'cac nha hang', 'tat ca nha hang', 'alle restaurants', 'restaurantliste', 'restaurants', 'all restaurants', 'restaurant list'] },
  allReports: { scope: 'global', owner: true, month: true, vi: 'Báo cáo tất cả nhà hàng', de: 'Berichte aller Restaurants', en: 'Reports for all restaurants', kw: ['bao cao tat ca', 'so sanh nha hang', 'so sanh cac quan', 'restaurants vergleichen', 'vergleich', 'compare restaurants', 'all reports'] },
  settings: { scope: 'rest', vi: 'Cài đặt', de: 'Einstellungen', en: 'Settings', kw: ['cai dat', 'thiet lap', 'einstellung', 'einstellungen', 'settings', 'setting'] },
  scan: { scope: 'rest', vi: 'Scan hoá đơn', de: 'Beleg scannen', en: 'Scan receipts', kw: ['scan', 'quet', 'chup hoa don', 'chup', 'quet hoa don', 'tai hoa don', 'scannen', 'beleg scannen', 'scan receipt', 'scan receipts', 'scan invoice'] },
  scanZ: { scope: 'rest', vi: 'Scan Z-Bon', de: 'Z-Bon scannen', en: 'Scan Z report', kw: ['z bon', 'zbon', 'zet bon', 'z bericht', 'tagesabschluss', 'z report', 'z reports', 'daily report'] },
  scanSales: { scope: 'rest', vi: 'Scan hoá đơn thu tiền', de: 'Ausgangsrechnung scannen', en: 'Scan sales invoice', kw: ['hoa don thu tien', 'ausgangsrechnung scannen', 'scan sales invoice'] },
  review: { scope: 'rest', manage: true, vi: 'Chờ kiểm tra', de: 'Zu prüfen', en: 'To review', kw: ['cho kiem tra', 'can kiem tra', 'cho duyet', 'can duyet', 'duyet hoa don', 'zu prufen', 'prufen', 'to review', 'pending review', 'pending', 'review'] },
  archive: { scope: 'rest', manage: true, month: true, vi: 'Chứng từ', de: 'Belege', en: 'Documents', kw: ['chung tu', 'luu tru', 'hoa don', 'hoa don mua', 'hoa don mua vao', 'hoa don dau vao', 'hoa don dau ra', 'belege', 'beleg', 'archiv', 'bargeld', 'rechnungseingang', 'rechnungsausgang', 'eingangsrechnung', 'eingangsrechnungen', 'documents', 'receipts', 'invoices', 'cash receipts', 'incoming invoices', 'outgoing invoices', 'purchase invoices'] },
  kb: { scope: 'rest', manage: true, month: true, vi: 'Kassenbuch', de: 'Kassenbuch', en: 'Cash book', kw: ['kassenbuch', 'kassen buch', 'kasse buch', 'kasa buch', 'so quy', 'so tien mat', 'ton quy', 'kassenbestand', 'cash book', 'cashbook', 'cash register book', 'cash balance'] },
  viva: { scope: 'rest', manage: true, vi: 'Viva Wallet', de: 'Viva Wallet', en: 'Viva Wallet', kw: ['viva', 'viva wallet', 'may the', 'may quet the', 'kartenterminal', 'card terminal'] },
  reports: { scope: 'rest', manage: true, month: true, vi: 'Báo cáo', de: 'Berichte', en: 'Reports', kw: ['bao cao', 'thong ke', 'doanh thu', 'chi phi', 'tien chi', 'bericht', 'berichte', 'auswertung', 'statistik', 'umsatz', 'ausgaben', 'report', 'reports', 'statistics', 'revenue', 'expenses', 'sales'] },
  bwa: { scope: 'rest', manage: true, month: true, vi: 'BWA', de: 'BWA', en: 'BWA', kw: ['bwa', 'be ve a', 'b w a', 'betriebswirtschaftliche auswertung'] },
  statements: { scope: 'rest', manage: true, vi: 'Sao kê ngân hàng', de: 'Kontoauszüge', en: 'Bank statements', kw: ['sao ke', 'sao ke ngan hang', 'ngan hang', 'kontoauszug', 'kontoauszuge', 'bank', 'bank statement', 'bank statements'] },
  contracts: { scope: 'rest', manage: true, vi: 'Hợp đồng', de: 'Verträge', en: 'Contracts', kw: ['hop dong', 'vertrag', 'vertrage', 'contract', 'contracts'] },
  hr: { scope: 'rest', manage: true, vi: 'Nhân sự', de: 'Personal', en: 'Staff', kw: ['nhan su', 'nhan vien', 'danh sach nhan vien', 'personal', 'mitarbeiter', 'personalliste', 'staff', 'employees', 'staff list', 'human resources'] },
  employee: { scope: 'rest', manage: true, emp: true, vi: 'Hồ sơ nhân viên', de: 'Personalakte', en: 'Employee file', kw: ['ho so', 'ho so nhan vien', 'thong tin', 'personalakte', 'akte', 'profil', 'employee file', 'personnel file', 'employee profile'] },
  payslip: { scope: 'rest', manage: true, emp: true, month: true, vi: 'Bảng lương', de: 'Lohnabrechnung', en: 'Payslip', kw: ['luong', 'bang luong', 'phieu luong', 'tien luong', 'lohn', 'gehalt', 'lohnabrechnung', 'lohnzettel', 'gehaltsabrechnung', 'abrechnung', 'payslip', 'payslips', 'pay slip', 'salary', 'payroll', 'wage', 'wages', 'pay stub'] },
  empContract: { scope: 'rest', manage: true, emp: true, vi: 'Hợp đồng lao động', de: 'Arbeitsvertrag', en: 'Employment contract', kw: ['hop dong lao dong', 'arbeitsvertrag', 'arbeitsvertrage', 'employment contract', 'work contract'] },
  leave: { scope: 'rest', manage: true, emp: true, vi: 'Giờ làm và nghỉ phép', de: 'Arbeitszeit und Urlaub', en: 'Working hours and leave', kw: ['nghi phep', 'ngay phep', 'phep', 'gio lam', 'urlaub', 'arbeitszeit', 'stunden', 'krank', 'nghi om', 'vacation', 'holiday', 'holidays', 'leave', 'working hours', 'sick leave'] },
  plan: { scope: 'rest', manage: true, month: true, vi: 'Lịch làm (Dienstplan)', de: 'Dienstplan', en: 'Shift plan', kw: ['lich lam', 'lich lam viec', 'xep lich', 'ca lam', 'dienstplan', 'arbeitsplan', 'schichtplan', 'schedule', 'shift plan', 'roster', 'work schedule', 'shifts'] },
  bk: { scope: 'rest', manage: true, vi: 'Bàn đặt', de: 'Reservierungen', en: 'Reservations', kw: ['dat ban', 'ban dat', 'dat cho', 'reservierung', 'reservierungen', 'reservation', 'tischplan', 'booking', 'bookings', 'table booking', 'reservations'] },
  inv: { scope: 'rest', manage: true, vi: 'Viết hoá đơn', de: 'Rechnungen', en: 'Invoicing', kw: ['viet hoa don', 'hoa don ban', 'hoa don da viet', 'rechnung', 'rechnungen', 'rechnung schreiben', 'write invoice', 'sales invoices', 'invoicing'] },
  invNew: { scope: 'rest', manage: true, vi: 'Hoá đơn mới', de: 'Neue Rechnung', en: 'New invoice', kw: ['viet hoa don moi', 'tao hoa don', 'hoa don moi', 'neue rechnung', 'rechnung erstellen', 'new invoice', 'create invoice'] },
  quotes: { scope: 'rest', manage: true, vi: 'Angebot', de: 'Angebote', en: 'Quotes', kw: ['angebot', 'angebote', 'bao gia', 'quote', 'quotes', 'offer', 'offers'] },
  customers: { scope: 'rest', manage: true, vi: 'Khách hàng', de: 'Kunden', en: 'Customers', kw: ['khach hang', 'kunden', 'kunde', 'kundenliste', 'customer', 'customers', 'clients'] },
  articles: { scope: 'rest', manage: true, vi: 'Danh mục món bán', de: 'Artikel', en: 'Articles', kw: ['mat hang ban', 'danh muc mon', 'artikel', 'artikelliste', 'articles', 'menu items'] },
  rc: { scope: 'rest', vi: 'Công thức', de: 'Rezepte', en: 'Recipes', kw: ['cong thuc', 'mon an', 'thuc don', 'rezept', 'rezepte', 'speisekarte', 'recipe', 'recipes', 'menu'] },
  ingredients: { scope: 'rest', manage: true, vi: 'Nguyên liệu', de: 'Zutaten', en: 'Ingredients', kw: ['nguyen lieu', 'gia nguyen lieu', 'zutaten', 'zutat', 'ingredients', 'ingredient'] },
  concepts: { scope: 'rest', vi: 'Concept', de: 'Konzepte', en: 'Concepts', kw: ['concept', 'khai niem', 'konzept', 'konzepte', 'concepts'] },
}

/** Bỏ dấu, viết thường, chỉ giữ chữ và số */
export const norm = (s: string) => ` ${s.toLowerCase().replace(/đ/g, 'd').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
const has = (t: string, kw: string) => t.includes(` ${kw} `)

const VI_NUM: [string, number][] = [['muoi hai', 12], ['muoi mot', 11], ['muoi', 10], ['mot', 1], ['gieng', 1], ['hai', 2], ['ba', 3], ['bon', 4], ['tu', 4], ['nam', 5], ['sau', 6], ['bay', 7], ['tam', 8], ['chin', 9], ['chap', 12]]
const EN_MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DE_MON = ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
function shift(today: string, n: number) {
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + n, 1)
  return ym(d.getFullYear(), d.getMonth() + 1)
}

/** Tìm tháng trong câu. Trả về tháng và các từ đã dùng (để không nhầm là tên người). */
export function parseMonth(t: string, today: string): { month: string | null; used: string[] } {
  const cy = Number(today.slice(0, 4)), cm = Number(today.slice(5, 7))
  const yr = t.match(/ (?:(?:nam|jahr) )?(20\d\d) /)
  const withYear = (m: number) => (yr ? Number(yr[1]) : m > cm ? cy - 1 : cy)
  const used = yr ? yr[0].trim().split(' ') : []
  const rel: [RegExp, number][] = [[/ thang (nay|hien tai) /, 0], [/ thang (truoc|roi|vua roi|vua qua) /, -1], [/ (diesen|dieser|aktuellen|aktueller) monat /, 0], [/ (letzten|letzter|vorigen|voriger) monat /, -1], [/ vormonat /, -1], [/ (this|current) month /, 0], [/ (last|previous) month /, -1]]
  for (const [re, n] of rel) { const m = t.match(re); if (m) return { month: shift(today, n), used: [...used, ...m[0].trim().split(' ')] } }
  const num = t.match(/ (?:thang|monat|month) (\d{1,2}) /) || t.match(/ (\d{1,2}) (20\d\d) /)
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12) return { month: ym(withYear(Number(num[1])), Number(num[1])), used: [...used, ...num[0].trim().split(' ')] }
  for (const [w, n] of VI_NUM) if (has(t, `thang ${w}`)) return { month: ym(withYear(n), n), used: [...used, 'thang', ...w.split(' ')] }
  for (let i = 0; i < 12; i++) if (has(t, DE_MON[i]) || (i === 2 && has(t, 'maerz'))) return { month: ym(withYear(i + 1), i + 1), used: [...used, DE_MON[i], 'maerz'] }
  // 'may' (tháng 5) cũng là động từ tiếng Anh: chỉ nhận khi đi với 'in/for/of'
  for (let i = 0; i < 12; i++) if (i === 4 ? / (in|for|of) may /.test(t) : has(t, EN_MON[i])) return { month: ym(withYear(i + 1), i + 1), used: [...used, EN_MON[i]] }
  return { month: null, used }
}

// Từ chung, không phải tên người
const STOP = new Set(('toi can cho xem mo tim kiem hien giup voi cua anh chi em ban ong ba co chu bac nhan vien cai nay kia la di nhe a oi va thi o tai nha hang quan thang ngay hom nay qua lai ra len cac nhung mot de duoc khong so '
  + 'ich will bitte zeig zeige mir offne oeffne suche finde den die das der des dem von vom fur fuer im in am und mit monat jahr restaurant mitarbeiter mitarbeiterin herr frau nr nummer '
  + 'i need show me open the of for please find get from my employee month year to in at and with number no').split(' '))

/** Tên quán được nhắc tới (bỏ phần chung của mọi quán như "Vietbowl") */
export function matchRestaurant(t: string, rs: AsRest[]): { rid: string | null; used: string[] } {
  const toks = rs.map((r) => norm(r.name).trim().split(' ').filter((w) => w.length >= 3))
  const common = new Set(toks.length > 1 ? toks[0].filter((w) => toks.every((x) => x.includes(w))) : [])
  let best: { rid: string; n: number; used: string[] } | null = null, tie = false
  rs.forEach((r, i) => {
    const used = toks[i].filter((w) => !common.has(w) && !['restaurant', 'nha', 'hang', 'quan'].includes(w) && has(t, w))
    if (!used.length) return
    if (!best || used.length > best.n) { best = { rid: r.id, n: used.length, used }; tie = false } else if (used.length === best.n) tie = true
  })
  const b = best as { rid: string; used: string[] } | null
  return b && !tie ? { rid: b.rid, used: b.used } : { rid: null, used: [] }
}

/** Nhân viên có tên khớp với các từ còn lại của câu. Trả về nhóm khớp nhiều từ nhất. */
export function matchEmployees(words: string[], emps: AsEmp[]): AsEmp[] {
  if (!words.length) return []
  const ws = new Set(words)
  let best: AsEmp[] = [], bestN = 0
  for (const e of emps) {
    const name = norm(`${e.first_name} ${e.last_name}`).trim().split(' ').filter(Boolean)
    let n = name.filter((w) => ws.has(w)).length
    if (e.personnel_no && ws.has(norm(e.personnel_no).trim())) n += 2
    if (!n) continue
    if (n > bestN) { best = [e]; bestN = n } else if (n === bestN) best.push(e)
  }
  return best
}

/** Đọc câu lệnh trên máy. `sure` = đủ chắc để mở luôn, khỏi hỏi AI. */
export function parseLocal(text: string, ctx: AsCtx): Intent & { sure: boolean } {
  const t = norm(text)
  let page: PageKey | 'unknown' = 'unknown', len = 0
  const used: string[] = []
  for (const k of Object.keys(PAGES) as PageKey[]) {
    for (const kw of PAGES[k].kw) if (kw.length > len && has(t, kw)) { page = k; len = kw.length }
  }
  for (const k of Object.keys(PAGES) as PageKey[]) for (const kw of PAGES[k].kw) if (has(t, kw)) used.push(...kw.split(' '))
  const mo = parseMonth(t, ctx.today)
  const re = matchRestaurant(t, ctx.restaurants)
  const skip = new Set([...used, ...mo.used, ...re.used])
  const rest = t.trim().split(' ').filter((w) => w && !skip.has(w) && !STOP.has(w) && (w.length >= 2 || /\d/.test(w)))
  // Ưu tiên nhân viên của quán được nhắc tới / quán đang mở
  const rid0 = re.rid || ctx.currentRid
  let emps = matchEmployees(rest, ctx.employees)
  if (rid0 && emps.some((e) => e.restaurant_id === rid0)) emps = emps.filter((e) => e.restaurant_id === rid0)
  if (emps.length) {
    if (page === 'unknown' || page === 'hr') page = 'employee'
    else if (page === 'contracts') page = 'empContract'
  }
  const folder: Folder | null = page !== 'archive' ? null
    : /( bargeld | tien mat | cash )/.test(t) ? 'Bargeld'
    : /( rechnungseingang | eingangsrechnung\w* | mua vao | dau vao | incoming | purchase )/.test(t) ? 'Rechnungseingang'
    : /( rechnungsausgang | dau ra | ban ra | outgoing )/.test(t) ? 'Rechnungsausgang' : null
  const leftover = rest.filter((w) => !emps.some((e) => norm(`${e.first_name} ${e.last_name} ${e.personnel_no || ''}`).includes(` ${w} `)))
  // Chắc chắn khi: đã biết trang, và nếu trang có thể theo nhân viên thì không còn từ lạ (có thể là tên nghe nhầm)
  const sure = page !== 'unknown' && (!PAGES[page].emp || page === 'hr' || !leftover.length)
  return { page, rid: re.rid, empIds: emps.map((e) => e.id), month: mo.month, folder, sure }
}

export type Plan =
  | { kind: 'go'; to: string; label: string }
  | { kind: 'pickEmp'; intent: Intent; options: AsEmp[] }
  | { kind: 'pickRest'; intent: Intent; options: AsRest[] }
  | { kind: 'deny'; msg: string }
  | { kind: 'unknown' }

const mLabel = (m: string, l: AsLang) => (l === 'vi' ? `tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}` : `${m.slice(5, 7)}/${m.slice(0, 4)}`)

/** Từ ý định tới đường dẫn cụ thể (kiểm tra quyền, hỏi lại khi còn mơ hồ) */
export function planIntent(it: Intent, ctx: AsCtx): Plan {
  const l = ctx.lang
  const L = (vi: string, de: string, en: string) => (l === 'de' ? de : l === 'en' ? en : vi)
  if (it.page === 'unknown') return { kind: 'unknown' }
  const p = PAGES[it.page]
  const name = L(p.vi, p.de, p.en)
  const noRight = { kind: 'deny', msg: L(`Tài khoản này không có quyền mở: ${name}`, `Keine Berechtigung für: ${name}`, `No permission to open: ${name}`) } as const
  if (p.owner && !ctx.isOwner) return noRight
  const m = p.month ? it.month : null
  if (p.scope === 'global') {
    if (it.page === 'allReports') return { kind: 'go', to: `/reports${m ? `?m=${m}` : ''}`, label: name + (m ? ` · ${mLabel(m, l)}` : '') }
    return { kind: 'go', to: '/restaurants', label: name }
  }
  const visible = new Set(ctx.restaurants.map((r) => r.id))
  let emps = it.empIds.map((id) => ctx.employees.find((e) => e.id === id)).filter((e): e is AsEmp => !!e && visible.has(e.restaurant_id))
  let rid = it.rid && visible.has(it.rid) ? it.rid : null
  if (rid && emps.length > 1 && emps.some((e) => e.restaurant_id === rid)) emps = emps.filter((e) => e.restaurant_id === rid)
  if (p.emp && emps.length > 1) return { kind: 'pickEmp', intent: { ...it, rid }, options: emps }
  const emp = p.emp ? emps[0] : undefined
  if (emp) rid = emp.restaurant_id
  rid = rid || ctx.currentRid || (ctx.restaurants.length === 1 ? ctx.restaurants[0].id : null)
  if (!rid) return { kind: 'pickRest', intent: it, options: ctx.restaurants }
  if (p.manage && !ctx.canManage(rid)) return noRight
  const rName = ctx.restaurants.find((r) => r.id === rid)?.name || ''
  const base = `/r/${rid}`
  const who = emp ? `${emp.first_name} ${emp.last_name}`.trim() : ''
  const lab = (s: string) => [s, who, rName].filter(Boolean).join(' · ')
  if (p.emp && !emp) {
    // Không rõ nhân viên nào: mở danh sách nhân viên để chọn
    return { kind: 'go', to: `${base}/hr/list`, label: lab(L('Nhân sự (chọn nhân viên)', 'Personal (Mitarbeiter wählen)', 'Staff (choose an employee)')) }
  }
  const mq = m ? `?m=${m}` : ''
  const withM = (s: string) => (m ? `${s} ${mLabel(m, l)}` : s)
  switch (it.page) {
    case 'home': return { kind: 'go', to: base, label: lab(name) }
    case 'settings': return { kind: 'go', to: ctx.canManage(rid) ? `${base}/settings` : '/settings', label: lab(name) }
    case 'scan': return { kind: 'go', to: `${base}/scan`, label: lab(name) }
    case 'scanZ': return { kind: 'go', to: `${base}/scan?type=zbon`, label: lab(name) }
    case 'scanSales': return { kind: 'go', to: `${base}/scan?type=sales`, label: lab(name) }
    case 'review': return { kind: 'go', to: `${base}?v=review`, label: lab(name) }
    case 'archive': {
      const q = [it.folder ? `f=${it.folder}` : '', m ? `m=${m}` : ''].filter(Boolean).join('&')
      return { kind: 'go', to: `${base}/archive${q ? `?${q}` : ''}`, label: lab(withM(it.folder || name)) }
    }
    case 'kb': case 'reports': case 'bwa': case 'plan': {
      const seg = { kb: 'kb', reports: 'reports', bwa: 'bwa', plan: 'plan' }[it.page]
      return { kind: 'go', to: `${base}/${seg}${mq}`, label: lab(withM(name)) }
    }
    case 'viva': return { kind: 'go', to: `${base}/viva`, label: lab(name) }
    case 'statements': return { kind: 'go', to: `${base}/statements`, label: lab(name) }
    case 'contracts': return { kind: 'go', to: `${base}/contracts`, label: lab(name) }
    case 'hr': return { kind: 'go', to: `${base}/hr`, label: lab(name) }
    case 'employee': return { kind: 'go', to: `${base}/hr/${emp!.id}`, label: lab(name) }
    case 'payslip': return { kind: 'go', to: `${base}/hr/${emp!.id}?slip=${m || 'last'}`, label: lab(m ? withM(name) : `${name} ${L('mới nhất', '(neueste)', '(latest)')}`) }
    case 'empContract': return { kind: 'go', to: `${base}/hr/${emp!.id}?tab=work`, label: lab(name) }
    case 'leave': return { kind: 'go', to: `${base}/hr/${emp!.id}?tab=leave`, label: lab(name) }
    case 'bk': return { kind: 'go', to: `${base}/bk`, label: lab(name) }
    case 'inv': return { kind: 'go', to: `${base}/inv`, label: lab(name) }
    case 'invNew': return { kind: 'go', to: `${base}/inv/new`, label: lab(name) }
    case 'quotes': return { kind: 'go', to: `${base}/inv/quotes`, label: lab(name) }
    case 'customers': return { kind: 'go', to: `${base}/inv/customers`, label: lab(name) }
    case 'articles': return { kind: 'go', to: `${base}/inv/articles`, label: lab(name) }
    case 'rc': return { kind: 'go', to: `${base}/rc`, label: lab(name) }
    case 'ingredients': return { kind: 'go', to: `${base}/rc/ing`, label: lab(name) }
    case 'concepts': return { kind: 'go', to: `${base}/rc/concepts`, label: lab(name) }
  }
  return { kind: 'unknown' }
}

/** Nhờ AI hiểu câu lệnh khi đọc trên máy chưa chắc. null khi lỗi / chưa có khoá. */
export async function aiIntent(text: string, ctx: AsCtx): Promise<(Intent & { reply: string }) | null> {
  const pages = (Object.keys(PAGES) as PageKey[])
    .filter((k) => (!PAGES[k].owner || ctx.isOwner))
    .map((k) => ({ key: k, desc: `${PAGES[k].vi} / ${PAGES[k].de} / ${PAGES[k].en}${PAGES[k].emp ? ' (eines Mitarbeiters)' : ''}${PAGES[k].month ? ' (nach Monat)' : ''}` }))
  try {
    const { data, error } = await supabase.functions.invoke('nh-assist', {
      body: {
        text, lang: ctx.lang, today: ctx.today, current_restaurant_id: ctx.currentRid, pages,
        restaurants: ctx.restaurants,
        employees: ctx.employees.map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), restaurant_id: e.restaurant_id, pnr: e.personnel_no })),
      },
    })
    const r = data?.result
    if (error || !r) { console.warn('nh-assist', error || data); return null }
    const page = r.page in PAGES ? (r.page as PageKey) : 'unknown'
    const month = typeof r.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) ? r.month : null
    return { page, rid: typeof r.restaurant_id === 'string' ? r.restaurant_id : null, empIds: Array.isArray(r.employee_ids) ? r.employee_ids.filter((x: unknown) => typeof x === 'string') : [], month, reply: String(r.reply || '') }
  } catch (e) { console.warn('nh-assist', e); return null }
}

/** Danh sách nhân viên tài khoản này được xem (RLS lọc theo quán). Nhân viên thường: rỗng. */
export async function loadEmployees(): Promise<AsEmp[]> {
  const { data, error } = await supabase.from('nh_employees').select('id,first_name,last_name,restaurant_id,personnel_no').limit(3000)
  if (error) { console.warn('assistant employees', error); return [] }
  return (data || []) as AsEmp[]
}
