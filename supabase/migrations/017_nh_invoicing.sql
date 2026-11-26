-- Viết hoá đơn (Rechnung) + Angebot, gộp từ app hoá đơn riêng.
-- Mọi dữ liệu theo từng nhà hàng (mỗi quán là một công ty, dãy số hoá đơn riêng).
-- Chỉ Chủ + Người phụ trách của quán dùng được (nh_can_manage).
-- GoBD: số hoá đơn chỉ cấp qua nh_inv_finalize, liên tục theo tháng; hoá đơn đã hoàn tất không sửa/xoá được.
-- Viết không dùng DROP để chạy lại an toàn.

-- ===== Thông tin công ty in trên hoá đơn (1 dòng / quán) =====
create table if not exists public.nh_inv_company (
  restaurant_id uuid primary key references public.nh_restaurants(id) on delete cascade,
  name text not null default '',
  street text not null default '', zip text not null default '', city text not null default '',
  phone text not null default '', email text not null default '', website text not null default '',
  vat_id text not null default '', tax_number text not null default '', managing_director text not null default '',
  bank_name text not null default '', account_holder text not null default '', iban text not null default '', bic text not null default '',
  payment_days int not null default 7 check (payment_days between 0 and 365),
  intro_text text not null default 'Vielen Dank für Ihre Bestellung. Wir stellen Ihnen folgende Leistung in Rechnung.',
  closing_text text not null default E'Wir bitten Sie den o.g. Betrag innerhalb von {tage} Tagen auf unser Konto zu überweisen.\nVielen Dank für Ihr Vertrauen.',
  email_subject text not null default 'Rechnung {nummer}',
  email_body text not null default E'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Rechnung {nummer} über {betrag}.\n\nMit freundlichen Grüßen\n{firma}',
  intro_text_en text not null default 'Thank you for your order. We hereby invoice you for the following services.',
  closing_text_en text not null default E'Please transfer the above amount to our account within {tage} days.\nKind regards,\n{firma}',
  email_subject_en text not null default 'Invoice {nummer}',
  email_body_en text not null default E'Dear Sir or Madam,\n\nplease find attached our invoice {nummer} for {betrag}.\n\nKind regards,\n{firma}',
  logo_url text,
  updated_at timestamptz not null default now()
);

-- ===== Khách hàng =====
create table if not exists public.nh_inv_customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  customer_number int,
  kind text not null default 'customer' check (kind in ('customer','vendor')),
  name text not null,
  street text not null default '', supplement text not null default '', zip text not null default '', city text not null default '',
  country text not null default 'DE',
  emails text not null default '', phone text not null default '', vat_id text not null default '', note text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, customer_number)
);
create index if not exists nh_inv_customers_name on public.nh_inv_customers(restaurant_id, name);

-- ===== Món / dịch vụ =====
create table if not exists public.nh_inv_articles (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  number text not null default '',
  name text not null,
  description text not null default '',
  unit text not null default 'Stück',
  tax_rate numeric(5,2) not null default 7,
  price_net numeric(12,2) not null default 0,
  price_gross numeric(12,2) not null default 0,
  is_lunch boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nh_inv_articles_name on public.nh_inv_articles(restaurant_id, name);

-- ===== Bộ đếm số: period 'YYYYMM' (hoá đơn) hoặc 'AGYYYYMM' (Angebot) =====
create table if not exists public.nh_inv_counters (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  period text not null check (period ~ '^(AG)?[0-9]{6}$'),
  last_value int not null default 0 check (last_value >= 0),
  primary key (restaurant_id, period)
);

-- ===== Hoá đơn + Angebot (doc_type) =====
create table if not exists public.nh_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  doc_type text not null default 'invoice' check (doc_type in ('invoice','quote')),
  invoice_number text,
  status text not null default 'draft' check (status in ('draft','open','paid','cancelled','accepted')),
  customer_id uuid references public.nh_inv_customers(id) on delete set null,
  customer_snapshot jsonb not null default '{}'::jsonb,
  invoice_date date not null default current_date,
  service_period text not null default '',
  due_date date,
  delivery_type text not null default 'none' check (delivery_type in ('none','delivery_date','delivery_period','service_date','service_period')),
  delivery_date date,
  delivery_end date,
  language text not null default 'de' check (language in ('de','en')),
  price_mode text not null default 'gross' check (price_mode in ('gross','net')),
  intro_text text not null default '',
  closing_text text not null default '',
  total_net numeric(12,2) not null default 0,
  total_tax numeric(12,2) not null default 0,
  total_gross numeric(12,2) not null default 0,
  sent_at timestamptz, sent_to text, paid_at date,
  source_quote_id uuid references public.nh_invoices(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, invoice_number)
);
create index if not exists nh_invoices_list on public.nh_invoices(restaurant_id, doc_type, invoice_date desc);
create index if not exists nh_invoices_customer on public.nh_invoices(customer_id);
create index if not exists nh_invoices_quote on public.nh_invoices(source_quote_id);

