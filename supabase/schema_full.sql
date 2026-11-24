-- Toàn bộ cấu trúc app nhà hàng cho project riêng (gộp migration 001, 003-011). Dữ liệu danh mục chép từ project cũ.

-- Ứng dụng quản lý nhà hàng (Kassenbuch / Belege). Mọi bảng có tiền tố nh_
-- để tách khỏi bảng của app viết hoá đơn trong cùng project.

-- ============ Bảng ============
create table public.nh_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_owner boolean not null default false,
  lang text not null default 'vi' check (lang in ('vi','de')),
  created_at timestamptz not null default now()
);

create table public.nh_restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  tax_number text,                       -- Steuernummer / USt-IdNr. của quán
  active boolean not null default true,
  opening_cash numeric(12,2) not null default 0,   -- tồn quỹ đầu kỳ
  opening_date date,
  tip_paid_cash boolean not null default false,    -- tip thẻ trả nhân viên bằng tiền mặt từ két
  pos_type text not null default 'thermal_b',      -- mẫu Z-Bon
  datev_consultant_no text,                        -- Beraternummer
  datev_client_no text,                            -- Mandantennummer
  pos_payment_map jsonb not null default '{"BAREINNAHMEN":"cash","KREDITZAHLUNGEN":"card"}',
  created_at timestamptz not null default now()
);

create table public.nh_members (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  user_id uuid not null references public.nh_profiles(id) on delete cascade,
  role text not null check (role in ('manager','staff')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create unique index nh_members_one_manager on public.nh_members(restaurant_id) where role = 'manager';
create index on public.nh_members(user_id);

create table public.nh_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.nh_categories(id) on delete restrict,
  kind text not null check (kind in ('food','drink','nonfood')),
  name_vi text not null,
  name_de text not null,
  skr_account text,          -- tài khoản SKR03 mặc định
  sort int not null default 0
);

create table public.nh_item_memory (
  name_norm text primary key,
  category_id uuid not null references public.nh_categories(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table public.nh_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tax_id text,
  created_at timestamptz not null default now()
);

create table public.nh_periods (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  locked_at timestamptz not null default now(),
  locked_by uuid references public.nh_profiles(id),
  primary key (restaurant_id, period)
);

-- Chứng từ mua vào (Eingangsbelege) và hoá đơn thu tiền
create table public.nh_documents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  kind text not null default 'purchase' check (kind in ('purchase','sales')),
  status text not null default 'uploaded' check (status in ('uploaded','reviewed')),
  doc_date date not null,
  period text not null check (period ~ '^\d{4}-\d{2}$'),   -- tháng ghi sổ (có thể sau tháng của doc_date)
  supplier text,
  invoice_no text,
  seller_tax_id text,
  gross numeric(12,2) not null default 0,
  note text,
  files text[] not null default '{}',     -- đường dẫn trong bucket nh-belege
  ocr_text text,
  flags text[] not null default '{}',     -- ví dụ: sum_mismatch, missing_tax_id
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.nh_profiles(id),
  updated_at timestamptz not null default now()
);
create index on public.nh_documents(restaurant_id, period);
create index on public.nh_documents(restaurant_id, doc_date);
create index on public.nh_documents(created_by);
create index on public.nh_documents(updated_by);

create table public.nh_document_payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.nh_documents(id) on delete cascade,
  method text not null check (method in ('cash','card','transfer')),
  amount numeric(12,2) not null check (amount >= 0)
);
create index on public.nh_document_payments(document_id);

create table public.nh_document_taxes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.nh_documents(id) on delete cascade,
  rate numeric(4,2) not null check (rate in (0,7,19)),
  net numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  gross numeric(12,2) not null default 0
);
create index on public.nh_document_taxes(document_id);

create table public.nh_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.nh_documents(id) on delete cascade,
  pos int not null default 0,
  name text not null,
  qty numeric(12,3),
  unit text,
  unit_price numeric(12,4),
  total numeric(12,2) not null default 0,   -- Brutto
  rate numeric(4,2) check (rate in (0,7,19)),
  category_id uuid references public.nh_categories(id)
);
create index on public.nh_document_lines(document_id);
create index on public.nh_document_lines(category_id);

