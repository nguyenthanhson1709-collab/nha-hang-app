// Kiểm tra hàm thuần của nh-bank (Enable Banking). npx tsx tests/bank.mts
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { depositDate, isCashDeposit, isPem, makeJwt, pemToPkcs8, pickBalance, psuHeaders, toTxRow } from '../supabase/functions/nh-bank/bank.ts'

let fail = 0
const ok = (c: unknown, m: string) => { if (!c) { fail++; console.error('✗', m) } else console.log('✓', m) }

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pk8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const pk1 = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
ok(isPem(pk8) && isPem(pk1) && !isPem('hello'), 'nhận ra file PEM')

for (const [name, pem] of [['PKCS#8', pk8], ['PKCS#1', pk1]]) {
  const jwt = await makeJwt('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pem, 3600, 1700000000)
  const [h, b, s] = jwt.split('.')
  const head = JSON.parse(Buffer.from(h, 'base64url').toString()), body = JSON.parse(Buffer.from(b, 'base64url').toString())
  ok(head.alg === 'RS256' && head.typ === 'JWT' && head.kid === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', `${name}: header JWT`)
  ok(body.iss === 'enablebanking.com' && body.aud === 'api.enablebanking.com' && body.exp - body.iat === 3600, `${name}: claims JWT`)
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${b}`)
  ok(v.verify(publicKey, Buffer.from(s, 'base64url')), `${name}: chữ ký đúng`)
}
ok(pemToPkcs8(pk8).length > 1000, 'PEM -> DER')

const bal = pickBalance([
  { balance_type: 'CLBD', balance_amount: { amount: '1000.00', currency: 'EUR' } },
  { balance_type: 'ITAV', balance_amount: { amount: '950.50', currency: 'EUR' } },
])
ok(bal?.amount === 950.5 && bal.type === 'ITAV', 'ưu tiên số dư khả dụng')
ok(pickBalance([{ balance_type: 'CLBD', balance_amount: { amount: '12.3', currency: 'EUR' } }])?.type === 'CLBD', 'không có khả dụng -> số dư sổ sách')
ok(pickBalance([]) === null, 'không có số dư')

const out = await toTxRow({
  transaction_amount: { amount: '89.90', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-20', value_date: '2026-11-20',
  creditor: { name: 'METRO Berlin' }, creditor_account: { iban: 'DE001' }, debtor: { name: 'Vietbowl' }, remittance_information: ['RE 12345', ' Kunde 77'], entry_reference: 'X1',
}, 'DE99')
ok(out.amount === -89.9 && out.counterparty === 'METRO Berlin' && out.counterparty_iban === 'DE001' && out.purpose === 'RE 12345 Kunde 77' && out.booking_date === '2026-11-20', 'tiền ra: âm, người nhận, nội dung')
const inn = await toTxRow({ transaction_amount: { amount: '500', currency: 'EUR' }, credit_debit_indicator: 'CRDT', booking_date: '2026-11-21', debtor: { name: 'Viva Payments' } }, 'DE99')
ok(inn.amount === 500 && inn.counterparty === 'Viva Payments', 'tiền vào: dương, người gửi')
const again = await toTxRow({ transaction_amount: { amount: '89.90', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-20', creditor: { name: 'METRO Berlin' }, remittance_information: ['RE 12345', ' Kunde 77'], entry_reference: 'X1' }, 'DE99')
ok(again.id === out.id && inn.id !== out.id, 'mã giao dịch ổn định, không trùng')

ok(Object.keys(psuHeaders([], { ip: null, ua: 'x' })).length === 0, 'không có IP -> chạy nền, không gửi PSU')
ok(psuHeaders(['Psu-Ip-Address', 'Psu-User-Agent'], { ip: '1.2.3.4', ua: 'UA' })['Psu-Ip-Address'] === '1.2.3.4', 'gửi đủ tiêu đề PSU')
ok(Object.keys(psuHeaders(['Psu-Ip-Address', 'Psu-Geo-Location'], { ip: '1.2.3.4', ua: 'UA' })).length === 0, 'thiếu tiêu đề bắt buộc -> không gửi gì')

const dep = { amount: 5000, booking_date: '2026-11-23', purpose: 'BERLINER VB BERLIN SB Kurfürstenstr./Berlin/DE21.11.2026/11:34 girocard GA 10090', raw: { bank_transaction_code: { code: 'NTAV', sub_code: 'NTAV', description: 'XTND' } } }
ok(isCashDeposit(dep), 'nhận ra nộp tiền mặt bằng girocard')
ok(depositDate(dep) === '2026-11-21', 'ngày nộp lấy từ nội dung')
ok(!isCashDeposit({ amount: -47.06, purpose: 'Kapitalertragsteuer', raw: { bank_transaction_code: { code: 'NTAV' } } }), 'thuế lãi không phải nộp tiền')
ok(!isCashDeposit({ amount: 800, purpose: 'RE 123 Catering', raw: { bank_transaction_code: { code: 'RCDT' } } }), 'chuyển khoản đến không phải nộp tiền')
ok(isCashDeposit({ amount: 300, purpose: 'Bareinzahlung Filiale', raw: {} }), 'chữ Bareinzahlung')
ok(depositDate({ booking_date: '2026-10-02', purpose: 'Einzahlung' }) === '2026-10-02', 'không có ngày trong nội dung -> ngày ghi sổ')

if (fail) { console.error(`${fail} lỗi`); process.exit(1) }