create table if not exists public.nh_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.nh_invoices(id) on delete cascade,
  position int not null,
  article_id uuid references public.nh_inv_articles(id) on delete set null,
  name text not null,
  description text not null default '',
  quantity numeric(12,3) not null default 1,
  unit text not null default 'Stück',
  unit_price_gross numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 7,
  line_total_gross numeric(12,2) not null default 0
);
create index if not exists nh_invoice_items_inv on public.nh_invoice_items(invoice_id, position);

-- ===== Bảo vệ GoBD =====
create or replace function public.nh_inv_protect() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.invoice_number is not null and coalesce(current_setting('nh.inv_finalize', true), '') <> '1' then
      raise exception 'Rechnungsnummern werden nur beim Abschließen vergeben';
    end if;
    if new.invoice_number is null and not (new.status = 'draft' or (new.status = 'accepted' and new.doc_type = 'quote')) then
      raise exception 'Entwürfe haben den Status draft';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_number is not null then raise exception 'Abgeschlossene Rechnungen können nicht gelöscht werden'; end if;
    return old;
  end if;
  -- UPDATE
  if old.invoice_number is null and new.invoice_number is not null and coalesce(current_setting('nh.inv_finalize', true), '') <> '1' then
    raise exception 'Rechnungsnummern werden nur beim Abschließen vergeben';
  end if;
  if new.restaurant_id is distinct from old.restaurant_id then raise exception 'restaurant_id ist unveränderlich'; end if;
  if old.invoice_number is not null and (
     new.invoice_number is distinct from old.invoice_number or
     new.doc_type is distinct from old.doc_type or
     new.customer_snapshot is distinct from old.customer_snapshot or
     new.invoice_date is distinct from old.invoice_date or
     new.due_date is distinct from old.due_date or
     new.delivery_type is distinct from old.delivery_type or
     new.delivery_date is distinct from old.delivery_date or
     new.delivery_end is distinct from old.delivery_end or
     new.service_period is distinct from old.service_period or
     new.language is distinct from old.language or
     new.price_mode is distinct from old.price_mode or
     new.intro_text is distinct from old.intro_text or
     new.closing_text is distinct from old.closing_text or
     new.total_net is distinct from old.total_net or
     new.total_tax is distinct from old.total_tax or
     new.total_gross is distinct from old.total_gross or
     new.status = 'draft') then
    raise exception 'Finalisierte Rechnungen können nicht geändert werden';
  end if;
  if new.invoice_number is null and not (new.status = 'draft' or (new.status = 'accepted' and new.doc_type = 'quote')) then
    raise exception 'Entwürfe haben den Status draft';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.nh_inv_protect() from public, anon, authenticated;

create or replace function public.nh_inv_protect_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  select invoice_number into v_num from public.nh_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_num is not null then raise exception 'Finalisierte Rechnungen können nicht geändert werden'; end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    select invoice_number into v_num from public.nh_invoices where id = old.invoice_id;
    if v_num is not null then raise exception 'Finalisierte Rechnungen können nicht geändert werden'; end if;
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.nh_inv_protect_items() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'nh_invoices_protect') then
    create trigger nh_invoices_protect before insert or update or delete on public.nh_invoices for each row execute function public.nh_inv_protect();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_invoice_items_protect') then
    create trigger nh_invoice_items_protect before insert or update or delete on public.nh_invoice_items for each row execute function public.nh_inv_protect_items();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_inv_company_touch') then
    create trigger nh_inv_company_touch before update on public.nh_inv_company for each row execute function public.nh_touch();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_inv_customers_touch') then
    create trigger nh_inv_customers_touch before update on public.nh_inv_customers for each row execute function public.nh_touch();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_inv_articles_touch') then
    create trigger nh_inv_articles_touch before update on public.nh_inv_articles for each row execute function public.nh_touch();
  end if;
end $$;