-- Z-Bon (Tagesabschluss)
create table public.nh_zbons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  z_date date not null,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  z_no text,
  net7 numeric(12,2) not null default 0, tax7 numeric(12,2) not null default 0, gross7 numeric(12,2) not null default 0,
  net19 numeric(12,2) not null default 0, tax19 numeric(12,2) not null default 0, gross19 numeric(12,2) not null default 0,
  gross0 numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,       -- doanh thu không gồm tip
  cash_pos numeric(12,2) not null default 0,    -- tiền mặt theo Kasse
  card_pos numeric(12,2) not null default 0,    -- thẻ theo Kasse
  card_terminal numeric(12,2),                  -- tổng thẻ nhập tay từ báo cáo EC-Terminal (gồm tip thẻ)
  tip numeric(12,2) not null default 0,         -- tip theo Kasse
  tip_card numeric(12,2) not null default 0,    -- tip trả qua thẻ (nằm trong số EC-Terminal)
  storno numeric(12,2) not null default 0,
  storno_count int not null default 0,
  details jsonb not null default '{}',
  files text[] not null default '{}',
  ocr_text text,
  cash_revenue numeric(12,2) generated always as (total - coalesce(card_terminal - tip_card, card_pos)) stored,
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.nh_profiles(id),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, z_date)
);

-- Bút toán quỹ nhập tay: Einlage, Privatentnahme, nộp ngân hàng, khác
create table public.nh_cash_moves (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  move_date date not null,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  type text not null check (type in ('einlage','privatentnahme','geldtransit','sonstige_einnahme','sonstige_ausgabe')),
  amount numeric(12,2) not null check (amount > 0),
  description text,
  files text[] not null default '{}',
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now()
);
create index on public.nh_cash_moves(restaurant_id, move_date);

-- Đếm két hằng ngày (Kassensturz)
create table public.nh_cash_counts (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  count_date date not null,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  counted numeric(12,2) not null,
  book_balance numeric(12,2) not null,
  difference numeric(12,2) generated always as (counted - book_balance) stored,
  reason text,
  confirmed_by uuid default auth.uid() references public.nh_profiles(id),
  confirmed_at timestamptz not null default now(),
  primary key (restaurant_id, count_date),
  check (counted = book_balance or coalesce(length(trim(reason)),0) > 0)
);

-- Nhật ký sửa đổi
create table public.nh_audit (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text not null,
  restaurant_id uuid,
  action text not null,
  user_id uuid default auth.uid(),
  at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index on public.nh_audit(table_name, row_id);

-- ============ Hàm phân quyền ============
create or replace function public.nh_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.nh_profiles where id = auth.uid()), false)
$$;

