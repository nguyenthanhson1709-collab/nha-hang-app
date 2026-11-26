-- Concept & Công thức món ăn (Rezepte & Konzepte), dùng chung cả chuỗi quán.
-- Quyền: chủ sửa tất cả; người phụ trách xem + sửa món của quán mình; nhân viên chỉ xem.
-- Giá vốn: nguyên liệu nối với dòng hàng trên hoá đơn đã scan (nh_document_lines), lấy giá Netto mới nhất.
-- Chạy lại nhiều lần được (không DROP).

-- ===== Hàm phân quyền chung =====
create or replace function public.nh_any_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_is_owner() or exists(select 1 from public.nh_members where user_id = auth.uid() and role = 'manager')
$$;
create or replace function public.nh_any_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_is_owner() or exists(select 1 from public.nh_members where user_id = auth.uid())
$$;
-- Món dùng ở các quán rids (mảng trống = mọi quán)
create or replace function public.nh_rc_can_view(rids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_is_owner()
      or (coalesce(cardinality(rids), 0) = 0 and public.nh_any_member())
      or exists(select 1 from unnest(rids) r where public.nh_is_member(r))
$$;
create or replace function public.nh_rc_can_edit(rids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.nh_is_owner()
      or (coalesce(cardinality(rids), 0) = 0 and public.nh_any_manager())
      or exists(select 1 from unnest(rids) r where public.nh_can_manage(r))
$$;
grant execute on function public.nh_any_manager(), public.nh_any_member(), public.nh_rc_can_view(uuid[]), public.nh_rc_can_edit(uuid[]) to authenticated;

-- ===== Bảng =====
create table if not exists public.nh_rc_concepts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  cover text,                                   -- đường dẫn ảnh trong bucket nh-recipes
  restaurant_ids uuid[] not null default '{}',  -- quán dùng concept (trống = mọi quán)
  status text not null default 'active' check (status in ('active','testing','stopped')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nh_rc_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_de text,
  unit text not null default 'g' check (unit in ('g','ml','pcs')),  -- đơn vị gốc để tính
  allergens text[] not null default '{}',       -- mã EU: A B C D E F G H L M N O P R
  rate numeric(4,2) not null default 7,         -- thuế mua vào (dự phòng khi dòng hàng không có)
  yield_pct numeric(5,2) not null default 100 check (yield_pct > 0 and yield_pct <= 100), -- tỉ lệ dùng được sau sơ chế
  -- nối với hoá đơn scan
  match_name text,                              -- tên hàng như trên hoá đơn (* = bất kỳ)
  match_supplier text,                          -- lọc theo nhà cung cấp (không bắt buộc)
  pack_size numeric(12,3),                      -- 1 đơn vị trên hoá đơn = bao nhiêu g / ml / cái
  -- giá Netto cho 1 kg / 1 l / 1 cái
  price_manual numeric(12,4),
  price numeric(12,4),
  price_prev numeric(12,4),
  price_date date,
  price_supplier text,
  price_source text check (price_source in ('manual','invoice')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nh_rc_ingredients_name on public.nh_rc_ingredients (lower(name));

create table if not exists public.nh_rc_recipes (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid references public.nh_rc_concepts(id) on delete set null,
  kind text not null default 'dish' check (kind in ('dish','base')),   -- base = Grundrezept (sốt, nước dùng…) dùng trong món khác
  number text,
  name text not null,
  name_de text,
  description text,
  photo text,
  plating_photo text,
  status text not null default 'active' check (status in ('active','testing','stopped')),
  restaurant_ids uuid[] not null default '{}',
  portions numeric(10,2) not null default 1 check (portions > 0),
  yield_qty numeric(12,3),                      -- base: tổng thành phẩm (vd 2000)
  yield_unit text check (yield_unit in ('g','ml','pcs')),
  sell_price numeric(10,2),                     -- giá bán Brutto / phần
  sell_rate numeric(4,2) not null default 7,
  target_pct numeric(5,2) not null default 30,  -- Wareneinsatz mục tiêu
  prep_min int, cook_min int,
  steps jsonb not null default '[]',            -- [{text, photo?}]
  allergens_extra text[] not null default '{}',
  notes text,
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nh_rc_recipes_concept on public.nh_rc_recipes(concept_id);

create table if not exists public.nh_rc_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.nh_rc_recipes(id) on delete cascade,
  pos int not null default 0,
  grp text,                                     -- nhóm trong công thức (vd "Sốt", "Topping")
  ingredient_id uuid references public.nh_rc_ingredients(id) on delete restrict,
  sub_recipe_id uuid references public.nh_rc_recipes(id) on delete restrict,
  qty numeric(12,3) not null default 0,
  unit text not null default 'g' check (unit in ('g','kg','ml','l','pcs','portion')),
  note text,
  check ((ingredient_id is null) <> (sub_recipe_id is null)),
  check (sub_recipe_id is null or sub_recipe_id <> recipe_id)
);
create index if not exists nh_rc_items_recipe on public.nh_rc_items(recipe_id);
create index if not exists nh_rc_items_ing on public.nh_rc_items(ingredient_id);
create index if not exists nh_rc_items_sub on public.nh_rc_items(sub_recipe_id);

-- updated_at
create or replace function public.nh_rc_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['nh_rc_concepts','nh_rc_ingredients','nh_rc_recipes'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_touch') then
      execute format('create trigger %I before update on public.%I for each row execute function public.nh_rc_touch()', t || '_touch', t);
    end if;
  end loop;
end $$;

-- ===== RLS =====
alter table public.nh_rc_concepts enable row level security;
alter table public.nh_rc_ingredients enable row level security;
alter table public.nh_rc_recipes enable row level security;
alter table public.nh_rc_items enable row level security;

create or replace function public.nh_rc_recipe_editable(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.nh_rc_can_edit(restaurant_ids) from public.nh_rc_recipes where id = rid), false)
$$;
grant execute on function public.nh_rc_recipe_editable(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'nh_rc_concepts' and policyname = 'nh_rc_concepts_sel') then
    create policy nh_rc_concepts_sel on public.nh_rc_concepts for select to authenticated using (public.nh_rc_can_view(restaurant_ids));
    create policy nh_rc_concepts_ins on public.nh_rc_concepts for insert to authenticated with check (public.nh_rc_can_edit(restaurant_ids));
    create policy nh_rc_concepts_upd on public.nh_rc_concepts for update to authenticated using (public.nh_rc_can_edit(restaurant_ids)) with check (public.nh_rc_can_edit(restaurant_ids));
    create policy nh_rc_concepts_del on public.nh_rc_concepts for delete to authenticated using (public.nh_is_owner());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_rc_ingredients' and policyname = 'nh_rc_ingredients_sel') then
    create policy nh_rc_ingredients_sel on public.nh_rc_ingredients for select to authenticated using (public.nh_any_member());
    create policy nh_rc_ingredients_ins on public.nh_rc_ingredients for insert to authenticated with check (public.nh_any_manager());
    create policy nh_rc_ingredients_upd on public.nh_rc_ingredients for update to authenticated using (public.nh_any_manager()) with check (public.nh_any_manager());
    create policy nh_rc_ingredients_del on public.nh_rc_ingredients for delete to authenticated using (public.nh_any_manager());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_rc_recipes' and policyname = 'nh_rc_recipes_sel') then
    create policy nh_rc_recipes_sel on public.nh_rc_recipes for select to authenticated using (public.nh_rc_can_view(restaurant_ids));
    create policy nh_rc_recipes_ins on public.nh_rc_recipes for insert to authenticated with check (public.nh_rc_can_edit(restaurant_ids));
    create policy nh_rc_recipes_upd on public.nh_rc_recipes for update to authenticated using (public.nh_rc_can_edit(restaurant_ids)) with check (public.nh_rc_can_edit(restaurant_ids));
    create policy nh_rc_recipes_del on public.nh_rc_recipes for delete to authenticated using (public.nh_rc_can_edit(restaurant_ids));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_rc_items' and policyname = 'nh_rc_items_sel') then
    create policy nh_rc_items_sel on public.nh_rc_items for select to authenticated using (exists(select 1 from public.nh_rc_recipes r where r.id = recipe_id));
    create policy nh_rc_items_ins on public.nh_rc_items for insert to authenticated with check (public.nh_rc_recipe_editable(recipe_id));
    create policy nh_rc_items_upd on public.nh_rc_items for update to authenticated using (public.nh_rc_recipe_editable(recipe_id)) with check (public.nh_rc_recipe_editable(recipe_id));
    create policy nh_rc_items_del on public.nh_rc_items for delete to authenticated using (public.nh_rc_recipe_editable(recipe_id));
  end if;
end $$;
grant select, insert, update, delete on public.nh_rc_concepts, public.nh_rc_ingredients, public.nh_rc_recipes, public.nh_rc_items to authenticated;

-- ===== Ảnh: bucket riêng tư nh-recipes =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('nh-recipes', 'nh-recipes', false, 10485760)
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_recipes_sel') then
    create policy nh_recipes_sel on storage.objects for select to authenticated using (bucket_id = 'nh-recipes' and public.nh_any_member());
    create policy nh_recipes_ins on storage.objects for insert to authenticated with check (bucket_id = 'nh-recipes' and public.nh_any_manager());
    create policy nh_recipes_del on storage.objects for delete to authenticated using (bucket_id = 'nh-recipes' and public.nh_any_manager());
  end if;
end $$;

-- ===== Giá từ hoá đơn scan =====
-- Mọi dòng hàng mua vào, giá Netto của 1 đơn vị trên hoá đơn.
-- Hoá đơn sỉ in giá Netto, siêu thị in Brutto: so tổng dòng với Brutto của hoá đơn để biết.
create or replace function public.nh_rc_lines_net(only_mine boolean default true)
returns table (line_id uuid, doc_date date, supplier text, restaurant_id uuid, name text, qty numeric, unit text, unit_net numeric, rate numeric)
language sql stable security definer set search_path = public as $$
  with d as (
    select doc.id, doc.doc_date, doc.supplier, doc.restaurant_id, doc.gross,
      (select sum(total) from public.nh_document_lines x where x.document_id = doc.id) lsum,
      (select sum(net) from public.nh_document_taxes t where t.document_id = doc.id) tnet,
      (select case when count(*) = 1 then max(rate) end from public.nh_document_taxes t where t.document_id = doc.id) one_rate
    from public.nh_documents doc
    where doc.kind = 'purchase' and not coalesce(doc.is_credit, false)
      and (not only_mine or public.nh_is_owner() or public.nh_is_member(doc.restaurant_id))
  )
  select l.id, d.doc_date, d.supplier, d.restaurant_id, l.name, l.qty, l.unit,
    round(case
      when abs(d.lsum - d.gross) > 0.05 and d.tnet is not null and abs(d.lsum - d.tnet) <= 0.05 + d.tnet * 0.002
        then coalesce(l.unit_price, l.total / nullif(l.qty, 0), l.total)
      else coalesce(l.unit_price, l.total / nullif(l.qty, 0), l.total) / (1 + coalesce(l.rate, d.one_rate, 7) / 100)
    end, 4) unit_net,
    coalesce(l.rate, d.one_rate)
  from public.nh_document_lines l join d on d.id = l.document_id
  where l.total > 0 and coalesce(l.qty, 1) > 0
$$;
revoke execute on function public.nh_rc_lines_net(boolean) from public, anon, authenticated;

create or replace function public.nh_rc_match(n text, s text, pat text, sup text) returns boolean
language sql immutable as $$
  select lower(n) like lower(replace(replace(replace(replace(pat, '\', '\\'), '%', '\%'), '_', '\_'), '*', '%'))
     and (coalesce(sup, '') = '' or lower(coalesce(s, '')) like '%' || lower(sup) || '%')
$$;

-- Tìm dòng hàng để nối nguyên liệu (gợi ý tên như trên hoá đơn)
create or replace function public.nh_rc_find_lines(q text)
returns table (name text, supplier text, unit text, n bigint, last_date date, last_unit_net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.nh_any_manager() then raise exception 'NH_LOCKED: Không có quyền'; end if;
  return query
    select x.name, x.supplier, max(x.unit), count(*), max(x.doc_date),
      (array_agg(x.unit_net order by x.doc_date desc))[1]
    from public.nh_rc_lines_net() x
    where x.name ilike '%' || coalesce(q, '') || '%'
    group by x.name, x.supplier
    order by max(x.doc_date) desc
    limit 60;
end $$;
grant execute on function public.nh_rc_find_lines(text) to authenticated;

-- Lịch sử giá của một nguyên liệu (mới nhất trước), giá Netto / 1 kg|l|cái
create or replace function public.nh_rc_price_history(ing uuid)
returns table (doc_date date, supplier text, name text, qty numeric, unit text, unit_net numeric, base_price numeric)
language plpgsql stable security definer set search_path = public as $$
declare i public.nh_rc_ingredients;
begin
  if not public.nh_any_manager() then raise exception 'NH_LOCKED: Không có quyền'; end if;
  select * into i from public.nh_rc_ingredients where id = ing;
  if i.match_name is null or i.match_name = '' then return; end if;
  return query
    select x.doc_date, x.supplier, x.name, x.qty, x.unit, x.unit_net,
      round(x.unit_net / nullif(i.pack_size, 0) * (case when i.unit = 'pcs' then 1 else 1000 end), 4)
    from public.nh_rc_lines_net() x
    where public.nh_rc_match(x.name, x.supplier, i.match_name, i.match_supplier)
    order by x.doc_date desc
    limit 50;
end $$;
grant execute on function public.nh_rc_price_history(uuid) to authenticated;

-- Cập nhật giá mọi nguyên liệu đã nối hoá đơn. Trả về số nguyên liệu đổi giá.
create or replace function public.nh_rc_refresh_prices() returns int
language plpgsql security definer set search_path = public as $$
declare i record; v record; n int := 0; newp numeric;
begin
  if not public.nh_any_manager() then raise exception 'NH_LOCKED: Không có quyền'; end if;
  for i in select * from public.nh_rc_ingredients where coalesce(match_name, '') <> '' and coalesce(pack_size, 0) > 0 loop
    select x.doc_date, x.supplier, x.unit_net into v
      from public.nh_rc_lines_net(false) x
      where public.nh_rc_match(x.name, x.supplier, i.match_name, i.match_supplier)
      order by x.doc_date desc, x.line_id limit 1;
    if not found then continue; end if;
    newp := round(v.unit_net / i.pack_size * (case when i.unit = 'pcs' then 1 else 1000 end), 4);
    if i.price is distinct from newp or i.price_date is distinct from v.doc_date or i.price_source is distinct from 'invoice' then
      update public.nh_rc_ingredients set
        price_prev = case when i.price_source = 'invoice' and i.price is distinct from newp and coalesce(i.price_date, '1900-01-01') <= v.doc_date then i.price else price_prev end,
        price = newp, price_date = v.doc_date, price_supplier = v.supplier, price_source = 'invoice'
      where id = i.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.nh_rc_refresh_prices() to authenticated;