-- ===== Hoàn tất: cấp số YYYYMM + 3 số (Angebot: AG + YYYYMM + 3 số), theo từng quán =====
create or replace function public.nh_inv_finalize(p_invoice uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_inv public.nh_invoices; v_period text; v_next int; v_number text; v_days int;
begin
  select * into v_inv from public.nh_invoices where id = p_invoice for update;
  if v_inv.id is null or not public.nh_can_manage(v_inv.restaurant_id) then raise exception 'not allowed'; end if;
  if v_inv.invoice_number is not null then return v_inv.invoice_number; end if;
  if v_inv.status <> 'draft' then raise exception 'only drafts can be finalized'; end if;
  if not exists (select 1 from public.nh_invoice_items where invoice_id = p_invoice) then raise exception 'Rechnung ohne Positionen'; end if;
  v_period := case when v_inv.doc_type = 'quote' then 'AG' else '' end || to_char(v_inv.invoice_date, 'YYYYMM');
  insert into public.nh_inv_counters(restaurant_id, period, last_value) values (v_inv.restaurant_id, v_period, 1)
    on conflict (restaurant_id, period) do update set last_value = public.nh_inv_counters.last_value + 1
    returning last_value into v_next;
  v_number := v_period || lpad(v_next::text, 3, '0');
  select payment_days into v_days from public.nh_inv_company where restaurant_id = v_inv.restaurant_id;
  perform set_config('nh.inv_finalize', '1', true);
  update public.nh_invoices set invoice_number = v_number, status = 'open',
    due_date = coalesce(due_date, invoice_date + case when v_inv.doc_type = 'quote' then 14 else coalesce(v_days, 7) end)
    where id = p_invoice;
  perform set_config('nh.inv_finalize', '', true);
  return v_number;
end $$;

-- Đặt số thứ tự hiện tại của tháng (vd. tiếp tục dãy số từ phần mềm cũ). Không được nhỏ hơn số đã cấp.
create or replace function public.nh_inv_set_counter(p_restaurant uuid, p_period text, p_value int) returns void
language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  if not public.nh_can_manage(p_restaurant) then raise exception 'not allowed'; end if;
  if p_period !~ '^(AG)?[0-9]{6}$' or p_value < 0 then raise exception 'invalid'; end if;
  select coalesce(max(right(invoice_number, 3)::int), 0) into v_max from public.nh_invoices
    where restaurant_id = p_restaurant and invoice_number ~ ('^' || p_period || '[0-9]{3}$');
  if p_value < v_max then raise exception 'Nummer % ist bereits vergeben', p_period || lpad(v_max::text, 3, '0'); end if;
  insert into public.nh_inv_counters(restaurant_id, period, last_value) values (p_restaurant, p_period, p_value)
    on conflict (restaurant_id, period) do update set last_value = excluded.last_value;
end $$;

create or replace function public.nh_inv_next_customer(p_restaurant uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.nh_can_manage(p_restaurant) then
    (select coalesce(max(customer_number), 10000) + 1 from public.nh_inv_customers where restaurant_id = p_restaurant and customer_number < 70000)
  end
$$;

revoke execute on function public.nh_inv_finalize(uuid), public.nh_inv_set_counter(uuid, text, int), public.nh_inv_next_customer(uuid) from public, anon;
grant execute on function public.nh_inv_finalize(uuid), public.nh_inv_set_counter(uuid, text, int), public.nh_inv_next_customer(uuid) to authenticated;

-- ===== RLS =====
do $$
declare t text;
begin
  foreach t in array array['nh_inv_company','nh_inv_customers','nh_inv_articles','nh_inv_counters','nh_invoices','nh_invoice_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['nh_inv_company','nh_inv_customers','nh_inv_articles'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_all') then
      execute format('create policy %I on public.%I for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id))', t || '_all', t);
    end if;
  end loop;
end $$;

-- Bộ đếm: chỉ đọc; ghi qua nh_inv_finalize / nh_inv_set_counter
revoke insert, update, delete on public.nh_inv_counters from authenticated;
grant select on public.nh_inv_counters to authenticated;
grant select, insert, update, delete on public.nh_invoices, public.nh_invoice_items to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'nh_inv_counters' and policyname = 'nh_inv_counters_sel') then
    create policy nh_inv_counters_sel on public.nh_inv_counters for select to authenticated using (public.nh_can_manage(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_invoices' and policyname = 'nh_invoices_sel') then
    create policy nh_invoices_sel on public.nh_invoices for select to authenticated using (public.nh_can_manage(restaurant_id));
    create policy nh_invoices_ins on public.nh_invoices for insert to authenticated with check (public.nh_can_manage(restaurant_id));
    create policy nh_invoices_upd on public.nh_invoices for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
    create policy nh_invoices_del on public.nh_invoices for delete to authenticated using (public.nh_can_manage(restaurant_id) and invoice_number is null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_invoice_items' and policyname = 'nh_invoice_items_all') then
    create policy nh_invoice_items_all on public.nh_invoice_items for all to authenticated
      using (exists (select 1 from public.nh_invoices i where i.id = invoice_id and public.nh_can_manage(i.restaurant_id)))
      with check (exists (select 1 from public.nh_invoices i where i.id = invoice_id and public.nh_can_manage(i.restaurant_id)));
  end if;
end $$;