create or replace function public.nh_role(rid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.nh_is_owner() then 'owner'
    else (select role from public.nh_members where restaurant_id = rid and user_id = auth.uid()) end
$$;

create or replace function public.nh_can_manage(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.nh_role(rid) in ('owner','manager'), false)
$$;

create or replace function public.nh_is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_role(rid) is not null
$$;

create or replace function public.nh_is_locked(rid uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.nh_periods where restaurant_id = rid and period = p)
$$;

-- Tháng mở đầu tiên >= tháng của ngày cho trước (cho chứng từ đến muộn)
create or replace function public.nh_open_period(rid uuid, d date) returns text
language plpgsql stable security definer set search_path = public as $$
declare p date := date_trunc('month', d)::date;
begin
  while public.nh_is_locked(rid, to_char(p,'YYYY-MM')) loop
    p := (p + interval '1 month')::date;
  end loop;
  return to_char(p,'YYYY-MM');
end $$;

revoke execute on function public.nh_is_owner(), public.nh_role(uuid), public.nh_can_manage(uuid),
  public.nh_is_member(uuid), public.nh_is_locked(uuid,text), public.nh_open_period(uuid,date) from anon, public;
grant execute on function public.nh_is_owner(), public.nh_role(uuid), public.nh_can_manage(uuid),
  public.nh_is_member(uuid), public.nh_is_locked(uuid,text), public.nh_open_period(uuid,date) to authenticated;

-- ============ Trigger: khoá sổ, kỳ ghi sổ, nhật ký ============
create or replace function public.nh_guard_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; p text; d date;
begin
  if tg_op in ('UPDATE','DELETE') then
    if public.nh_is_locked(old.restaurant_id, old.period) then
      raise exception 'NH_LOCKED: Tháng % đã khoá sổ, không sửa được', old.period;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if tg_table_name = 'nh_documents' then d := new.doc_date;
    elsif tg_table_name = 'nh_zbons' then d := new.z_date;
    elsif tg_table_name = 'nh_cash_moves' then d := new.move_date;
    elsif tg_table_name = 'nh_cash_counts' then d := new.count_date;
    end if;
    if tg_op = 'INSERT' or new.period is null or new.period < to_char(d,'YYYY-MM') then
      new.period := public.nh_open_period(new.restaurant_id, d);
    end if;
    if public.nh_is_locked(new.restaurant_id, new.period) then
      raise exception 'NH_LOCKED: Tháng % đã khoá sổ', new.period;
    end if;
    if tg_table_name in ('nh_documents','nh_zbons') then
      if tg_op = 'UPDATE' then new.updated_by := auth.uid(); new.updated_at := now(); end if;
    end if;
    return new;
  end if;
  return old;
end $$;

create trigger nh_documents_guard before insert or update or delete on public.nh_documents
  for each row execute function public.nh_guard_period();
create trigger nh_zbons_guard before insert or update or delete on public.nh_zbons
  for each row execute function public.nh_guard_period();
create trigger nh_cash_moves_guard before insert or update or delete on public.nh_cash_moves
  for each row execute function public.nh_guard_period();
create trigger nh_cash_counts_guard before insert or update or delete on public.nh_cash_counts
  for each row execute function public.nh_guard_period();

-- Bảng con: chặn sửa khi chứng từ cha đã khoá
create or replace function public.nh_guard_child() returns trigger
language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  if tg_op = 'DELETE' then did := old.document_id; else did := new.document_id; end if;
  if exists (select 1 from public.nh_documents d where d.id = did and public.nh_is_locked(d.restaurant_id, d.period)) then
    raise exception 'NH_LOCKED: Chứng từ thuộc tháng đã khoá sổ';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger nh_payments_guard before insert or update or delete on public.nh_document_payments
  for each row execute function public.nh_guard_child();
create trigger nh_taxes_guard before insert or update or delete on public.nh_document_taxes
  for each row execute function public.nh_guard_child();
create trigger nh_lines_guard before insert or update or delete on public.nh_document_lines
  for each row execute function public.nh_guard_child();

-- Không mở khoá được
create or replace function public.nh_no_unlock() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'NH_LOCKED: Khoá sổ không thể huỷ'; end $$;
create trigger nh_periods_no_change before update or delete on public.nh_periods
  for each row execute function public.nh_no_unlock();

create or replace function public.nh_audit_fn() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  insert into public.nh_audit(table_name, row_id, restaurant_id, action, old_data, new_data)
  values (tg_table_name, coalesce(r->>'id', r->>'count_date', ''), nullif(r->>'restaurant_id','')::uuid, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'ocr_text' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'ocr_text' end);
  return null;
end $$;
create trigger nh_documents_audit after insert or update or delete on public.nh_documents
  for each row execute function public.nh_audit_fn();
create trigger nh_zbons_audit after insert or update or delete on public.nh_zbons
  for each row execute function public.nh_audit_fn();
create trigger nh_cash_moves_audit after insert or update or delete on public.nh_cash_moves
  for each row execute function public.nh_audit_fn();
create trigger nh_cash_counts_audit after insert or update or delete on public.nh_cash_counts
  for each row execute function public.nh_audit_fn();

-- Nhân viên chỉ được tạo chứng từ ở trạng thái "uploaded" và không đổi được sau đó
create or replace function public.nh_staff_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.nh_role(new.restaurant_id) = 'staff' then
    new.status := 'uploaded';
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger nh_documents_staff before insert on public.nh_documents
  for each row execute function public.nh_staff_doc();

-- Tự tạo hồ sơ khi có tài khoản mới
create or replace function public.nh_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.nh_profiles(id, email, full_name, lang)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when new.raw_user_meta_data->>'lang' = 'de' then 'de' else 'vi' end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger nh_on_auth_user_created after insert on auth.users
  for each row execute function public.nh_handle_new_user();

-- Không cho tự nâng quyền chủ
create or replace function public.nh_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_owner is distinct from old.is_owner and not public.nh_is_owner() then
    raise exception 'Không có quyền';
  end if;
  return new;
end $$;
create trigger nh_profiles_guard before update on public.nh_profiles
  for each row execute function public.nh_profiles_guard();

-- ============ RLS ============
alter table public.nh_profiles enable row level security;
alter table public.nh_restaurants enable row level security;
alter table public.nh_members enable row level security;
alter table public.nh_categories enable row level security;
alter table public.nh_item_memory enable row level security;
alter table public.nh_suppliers enable row level security;
alter table public.nh_periods enable row level security;
alter table public.nh_documents enable row level security;
alter table public.nh_document_payments enable row level security;
alter table public.nh_document_taxes enable row level security;
alter table public.nh_document_lines enable row level security;
alter table public.nh_zbons enable row level security;
alter table public.nh_cash_moves enable row level security;
alter table public.nh_cash_counts enable row level security;
alter table public.nh_audit enable row level security;

create policy nh_profiles_sel on public.nh_profiles for select to authenticated using (
  id = (select auth.uid()) or (select public.nh_is_owner())
  or exists (select 1 from public.nh_members m where m.user_id = nh_profiles.id and public.nh_can_manage(m.restaurant_id)));
create policy nh_profiles_upd on public.nh_profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.nh_is_owner()))
  with check (id = (select auth.uid()) or (select public.nh_is_owner()));

