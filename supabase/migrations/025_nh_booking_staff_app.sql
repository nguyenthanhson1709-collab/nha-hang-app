-- 025: App nhân viên đặt bàn riêng (đăng nhập bằng mã PIN, chỉ thấy phần đặt bàn) chạy trên DB này.
-- Người dùng chốt 26.11.2026: nhân viên vẫn dùng app đặt bàn riêng như trước, không cần tài khoản app nhà hàng.
--   nh_bk_staff        = nhân viên PIN của từng quán (chép từ app cũ, giữ id + mã PIN đã mã hoá)
--   nh_bk_access(rid)  = thành viên app nhà hàng HOẶC nhân viên PIN của quán  -> xem/sửa đơn
--   nh_bk_manage(rid)  = chủ/phụ trách app nhà hàng HOẶC nhân viên PIN vai trò "owner" -> cài đặt, sơ đồ, nhân viên, xoá đơn
-- Nhân viên PIN chỉ có quyền trên bảng nh_bk_*, không đọc được hoá đơn, sổ quỹ, nhân sự của app nhà hàng.

alter table public.nh_bk_settings add column if not exists font_size text not null default 'm';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'nh_bk_settings_font_size_check') then
    alter table public.nh_bk_settings add constraint nh_bk_settings_font_size_check check (font_size in ('s','m','l'));
  end if;
end $$;

create table if not exists public.nh_bk_staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  role          text not null default 'staff' check (role in ('owner','staff')),
  auth_user     uuid unique references auth.users(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists nh_bk_staff_rid on public.nh_bk_staff (restaurant_id);
-- Mã PIN (bcrypt) để riêng, không trình duyệt nào đọc được (RLS bật, không có policy)
create table if not exists public.nh_bk_staff_pins (
  staff_id  uuid primary key references public.nh_bk_staff(id) on delete cascade,
  pin_hash  text not null
);
create table if not exists public.nh_bk_login_attempts (
  id   bigint generated always as identity primary key,
  ip   text,
  ok   boolean not null,
  at   timestamptz not null default now()
);
create index if not exists nh_bk_login_attempts_at on public.nh_bk_login_attempts (at);
alter table public.nh_bk_staff          enable row level security;
alter table public.nh_bk_staff_pins     enable row level security;
alter table public.nh_bk_login_attempts enable row level security;

-- ---------- quyền ----------
create or replace function public.nh_bk_access(p_rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_is_member(p_rid)
      or exists (select 1 from public.nh_bk_staff s where s.auth_user = auth.uid() and s.restaurant_id = p_rid and s.active)
$$;
create or replace function public.nh_bk_manage(p_rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_can_manage(p_rid)
      or exists (select 1 from public.nh_bk_staff s where s.auth_user = auth.uid() and s.restaurant_id = p_rid and s.active and s.role = 'owner')
$$;
create or replace function public.nh_bk_my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select name from public.nh_bk_staff where auth_user = auth.uid() and active order by created_at limit 1),
    (select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.nh_profiles where id = auth.uid()))
$$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'nh_bk_staff_read') then
    create policy nh_bk_staff_read  on public.nh_bk_staff for select to authenticated using (public.nh_bk_access(restaurant_id));
    create policy nh_bk_staff_write on public.nh_bk_staff for update to authenticated using (public.nh_bk_manage(restaurant_id)) with check (public.nh_bk_manage(restaurant_id));
  end if;
end $$;
grant select, update (name, active) on public.nh_bk_staff to authenticated;
revoke all on public.nh_bk_staff from anon;
revoke all on public.nh_bk_staff_pins, public.nh_bk_login_attempts from anon, authenticated;

