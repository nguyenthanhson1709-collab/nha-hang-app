// Kiểm tra cơ sở dữ liệu cục bộ (PGlite): phân quyền, khoá sổ, Kassenbuch. npx tsx tests/db.mts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
// Giả lập phần Supabase cần thiết
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
grant usage on schema public, auth, storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`)
for (const f of ['001_nh_schema.sql', '003_nh_hardening.sql', '004_nh_kassenbuch_order.sql', '005_nh_cash_moves_channel.sql']) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`)

const O = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333', X = '44444444-4444-4444-8444-444444444444'
await db.exec(`insert into auth.users(id,email) values ('${O}','o@t'),('${M}','m@t'),('${S}','s@t'),('${X}','x@t');
update public.nh_profiles set is_owner = true where id = '${O}';
insert into public.nh_restaurants(id,name,opening_cash,tip_paid_cash) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A',300,true),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B',0,false);
insert into public.nh_members values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${M}','manager',now()),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${S}','staff',now());`)
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++ }
async function as<T>(uid: string, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`)
  try { const r = await fn(); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return e as Error }
}
const q = (s: string, p: unknown[] = []) => db.query(s, p).then((r) => r.rows as Record<string, unknown>[])

// Nhân viên tải hoá đơn
const d1 = await as(S, () => q(`insert into nh_documents(restaurant_id, doc_date, period, supplier, gross, status) values ($1,'2026-10-05','2026-10','Metro',47.60,'reviewed') returning id, status, created_by`, [A]))
ok(!(d1 instanceof Error) && d1[0].status === 'uploaded' && d1[0].created_by === S, 'Nhân viên tải lên: trạng thái luôn "chờ duyệt"')
const docId = (d1 as Record<string, unknown>[])[0].id as string
ok(!((await as(S, () => q(`insert into nh_document_payments(document_id, method, amount) values ($1,'cash',47.60)`, [docId]))) instanceof Error), 'Nhân viên chọn tiền mặt cho hoá đơn của mình')
const sUpd = await as(S, () => q(`update nh_documents set gross = 1 where id = $1 returning id`, [docId]))
ok(Array.isArray(sUpd) && sUpd.length === 0, 'Nhân viên không sửa được hoá đơn')
const xSee = await as(X, () => q(`select id from nh_documents`))
ok(Array.isArray(xSee) && xSee.length === 0, 'Người ngoài không thấy hoá đơn')
const mSeeB = await as(M, () => q(`select id from nh_restaurants where id = $1`, [B]))
ok(Array.isArray(mSeeB) && mSeeB.length === 0, 'Người phụ trách quán A không thấy quán B')
const sZ = await as(S, () => q(`select id from nh_zbons`))
ok(Array.isArray(sZ), 'Nhân viên đọc Z-Bon: trả rỗng')

// Người phụ trách duyệt
await as(M, () => q(`update nh_documents set status='reviewed' where id=$1`, [docId]))
await as(M, () => q(`insert into nh_document_taxes(document_id, rate, net, tax, gross) values ($1,19,40,7.6,47.6)`, [docId]))
// Z-Bon ngày 6/10: tổng 4053.90, thẻ máy cà thẻ 3731.44 gồm tip 269.24 => thẻ 3462.20, tiền mặt 591.70
const z = await as(M, () => q(`insert into nh_zbons(restaurant_id, z_date, period, gross7, gross19, total, card_pos, cash_pos, card_terminal, tip_card) values ($1,'2026-10-06','2026-10',3090.40,963.50,4053.90,3462.20,591.70,3731.44,269.24) returning cash_revenue`, [A]))
ok(!(z instanceof Error) && Number(z[0].cash_revenue) === 591.7, 'Z-Bon: tiền mặt thực thu = tổng − (thẻ máy cà thẻ − tip) = 591,70')
await as(M, () => q(`insert into nh_cash_moves(restaurant_id, move_date, period, type, amount) values ($1,'2026-10-06','2026-10','geldtransit',500)`, [A]))
const kb = await as(M, () => q(`select nr, text, einnahme, ausgabe, saldo from nh_kassenbuch where restaurant_id=$1 order by nr`, [A]))
if (!(kb instanceof Error)) kb.forEach((r) => console.log('   ', r.nr, String(r.text).padEnd(45), r.einnahme, r.ausgabe, r.saldo))
// 300 − 47,60 + 591,70 − 269,24 (tip trả từ két) − 500 = 74,86
ok(!(kb instanceof Error) && Number(kb[kb.length - 1].saldo) === 74.86, 'Kassenbuch: tồn quỹ cuối = 74,86')
ok(!(kb instanceof Error) && kb.every((r) => Number(r.saldo) >= 0), 'Kassenbuch: trong ngày không bị âm (nộp ngân hàng sau Z-Bon)')
ok(!(kb instanceof Error) && kb.map((r) => r.nr).join(',') === '1,2,3,4', 'Kassenbuch: đánh số liên tục')

// Khoá sổ
const mLock = await as(M, () => q(`insert into nh_periods(restaurant_id, period) values ($1,'2026-10')`, [A]))
ok(mLock instanceof Error, 'Người phụ trách không khoá sổ được')
ok(!((await as(O, () => q(`insert into nh_periods(restaurant_id, period, locked_by) values ($1,'2026-10',$2)`, [A, O]))) instanceof Error), 'Chủ khoá sổ tháng 10')
const oEdit = await as(O, () => q(`update nh_documents set gross = 1 where id=$1`, [docId]))
ok(oEdit instanceof Error && /khoá sổ/.test(oEdit.message), 'Sau khoá sổ: chủ cũng không sửa được')
const oChild = await as(O, () => q(`delete from nh_document_taxes where document_id=$1`, [docId]))
ok(oChild instanceof Error, 'Sau khoá sổ: không xoá được dòng thuế')
await as(O, () => q(`delete from nh_periods where restaurant_id=$1`, [A]))
ok((await q(`select count(*)::int n from nh_periods`))[0].n === 1, 'Không huỷ khoá sổ được')
const late = await as(M, () => q(`insert into nh_documents(restaurant_id, doc_date, period, supplier, gross) values ($1,'2026-10-20','2026-10','Selgros',10) returning period`, [A]))
ok(!(late instanceof Error) && late[0].period === '2026-11', 'Hoá đơn tháng 10 đến muộn tự ghi vào tháng 11')
const cnt = await as(M, () => q(`insert into nh_cash_counts(restaurant_id, count_date, period, counted, book_balance) values ($1,'2026-11-02','2026-11',70,74.86)`, [A]))
ok(cnt instanceof Error, 'Đếm két lệch mà không ghi lý do: bị chặn')
const own = await as(M, () => q(`update nh_profiles set is_owner = true where id = $1`, [M]))
ok(own instanceof Error || (Array.isArray(own) && own.length === 0), 'Không tự nâng quyền chủ được')
// Viva Wallet: thay phần thẻ của Z-Bon ngày đó, chỉ phần vượt quá (650 − 600 = 50) làm giảm tồn quỹ
await as(M, () => q(`insert into nh_zbons(restaurant_id, z_date, period, gross7, gross19, total, card_pos, cash_pos) values ($1,'2026-11-03','2026-11',1000,0,1000,600,400)`, [A]))
await as(M, () => q(`insert into nh_cash_moves(restaurant_id, move_date, period, type, amount, channel) values ($1,'2026-11-03','2026-11','geldtransit',650,'viva')`, [A]))
const vv = await as(M, () => q(`select text, einnahme, ausgabe from nh_kassenbuch where restaurant_id=$1 and entry_date='2026-11-03' order by nr`, [A]))
ok(!(vv instanceof Error) && vv.some((r) => /Viva/.test(String(r.text)) && Number(r.ausgabe) === 50) && vv.some((r) => Number(r.einnahme) === 400), 'Viva Wallet: chỉ phần vượt thẻ Z-Bon (50) ra khỏi két')
const aud = await q(`select count(*)::int n from nh_audit`)
ok(Number(aud[0].n) > 3, 'Nhật ký sửa đổi được ghi')

console.log(fails ? `\n${fails} kiểm tra thất bại` : '\nTất cả kiểm tra đạt')
process.exit(fails ? 1 : 0)
