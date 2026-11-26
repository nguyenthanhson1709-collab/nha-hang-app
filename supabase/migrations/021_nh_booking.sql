-- 021: Module Đặt bàn (Reservierungen), ghép từ app đặt bàn Vietbowl Potsdamer Platz (Supabase cũ sfeqtlqibaiptnkkjecw).
-- Mọi bảng có restaurant_id; quyền theo thành viên quán:
--   thành viên (nh_is_member)  = xem đơn, tạo/sửa đơn, đổi trạng thái, chọn bàn, ghi chú khách
--   chủ + người phụ trách (nh_can_manage) = cài đặt, sơ đồ bàn, luật cao điểm, đánh giá, lịch sử thao tác, xoá đơn, vượt giới hạn cao điểm
-- Trang khách gọi các hàm nh_bk_* theo "slug" của quán, chỉ chạy khi quán bật online_enabled
-- (để DB mới không nhận đơn của khách trước khi chuyển trang khách sang).
-- Không dùng DROP (xem ghi chú trong repo): chỉ create if not exists / create or replace.

create extension if not exists pgcrypto with schema extensions;

-- ---------- cài đặt (1 dòng / quán) ----------
create table if not exists public.nh_bk_settings (
  restaurant_id    uuid primary key references public.nh_restaurants(id) on delete cascade,
  slug             text unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  online_enabled   boolean not null default false,
  auto_confirm     boolean not null default true,
  peak_enabled     boolean not null default true,
  duration_min     int     not null default 90  check (duration_min between 30 and 300),
  min_online       int     not null default 4   check (min_online >= 1),
  max_online       int     not null default 20  check (max_online >= 1),
  slot_step        int     not null default 15  check (slot_step in (15, 30)),
  open_time        time    not null default '11:30',
  close_time       time    not null default '23:00',
  weekday_from     time             default '14:00',
  closed_days      text[]  not null default '{12-24,12-25}',
  lead_hours       int     not null default 4   check (lead_hours between 0 and 72),
  auto_arrive_min  int     not null default 20  check (auto_arrive_min between 0 and 180),
  contact_email    text,
  tz               text    not null default 'Europe/Berlin',
  google_review_url text   check (google_review_url is null or google_review_url ~* '^https://'),
  updated_at       timestamptz not null default now()
);

create table if not exists public.nh_bk_peak_rules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  days          int[]   not null,
  start_time    time    not null,
  end_time      time    not null check (end_time > start_time),
  max_guests    int     not null check (max_guests > 0),
  block_min     int     not null check (block_min in (15, 30, 60)),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists nh_bk_peak_rules_rid on public.nh_bk_peak_rules (restaurant_id);

-- ---------- sơ đồ bàn ----------
create table if not exists public.nh_bk_areas (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  id    text not null,
  name  text not null,
  sort  int  not null default 0,
  primary key (restaurant_id, id)
);
create table if not exists public.nh_bk_tables (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  id       text not null,
  label    text not null,
  area_id  text,
  x numeric not null, y numeric not null, w numeric not null, h numeric not null,
  rot      numeric not null default 0,
  seats    int check (seats is null or seats between 0 and 40),
  flip     boolean not null default false,
  active   boolean not null default true,
  primary key (restaurant_id, id)
);

-- ---------- đơn đặt bàn ----------
create table if not exists public.nh_bk_bookings (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  code          text not null unique,
  manage_token  text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  day           date not null,
  slot          time not null,
  party         int  not null check (party >= 1),
  name          text not null,
  phone         text,
  email         text,
  note          text,
  lang          text not null default 'de' check (lang in ('de','en','vi')),
  status        text not null check (status in ('pending','confirmed','seated','noshow','cancelled','rejected')),
  source        text not null check (source in ('online','phone','walkin')),
  channel       text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  created_by_name text,
  auto_arrived  boolean not null default false,
  cancelled_at  timestamptz,
  called        boolean not null default false,
  review_ok     boolean not null default false
);
create index if not exists nh_bk_bookings_day on public.nh_bk_bookings (restaurant_id, day, slot);

create table if not exists public.nh_bk_booking_tables (
  booking_id    uuid not null references public.nh_bk_bookings(id) on delete cascade,
  restaurant_id uuid not null,
  table_id      text not null,
  primary key (booking_id, table_id),
  foreign key (restaurant_id, table_id) references public.nh_bk_tables(restaurant_id, id) on delete cascade
);

create table if not exists public.nh_bk_guest_notes (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  guest_key  text not null,
  note       text not null,
  primary key (restaurant_id, guest_key)
);