create policy nh_rest_sel on public.nh_restaurants for select to authenticated using (public.nh_is_member(id));
create policy nh_rest_ins on public.nh_restaurants for insert to authenticated with check ((select public.nh_is_owner()));
create policy nh_rest_upd on public.nh_restaurants for update to authenticated using ((select public.nh_is_owner())) with check ((select public.nh_is_owner()));

create policy nh_members_sel on public.nh_members for select to authenticated
  using (user_id = (select auth.uid()) or public.nh_can_manage(restaurant_id));
create policy nh_members_del on public.nh_members for delete to authenticated
  using ((select public.nh_is_owner()) or (role = 'staff' and public.nh_can_manage(restaurant_id)));

create policy nh_cat_sel on public.nh_categories for select to authenticated using (true);
create policy nh_cat_ins on public.nh_categories for insert to authenticated with check ((select public.nh_is_owner()));
create policy nh_cat_upd on public.nh_categories for update to authenticated using ((select public.nh_is_owner()));
create policy nh_cat_del on public.nh_categories for delete to authenticated using ((select public.nh_is_owner()));
create policy nh_mem_sel on public.nh_item_memory for select to authenticated using (true);
create policy nh_mem_ins on public.nh_item_memory for insert to authenticated with check (exists (select 1 from public.nh_members m where m.user_id = (select auth.uid()) and m.role = 'manager') or (select public.nh_is_owner()));
create policy nh_mem_upd on public.nh_item_memory for update to authenticated using (exists (select 1 from public.nh_members m where m.user_id = (select auth.uid()) and m.role = 'manager') or (select public.nh_is_owner()));
create policy nh_sup_sel on public.nh_suppliers for select to authenticated using (true);
create policy nh_sup_ins on public.nh_suppliers for insert to authenticated with check (exists (select 1 from public.nh_profiles p where p.id = (select auth.uid())));
create policy nh_sup_upd on public.nh_suppliers for update to authenticated using ((select public.nh_is_owner()));

create policy nh_per_sel on public.nh_periods for select to authenticated using (public.nh_is_member(restaurant_id));
create policy nh_per_ins on public.nh_periods for insert to authenticated with check ((select public.nh_is_owner()));

create policy nh_doc_sel on public.nh_documents for select to authenticated using (
  public.nh_can_manage(restaurant_id) or (public.nh_role(restaurant_id) = 'staff' and created_by = (select auth.uid())));
