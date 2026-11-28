-- Đặt bàn: đóng đặt bàn online theo khung giờ (chủ quán 28.11.2026).
-- Nhân viên / chủ chọn ngày + từ giờ đến giờ; trong khoảng đó khách không đặt online được
-- (giờ hiện gạch ngang như hết chỗ). Nhân viên vẫn nhập tay được.

create table if not exists public.nh_bk_blocks (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  day           date not null,
  start_time    time not null,
  end_time      time not null check (end_time > start_time),
  note          text check (note is null or length(note) <= 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists nh_bk_blocks_rid_day on public.nh_bk_blocks (restaurant_id, day);

alter table public.nh_bk_blocks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'nh_bk_blocks_all') then
    create policy nh_bk_blocks_all on public.nh_bk_blocks for all to authenticated
      using (public.nh_bk_access(restaurant_id)) with check (public.nh_bk_access(restaurant_id));
  end if;
end $$;
grant select, insert, delete on public.nh_bk_blocks to authenticated;
revoke all on public.nh_bk_blocks from anon;

-- Luật online: thêm kiểm tra khung giờ bị đóng → 'full' (khách thấy giờ hết chỗ, đặt bị từ chối)
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
  if exists (select 1 from public.nh_bk_blocks k
             where k.restaurant_id = p_rid and k.day = p_day and p_slot >= k.start_time and p_slot < k.end_time) then
    return 'full';
  end if;
  return null;
end $$;
