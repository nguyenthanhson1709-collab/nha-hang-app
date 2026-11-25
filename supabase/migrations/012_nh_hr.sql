-- Module Nhân sự (Personal): nhân viên, giấy tờ, hợp đồng lao động, ca làm, giờ làm thực tế, nghỉ phép/ốm.
-- Chỉ Chủ và Người phụ trách của đúng nhà hàng đọc/ghi (nh_can_manage). Tài khoản Nhân viên (staff) không thấy.
-- Không sửa bảng nh_ có sẵn. Chạy lại nhiều lần được (if not exists / create or replace), không có DROP.

-- Cài đặt nhân sự theo nhà hàng (tên công ty GmbH, giới hạn Minijob...)
create table if not exists public.nh_hr_settings (
  restaurant_id uuid primary key references public.nh_restaurants(id) on delete cascade,
  company_name text,                                  -- Firma, vd. "Vietbowl Mitte GmbH"
  minijob_limit numeric(10,2) not null default 603,   -- Minijob-Grenze €/Monat (2026)
  staffing jsonb not null default '{}',               -- số người cần theo vị trí / thứ (Bước 3)
  updated_at timestamptz not null default now()
);

-- Nhân viên (theo Meldungsbogen PERSONAL)
create table if not exists public.nh_employees (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  last_name text not null,                 -- Name
  first_name text not null default '',     -- Vorname
  address text,                            -- Anschrift
  birth_date date,                         -- Geburtsdatum
  birth_place text,                        -- Geburtsort
  nationality text,                        -- Nationalität
  phone text, email text,
  photo text,                              -- đường dẫn trong bucket nh-personal
  residence_permit text,                   -- Aufenthaltstitel
  residence_permit_until date,             -- hết hạn giấy phép cư trú (app nhắc trước)
  work_permitted boolean,                  -- Erwerbstätigkeit gestattet
  company text,                            -- Firma
  entry_date date,                         -- Eintrittsdatum
  exit_date date,                          -- ngày nghỉ việc (hợp đồng kết thúc) -> mục "Đã nghỉ"
  exit_reason text,
  job_title text,                          -- Tätigkeit
  position text check (position in ('kitchen','service','bar','dish','other')),
  employment_type text check (employment_type in ('vollzeit','teilzeit','minijob','werkstudent','aushilfe')),
  gross_monthly numeric(10,2),             -- Monatlicher Bruttolohn
  hourly_wage numeric(8,2),
  weekly_hours numeric(5,2),
  vacation_days numeric(4,1),
  multiple_employment boolean,             -- Mehrfachbeschäftigung
  tax_class smallint check (tax_class between 1 and 6),   -- Lohnsteuerklasse
  pension_no text,                         -- Rentenversicherungsnummer
  health_insurance text,                   -- Krankenkasse
  tax_id text,                             -- Steuer-Identifikationsnummer
  iban text, bic text, bank_name text,     -- Bankverbindung
  note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index if not exists nh_employees_rest on public.nh_employees(restaurant_id, last_name);

-- Giấy tờ nhân viên (hộ chiếu, giấy cư trú, hợp đồng, bảng lương...)
create table if not exists public.nh_employee_docs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  employee_id uuid not null,
  kind text not null default 'other' check (kind in ('passport','residence','work_permit','id_card','contract','payslip','sv','tax','health','certificate','other')),
  title text,
  path text not null,                      -- <restaurant_id>/<employee_id>/<uuid>.<ext> trong bucket nh-personal
  valid_until date,
  period text,                             -- YYYY-MM cho bảng lương
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_employee_docs_emp on public.nh_employee_docs(employee_id);

-- Hợp đồng lao động (khác nh_contracts = hợp đồng Lastschrift với công ty)
create table if not exists public.nh_employment_contracts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  employee_id uuid not null,
  employment_type text check (employment_type in ('vollzeit','teilzeit','minijob','werkstudent','aushilfe')),
  start_date date not null,
  end_date date,                           -- befristet bis
  probation_until date,                    -- Probezeit bis
  weekly_hours numeric(5,2),
  gross_monthly numeric(10,2),
  hourly_wage numeric(8,2),
  vacation_days numeric(4,1),
  terminated_on date,                      -- ngày huỷ hợp đồng (Kündigung)
  note text,
  files text[] not null default '{}',
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_emp_contracts_emp on public.nh_employment_contracts(employee_id, start_date);

-- Ca làm dự kiến (Arbeitsplan)
create table if not exists public.nh_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  employee_id uuid not null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,                  -- nhỏ hơn start_time = qua đêm
  break_min integer not null default 0 check (break_min >= 0),
  position text check (position in ('kitchen','service','bar','dish','other')),
  note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_shifts_rest_date on public.nh_shifts(restaurant_id, shift_date);

-- Giờ làm thực tế (Stundenzettel)
create table if not exists public.nh_time_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  break_min integer not null default 0 check (break_min >= 0),
  shift_id uuid references public.nh_shifts(id) on delete set null,
  note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_time_rest_date on public.nh_time_entries(restaurant_id, work_date);

-- Nghỉ phép / nghỉ ốm
create table if not exists public.nh_absences (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('vacation','sick','unpaid','other')),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  note text,
  files text[] not null default '{}',
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  foreign key (employee_id, restaurant_id) references public.nh_employees(id, restaurant_id) on delete cascade on update cascade
);
create index if not exists nh_absences_rest on public.nh_absences(restaurant_id, from_date);

-- updated_at
create or replace function public.nh_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
revoke execute on function public.nh_touch() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'nh_employees_touch') then
    create trigger nh_employees_touch before update on public.nh_employees for each row execute function public.nh_touch();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'nh_hr_settings_touch') then
    create trigger nh_hr_settings_touch before update on public.nh_hr_settings for each row execute function public.nh_touch();
  end if;
end $$;

-- RLS: chỉ chủ + người phụ trách của nhà hàng đó
do $$
declare t text;
begin
  foreach t in array array['nh_hr_settings','nh_employees','nh_employee_docs','nh_employment_contracts','nh_shifts','nh_time_entries','nh_absences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_all') then
      execute format('create policy %I on public.%I for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id))', t || '_all', t);
    end if;
  end loop;
end $$;

-- Kho file riêng tư cho giấy tờ nhân viên. Đường dẫn: <restaurant_id>/<employee_id>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit)
values ('nh-personal', 'nh-personal', false, 20971520)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_personal_sel') then
    create policy nh_personal_sel on storage.objects for select to authenticated
      using (bucket_id = 'nh-personal' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_personal_ins') then
    create policy nh_personal_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'nh-personal' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_personal_del') then
    create policy nh_personal_del on storage.objects for delete to authenticated
      using (bucket_id = 'nh-personal' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