create policy nh_doc_ins on public.nh_documents for insert to authenticated with check (public.nh_is_member(restaurant_id));
create policy nh_doc_upd on public.nh_documents for update to authenticated
  using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_doc_del on public.nh_documents for delete to authenticated using (public.nh_can_manage(restaurant_id));

-- bảng con theo quyền của chứng từ cha
create policy nh_pay_sel on public.nh_document_payments for select to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id));
create policy nh_pay_ins on public.nh_document_payments for insert to authenticated with check (exists (select 1 from public.nh_documents d where d.id = document_id and (public.nh_can_manage(d.restaurant_id) or (d.created_by = (select auth.uid()) and d.status = 'uploaded'))));
create policy nh_pay_upd on public.nh_document_payments for update to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));
create policy nh_pay_del on public.nh_document_payments for delete to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));

create policy nh_tax_sel on public.nh_document_taxes for select to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id));
create policy nh_tax_ins on public.nh_document_taxes for insert to authenticated with check (exists (select 1 from public.nh_documents d where d.id = document_id and (public.nh_can_manage(d.restaurant_id) or (d.created_by = (select auth.uid()) and d.status = 'uploaded'))));
create policy nh_tax_upd on public.nh_document_taxes for update to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));
create policy nh_tax_del on public.nh_document_taxes for delete to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));

create policy nh_line_sel on public.nh_document_lines for select to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id));
create policy nh_line_ins on public.nh_document_lines for insert to authenticated with check (exists (select 1 from public.nh_documents d where d.id = document_id and (public.nh_can_manage(d.restaurant_id) or (d.created_by = (select auth.uid()) and d.status = 'uploaded'))));
create policy nh_line_upd on public.nh_document_lines for update to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));
create policy nh_line_del on public.nh_document_lines for delete to authenticated using (exists (select 1 from public.nh_documents d where d.id = document_id and public.nh_can_manage(d.restaurant_id)));

create policy nh_z_sel on public.nh_zbons for select to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_z_ins on public.nh_zbons for insert to authenticated with check (public.nh_can_manage(restaurant_id));
create policy nh_z_upd on public.nh_zbons for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_z_del on public.nh_zbons for delete to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_mv_sel on public.nh_cash_moves for select to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_mv_ins on public.nh_cash_moves for insert to authenticated with check (public.nh_can_manage(restaurant_id));
create policy nh_mv_upd on public.nh_cash_moves for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_mv_del on public.nh_cash_moves for delete to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_cnt_sel on public.nh_cash_counts for select to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_cnt_ins on public.nh_cash_counts for insert to authenticated with check (public.nh_can_manage(restaurant_id));
create policy nh_cnt_upd on public.nh_cash_counts for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
create policy nh_cnt_del on public.nh_cash_counts for delete to authenticated using (public.nh_can_manage(restaurant_id));
create policy nh_audit_sel on public.nh_audit for select to authenticated using ((select public.nh_is_owner()) or (restaurant_id is not null and public.nh_can_manage(restaurant_id)));

-- ============ Storage ============
insert into storage.buckets (id, name, public, file_size_limit)
values ('nh-belege', 'nh-belege', false, 20971520)
on conflict (id) do nothing;

-- Đường dẫn: <restaurant_id>/<yyyy>/<mm>/<uuid>.<ext>
create policy nh_belege_sel on storage.objects for select to authenticated
  using (bucket_id = 'nh-belege' and (public.nh_can_manage(((storage.foldername(name))[1])::uuid)
         or (owner_id = (select auth.uid())::text and public.nh_is_member(((storage.foldername(name))[1])::uuid))));
create policy nh_belege_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'nh-belege' and public.nh_is_member(((storage.foldername(name))[1])::uuid));


revoke execute on function public.nh_audit_fn(), public.nh_guard_child(), public.nh_guard_period(),
  public.nh_handle_new_user(), public.nh_profiles_guard(), public.nh_staff_doc(), public.nh_no_unlock() from public, anon, authenticated;

