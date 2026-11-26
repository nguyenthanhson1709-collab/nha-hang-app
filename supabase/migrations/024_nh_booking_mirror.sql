-- 024: Nối app đặt bàn cũ (Supabase sfeqtlqibaiptnkkjecw) vào module Bàn đặt, trước khi chuyển hẳn.
-- Mỗi phút hàm nh-bk-sync đọc toàn bộ dữ liệu đặt bàn cũ và chép sang nh_bk_* của quán có mirror_old = true
-- (Vietbowl Mitte GmbH = Potsdamer Platz). Trong thời gian này app chỉ xem; sửa đơn vẫn ở trang nhân viên cũ /mitarbeiter.
-- Khi chuyển hẳn: đặt mirror_old = false, online_enabled = true, đổi trang khách sang DB này, bỏ lịch nh-bk-sync.

alter table public.nh_bk_settings add column if not exists mirror_old boolean not null default false;
alter table public.nh_bk_log add column if not exists src_id bigint;
create unique index if not exists nh_bk_log_src on public.nh_bk_log (src_id);

-- Quán đang chép từ app cũ: không tự chuyển "Đã đến" ở đây (app cũ tự làm, lần chép sau mang sang)
create or replace function public.nh_bk_auto_arrive() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.nh_bk_bookings b set status = 'seated', auto_arrived = true
  from public.nh_bk_settings s
  where s.restaurant_id = b.restaurant_id and not s.mirror_old and s.auto_arrive_min > 0 and b.status = 'confirmed'
    and (b.day + b.slot) at time zone s.tz + make_interval(mins => s.auto_arrive_min) <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Khoá bí mật cho lịch gọi nh-bk-sync (nằm trong Vault, không trong mã)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'nh_bk_sync_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'nh_bk_sync_secret', 'nh-bk-sync cron header');
  end if;
end $$;
create or replace function public.nh_bk_sync_secret_ok(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(s, '') <> '' and s = (select decrypted_secret from vault.decrypted_secrets where name = 'nh_bk_sync_secret')
$$;

-- Ghi bản chép từ app cũ (gọi bằng service role từ hàm nh-bk-sync). p = toàn bộ dữ liệu app cũ.
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
      contact_email = s->>'contact_email', google_review_url = s->>'google_review_url', updated_at = now()
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

  return json_build_object('bookings', nb, 'at', now());
end $$;

revoke all on function public.nh_bk_sync_secret_ok(text), public.nh_bk_mirror_apply(jsonb) from public, anon, authenticated;
grant execute on function public.nh_bk_sync_secret_ok(text), public.nh_bk_mirror_apply(jsonb) to service_role;

-- Quán đang chép từ app cũ: người dùng app không sửa được (mọi thay đổi phải làm ở app cũ, nếu không lần chép sau sẽ ghi đè).
-- Chỉ chặn người đăng nhập (auth.uid() có giá trị); hàm chép, lịch chạy và SQL Editor vẫn ghi được.
create or replace function public.nh_bk_mirror_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if tg_op = 'DELETE' then r := old.restaurant_id; else r := new.restaurant_id; end if;
  if tg_op = 'UPDATE' and old.restaurant_id is distinct from new.restaurant_id then r := old.restaurant_id; end if;
  if auth.uid() is not null and exists (select 1 from public.nh_bk_settings s where s.restaurant_id = r and s.mirror_old) then
    raise exception 'mirror_readonly';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['nh_bk_settings','nh_bk_peak_rules','nh_bk_areas','nh_bk_tables','nh_bk_bookings','nh_bk_booking_tables','nh_bk_guest_notes'] loop
    execute format('drop trigger if exists nh_bk_mirror_guard on public.%I', t);
    execute format('create trigger nh_bk_mirror_guard before insert or update or delete on public.%I for each row execute function public.nh_bk_mirror_guard()', t);
  end loop;
end $$;

update public.nh_bk_settings set mirror_old = true
  where restaurant_id = (select id from public.nh_restaurants where name = 'Vietbowl Mitte GmbH' limit 1);

-- Mỗi phút chép từ app cũ (hàm nh-bk-sync cần secret OLD_BK_SERVICE_KEY = khoá service_role của project cũ)
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-bk-sync') then
    perform cron.schedule('nh-bk-sync', '* * * * *', $job$
      select net.http_post(
        url := 'https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-bk-sync',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nh_bk_sync_secret')),
        body := '{}'::jsonb)
      where exists (select 1 from public.nh_bk_settings where mirror_old)
    $job$);
  end if;
end $$;
