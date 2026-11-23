-- Hợp đồng ghi nợ tự động (Lastschrift / Dauerauftrag): công ty tự rút tiền hàng tháng
create table if not exists public.nh_contracts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  company text not null,
  title text,
  amount numeric(12,2),
  interval text not null default 'monthly' check (interval in ('monthly','quarterly','yearly','other')),
  start_date date,
  end_date date,
  contract_no text,
  note text,
  files text[] not null default '{}',
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists nh_contracts_rid on public.nh_contracts(restaurant_id);
alter table public.nh_contracts enable row level security;
create policy nh_ct_sel on public.nh_contracts for select to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_ct_ins on public.nh_contracts for insert to authenticated with check (public.nh_can_manage(restaurant_id));
create policy nh_ct_upd on public.nh_contracts for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_ct_del on public.nh_contracts for delete to authenticated using (public.nh_can_manage(restaurant_id));
grant select, insert, update, delete on public.nh_contracts to authenticated;
