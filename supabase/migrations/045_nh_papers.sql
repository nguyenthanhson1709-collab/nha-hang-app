-- Giấy tờ (Dokumente): thư mục tự đặt tên (lồng nhau được) + file PDF/Word/Excel của mỗi quán.
-- Chỉ Chủ và Người phụ trách quán xem/sửa. File nằm trong bucket nh-papers: <restaurant_id>/<folder_id>/<uuid>.<ext>
create table if not exists public.nh_paper_folders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  parent_id uuid references public.nh_paper_folders(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists nh_paper_folders_rid on public.nh_paper_folders(restaurant_id, parent_id);

create table if not exists public.nh_paper_files (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  folder_id uuid not null references public.nh_paper_folders(id) on delete cascade,
  name text not null,
  path text not null unique,
  size bigint,
  mime text,
  created_by uuid default auth.uid() references public.nh_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists nh_paper_files_folder on public.nh_paper_files(folder_id);
create index if not exists nh_paper_files_rid on public.nh_paper_files(restaurant_id);

alter table public.nh_paper_folders enable row level security;
alter table public.nh_paper_files enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'nh_paper_folders' and policyname = 'nh_pf_all') then
    create policy nh_pf_all on public.nh_paper_folders for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'nh_paper_files' and policyname = 'nh_pfi_all') then
    create policy nh_pfi_all on public.nh_paper_files for all to authenticated
      using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
end $$;
grant select, insert, update, delete on public.nh_paper_folders, public.nh_paper_files to authenticated;

-- Thư mục con và file phải cùng quán với thư mục cha
create or replace function public.nh_paper_same_rid() returns trigger language plpgsql set search_path = public as $$
declare p uuid;
begin
  if tg_table_name = 'nh_paper_folders' then
    if new.parent_id is null then return new; end if;
    select restaurant_id into p from public.nh_paper_folders where id = new.parent_id;
  else
    select restaurant_id into p from public.nh_paper_folders where id = new.folder_id;
  end if;
  if p is distinct from new.restaurant_id then raise exception 'folder belongs to another restaurant'; end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'nh_paper_folders_rid') then
    create trigger nh_paper_folders_rid before insert or update on public.nh_paper_folders for each row execute function public.nh_paper_same_rid();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_paper_files_rid') then
    create trigger nh_paper_files_rid before insert or update on public.nh_paper_files for each row execute function public.nh_paper_same_rid();
  end if;
end $$;

-- Kho file riêng tư, tối đa 50 MB/file (giới hạn gói Free)
insert into storage.buckets (id, name, public, file_size_limit)
values ('nh-papers', 'nh-papers', false, 52428800)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_papers_sel') then
    create policy nh_papers_sel on storage.objects for select to authenticated
      using (bucket_id = 'nh-papers' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_papers_ins') then
    create policy nh_papers_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'nh-papers' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_papers_del') then
    create policy nh_papers_del on storage.objects for delete to authenticated
      using (bucket_id = 'nh-papers' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
