-- Đặt bàn: giờ mở cửa đặc biệt lặp lại hằng năm (chủ quán 28.11.2026):
-- 1.1 mở từ 15:00, 31.12 đóng lúc 22:00. Lưu dạng {"MM-DD": ["mở", "đóng"]}; giờ đặt muộn nhất = đóng − thời lượng bàn.
alter table public.nh_bk_settings add column if not exists special_hours jsonb not null default '{}'::jsonb;
update public.nh_bk_settings set special_hours = '{"01-01": ["15:00", "23:00"], "12-31": ["11:30", "22:00"]}'::jsonb
  where slug = 'potsdamerplatz' and special_hours = '{}'::jsonb;

create or replace function public.nh_bk_online_rule_error(p_rid uuid, p_day date, p_slot time, p_party int)
returns text language plpgsql stable security definer set search_path = public as $$
declare s public.nh_bk_settings; starts timestamptz; first_slot time; close_at time; sp jsonb;
begin
  s := public.nh_bk_settings_of(p_rid);
  if p_party < s.min_online or p_party > s.max_online then return 'party'; end if;
  if to_char(p_day, 'MM-DD') = any(s.closed_days) then return 'closed'; end if;
  first_slot := case when extract(isodow from p_day) between 1 and 5 and s.weekday_from is not null
                     then greatest(s.open_time, s.weekday_from) else s.open_time end;
  close_at := s.close_time;
  sp := coalesce(s.special_hours, '{}'::jsonb) -> to_char(p_day, 'MM-DD');
  if sp is not null then
    if coalesce(sp->>0, '') <> '' then first_slot := greatest(first_slot, (sp->>0)::time); end if;
    if coalesce(sp->>1, '') <> '' then close_at := least(close_at, (sp->>1)::time); end if;
  end if;
  if p_slot < first_slot or p_slot > close_at - make_interval(mins => s.duration_min) then return 'hours'; end if;
  if (extract(epoch from (p_slot - s.open_time)) / 60)::int % s.slot_step <> 0 then return 'hours'; end if;
  starts := (p_day + p_slot) at time zone s.tz;
  if starts < now() + make_interval(hours => s.lead_hours) then return 'lead'; end if;
  if exists (select 1 from public.nh_bk_blocks k
             where k.restaurant_id = p_rid and k.day = p_day and p_slot >= k.start_time and p_slot < k.end_time) then
    return 'full';
  end if;
  return null;
end $$;

create or replace function public.nh_bk_public_settings(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('name', r.name, 'auto_confirm', s.auto_confirm, 'duration_min', s.duration_min,
    'min_online', s.min_online, 'max_online', s.max_online, 'slot_step', s.slot_step, 'open_time', s.open_time,
    'close_time', s.close_time, 'weekday_from', s.weekday_from, 'closed_days', s.closed_days, 'lead_hours', s.lead_hours,
    'contact_email', s.contact_email, 'tz', s.tz, 'special_hours', s.special_hours)
  from public.nh_bk_settings s join public.nh_restaurants r on r.id = s.restaurant_id
  where s.slug = lower(trim(p_slug)) and s.online_enabled
$$;
