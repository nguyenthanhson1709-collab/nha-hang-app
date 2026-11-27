-- 040: Lịch làm nhân viên (Mitarbeiterliste je Monat) — bảng điền theo tháng như file Excel gửi văn phòng lương.
-- Mỗi nhân viên một dòng mỗi tháng; data jsonb chỉ chứa các ô người dùng tự điền / sửa (ghi đè giá trị tự tính).
-- Quyền: Chủ + Người phụ trách (nh_can_manage). Không DROP, chạy lại an toàn.
create table if not exists public.nh_staff_month (
  restaurant_id uuid not null,
  employee_id uuid not null,
  ym text not null check (ym ~ '^\d{4}-\d{2}$'),
  data jsonb not null default '{}'::jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, employee_id, ym),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_staff_month_ym on public.nh_staff_month(restaurant_id, ym);
alter table public.nh_staff_month enable row level security;
revoke all on public.nh_staff_month from anon;
grant select, insert, update, delete on public.nh_staff_month to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_staff_month' and policyname = 'nh_staff_month_all') then
    create policy nh_staff_month_all on public.nh_staff_month for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
end $$;