create table if not exists public.nh_bk_reviews (
  booking_id  uuid primary key references public.nh_bk_bookings(id) on delete cascade,
  stars       int  not null check (stars between 1 and 5),
  comment     text check (length(comment) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.nh_bk_log (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.nh_bk_bookings(id) on delete cascade,
  at          timestamptz not null default now(),
  user_id     uuid,
  staff_name  text,
  kind        text not null check (kind in ('status','tables')),
  old_value   text,
  new_value   text
);
create index if not exists nh_bk_log_booking on public.nh_bk_log (booking_id, at);

-- Hàng đợi email cho khách (hàm gửi mail đọc bằng service role)
create table if not exists public.nh_bk_email_outbox (
  id          bigint generated always as identity primary key,
  booking_id  uuid references public.nh_bk_bookings(id) on delete cascade,
  kind        text not null check (kind in ('confirmed','pending','approved','cancelled','rejected','review')),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);

-- ---------- hàm phụ ----------
create or replace function public.nh_bk_settings_of(p_rid uuid) returns public.nh_bk_settings
language plpgsql stable security definer set search_path = public as $$
declare s public.nh_bk_settings;
begin
  select * into s from public.nh_bk_settings where restaurant_id = p_rid;
  if not found then s.restaurant_id := p_rid;
    -- giá trị mặc định khi quán chưa có dòng cài đặt
    s.online_enabled := false; s.auto_confirm := true; s.peak_enabled := true; s.duration_min := 90; s.min_online := 4; s.max_online := 20;
    s.slot_step := 15; s.open_time := '11:30'; s.close_time := '23:00'; s.weekday_from := '14:00'; s.closed_days := '{12-24,12-25}';
    s.lead_hours := 4; s.auto_arrive_min := 20; s.tz := 'Europe/Berlin';
  end if;
  return s;
end $$;

create or replace function public.nh_bk_my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.nh_profiles where id = auth.uid()
$$;

create or replace function public.nh_bk_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    c := 'VB-';
    for i in 1..5 loop c := c || substr(chars, 1 + floor(random()*length(chars))::int, 1); end loop;
    exit when not exists (select 1 from public.nh_bk_bookings where code = c);
  end loop;
  return c;
end $$;

-- Khung giờ cao điểm sẽ bị vượt nếu thêm p_party khách vào (p_day, p_slot)
create or replace function public.nh_bk_peak_violations(p_rid uuid, p_day date, p_slot time, p_party int, p_exclude uuid default null)
returns table (rule_id uuid, win_start time, win_end time, booked int, max_guests int)
language sql stable security definer set search_path = public as $$
  with s as (select peak_enabled from public.nh_bk_settings_of(p_rid)),
  r as (
    select pr.*,
           pr.start_time + make_interval(mins => (floor(extract(epoch from (p_slot - pr.start_time)) / 60 / pr.block_min) * pr.block_min)::int) as ws
    from public.nh_bk_peak_rules pr, s
    where pr.restaurant_id = p_rid and s.peak_enabled and pr.active
      and extract(dow from p_day)::int = any(pr.days)
      and p_slot >= pr.start_time and p_slot < pr.end_time
  ),
  c as (
    select r.id, r.ws, r.block_min, r.max_guests,
           coalesce((select sum(b.party) from public.nh_bk_bookings b
                     where b.restaurant_id = p_rid and b.day = p_day
                       and b.slot >= r.ws and b.slot < r.ws + make_interval(mins => r.block_min)
                       and b.status in ('pending','confirmed','seated')
                       and (p_exclude is null or b.id <> p_exclude)), 0)::int as booked
    from r
  )
  select c.id, c.ws, (c.ws + make_interval(mins => c.block_min))::time, c.booked, c.max_guests
  from c where c.booked + p_party > c.max_guests
$$;

-- Lý do khách online không đặt được giờ này (null = được, chưa tính cao điểm)
create or replace function public.nh_bk_online_rule_error(p_rid uuid, p_day date, p_slot time, p_party int)
returns text language plpgsql stable security definer set search_path = public as $$
declare s public.nh_bk_settings; starts timestamptz; first_slot time;
begin
  s := public.nh_bk_settings_of(p_rid);
  if p_party < s.min_online or p_party > s.max_online then return 'party'; end if;
  if to_char(p_day, 'MM-DD') = any(s.closed_days) then return 'closed'; end if;
  first_slot := case when extract(isodow from p_day) between 1 and 5 and s.weekday_from is not null
                     then greatest(s.open_time, s.weekday_from) else s.open_time end;
  if p_slot < first_slot or p_slot > s.close_time - make_interval(mins => s.duration_min) then return 'hours'; end if;
  if (extract(epoch from (p_slot - s.open_time)) / 60)::int % s.slot_step <> 0 then return 'hours'; end if;
  starts := (p_day + p_slot) at time zone s.tz;
  if starts < now() + make_interval(hours => s.lead_hours) then return 'lead'; end if;
  return null;
end $$;

create or replace function public.nh_bk_rid_by_slug(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select restaurant_id from public.nh_bk_settings where slug = lower(trim(p_slug)) and online_enabled
$$;

create or replace function public.nh_bk_table_list(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(table_id, ',' order by table_id) from public.nh_bk_booking_tables where booking_id = p_id
$$;

create or replace function public.nh_bk_log_add(p_id uuid, p_kind text, p_old text, p_new text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_old is not distinct from p_new then return; end if;
  insert into public.nh_bk_log (booking_id, user_id, staff_name, kind, old_value, new_value)
  values (p_id, auth.uid(), case when auth.uid() is null then null else public.nh_bk_my_name() end, p_kind, p_old, p_new);
end $$;

-- Mọi lần đổi trạng thái (nhân viên, tự động, khách huỷ) đều ghi lịch sử
create or replace function public.nh_bk_status_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.nh_bk_log_add(new.id, 'status', old.status, new.status);
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'nh_bk_status_log') then
    create trigger nh_bk_status_log after update of status on public.nh_bk_bookings
      for each row execute function public.nh_bk_status_log();
  end if;
end $$;

-- ---------- trang khách (không cần đăng nhập) ----------
-- Thông tin công khai của quán cho trang khách (giờ mở, luật đặt). Không có dữ liệu cá nhân.
create or replace function public.nh_bk_public_settings(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('name', r.name, 'auto_confirm', s.auto_confirm, 'duration_min', s.duration_min,
    'min_online', s.min_online, 'max_online', s.max_online, 'slot_step', s.slot_step, 'open_time', s.open_time,
    'close_time', s.close_time, 'weekday_from', s.weekday_from, 'closed_days', s.closed_days, 'lead_hours', s.lead_hours,
    'contact_email', s.contact_email, 'tz', s.tz)
  from public.nh_bk_settings s join public.nh_restaurants r on r.id = s.restaurant_id
  where s.slug = lower(trim(p_slug)) and s.online_enabled
$$;

-- Giờ còn chỗ: state ok | full | lead | party | closed
create or replace function public.nh_bk_available_slots(p_slug text, p_day date, p_party int)
returns table (slot time, state text)
language plpgsql stable security definer set search_path = public as $$
declare rid uuid := public.nh_bk_rid_by_slug(p_slug); s public.nh_bk_settings; t time; e text;
begin
  if rid is null then return; end if;
  s := public.nh_bk_settings_of(rid);
  t := s.open_time;
  while t <= s.close_time - make_interval(mins => s.duration_min) loop
    e := public.nh_bk_online_rule_error(rid, p_day, t, p_party);
    if e is distinct from 'hours' then
      slot := t;
      state := coalesce(e, case when exists (select 1 from public.nh_bk_peak_violations(rid, p_day, t, p_party)) then 'full' else 'ok' end);
      return next;
    end if;
    t := t + make_interval(mins => s.slot_step);
  end loop;
end $$;

create or replace function public.nh_bk_book_online(
  p_slug text, p_day date, p_slot time, p_party int, p_name text, p_phone text, p_email text,
  p_note text default null, p_consent boolean default false, p_lang text default 'de',
  p_channel text default null, p_review_ok boolean default false)
returns json language plpgsql volatile security definer set search_path = public as $$
declare rid uuid := public.nh_bk_rid_by_slug(p_slug); s public.nh_bk_settings; err text; b public.nh_bk_bookings;
begin
  if rid is null then raise exception 'closed' using errcode = 'P0001'; end if;
  if not coalesce(p_consent, false) then raise exception 'consent' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'name' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_phone,''))) < 5 then raise exception 'phone' using errcode = 'P0001'; end if;
  if coalesce(p_email,'') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email' using errcode = 'P0001'; end if;
  err := public.nh_bk_online_rule_error(rid, p_day, p_slot, p_party);
  if err is not null then raise exception '%', err using errcode = 'P0001'; end if;

  -- Mỗi ngày mỗi quán chỉ một đơn được ghi cùng lúc: 2 khách không thể cùng lấy chỗ cuối
  perform pg_advisory_xact_lock(hashtext('nh-bk-' || rid::text || '-' || p_day::text));
  if exists (select 1 from public.nh_bk_peak_violations(rid, p_day, p_slot, p_party)) then
    raise exception 'full' using errcode = 'P0001';
  end if;

  s := public.nh_bk_settings_of(rid);
  insert into public.nh_bk_bookings (restaurant_id, code, day, slot, party, name, phone, email, note, lang, status, source, channel, review_ok)
  values (rid, public.nh_bk_new_code(), p_day, p_slot, p_party, trim(p_name), trim(p_phone), lower(trim(p_email)),
          nullif(left(trim(coalesce(p_note,'')), 200), ''), case when p_lang in ('de','en','vi') then p_lang else 'de' end,
          case when s.auto_confirm then 'confirmed' else 'pending' end, 'online',
          case when p_channel in ('web','google','instagram','facebook','qr') then p_channel else null end,
          coalesce(p_review_ok, false))
  returning * into b;
  insert into public.nh_bk_email_outbox (booking_id, kind) values (b.id, case when b.status = 'confirmed' then 'confirmed' else 'pending' end);
  return json_build_object('code', b.code, 'token', b.manage_token, 'status', b.status);
end $$;

create or replace function public.nh_bk_guest_booking(p_code text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('code', code, 'day', day, 'slot', slot, 'party', party, 'name', name, 'status', status, 'email', email)
  from public.nh_bk_bookings where code = upper(trim(p_code))
    and (manage_token = p_token or (email is not null and email = lower(trim(p_token))))
$$;

create or replace function public.nh_bk_cancel_online(p_code text, p_token text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings; s public.nh_bk_settings;
begin
  select * into b from public.nh_bk_bookings where code = upper(trim(p_code))
    and (manage_token = p_token or (email is not null and email = lower(trim(p_token)))) for update;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  s := public.nh_bk_settings_of(b.restaurant_id);
  if b.status not in ('pending','confirmed') then raise exception 'notcancellable' using errcode = 'P0001'; end if;
  if (b.day + b.slot) at time zone s.tz < now() + interval '2 hours' then raise exception 'toolate' using errcode = 'P0001'; end if;
  update public.nh_bk_bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
  insert into public.nh_bk_email_outbox (booking_id, kind) values (b.id, 'cancelled');
  return 'cancelled';
end $$;

create or replace function public.nh_bk_guest_review_info(p_code text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('name', b.name, 'day', b.day, 'slot', b.slot, 'party', b.party, 'lang', b.lang,
                           'visited', b.status = 'seated', 'stars', r.stars, 'comment', r.comment,
                           'google', (public.nh_bk_settings_of(b.restaurant_id)).google_review_url)
  from public.nh_bk_bookings b left join public.nh_bk_reviews r on r.booking_id = b.id
  where b.code = upper(trim(p_code)) and b.manage_token = p_token
$$;

create or replace function public.nh_bk_submit_review(p_code text, p_token text, p_stars int, p_comment text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings;
begin
  select * into b from public.nh_bk_bookings where code = upper(trim(p_code)) and manage_token = p_token;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  if b.status <> 'seated' then raise exception 'notvisited' using errcode = 'P0001'; end if;
  if b.day < current_date - 30 then raise exception 'toolate' using errcode = 'P0001'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'stars' using errcode = 'P0001'; end if;
  insert into public.nh_bk_reviews (booking_id, stars, comment)
  values (b.id, p_stars, nullif(left(trim(coalesce(p_comment,'')), 2000), ''))
  on conflict (booking_id) do update set stars = excluded.stars,
    comment = coalesce(excluded.comment, public.nh_bk_reviews.comment), updated_at = now();
end $$;

-- ---------- thao tác của nhân viên (đã đăng nhập app) ----------
-- Tạo hoặc sửa đơn. p_id có thể là id mới do trình duyệt tạo: khi đó là tạo mới.
create or replace function public.nh_bk_save_booking(
  p_rid uuid, p_id uuid, p_day date, p_slot time, p_party int, p_name text, p_phone text, p_email text,
  p_note text, p_source text, p_tables text[], p_override boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare bid uuid; old public.nh_bk_bookings; oldt text;
begin
  if not public.nh_is_member(p_rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_party, 0) < 1 then raise exception 'party' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'name' using errcode = 'P0001'; end if;
  if p_id is not null then
    select * into old from public.nh_bk_bookings where id = p_id for update;
    if old.id is not null and old.restaurant_id <> p_rid then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('nh-bk-' || p_rid::text || '-' || p_day::text));
  if (old.id is null or old.status in ('pending','confirmed','seated'))
     and exists (select 1 from public.nh_bk_peak_violations(p_rid, p_day, p_slot, p_party, p_id)) then
    if not (coalesce(p_override, false) and public.nh_can_manage(p_rid)) then
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

-- Nhân viên đặt: pending→confirmed (duyệt), pending→rejected (từ chối), confirmed↔seated, →noshow. Không bao giờ 'cancelled'.
create or replace function public.nh_bk_set_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings;
begin
  select * into b from public.nh_bk_bookings where id = p_id for update;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  if not public.nh_is_member(b.restaurant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
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

-- Chọn bàn từ danh sách (không kiểm tra cao điểm: chỉ đổi bàn)
create or replace function public.nh_bk_set_tables(p_id uuid, p_tables text[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare b public.nh_bk_bookings; oldt text;
begin
  select * into b from public.nh_bk_bookings where id = p_id for update;
  if not found then raise exception 'notfound' using errcode = 'P0001'; end if;
  if not public.nh_is_member(b.restaurant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
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
  if rid is null or not public.nh_is_member(rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.nh_bk_bookings set called = coalesce(p_called, false) where id = p_id;
end $$;

create or replace function public.nh_bk_delete_booking(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.nh_bk_bookings where id = p_id;
  if rid is null or not public.nh_can_manage(rid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if found then delete from public.nh_bk_bookings where id = p_id and restaurant_id = rid; end if;
end $$;

create or replace function public.nh_bk_reviews_list(p_rid uuid, p_days int default 90)
returns table (booking_id uuid, day date, slot time, party int, name text, tables text, stars int, comment text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.day, b.slot, b.party, b.name, public.nh_bk_table_list(b.id), r.stars, r.comment, r.created_at
  from public.nh_bk_reviews r join public.nh_bk_bookings b on b.id = r.booking_id
  where public.nh_can_manage(p_rid) and b.restaurant_id = p_rid
    and r.created_at > now() - make_interval(days => greatest(1, least(p_days, 400)))
  order by r.created_at desc
$$;

-- ---------- việc chạy nền (pg_cron) ----------
create or replace function public.nh_bk_auto_arrive() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.nh_bk_bookings b set status = 'seated', auto_arrived = true
  from public.nh_bk_settings s
  where s.restaurant_id = b.restaurant_id and s.auto_arrive_min > 0 and b.status = 'confirmed'
    and (b.day + b.slot) at time zone s.tz + make_interval(mins => s.auto_arrive_min) <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.nh_bk_queue_review_mails() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  insert into public.nh_bk_email_outbox (booking_id, kind)
  select b.id, 'review' from public.nh_bk_bookings b join public.nh_bk_settings s on s.restaurant_id = b.restaurant_id
  where s.online_enabled and b.review_ok and b.status = 'seated' and b.email is not null
    and b.day = (now() at time zone s.tz)::date - 1
    and not exists (select 1 from public.nh_bk_email_outbox o where o.booking_id = b.id and o.kind = 'review');
  get diagnostics n = row_count;
  return n;
end $$;

-- GDPR: xoá đơn cũ hơn 12 tháng
create or replace function public.nh_bk_purge_old() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  delete from public.nh_bk_bookings where day < (current_date - interval '12 months');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- phân quyền (RLS) ----------
alter table public.nh_bk_settings       enable row level security;
alter table public.nh_bk_peak_rules     enable row level security;
alter table public.nh_bk_areas          enable row level security;
alter table public.nh_bk_tables         enable row level security;
alter table public.nh_bk_bookings       enable row level security;
alter table public.nh_bk_booking_tables enable row level security;
alter table public.nh_bk_guest_notes    enable row level security;
alter table public.nh_bk_reviews        enable row level security;
alter table public.nh_bk_log            enable row level security;
alter table public.nh_bk_email_outbox   enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'nh_bk_settings_read') then
    create policy nh_bk_settings_read  on public.nh_bk_settings for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_settings_write on public.nh_bk_settings for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
    create policy nh_bk_peak_read  on public.nh_bk_peak_rules for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_peak_write on public.nh_bk_peak_rules for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
    create policy nh_bk_areas_read  on public.nh_bk_areas for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_areas_write on public.nh_bk_areas for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
    create policy nh_bk_tables_read  on public.nh_bk_tables for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_tables_write on public.nh_bk_tables for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
    create policy nh_bk_bookings_read on public.nh_bk_bookings for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_bt_read on public.nh_bk_booking_tables for select to authenticated using (public.nh_is_member(restaurant_id));
    create policy nh_bk_notes_all on public.nh_bk_guest_notes for all to authenticated using (public.nh_is_member(restaurant_id)) with check (public.nh_is_member(restaurant_id));
    create policy nh_bk_reviews_read on public.nh_bk_reviews for select to authenticated
      using (exists (select 1 from public.nh_bk_bookings b where b.id = booking_id and public.nh_can_manage(b.restaurant_id)));
    create policy nh_bk_log_read on public.nh_bk_log for select to authenticated
      using (exists (select 1 from public.nh_bk_bookings b where b.id = booking_id and public.nh_can_manage(b.restaurant_id)));
  end if;
end $$;

grant select, insert, update, delete on public.nh_bk_settings, public.nh_bk_peak_rules, public.nh_bk_areas,
  public.nh_bk_tables, public.nh_bk_guest_notes to authenticated;
grant select on public.nh_bk_bookings, public.nh_bk_booking_tables, public.nh_bk_reviews, public.nh_bk_log to authenticated;
-- Đơn, bàn của đơn, lịch sử chỉ sửa qua hàm (máy chủ kiểm tra luật)
revoke insert, update, delete on public.nh_bk_bookings, public.nh_bk_booking_tables, public.nh_bk_log, public.nh_bk_reviews from anon, authenticated;
revoke all on public.nh_bk_email_outbox from anon, authenticated;
revoke all on public.nh_bk_settings, public.nh_bk_peak_rules, public.nh_bk_areas, public.nh_bk_tables, public.nh_bk_bookings,
  public.nh_bk_booking_tables, public.nh_bk_guest_notes, public.nh_bk_reviews, public.nh_bk_log from anon;

revoke execute on function
  public.nh_bk_settings_of(uuid), public.nh_bk_my_name(), public.nh_bk_new_code(), public.nh_bk_rid_by_slug(text),
  public.nh_bk_table_list(uuid), public.nh_bk_log_add(uuid, text, text, text), public.nh_bk_status_log(),
  public.nh_bk_online_rule_error(uuid, date, time, int), public.nh_bk_peak_violations(uuid, date, time, int, uuid),
  public.nh_bk_public_settings(text), public.nh_bk_available_slots(text, date, int),
  public.nh_bk_book_online(text, date, time, int, text, text, text, text, boolean, text, text, boolean),
  public.nh_bk_guest_booking(text, text), public.nh_bk_cancel_online(text, text),
  public.nh_bk_guest_review_info(text, text), public.nh_bk_submit_review(text, text, int, text),
  public.nh_bk_save_booking(uuid, uuid, date, time, int, text, text, text, text, text, text[], boolean),
  public.nh_bk_set_status(uuid, text), public.nh_bk_set_tables(uuid, text[]), public.nh_bk_set_called(uuid, boolean),
  public.nh_bk_delete_booking(uuid), public.nh_bk_reviews_list(uuid, int),
  public.nh_bk_auto_arrive(), public.nh_bk_queue_review_mails(), public.nh_bk_purge_old()
  from public, anon, authenticated;

grant execute on function
  public.nh_bk_public_settings(text), public.nh_bk_available_slots(text, date, int),
  public.nh_bk_book_online(text, date, time, int, text, text, text, text, boolean, text, text, boolean),
  public.nh_bk_guest_booking(text, text), public.nh_bk_cancel_online(text, text),
  public.nh_bk_guest_review_info(text, text), public.nh_bk_submit_review(text, text, int, text)
  to anon, authenticated;
grant execute on function
  public.nh_bk_peak_violations(uuid, date, time, int, uuid),
  public.nh_bk_save_booking(uuid, uuid, date, time, int, text, text, text, text, text, text[], boolean),
  public.nh_bk_set_status(uuid, text), public.nh_bk_set_tables(uuid, text[]), public.nh_bk_set_called(uuid, boolean),
  public.nh_bk_delete_booking(uuid), public.nh_bk_reviews_list(uuid, int)
  to authenticated;

-- Màn hình nhân viên cập nhật ngay khi có đơn mới (Realtime tôn trọng RLS)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'nh_bk_bookings') then
    alter publication supabase_realtime add table public.nh_bk_bookings;
  end if;
end $$;