create or replace function public.nh_has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.nh_profiles where is_owner)
$$;
grant execute on function public.nh_has_owner() to anon, authenticated;

create or replace function public.nh_claim_owner() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.nh_profiles where is_owner) then return false; end if;
  update public.nh_profiles set is_owner = true where id = auth.uid();
  return found;
end $$;
revoke execute on function public.nh_claim_owner() from public, anon;
grant execute on function public.nh_claim_owner() to authenticated;

-- Kỳ ghi sổ luôn = tháng mở đầu tiên tính từ tháng của ngày chứng từ
create or replace function public.nh_guard_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if tg_op in ('UPDATE','DELETE') then
    if public.nh_is_locked(old.restaurant_id, old.period) then
      raise exception 'NH_LOCKED: Tháng % đã khoá sổ, không sửa được', old.period;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name = 'nh_documents' then d := new.doc_date;
  elsif tg_table_name = 'nh_zbons' then d := new.z_date;
  elsif tg_table_name = 'nh_cash_moves' then d := new.move_date;
  elsif tg_table_name = 'nh_cash_counts' then d := new.count_date;
  end if;
  new.period := public.nh_open_period(new.restaurant_id, d);
  if tg_table_name in ('nh_documents','nh_zbons') and tg_op = 'UPDATE' then
    new.updated_by := auth.uid(); new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.nh_guard_period() from public, anon, authenticated;

-- Cho phép quản trị (SQL editor / service role, không có auth.uid()) đặt quyền chủ
create or replace function public.nh_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_owner is distinct from old.is_owner and auth.uid() is not null and not public.nh_is_owner() then
    raise exception 'Không có quyền';
  end if;
  return new;
end $$;
revoke execute on function public.nh_profiles_guard() from public, anon, authenticated;


alter table public.nh_cash_moves add column if not exists channel text;
comment on column public.nh_cash_moves.channel is 'Kênh thanh toán thẻ, ví dụ viva = Viva Wallet (Kartenzahlung)';

-- Viva Wallet (thu thẻ nhập tay, channel = 'viva'): thay phần thẻ của Z-Bon ngày đó; chỉ phần vượt quá mới làm giảm tồn quỹ


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


-- Tiêu đề trang danh sách nhà hàng do chủ tự đặt
alter table public.nh_profiles add column if not exists home_title text;


-- Mỗi quán chọn cách tính thẻ trong Kassenbuch (người dùng chốt 2026-11-24):
--  'zbon' : Umsatz, Kartenzahlung, Trinkgeld đều theo Z-Bon; Trinkgeld (Karte) luôn trả nhân viên từ két.
--  'viva' : Umsatz + Kartenzahlung theo Z-Bon; Trinkgeld = Viva Wallet - Kreditzahlung Z-Bon, chỉ ghi Ausgaben.
alter table public.nh_restaurants add column if not exists card_source text not null default 'zbon';
-- Überweisung trên Z-Bon: không vào két, ghi Ausgaben "Überweisung"
alter table public.nh_zbons add column if not exists transfer_pos numeric(12,2) not null default 0;



-- Gutschrift (người dùng chốt 2026-11-24): hoá đơn nhận lại tiền của nhà cung cấp.
-- Vẫn là kind 'purchase' (giảm chi phí / Vorsteuer), nhưng tiền mặt nhận về ghi vào Einnahmen của Kassenbuch.
alter table public.nh_documents add column if not exists is_credit boolean not null default false;

