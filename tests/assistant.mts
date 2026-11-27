// Kiểm tra bộ đọc câu lệnh của trợ lý giọng nói: npx tsx tests/assistant.mts
import { parseLocal, planIntent, type AsCtx } from '../src/lib/assistant.ts'

const ctx: AsCtx = {
  lang: 'vi', today: '2026-11-27',
  restaurants: [{ id: 'r1', name: 'Vietbowl Mitte' }, { id: 'r2', name: 'Vietbowl Prenzlauer Berg' }],
  currentRid: 'r1',
  employees: [
    { id: 'e1', first_name: 'Lina', last_name: 'Nguyen', restaurant_id: 'r1', personnel_no: '12' },
    { id: 'e2', first_name: 'Văn Nam', last_name: 'Trần', restaurant_id: 'r1', personnel_no: '7' },
    { id: 'e3', first_name: 'Lina', last_name: 'Schmidt', restaurant_id: 'r2', personnel_no: '3' },
    { id: 'e4', first_name: 'Thị Hoa', last_name: 'Phạm', restaurant_id: 'r2', personnel_no: null },
  ],
  isOwner: true, canManage: () => true,
}

let fail = 0
function check(text: string, want: { to?: string; kind?: string; sure?: boolean }, c: AsCtx = ctx) {
  const it = parseLocal(text, c)
  const p = planIntent(it, c)
  const to = p.kind === 'go' ? p.to : undefined
  const ok = (want.to === undefined || to === want.to) && (want.kind === undefined || p.kind === want.kind) && (want.sure === undefined || it.sure === want.sure)
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${text} → ${p.kind} ${to || ''} ${p.kind === 'go' ? `"${p.label}"` : ''} sure=${it.sure}`)
}

check('Cần bảng lương nhân viên Nam', { to: '/r/r1/hr/e2?slip=last', sure: true })
check('bảng lương tháng 10 của Hoa', { to: '/r/r2/hr/e4?slip=2026-10' })
check('phiếu lương Lina tháng trước', { to: '/r/r1/hr/e1?slip=2026-10' }) // ưu tiên quán đang mở
check('Lohnabrechnung Lina Schmidt Oktober', { to: '/r/r2/hr/e3?slip=2026-10' })
check('bang luong lina quan prenzlauer', { to: '/r/r2/hr/e3?slip=last' })
check('Lina', { kind: 'pickEmp' }, { ...ctx, currentRid: null })
check('mở kassenbuch tháng 9', { to: '/r/r1/kb?m=2026-09' })
check('Kassenbuch Prenzlauer Berg tháng mười', { to: '/r/r2/kb?m=2026-10' })
check('sổ quỹ tháng 12', { to: '/r/r1/kb?m=2025-12' })
check('BWA tháng 9 năm 2026', { to: '/r/r1/bwa?m=2026-09' })
check('chứng từ tiền mặt tháng 11', { to: '/r/r1/archive?f=Bargeld&m=2026-11' })
check('scan z-bon', { to: '/r/r1/scan?type=zbon' })
check('đặt bàn hôm nay', { to: '/r/r1/bk' })
check('hợp đồng lao động của Nam', { to: '/r/r1/hr/e2?tab=work' })
check('ngày phép của Lina Nguyen', { to: '/r/r1/hr/e1?tab=leave' })
check('lịch làm tháng 10', { to: '/r/r1/plan?m=2026-10' })
check('viết hoá đơn mới', { to: '/r/r1/inv/new' })
check('bảng lương nhân viên Minh', { sure: false }) // tên không có → hỏi AI
check('xin chào', { kind: 'unknown', sure: false })
check('so sánh nhà hàng tháng 10', { to: '/reports?m=2026-10' })
check('Kassenbuch', { kind: 'pickRest' }, { ...ctx, currentRid: null })
check('Kassenbuch', { kind: 'deny' }, { ...ctx, isOwner: false, canManage: () => false })
check('nhân viên số 12', { to: '/r/r1/hr/e1' })
// Tiếng Anh
check('show me the payslip of Nam for October', { to: '/r/r1/hr/e2?slip=2026-10' })
check('cash book last month', { to: '/r/r1/kb?m=2026-10' })
check('Lina Schmidt employment contract', { to: '/r/r2/hr/e3?tab=work' })
check('cash receipts for september', { to: '/r/r1/archive?f=Bargeld&m=2026-09' })

if (fail) { console.log(`${fail} lỗi`); process.exit(1) }
console.log('Tất cả đúng')
