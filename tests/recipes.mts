// Kiểm tra Concept & Công thức (PGlite): phân quyền, giá Netto từ hoá đơn scan. npx tsx tests/recipes.mts
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
await db.exec(readFileSync('supabase/migrations/001_nh_schema.sql', 'utf8'))
await db.exec('alter table public.nh_documents add column if not exists is_credit boolean not null default false')
for (const f of ['003_nh_hardening.sql', '029_nh_recipes.sql', '029_nh_recipes.sql']) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`)

const O = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333', MB = '44444444-4444-4444-8444-444444444444'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
await db.exec(`insert into auth.users(id,email) values ('${O}','o@t'),('${M}','m@t'),('${S}','s@t'),('${MB}','mb@t');
update public.nh_profiles set is_owner = true where id = '${O}';
insert into public.nh_restaurants(id,name,opening_cash,tip_paid_cash) values ('${A}','A',0,true),('${B}','B',0,false);
insert into public.nh_members values ('${A}','${M}','manager',now()),('${A}','${S}','staff',now()),('${B}','${MB}','manager',now());`)

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++ }
async function as<T>(uid: string, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`)
  try { const r = await fn(); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return e as Error }
}
const q = (s: string, p: unknown[] = []) => db.query(s, p).then((r) => r.rows as Record<string, unknown>[])
const rows = (x: unknown) => (x instanceof Error ? [] : (x as Record<string, unknown>[]))

// Món của quán A
const r1 = await as(M, () => q(`insert into nh_rc_recipes(name, restaurant_ids, sell_price) values ('Phở bò', array[$1::uuid], 14.9) returning id`, [A]))
ok(!(r1 instanceof Error), 'Phụ trách quán A tạo món cho quán A')
const rid = rows(r1)[0]?.id as string
ok(await as(M, () => q(`insert into nh_rc_recipes(name, restaurant_ids) values ('X', array[$1::uuid])`, [B])) instanceof Error, 'Phụ trách quán A không tạo món cho quán B')
ok(await as(S, () => q(`insert into nh_rc_recipes(name) values ('X')`)) instanceof Error, 'Nhân viên không tạo được món')
ok(rows(await as(S, () => q(`select id from nh_rc_recipes`))).length === 1, 'Nhân viên quán A xem được món của quán A')
ok(rows(await as(MB, () => q(`select id from nh_rc_recipes`))).length === 0, 'Quán B không thấy món chỉ của quán A')
ok(rows(await as(S, () => q(`update nh_rc_recipes set name='Y' returning id`))).length === 0, 'Nhân viên không sửa được món')

// Nguyên liệu + dòng công thức
const ing = rows(await as(M, () => q(`insert into nh_rc_ingredients(name, unit, match_name, pack_size, allergens) values ('Bánh phở', 'g', 'reisband*', 5000, '{}') returning id`)))[0]?.id as string
ok(!!ing, 'Phụ trách tạo nguyên liệu')
ok(await as(S, () => q(`insert into nh_rc_ingredients(name) values ('x')`)) instanceof Error, 'Nhân viên không tạo nguyên liệu')
ok(!(await as(M, () => q(`insert into nh_rc_items(recipe_id, ingredient_id, qty, unit) values ($1,$2,180,'g')`, [rid, ing])) instanceof Error), 'Phụ trách thêm nguyên liệu vào món')
ok(await as(S, () => q(`insert into nh_rc_items(recipe_id, ingredient_id, qty, unit) values ($1,$2,1,'g')`, [rid, ing])) instanceof Error, 'Nhân viên không thêm dòng công thức')
ok(rows(await as(S, () => q(`select id from nh_rc_items`))).length === 1, 'Nhân viên xem dòng công thức')

// Hoá đơn sỉ (Netto) và siêu thị (Brutto)
await db.exec(`
insert into nh_documents(id, restaurant_id, doc_date, period, supplier, gross, status) values
 ('d0000000-0000-4000-8000-000000000001','${A}','2026-10-01','2026-10','METRO',53.50,'reviewed'),
 ('d0000000-0000-4000-8000-000000000002','${A}','2026-11-02','2026-11','Asia Markt',26.75,'reviewed');
insert into nh_document_taxes(document_id, rate, net, tax, gross) values ('d0000000-0000-4000-8000-000000000001',7,50,3.5,53.5),('d0000000-0000-4000-8000-000000000002',7,25,1.75,26.75);
insert into nh_document_lines(document_id, pos, name, qty, unit, unit_price, total, rate) values
 ('d0000000-0000-4000-8000-000000000001',0,'Reisbandnudeln 5kg',2,'Stk',25,50,7),
 ('d0000000-0000-4000-8000-000000000002',0,'REISBANDNUDELN 5KG',1,'Stk',26.75,26.75,7);`)
const n = await as(M, () => q(`select nh_rc_refresh_prices() n`))
ok(rows(n)[0]?.n === 1, 'Cập nhật giá: 1 nguyên liệu')
const p = rows(await as(M, () => q(`select price, price_prev, price_date::text d, price_supplier from nh_rc_ingredients where id=$1`, [ing])))[0]
ok(Number(p?.price) === 5 && p?.d === '2026-11-02', `Giá mới nhất Netto/kg = 26,75/1,07/5 = 5,00 (được ${p?.price}, ${p?.d})`)
const h = rows(await as(M, () => q(`select base_price from nh_rc_price_history($1)`, [ing])))
ok(h.length === 2 && Number(h[1].base_price) === 5, `Lịch sử: hoá đơn Netto 25/5kg = 5,00 €/kg (được ${h.map((x) => x.base_price)})`)
ok(rows(await as(MB, () => q(`select * from nh_rc_find_lines('reis')`))).length === 0, 'Phụ trách quán B không thấy dòng hàng của quán A')
ok(rows(await as(M, () => q(`select * from nh_rc_find_lines('reis')`))).length === 2, 'Phụ trách quán A tìm thấy 2 dòng hàng')
ok(await as(S, () => q(`select * from nh_rc_find_lines('reis')`)) instanceof Error, 'Nhân viên không tra giá được')
// Giá tăng
await db.exec(`insert into nh_documents(id, restaurant_id, doc_date, period, supplier, gross, status) values ('d0000000-0000-4000-8000-000000000003','${A}','2026-11-20','2026-11','METRO',64.20,'reviewed');
insert into nh_document_taxes(document_id, rate, net, tax, gross) values ('d0000000-0000-4000-8000-000000000003',7,60,4.2,64.2);
insert into nh_document_lines(document_id, pos, name, qty, unit, unit_price, total, rate) values ('d0000000-0000-4000-8000-000000000003',0,'Reisbandnudeln 5kg',2,'Stk',30,60,7);`)
await as(O, () => q(`select nh_rc_refresh_prices()`))
const p2 = rows(await as(O, () => q(`select price, price_prev from nh_rc_ingredients where id=$1`, [ing])))[0]
ok(Number(p2?.price) === 6 && Number(p2?.price_prev) === 5, `Giá tăng 5 → 6 €/kg được ghi lại (được ${p2?.price_prev} → ${p2?.price})`)

console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt')
process.exit(fails ? 1 : 0)