-- Các bảng đặt bàn: nhân viên PIN được như thành viên quán, PIN "owner" được như chủ / phụ trách
alter policy nh_bk_settings_read on public.nh_bk_settings using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_settings_write on public.nh_bk_settings using (public.nh_bk_manage(restaurant_id)) with check (public.nh_bk_manage(restaurant_id));
alter policy nh_bk_peak_read on public.nh_bk_peak_rules using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_peak_write on public.nh_bk_peak_rules using (public.nh_bk_manage(restaurant_id)) with check (public.nh_bk_manage(restaurant_id));
alter policy nh_bk_areas_read on public.nh_bk_areas using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_areas_write on public.nh_bk_areas using (public.nh_bk_manage(restaurant_id)) with check (public.nh_bk_manage(restaurant_id));
alter policy nh_bk_tables_read on public.nh_bk_tables using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_tables_write on public.nh_bk_tables using (public.nh_bk_manage(restaurant_id)) with check (public.nh_bk_manage(restaurant_id));
alter policy nh_bk_bookings_read on public.nh_bk_bookings using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_bt_read on public.nh_bk_booking_tables using (public.nh_bk_access(restaurant_id));
alter policy nh_bk_notes_all on public.nh_bk_guest_notes using (public.nh_bk_access(restaurant_id)) with check (public.nh_bk_access(restaurant_id));
alter policy nh_bk_reviews_read on public.nh_bk_reviews
  using (exists (select 1 from public.nh_bk_bookings b where b.id = booking_id and public.nh_bk_manage(b.restaurant_id)));
alter policy nh_bk_log_read on public.nh_bk_log
  using (exists (select 1 from public.nh_bk_bookings b where b.id = booking_id and public.nh_bk_manage(b.restaurant_id)));

-- Thao tác đơn: như 021 nhưng dùng nh_bk_access / nh_bk_manage
create or replace function public.nh_bk_save_booking(
  p_rid uuid, p_id uuid, p_day date, p_slot time, p_party int, p_name text, p_phone text, p_email text,
  p_note text, p_source text, p_tables text[], p_override boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare bid uuid; old public.nh_bk_bookings; oldt text;
begin
  if not public.nh_bk_access(p_rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_party, 0) < 1 then raise exception 'party' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'name' using errcode = 'P0001'; end if;
  if p_id is not null then
    select * into old from public.nh_bk_bookings where id = p_id for update;
    if old.id is not null and old.restaurant_id <> p_rid then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('nh-bk-' || p_rid::text || '-' || p_day::text));
  if (old.id is null or old.status in ('pending','confirmed','seated'))
     and exists (select 1 from public.nh_bk_peak_violations(p_rid, p_day, p_slot, p_party, p_id)) then
    if not (coalesce(p_override, false) and public.nh_bk_manage(p_rid)) then
      raise exception 'full' using errcode = 'P0001';
    end if;
  end if;

  if old.id is null then
    insert into public.nh_bk_bookings (id, restaurant_id, code, day, slot, party, name, phone, email, note, status, source, created_by, created_by_name)
    values (coalesce(p_id, gen_random_uuid()), p_rid, public.nh_bk_new_code(), p_day, p_slot, p_party, trim(p_name),
            nullif(trim(coalesce(p_phone,'')),''), nullif(lower(trim(coalesce(p_email,''))),''), nullif(trim(coalesce(p_note,'')),''),
            'confirmed', case when p_source in ('phone','walkin') then p_source else 'phone' end, auth.uid(), public.nh_bk_my_name())
    returning id into bid;
  else
    update public.nh_bk_bookings set day = p_day, slot = p_slot, party = p_party, name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone,'')),''), email = nullif(lower(trim(coalesce(p_email,''))),''),
      note = nullif(trim(coalesce(p_note,'')),''),
      source = case when old.source = 'online' then 'online' when p_source in ('phone','walkin') then p_source else old.source end
    where id = p_id;
    bid := p_id;
  end if;

  if p_tables is not null then
    oldt := public.nh_bk_table_list(bid);
    if oldt is not null then delete from public.nh_bk_booking_tables where booking_id = bid; end if;
    insert into public.nh_bk_booking_tables (booking_id, restaurant_id, table_id)
      select bid, p_rid, t from unnest(p_tables) t
      where exists (select 1 from public.nh_bk_tables x where x.restaurant_id = p_rid and x.id = t)
      on conflict do nothing;
    perform public.nh_bk_log_add(bid, 'tables', oldt, public.nh_bk_table_list(bid));
  end if;
  return bid;
end $$;

