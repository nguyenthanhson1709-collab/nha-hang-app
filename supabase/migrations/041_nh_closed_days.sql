-- 041: Ngày quán đóng cửa (Betriebsruhe) — bộ xếp lịch không xếp ca vào những ngày này.
-- Quyền: Chủ + Người phụ trách (nh_can_manage). Không DROP, chạy lại an toàn.
create table if not exists public.nh_closed_days (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  day date not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, day)
);
alter table public.nh_closed_days enable row level security;
revoke all on public.nh_closed_days from anon;
grant select, insert, update, delete on public.nh_closed_days to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_closed_days' and policyname = 'nh_closed_days_all') then
    create policy nh_closed_days_all on public.nh_closed_days for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
end $$;