create or replace view public.nh_kassenbuch with (security_invoker = true) as
with rows as (
  select d.restaurant_id, greatest(d.doc_date, to_date(d.period||'-01','YYYY-MM-DD')) as entry_date, d.period,
         d.created_at as sort_ts, 'beleg'::text as source, d.id as source_id,
         case when d.is_credit then 'Gutschrift ' else '' end || coalesce(d.supplier,'Beleg') || coalesce(' Nr. '||d.invoice_no,'') ||
           case when d.doc_date < to_date(d.period||'-01','YYYY-MM-DD') then ' (Belegdatum '||to_char(d.doc_date,'DD.MM.YYYY')||')' else '' end as text,
         case when d.is_credit then p.amount::numeric else 0 end as einnahme, case when d.is_credit then 0 else p.amount::numeric end as ausgabe,
         (select string_agg(distinct (t.rate::int)::text||'%', '/') from public.nh_document_taxes t where t.document_id = d.id) as mwst
  from public.nh_documents d join public.nh_document_payments p on p.document_id = d.id and p.method = 'cash'
  where d.kind = 'purchase' and d.status = 'reviewed'
  union all
  select d.restaurant_id, greatest(d.doc_date, to_date(d.period||'-01','YYYY-MM-DD')), d.period, d.created_at, 'beleg', d.id,
         'Einnahme ' || coalesce(d.supplier,'') || coalesce(' Nr. '||d.invoice_no,''), p.amount, 0,
         (select string_agg(distinct (t.rate::int)::text||'%', '/') from public.nh_document_taxes t where t.document_id = d.id)
  from public.nh_documents d join public.nh_document_payments p on p.document_id = d.id and p.method = 'cash'
  where d.kind = 'sales' and d.status = 'reviewed'
  union all
  select z.restaurant_id, z.z_date, z.period, z.created_at, 'zbon', z.id,
         'Bareinnahmen lt. Z-Bon ' || to_char(z.z_date,'DD.MM.YYYY') || coalesce(' Nr. '||z.z_no,''),
         z.cash_revenue - coalesce(z.transfer_pos, 0), 0, '7%/19%'
  from public.nh_zbons z
  union all
  select z.restaurant_id, z.z_date, z.period, z.created_at, 'tip', z.id,
         'Auszahlung Trinkgeld (Karte) an Personal', 0, case when z.tip_card > 0 then z.tip_card else z.tip end, null
  from public.nh_zbons z join public.nh_restaurants r on r.id = z.restaurant_id
  where r.card_source is distinct from 'viva' and (z.tip_card > 0 or z.tip > 0)
  union all
  select m.restaurant_id, m.move_date, m.period, m.created_at, 'move', m.id,
         case m.type when 'einlage' then 'Einlage' when 'privatentnahme' then 'Privatentnahme'
           when 'geldtransit' then 'Geldtransit an Bank' when 'sonstige_einnahme' then 'Sonstige Einnahme' else 'Sonstige Ausgabe' end
           || coalesce(': '||m.description,''),
         case when m.type in ('einlage','sonstige_einnahme') then m.amount else 0 end,
         case when m.type in ('privatentnahme','geldtransit','sonstige_ausgabe') then m.amount else 0 end, null
  from public.nh_cash_moves m
  where m.channel is distinct from 'viva'
  union all
  select v.restaurant_id, v.move_date, v.period, v.ts, 'move', v.id,
         'Kartenzahlung (Viva Wallet)',
         0,
         case when v.card_z is null then v.amount else greatest(0, v.amount - v.card_z) end, null
  from (select m.restaurant_id, m.move_date, min(m.period) as period, max(m.created_at) as ts, (array_agg(m.id order by m.created_at))[1] as id, sum(m.amount) as amount,
               (select sum(z.total - z.cash_revenue) from public.nh_zbons z where z.restaurant_id = m.restaurant_id and z.z_date = m.move_date) as card_z
        from public.nh_cash_moves m join public.nh_restaurants rr on rr.id = m.restaurant_id
        where m.channel = 'viva' and rr.card_source = 'viva' group by m.restaurant_id, m.move_date) v
)
select r.*,
  row_number() over (partition by r.restaurant_id, r.period order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source) as nr,
  rs.opening_cash + sum(r.einnahme - r.ausgabe) over (partition by r.restaurant_id order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source
     rows between unbounded preceding and current row) as saldo
from rows r join public.nh_restaurants rs on rs.id = r.restaurant_id
where rs.opening_date is null or r.entry_date >= rs.opening_date;

grant select on public.nh_kassenbuch to authenticated;


-- Gutschrift ghi số hoá đơn gốc (hàng trả lại) để nối với hoá đơn đã nhập
alter table public.nh_documents add column if not exists ref_invoice_no text;


-- Quyền API cho người dùng đã đăng nhập (RLS vẫn giới hạn từng dòng)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
