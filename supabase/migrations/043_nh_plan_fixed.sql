-- 043: Ca cố định cho bộ xếp lịch (Fester Dienst): nhân viên X làm ngày D từ giờ a đến giờ b,
-- kể cả ngày quán đóng cửa (ví dụ 25.12 chỉ mở với vài người). Bộ xếp lịch đặt các ca này trước rồi mới xếp phần còn lại.
-- Quyền: Chủ + Người phụ trách (nh_can_manage). Không DROP, chạy lại an toàn.
create table if not exists public.nh_plan_fixed (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  employee_id uuid not null references public.nh_employees(id) on delete cascade,
  day date not null,
  start_time time not null,
  end_time time not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, day)
);
create index if not exists nh_plan_fixed_rid_day on public.nh_plan_fixed (restaurant_id, day);
alter table public.nh_plan_fixed enable row level security;
revoke all on public.nh_plan_fixed from anon;
grant select, insert, update, delete on public.nh_plan_fixed to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_plan_fixed' and policyname = 'nh_plan_fixed_all') then
    create policy nh_plan_fixed_all on public.nh_plan_fixed for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
end $$;
