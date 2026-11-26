-- Viết hoá đơn: Amtsgericht + HRB của công ty (in ở footer hoá đơn)
alter table public.nh_inv_company
  add column if not exists register_court text not null default '',
  add column if not exists register_number text not null default '';