create or replace function public.nh_bk_set_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings;
begin
  select * into b from public.nh_bk_bookings where id = p_id for update;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  if not public.nh_bk_access(b.restaurant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('confirmed','seated','noshow','rejected') then raise exception 'status' using errcode = 'P0001'; end if;
  if b.status in ('cancelled','rejected') then raise exception 'cancelled' using errcode = 'P0001'; end if;
  if p_status = 'rejected' and b.status <> 'pending' then raise exception 'status' using errcode = 'P0001'; end if;
  if b.status = p_status then return; end if;
  update public.nh_bk_bookings set status = p_status, auto_arrived = false where id = p_id;
  if p_status = 'rejected' then delete from public.nh_bk_booking_tables where booking_id = p_id; end if;
  if b.status = 'pending' and b.source = 'online' and p_status in ('confirmed','rejected') then
    insert into public.nh_bk_email_outbox (booking_id, kind) values (p_id, case when p_status = 'confirmed' then 'approved' else 'rejected' end);
  end if;
end $$;

create or replace function public.nh_bk_set_tables(p_id uuid, p_tables text[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings; oldt text;
begin
  select * into b from public.nh_bk_bookings where id = p_id for update;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  if not public.nh_bk_access(b.restaurant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.status in ('cancelled','rejected') then raise exception 'cancelled' using errcode = 'P0001'; end if;
  oldt := public.nh_bk_table_list(p_id);
  if oldt is not null then delete from public.nh_bk_booking_tables where booking_id = p_id; end if;
  insert into public.nh_bk_booking_tables (booking_id, restaurant_id, table_id)
    select p_id, b.restaurant_id, t from unnest(coalesce(p_tables, '{}')) t
    where exists (select 1 from public.nh_bk_tables x where x.restaurant_id = b.restaurant_id and x.id = t)
    on conflict do nothing;
  perform public.nh_bk_log_add(p_id, 'tables', oldt, public.nh_bk_table_list(p_id));
end $$;

create or replace function public.nh_bk_set_called(p_id uuid, p_called boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.nh_bk_bookings where id = p_id;
  if rid is null or not public.nh_bk_access(rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.nh_bk_bookings set called = coalesce(p_called, false) where id = p_id;
end $$;

create or replace function public.nh_bk_delete_booking(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.nh_bk_bookings where id = p_id;
  if rid is null or not public.nh_bk_manage(rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if found then delete from public.nh_bk_bookings where id = p_id and restaurant_id = rid; end if;
end $$;

create or replace function public.nh_bk_reviews_list(p_rid uuid, p_days int default 90)
returns table (booking_id uuid, day date, slot time, party int, name text, tables text, stars int, comment text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.day, b.slot, b.party, b.name, public.nh_bk_table_list(b.id), r.stars, r.comment, r.created_at
  from public.nh_bk_reviews r join public.nh_bk_bookings b on b.id = r.booking_id
  where public.nh_bk_manage(p_rid) and b.restaurant_id = p_rid
    and r.created_at > now() - make_interval(days => greatest(1, least(p_days, 400)))
  order by r.created_at desc
$$;

-- ---------- nhân viên PIN ----------
-- Người đang đăng nhập trong app đặt bàn: {id, name, role}. Chủ / phụ trách app nhà hàng đăng nhập bằng email
-- được tự gắn vào dòng "owner" chưa có tài khoản (dòng chép từ app cũ), không có thì tạo mới.
create or replace function public.nh_bk_my_staff(p_rid uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
declare s public.nh_bk_staff;
begin
  if auth.uid() is null or not public.nh_bk_access(p_rid) then return null; end if;
  select * into s from public.nh_bk_staff where auth_user = auth.uid() and restaurant_id = p_rid and active;
  if not found and public.nh_can_manage(p_rid) then
    update public.nh_bk_staff set auth_user = auth.uid()
      where id = (select id from public.nh_bk_staff where restaurant_id = p_rid and role = 'owner' and active and auth_user is null order by created_at limit 1)
      returning * into s;
    if s.id is null then
      insert into public.nh_bk_staff (restaurant_id, name, role, auth_user)
      values (p_rid, coalesce(public.nh_bk_my_name(), 'Chef'), 'owner', auth.uid()) returning * into s;
    end if;
  end if;
  if s.id is null then return null; end if;
  return json_build_object('id', s.id, 'name', s.name, 'role', case when public.nh_bk_manage(p_rid) then 'owner' else s.role end);
end $$;

create or replace function public.nh_bk_pin_taken(p_rid uuid, p_pin text, p_except uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nh_bk_staff s join public.nh_bk_staff_pins p on p.staff_id = s.id
                 where s.restaurant_id = p_rid and s.active and s.id is distinct from p_except
                   and p.pin_hash = extensions.crypt(p_pin, p.pin_hash))
$$;

create or replace function public.nh_bk_staff_add(p_rid uuid, p_name text, p_pin text, p_id uuid default null) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.nh_bk_manage(p_rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name' using errcode = 'P0001'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'pin' using errcode = 'P0001'; end if;
  if public.nh_bk_pin_taken(p_rid, p_pin, null) then raise exception 'pin_taken' using errcode = 'P0001'; end if;
  insert into public.nh_bk_staff (id, restaurant_id, name, role) values (coalesce(p_id, gen_random_uuid()), p_rid, trim(p_name), 'staff')
    returning id into sid;
  insert into public.nh_bk_staff_pins (staff_id, pin_hash) values (sid, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)));
  return sid;
end $$;

create or replace function public.nh_bk_staff_set_pin(p_id uuid, p_pin text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.nh_bk_staff where id = p_id;
  if rid is null then raise exception 'notfound' using errcode = 'P0001'; end if;
  -- chủ đổi mã của bất kỳ ai; mỗi người đổi được mã của chính mình
  if not (public.nh_bk_manage(rid) or exists (select 1 from public.nh_bk_staff where id = p_id and auth_user = auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'pin' using errcode = 'P0001'; end if;
  if public.nh_bk_pin_taken(rid, p_pin, p_id) then raise exception 'pin_taken' using errcode = 'P0001'; end if;
  insert into public.nh_bk_staff_pins (staff_id, pin_hash) values (p_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
    on conflict (staff_id) do update set pin_hash = excluded.pin_hash;
end $$;

-- Gọi từ hàm nh-bk-pin-login (service role). 5 lần sai / 15 phút / IP thì khoá; 50 lần sai toàn hệ thống cũng khoá.
create or replace function public.nh_bk_pin_check(p_slug text, p_pin text, p_ip text default null) returns json
language plpgsql volatile security definer set search_path = public as $$
declare rid uuid; s public.nh_bk_staff; v_ip text := coalesce(nullif(trim(p_ip), ''), '?');
begin
  delete from public.nh_bk_login_attempts where at < now() - interval '1 day';
  if (select count(*) from public.nh_bk_login_attempts where ip = v_ip and not ok and at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.nh_bk_login_attempts where not ok and at > now() - interval '15 minutes') >= 50 then
    return json_build_object('result', 'locked');
  end if;
  select restaurant_id into rid from public.nh_bk_settings where slug = lower(trim(p_slug));
  if rid is not null and coalesce(p_pin, '') ~ '^[0-9]{4}$' then
    select st.* into s from public.nh_bk_staff st join public.nh_bk_staff_pins p on p.staff_id = st.id
    where st.restaurant_id = rid and st.active and p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
    order by st.created_at limit 1;
  end if;
  insert into public.nh_bk_login_attempts (ip, ok) values (v_ip, s.id is not null);
  if s.id is null then return json_build_object('result', 'pin'); end if;
  return json_build_object('result', 'ok', 'staff_id', s.id, 'name', s.name, 'auth_user', s.auth_user);
end $$;

create or replace function public.nh_bk_set_staff_auth(p_staff uuid, p_auth uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.nh_bk_staff set auth_user = p_auth where id = p_staff and auth_user is null
$$;

-- ---------- chép từ app cũ: thêm nhân viên + mã PIN ----------
create or replace function public.nh_bk_mirror_apply(p jsonb) returns json
language plpgsql volatile security definer set search_path = public as $$
declare rid uuid; s jsonb; nb int; ids uuid[];
begin
  select restaurant_id into rid from public.nh_bk_settings where mirror_old limit 1;
  if rid is null then return json_build_object('skip', 'no mirror restaurant'); end if;
  if jsonb_typeof(p->'bookings') <> 'array' or jsonb_typeof(p->'tables') <> 'array' then raise exception 'incomplete payload'; end if;
  -- không ghi lịch sử thao tác khi chép (lịch sử lấy từ app cũ)
  begin set local session_replication_role = replica; exception when others then null; end;

  s := p->'settings';
  if s is not null then
    update public.nh_bk_settings set
      auto_confirm = (s->>'auto_confirm')::boolean, peak_enabled = (s->>'peak_enabled')::boolean,
      duration_min = (s->>'duration_min')::int, min_online = (s->>'min_online')::int, max_online = (s->>'max_online')::int,
      slot_step = (s->>'slot_step')::int, open_time = (s->>'open_time')::time, close_time = (s->>'close_time')::time,
      weekday_from = (s->>'weekday_from')::time, closed_days = array(select jsonb_array_elements_text(s->'closed_days')),
      lead_hours = (s->>'lead_hours')::int, auto_arrive_min = (s->>'auto_arrive_min')::int,
      contact_email = s->>'contact_email', font_size = coalesce(s->>'font_size', font_size), google_review_url = s->>'google_review_url', updated_at = now()
    where restaurant_id = rid;
  end if;

  insert into public.nh_bk_areas (restaurant_id, id, name, sort)
    select rid, j->>'id', j->>'name', coalesce((j->>'sort')::int, 0) from jsonb_array_elements(p->'areas') j
    on conflict (restaurant_id, id) do update set name = excluded.name, sort = excluded.sort;

  insert into public.nh_bk_tables (restaurant_id, id, label, area_id, x, y, w, h, rot, active)
    select rid, j->>'id', j->>'label', j->>'area_id', (j->>'x')::numeric, (j->>'y')::numeric, (j->>'w')::numeric, (j->>'h')::numeric,
           coalesce((j->>'rot')::numeric, 0), coalesce((j->>'active')::boolean, true)
    from jsonb_array_elements(p->'tables') j
    on conflict (restaurant_id, id) do update set label = excluded.label, area_id = excluded.area_id, x = excluded.x, y = excluded.y,
      w = excluded.w, h = excluded.h, rot = excluded.rot, active = excluded.active;
  update public.nh_bk_tables set active = false
    where restaurant_id = rid and id not in (select j->>'id' from jsonb_array_elements(p->'tables') j);

  insert into public.nh_bk_peak_rules (id, restaurant_id, days, start_time, end_time, max_guests, block_min, active, created_at)
    select (j->>'id')::uuid, rid, array(select jsonb_array_elements_text(j->'days')::int), (j->>'start_time')::time, (j->>'end_time')::time,
           (j->>'max_guests')::int, (j->>'block_min')::int, (j->>'active')::boolean, (j->>'created_at')::timestamptz
    from jsonb_array_elements(p->'rules') j
    on conflict (id) do update set days = excluded.days, start_time = excluded.start_time, end_time = excluded.end_time,
      max_guests = excluded.max_guests, block_min = excluded.block_min, active = excluded.active;
  delete from public.nh_bk_peak_rules
    where restaurant_id = rid and id not in (select (j->>'id')::uuid from jsonb_array_elements(p->'rules') j);

  insert into public.nh_bk_bookings (id, restaurant_id, code, manage_token, day, slot, party, name, phone, email, note, lang, status, source,
      channel, created_at, created_by_name, auto_arrived, cancelled_at, called, review_ok)
    select (j->>'id')::uuid, rid, j->>'code', j->>'manage_token', (j->>'day')::date, (j->>'slot')::time, (j->>'party')::int, j->>'name',
           j->>'phone', j->>'email', j->>'note', j->>'lang', j->>'status', j->>'source', j->>'channel', (j->>'created_at')::timestamptz,
           (select st->>'name' from jsonb_array_elements(p->'staff') st where st->>'id' = j->>'created_by' limit 1),
           coalesce((j->>'auto_arrived')::boolean, false), (j->>'cancelled_at')::timestamptz,
           coalesce((j->>'called')::boolean, false), coalesce((j->>'review_ok')::boolean, false)
    from jsonb_array_elements(p->'bookings') j
    on conflict (id) do update set code = excluded.code, manage_token = excluded.manage_token, day = excluded.day, slot = excluded.slot,
      party = excluded.party, name = excluded.name, phone = excluded.phone, email = excluded.email, note = excluded.note, lang = excluded.lang,
      status = excluded.status, source = excluded.source, channel = excluded.channel, created_by_name = excluded.created_by_name,
      auto_arrived = excluded.auto_arrived, cancelled_at = excluded.cancelled_at, called = excluded.called, review_ok = excluded.review_ok;
  get diagnostics nb = row_count;
  ids := array(select (j->>'id')::uuid from jsonb_array_elements(p->'bookings') j);
  delete from public.nh_bk_bookings where restaurant_id = rid and not (id = any(ids));

  delete from public.nh_bk_booking_tables where restaurant_id = rid;
  insert into public.nh_bk_booking_tables (booking_id, restaurant_id, table_id)
    select (j->>'booking_id')::uuid, rid, j->>'table_id' from jsonb_array_elements(p->'booking_tables') j
    where (j->>'booking_id')::uuid = any(ids)
      and exists (select 1 from public.nh_bk_tables t where t.restaurant_id = rid and t.id = j->>'table_id')
    on conflict do nothing;

  delete from public.nh_bk_guest_notes where restaurant_id = rid;
  insert into public.nh_bk_guest_notes (restaurant_id, guest_key, note)
    select rid, j->>'guest_key', j->>'note' from jsonb_array_elements(p->'notes') j on conflict do nothing;

  insert into public.nh_bk_reviews (booking_id, stars, comment, created_at, updated_at)
    select (j->>'booking_id')::uuid, (j->>'stars')::int, j->>'comment', (j->>'created_at')::timestamptz, (j->>'updated_at')::timestamptz
    from jsonb_array_elements(p->'reviews') j where (j->>'booking_id')::uuid = any(ids)
    on conflict (booking_id) do update set stars = excluded.stars, comment = excluded.comment, updated_at = excluded.updated_at;

  insert into public.nh_bk_log (src_id, booking_id, at, staff_name, kind, old_value, new_value)
    select (j->>'id')::bigint, (j->>'booking_id')::uuid, (j->>'at')::timestamptz, j->>'staff_name', j->>'kind', j->>'old_value', j->>'new_value'
    from jsonb_array_elements(p->'log') j where (j->>'booking_id')::uuid = any(ids)
    on conflict (src_id) do nothing;

  -- nhân viên PIN (giữ id để mã PIN cũ dùng tiếp; không xoá, chỉ ẩn người không còn ở app cũ)
  if jsonb_typeof(p->'staff') = 'array' and jsonb_array_length(p->'staff') > 0 and (p->'staff'->0) ? 'role' then
    insert into public.nh_bk_staff (id, restaurant_id, name, role, active, created_at)
      select (j->>'id')::uuid, rid, j->>'name', case when j->>'role' = 'owner' then 'owner' else 'staff' end,
             coalesce((j->>'active')::boolean, true), coalesce((j->>'created_at')::timestamptz, now())
      from jsonb_array_elements(p->'staff') j
      on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
    update public.nh_bk_staff set active = false
      where restaurant_id = rid and id not in (select (j->>'id')::uuid from jsonb_array_elements(p->'staff') j);
  end if;
  if jsonb_typeof(p->'pins') = 'array' then
    insert into public.nh_bk_staff_pins (staff_id, pin_hash)
      select (j->>'staff_id')::uuid, j->>'pin_hash' from jsonb_array_elements(p->'pins') j
      where exists (select 1 from public.nh_bk_staff s where s.id = (j->>'staff_id')::uuid)
      on conflict (staff_id) do update set pin_hash = excluded.pin_hash;
  end if;

  return json_build_object('bookings', nb, 'at', now());
end $$;

-- Đang chép từ app cũ thì nhân viên cũng chỉ sửa ở app cũ
drop trigger if exists nh_bk_mirror_guard on public.nh_bk_staff;
create trigger nh_bk_mirror_guard before insert or update or delete on public.nh_bk_staff
  for each row execute function public.nh_bk_mirror_guard();

-- ---------- quyền gọi hàm ----------
revoke execute on function
  public.nh_bk_access(uuid), public.nh_bk_manage(uuid), public.nh_bk_pin_taken(uuid, text, uuid),
  public.nh_bk_my_staff(uuid), public.nh_bk_staff_add(uuid, text, text, uuid), public.nh_bk_staff_set_pin(uuid, text),
  public.nh_bk_pin_check(text, text, text), public.nh_bk_set_staff_auth(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.nh_bk_access(uuid), public.nh_bk_manage(uuid),
  public.nh_bk_my_staff(uuid), public.nh_bk_staff_add(uuid, text, text, uuid), public.nh_bk_staff_set_pin(uuid, text)
  to authenticated;
grant execute on function public.nh_bk_pin_check(text, text, text), public.nh_bk_set_staff_auth(uuid, uuid) to service_role;

-- ---------- email cho khách (Brevo) ----------
-- Mỗi phút, nếu có thư chờ gửi thì gọi hàm nh-bk-send-mail (dùng chung khoá bí mật với nh-bk-sync)
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-bk-send-mail') then
    perform cron.schedule('nh-bk-send-mail', '* * * * *', $job$
      select net.http_post(
        url := 'https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-bk-send-mail',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nh_bk_sync_secret')),
        body := '{}'::jsonb)
      where exists (select 1 from public.nh_bk_email_outbox where sent_at is null and error is null)
    $job$);
  end if;
end $$;
