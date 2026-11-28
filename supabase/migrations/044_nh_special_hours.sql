-- 044: Giờ mở cửa ngắn của một ngày (Sonderöffnungszeit), ví dụ 26.12 chỉ bán 11–17 Uhr.
-- Bộ xếp lịch chỉ xếp ca trong khung này. Quyền: Chủ + Người phụ trách (nh_can_manage). Không DROP, chạy lại an toàn.
create table if not exists public.nh_special_hours (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  day date not null,
  open_from time not null,
  open_to time not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, day)
);
alter table public.nh_special_hours enable row level security;
revoke all on public.nh_special_hours from anon;
grant select, insert, update, delete on public.nh_special_hours to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_special_hours' and policyname = 'nh_special_hours_all') then
    create policy nh_special_hours_all on public.nh_special_hours for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
end $$;
