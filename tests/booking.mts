// Kiểm tra module Đặt bàn (PGlite): phân quyền theo quán, luật đặt online, giới hạn cao điểm, trạng thái, lịch sử. npx tsx tests/booking.mts
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
grant usage on schema public, auth, storage, extensions to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`)
// PGlite không có pgcrypto: thay gen_random_bytes bằng bản đơn giản
await db.exec(`create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
grant execute on function extensions.gen_random_bytes(int) to anon, authenticated;`)
const mig = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/create extension[^;]*;/g, '')
for (const f of ['001_nh_schema.sql', '003_nh_hardening.sql', '021_nh_booking.sql', '021_nh_booking.sql']) await db.exec(mig(f))

const O = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333', X = '44444444-4444-4444-8444-444444444444'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
await db.exec(`insert into auth.users(id,email) values ('${O}','o@t'),('${M}','m@t'),('${S}','s@t'),('${X}','x@t');
update public.nh_profiles set is_owner = true where id = '${O}';
update public.nh_profiles set full_name = 'Lan' where id = '${S}';
insert into public.nh_restaurants(id,name) values ('${A}','Vietbowl Mitte GmbH'),('${B}','B');
insert into public.nh_members values ('${A}','${M}','manager',now()),('${A}','${S}','staff',now()),('${B}','${X}','manager',now());`)
await db.exec(mig('023_nh_booking_seed.sql'))
await db.exec(mig('023_nh_booking_seed.sql')) // chạy lại không nạp trùng

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++ }
async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(uid ? `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);` : `begin; set local role anon;`)
  try { const r = await fn(); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return e as Error }
}
const q = (s: string, p: unknown[] = []) => db.query(s, p).then((r) => r.rows as Record<string, unknown>[])
const err = (r: unknown) => r instanceof Error
const msg = (r: unknown) => (r instanceof Error ? r.message : '')

const cnt = await q(`select (select count(*) from nh_bk_tables where restaurant_id=$1)::int t, (select count(*) from nh_bk_areas)::int a, (select count(*) from nh_bk_peak_rules)::int p`, [A])
ok(cnt[0].t === 73 && cnt[0].a === 4 && cnt[0].p === 2, 'Nạp sẵn 73 bàn, 4 khu, 2 luật cao điểm cho Vietbowl Mitte (chạy lại không trùng)')

// ngày thứ Tư còn xa trong tương lai
const day = '2027-03-10'
const book = (party: number, slot = '18:00', slug = 'potsdamerplatz') => as(null, () => q(`select nh_bk_book_online($1,$2,$3,$4,'Gast','01761234567','g@x.de',null,true,'de','google',true) r`, [slug, day, slot, party]).then((r) => r[0].r as { code: string; token: string; status: string }))
ok(msg(await book(4)) === 'closed', 'Khách chưa đặt được khi quán chưa bật nhận khách online')
await db.exec(`update nh_bk_settings set online_enabled = true where restaurant_id = '${A}'`)

const slots = await as(null, () => q(`select slot::text, state from nh_bk_available_slots('potsdamerplatz', $1, 4)`, [day]))
ok(Array.isArray(slots) && slots[0]?.slot === '14:00:00' && slots.every((s) => s.state === 'ok'), 'Thứ 2-6 giờ đặt online bắt đầu 14:00, còn chỗ')
ok(msg(await book(3)) === 'party', 'Dưới 4 người không đặt online được')
ok(msg(await book(4, '12:00')) === 'hours', 'Trước 14:00 ngày thường không đặt online được')
const b1 = await book(20)
ok(!err(b1) && (b1 as { status: string }).status === 'confirmed', 'Khách đặt 20 người, tự xác nhận')
const b2 = await book(16, '18:15')
ok(msg(b2) === 'full', 'Vượt 35 khách / 30 phút thì báo hết chỗ')
const full = await as(null, () => q(`select state from nh_bk_available_slots('potsdamerplatz', $1, 16) where slot = '18:00'`, [day]))
ok(Array.isArray(full) && full[0]?.state === 'full', 'Giờ hết chỗ hiện "full" cho khách')

// khách không đọc được bảng
const anonRead = await as(null, () => q(`select * from nh_bk_bookings`))
ok(err(anonRead) || (anonRead as unknown[]).length === 0, 'Khách không đọc được danh sách đơn')

// nhân viên quán A
const list = await as(S, () => q(`select code, channel from nh_bk_bookings where restaurant_id=$1`, [A]))
ok(Array.isArray(list) && list.length === 1 && list[0].channel === 'google', 'Nhân viên thấy đơn online kèm kênh')
const xList = await as(X, () => q(`select * from nh_bk_bookings`))
ok(Array.isArray(xList) && xList.length === 0, 'Người phụ trách quán khác không thấy đơn quán A')

const save = (uid: string, party: number, override = false, id: string | null = null, tables: string[] | null = ['t41'], slot = '18:10') =>
  as(uid, () => q(`select nh_bk_save_booking($1,$2,$3,$7,$4,'Herr Müller','030 123','','Fenster','phone',$5,$6) id`, [A, id, day, party, tables, override, slot]).then((r) => r[0].id as string))
ok(msg(await save(S, 16)) === 'full', 'Nhân viên không vượt được giới hạn cao điểm')
ok(msg(await save(S, 16, true)) === 'full', 'Nhân viên bật vượt cũng không được (chỉ chủ / phụ trách)')
const sb = await save(M, 16, true)
ok(!err(sb), 'Người phụ trách được vượt giới hạn cao điểm')
const s2 = await save(S, 2, false, null, ['t51', 'khong-co'], '19:00')
ok(!err(s2), 'Nhân viên tạo đơn 2 người (bàn không có thật bị bỏ qua)')
const row = await q(`select b.created_by_name, b.source, b.status, nh_bk_table_list(b.id) t from nh_bk_bookings b where id=$1`, [s2])
ok(row[0].created_by_name === 'Lan' && row[0].source === 'phone' && row[0].status === 'confirmed' && row[0].t === 't51', 'Đơn ghi tên người nhập, nguồn điện thoại, bàn 51')
ok(err(await as(X, () => q(`select nh_bk_set_status($1,'seated')`, [s2]))), 'Quán khác không đổi được trạng thái')
ok(!err(await as(S, () => q(`select nh_bk_set_status($1,'seated')`, [s2]))), 'Nhân viên bấm Đã đến')
ok(err(await as(S, () => q(`select nh_bk_set_status($1,'cancelled')`, [s2]))), 'Nhân viên không đặt được "Đã huỷ"')
ok(!err(await as(S, () => q(`select nh_bk_set_tables($1,array['t52','t53'])`, [s2]))), 'Nhân viên đổi bàn từ danh sách')
ok(!err(await as(S, () => q(`select nh_bk_set_called($1,true)`, [s2]))), 'Nhân viên đánh dấu đã gọi được')
const logS = await as(S, () => q(`select * from nh_bk_log`))
ok(Array.isArray(logS) && logS.length === 0, 'Nhân viên không xem lịch sử thao tác')
const logM = await as(M, () => q(`select kind, new_value, staff_name from nh_bk_log where booking_id=$1 order by id`, [s2]))
ok(Array.isArray(logM) && logM.some((l) => l.kind === 'status' && l.new_value === 'seated' && l.staff_name === 'Lan') && logM.some((l) => l.kind === 'tables' && l.new_value === 't52,t53'), 'Phụ trách xem lịch sử: ai bấm Đã đến, đổi bàn')

// duyệt / từ chối khi bật chế độ duyệt
await db.exec(`update nh_bk_settings set auto_confirm = false where restaurant_id = '${A}'`)
const p = await book(4, '15:00') as { code: string; token: string; status: string }
ok(p.status === 'pending', 'Chế độ duyệt: đơn online ở trạng thái Chờ duyệt')
const pid = (await q(`select id from nh_bk_bookings where code=$1`, [p.code]))[0].id
ok(!err(await as(S, () => q(`select nh_bk_set_status($1,'rejected')`, [pid]))), 'Nhân viên từ chối đơn chờ duyệt')
const ob = await q(`select kind from nh_bk_email_outbox where booking_id=$1 order by id`, [pid])
ok(ob.map((o) => o.kind).join(',') === 'pending,rejected', 'Hàng đợi email: pending rồi rejected')

// khách xem / huỷ
const g = await as(null, () => q(`select nh_bk_guest_booking($1,$2) r`, [(b1 as { code: string }).code, (b1 as { token: string }).token]))
ok(Array.isArray(g) && (g[0].r as { party: number }).party === 20, 'Khách xem đơn bằng mã + token')
ok(!err(await as(null, () => q(`select nh_bk_cancel_online($1,$2)`, [(b1 as { code: string }).code, 'g@x.de']))), 'Khách tự huỷ bằng mã + email')

// cài đặt, sơ đồ: chỉ chủ / phụ trách
ok(err(await as(S, () => q(`update nh_bk_settings set duration_min = 120 where restaurant_id=$1 returning 1`, [A]).then((r) => { if (!r.length) throw new Error('0 rows') }))), 'Nhân viên không sửa được cài đặt')
ok(!err(await as(M, () => q(`update nh_bk_settings set duration_min = 120 where restaurant_id=$1 returning 1`, [A]).then((r) => { if (!r.length) throw new Error('0 rows') }))), 'Phụ trách sửa cài đặt')
ok(err(await as(S, () => q(`insert into nh_bk_tables(restaurant_id,id,label,x,y,w,h) values ($1,'t999','999',1,1,40,40)`, [A]))), 'Nhân viên không thêm bàn được')
ok(!err(await as(O, () => q(`insert into nh_bk_tables(restaurant_id,id,label,x,y,w,h) values ($1,'t999','999',1,1,40,40)`, [A]))), 'Chủ thêm bàn')
ok(err(await as(S, () => q(`select nh_bk_delete_booking($1)`, [s2]))), 'Nhân viên không xoá hẳn đơn được')
ok(!err(await as(O, () => q(`select nh_bk_delete_booking($1)`, [s2]))), 'Chủ xoá hẳn đơn')

// tự chuyển Đã đến
await db.exec(`insert into nh_bk_bookings(restaurant_id, code, day, slot, party, name, status, source) values ('${A}','VB-OLD01', current_date - 1, '12:00', 4, 'Alt', 'confirmed', 'phone')`)
const n = await q(`select nh_bk_auto_arrive() n`)
ok(Number(n[0].n) >= 1, 'Đơn đã qua giờ tự chuyển Đã đến')

// 024: chép từ app cũ (chỉ Vietbowl Mitte), quán đang chép thì app chỉ xem
await db.exec(`create schema vault; create table vault.secrets(name text, secret text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(v text, n text, d text) returns void language sql as $$ insert into vault.secrets values (n, v) $$;
create schema cron; create table cron.job(jobname text);
create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.job values (a) returning 1::bigint $$;`)
await db.exec(mig('024_nh_booking_mirror.sql'))
await db.exec(mig('024_nh_booking_mirror.sql')) // chạy lại được
const mo = await q(`select restaurant_id from nh_bk_settings where mirror_old`)
ok(mo.length === 1 && mo[0].restaurant_id === A, 'Chỉ Vietbowl Mitte bật chép từ app cũ')
const OB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const payload = {
  settings: { auto_confirm: true, peak_enabled: true, duration_min: 90, min_online: 4, max_online: 20, slot_step: 15, open_time: '11:30', close_time: '23:00', weekday_from: '14:00', closed_days: ['12-24'], lead_hours: 4, auto_arrive_min: 20, contact_email: 'pp@x.de', google_review_url: null },
  rules: [], areas: [{ id: 'in', name: 'Innen', sort: 1 }],
  tables: [{ id: 't41', label: '41', area_id: 'in', x: 1, y: 1, w: 40, h: 40, rot: 0, active: true }],
  bookings: [{ id: OB, code: 'VB-AAAAA', manage_token: 'tok', day, slot: '19:00', party: 6, name: 'Alt Gast', phone: '0176', email: null, note: null, lang: 'de', status: 'confirmed', source: 'phone', channel: null, created_at: '2026-11-01T10:00:00Z', created_by: 'st1', auto_arrived: false, cancelled_at: null, called: true, review_ok: false }],
  booking_tables: [{ booking_id: OB, table_id: 't41' }, { booking_id: OB, table_id: 'khong-co' }],
  notes: [{ guest_key: 'alt gast', note: 'VIP' }], reviews: [{ booking_id: OB, stars: 5, comment: 'Super', created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z' }],
  log: [{ id: 7, booking_id: OB, at: '2026-11-01T10:00:00Z', staff_name: 'Mai', kind: 'status', old_value: 'pending', new_value: 'confirmed' }],
  staff: [{ id: 'st1', name: 'Mai' }],
}
ok(err(await as(M, () => q(`select nh_bk_mirror_apply($1)`, [payload]))), 'Người dùng app không gọi được hàm chép')
const ap = await q(`select nh_bk_mirror_apply($1) r`, [payload])
await q(`select nh_bk_mirror_apply($1) r`, [payload]) // chép lần 2 không trùng
ok((ap[0].r as { bookings: number }).bookings === 1, 'Hàm chép ghi đơn từ app cũ')
const mb = await q(`select b.code, b.created_by_name, b.called, (select count(*) from nh_bk_booking_tables t where t.booking_id=b.id)::int nt, (select count(*) from nh_bk_log l where l.booking_id=b.id)::int nl from nh_bk_bookings b where restaurant_id=$1`, [A])
ok(mb.length === 1 && mb[0].code === 'VB-AAAAA' && mb[0].created_by_name === 'Mai' && mb[0].called === true && mb[0].nt === 1 && mb[0].nl === 1, 'Đơn chép giữ mã, người tạo, bàn hợp lệ, lịch sử; đơn không còn ở app cũ bị bỏ')
const t999 = await q(`select active from nh_bk_tables where restaurant_id=$1 and id='t999'`, [A])
ok(t999[0]?.active === false, 'Bàn không có ở app cũ chuyển sang ẩn')
ok(msg(await save(M, 2, false, null, ['t41'], '20:00')).includes('mirror_readonly'), 'Đang chép: phụ trách không thêm đơn trong app được')
ok(msg(await as(O, () => q(`update nh_bk_settings set duration_min = 60 where restaurant_id=$1`, [A]))).includes('mirror_readonly'), 'Đang chép: chủ không sửa cài đặt trong app được')
ok(Number((await q(`select nh_bk_auto_arrive() n`))[0].n) === 0, 'Đang chép: không tự chuyển Đã đến ở app mới')

console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt')
process.exit(fails ? 1 : 0)
