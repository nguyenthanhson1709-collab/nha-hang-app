// Kiểm tra cộng giao dịch Viva Wallet theo ngày kinh doanh: npx tsx tests/viva.mts
import { aggregate, businessDay, fetchDates, parseInsDate, txList } from '../supabase/functions/nh-viva/viva.ts'

let fail = 0
const eq = (name: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log('✗', name, a, '≠', b) } else console.log('✓', name) }

// Giờ Athens không kèm múi giờ: 2026-11-27 01:30 Athens (UTC+2) = 00:30 Berlin -> vẫn thuộc ngày 26 (chốt 4:00)
eq('Athens -> Berlin', businessDay(parseInsDate('2026-11-27T01:30:00.12')!), '2026-11-26')
eq('sau giờ chốt', businessDay(parseInsDate('2026-11-27T05:30:00')!), '2026-11-27')
eq('có múi giờ', businessDay(parseInsDate('2026-07-10T23:59:00+02:00')!), '2026-07-10')
eq('giờ hè Athens', new Date(parseInsDate('2026-07-10T12:00:00')!).toISOString(), '2026-07-10T09:00:00.000Z')
eq('chốt 0 giờ', businessDay(parseInsDate('2026-11-27T01:30:00')!, 0), '2026-11-27')
eq('ngày cần hỏi', fetchDates('2026-11-25', '2026-11-26'), ['2026-11-25', '2026-11-26', '2026-11-27'])

const body = {
  Transactions: [
    { TransactionId: 'a', Amount: 45.5, StatusId: 'F', TransactionTypeId: 5, InsDate: '2026-11-26T20:00:00', TipAmount: 3.5, SourceCode: '1111', TerminalId: 900 },
    { TransactionId: 'b', Amount: 20, StatusId: 'F', TransactionTypeId: 5, InsDate: '2026-11-27T01:10:00', TipAmount: 0, SourceCode: '1111' }, // 00:10 Berlin -> ngày 26
    { TransactionId: 'b', Amount: 20, StatusId: 'F', TransactionTypeId: 5, InsDate: '2026-11-27T01:10:00' }, // trùng (lấy 2 ngày)
    { TransactionId: 'c', Amount: 10, StatusId: 'E', TransactionTypeId: 5, InsDate: '2026-11-26T19:00:00' }, // thất bại
    { TransactionId: 'd', Amount: -5, StatusId: 'F', TransactionTypeId: 4, InsDate: '2026-11-26T21:00:00', SourceCode: '1111' }, // hoàn tiền
    { TransactionId: 'e', Amount: 30, StatusId: 'R', TransactionTypeId: 5, InsDate: '2026-11-26T18:00:00', SourceCode: '1111' }, // gốc đã hoàn một phần
    { TransactionId: 'f', Amount: 99, StatusId: 'F', TransactionTypeId: 1, InsDate: '2026-11-26T18:00:00' }, // pre-auth
    { TransactionId: 'g', Amount: 12, StatusId: 'F', TransactionTypeId: 5, InsDate: '2026-11-26T18:00:00', SourceCode: '2222' }, // quán khác
  ],
  ErrorCode: 0, Success: true,
}
const all = aggregate(txList(body))
eq('tổng ngày 26', all.get('2026-11-26'), { day: '2026-11-26', amount: 102.5, tip: 3.5, refunds: 5, n: 4 })
const only = aggregate(txList(body), { sourceCodes: ['1111'] })
eq('lọc Source Code', only.get('2026-11-26')?.amount, 90.5)
eq('camelCase', aggregate([{ transactionId: 'x', amount: 7.25, statusId: 'F', transactionTypeId: 5, insDate: '2026-11-26T14:32:10.32+02:00' }]).get('2026-11-26')?.amount, 7.25)

console.log(fail ? `${fail} sai` : 'Tất cả đúng')
process.exit(fail ? 1 : 0)
