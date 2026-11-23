-- Kontoauszug: sao kê ngân hàng theo tháng
create table if not exists public.nh_bank_statements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  account text,
  note text,
  files text[] not null default '{}',
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists nh_bank_statements_rid on public.nh_bank_statements(restaurant_id, period);
alter table public.nh_bank_statements enable row level security;
create policy nh_bs_sel on public.nh_bank_statements for select to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_bs_ins on public.nh_bank_statements for insert to authenticated with check (public.nh_can_manage(restaurant_id));
create policy nh_bs_upd on public.nh_bank_statements for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_bs_del on public.nh_bank_statements for delete to authenticated using (public.nh_can_manage(restaurant_id));
grant select, insert, update, delete on public.nh_bank_statements to authenticated;
