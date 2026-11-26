// Kiểm tra module viết hoá đơn (PGlite): phân quyền theo quán, cấp số liên tục, khoá hoá đơn đã hoàn tất. npx tsx tests/invoicing.mts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
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
for (const f of ['001_nh_schema.sql', '003_nh_hardening.sql', '012_nh_hr.sql', '017_nh_invoicing.sql', '017_nh_invoicing.sql']) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))

const O = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
await db.exec(`insert into auth.users(id,email) values ('${O}','o@t'),('${M}','m@t'),('${S}','s@t');
update public.nh_profiles set is_owner = true where id = '${O}';
insert into public.nh_restaurants(id,name) values ('${A}','Vietbowl Mitte GmbH'),('${B}','B');
insert into public.nh_members values ('${A}','${M}','manager',now()),('${A}','${S}','staff',now());`)
await db.exec(readFileSync('supabase/migrations/018_nh_invoicing_seed.sql', 'utf8'))

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++ }
async function as<T>(uid: string, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`)
  try { const r = await fn(); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return e as Error }
}
const q = (s: string, p: unknown[] = []) => db.query(s, p).then((r) => r.rows as Record<string, unknown>[])
const err = (r: unknown) => r instanceof Error

const co = await as(M, () => q(`select name, payment_days from nh_inv_company where restaurant_id=$1`, [A]))
ok(!err(co) && (co as Record<string, unknown>[])[0]?.name === 'Vietbowl Mitte GmbH', 'Người phụ trách thấy thông tin công ty đã nạp sẵn')
const sCo = await as(S, () => q(`select * from nh_invoices`))
ok(Array.isArray(sCo) && sCo.length === 0, 'Nhân viên không thấy hoá đơn')
const sIns = await as(S, () => q(`insert into nh_invoices(restaurant_id) values ($1)`, [A]))
ok(err(sIns), 'Nhân viên không tạo được hoá đơn')
const mB = await as(M, () => q(`insert into nh_invoices(restaurant_id) values ($1)`, [B]))
ok(err(mB), 'Người phụ trách quán A không tạo hoá đơn cho quán B')

const draft = async (uid: string, rid: string, date = '2026-11-20', type = 'invoice') => {
  const r = await as(uid, async () => {
    const [i] = await q(`insert into nh_invoices(restaurant_id, doc_type, invoice_date, customer_snapshot, total_gross) values ($1,$2,$3,'{"name":"Kunde"}',10.70) returning id`, [rid, type, date])
    await q(`insert into nh_invoice_items(invoice_id, position, name, quantity, unit_price_gross, tax_rate) values ($1,1,'Pho',1,10.70,7)`, [i.id])
    return i.id as string
  })
  if (err(r)) throw r
  return r as string
}
const fin = (uid: string, id: string) => as(uid, () => q(`select nh_inv_finalize($1) n`, [id]).then((r) => r[0].n as string))

const forged = await as(M, () => q(`insert into nh_invoices(restaurant_id, invoice_number) values ($1,'202611099')`, [A]))
ok(err(forged), 'Không tự đặt số hoá đơn khi tạo')
const d1 = await draft(M, A)
const forged2 = await as(M, () => q(`update nh_invoices set invoice_number='202611050' where id=$1`, [d1]))
ok(err(forged2), 'Không tự đặt số hoá đơn khi sửa nháp')
const n1 = await fin(M, d1)
ok(n1 === '202611003', `Hoá đơn đầu tiên tiếp tục dãy cũ: ${String(n1)}`)
const n2 = await fin(O, await draft(O, A))
ok(n2 === '202611004', `Chủ hoàn tất hoá đơn tiếp theo: ${String(n2)}`)
const nB = await fin(O, await draft(O, B))
ok(nB === '202611001', `Quán B có dãy số riêng: ${String(nB)}`)
const nQ = await fin(M, await draft(M, A, '2026-11-21', 'quote'))
ok(nQ === 'AG202611001', `Angebot có dãy AG riêng: ${String(nQ)}`)
const nDec = await fin(M, await draft(M, A, '2026-12-01'))
ok(nDec === '202612001', `Tháng mới bắt đầu lại 001: ${String(nDec)}`)
const again = await fin(M, d1)
ok(again === '202611003', 'Hoàn tất lại không cấp số mới')

const due = await as(M, () => q(`select status, due_date::text d from nh_invoices where id=$1`, [d1]))
ok(!err(due) && (due as Record<string, unknown>[])[0].d === '2026-11-27' && (due as Record<string, unknown>[])[0].status === 'open', 'Hạn thanh toán = ngày + 7, trạng thái open')
ok(err(await as(M, () => q(`update nh_invoices set total_gross=1 where id=$1`, [d1]))), 'Không sửa được tổng tiền hoá đơn đã hoàn tất')
ok(err(await as(M, () => q(`update nh_invoice_items set quantity=2 where invoice_id=$1`, [d1]))), 'Không sửa được dòng hàng hoá đơn đã hoàn tất')
ok(err(await as(M, () => q(`insert into nh_invoice_items(invoice_id, position, name) values ($1,2,'x')`, [d1]))), 'Không thêm dòng vào hoá đơn đã hoàn tất')
const del = await as(O, () => q(`delete from nh_invoices where id=$1 returning id`, [d1]))
ok(err(del) || (del as unknown[]).length === 0, 'Chủ cũng không xoá được hoá đơn đã hoàn tất')
ok(!err(await as(M, () => q(`update nh_invoices set status='paid', paid_at='2026-11-22' where id=$1`, [d1]))), 'Đánh dấu đã thanh toán được')
ok(!err(await as(M, () => q(`update nh_invoices set sent_at=now(), sent_to='a@b.de' where id=$1`, [d1]))), 'Ghi lại đã gửi email được')
ok(err(await as(M, () => q(`update nh_invoices set status='draft' where id=$1`, [d1]))), 'Không đưa hoá đơn đã hoàn tất về nháp')
ok(err(await as(M, () => q(`update nh_inv_counters set last_value=0 where restaurant_id=$1`, [A]))), 'Không sửa thẳng bộ đếm')
ok(err(await as(M, () => q(`select nh_inv_set_counter($1,'202611',1)`, [A]))), 'Không đặt bộ đếm nhỏ hơn số đã cấp')
ok(!err(await as(M, () => q(`select nh_inv_set_counter($1,'202701',5)`, [A]))), 'Đặt trước bộ đếm cho tháng sau được')
ok(err(await as(S, () => q(`select nh_inv_set_counter($1,'202701',9)`, [A]))), 'Nhân viên không đặt được bộ đếm')
const d2 = await draft(M, A)
ok(!err(await as(M, () => q(`delete from nh_invoices where id=$1`, [d2]))), 'Xoá được bản nháp')
const cn = await as(M, () => q(`select nh_inv_next_customer($1) n`, [A]))
ok(!err(cn) && (cn as Record<string, unknown>[])[0].n === 10001, 'Mã khách đầu tiên 10001')
const cnS = await as(S, () => q(`select nh_inv_next_customer($1) n`, [A]))
ok(!err(cnS) && (cnS as Record<string, unknown>[])[0].n === null, 'Nhân viên không lấy được mã khách')
const qa = await draft(M, A, '2026-11-25', 'quote')
ok(!err(await as(M, () => q(`update nh_invoices set status='accepted' where id=$1`, [qa]))), 'Angebot nháp chuyển thành hoá đơn được (accepted)')

console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt')
process.exit(fails ? 1 : 0)
