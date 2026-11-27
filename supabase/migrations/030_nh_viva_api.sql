-- 030: Kết nối Viva Wallet bằng API (2026-11-27).
-- nh_viva_accounts: cài đặt từng quán (không có khoá bí mật), chủ + người phụ trách xem được.
-- nh_viva_keys: API Key, KHÔNG ai đọc được qua app (RLS bật, không có policy) - chỉ edge function nh-viva (service_role).
-- nh_viva_days: tổng Viva từng ngày kinh doanh đã lấy về (để đối chiếu với Z-Bon).
-- Mỗi sáng 5:30 (giờ đông) / 6:30 (giờ hè) Berlin: lấy 3 ngày gần nhất và điền ô Viva Wallet trong Kassenbuch.

create table if not exists public.nh_viva_accounts (
  restaurant_id uuid primary key references public.nh_restaurants(id) on delete cascade,
  merchant_id text not null,
  has_key boolean not null default false,
  source_codes text,          -- lọc theo Source Code (nếu một tài khoản Viva dùng cho nhiều quán)
  terminal_ids text,          -- lọc theo Terminal-ID
  cutoff_hour int not null default 4 check (cutoff_hour between 0 and 8),
  auto_sync boolean not null default true,
  demo boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.nh_viva_accounts enable row level security;
create policy nh_viva_acc_sel on public.nh_viva_accounts for select to authenticated using (public.nh_can_manage(restaurant_id));

create table if not exists public.nh_viva_keys (
  restaurant_id uuid primary key references public.nh_restaurants(id) on delete cascade,
  api_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.nh_viva_keys enable row level security;
revoke all on public.nh_viva_keys from anon, authenticated;

create table if not exists public.nh_viva_days (
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  day date not null,
  amount numeric(12,2) not null default 0,
  tip numeric(12,2) not null default 0,
  refunds numeric(12,2) not null default 0,
  n_tx int not null default 0,
  synced_at timestamptz not null default now(),
  primary key (restaurant_id, day)
);
alter table public.nh_viva_days enable row level security;
create policy nh_viva_days_sel on public.nh_viva_days for select to authenticated using (public.nh_can_manage(restaurant_id));

-- Mật mã riêng cho lịch chạy gọi edge function
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'nh_viva_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'nh_viva_cron_secret', 'nh-viva cron header');
  end if;
end $$;
create or replace function public.nh_viva_cron_secret_ok(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(s, '') <> '' and s = (select decrypted_secret from vault.decrypted_secrets where name = 'nh_viva_cron_secret')
$$;
revoke all on function public.nh_viva_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.nh_viva_cron_secret_ok(text) to service_role;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-viva-daily') then
    perform cron.schedule('nh-viva-daily', '30 4 * * *', $job$
      select net.http_post(
        url := 'https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-viva',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nh_viva_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000)
      where exists (select 1 from public.nh_viva_accounts where auto_sync and has_key)
    $job$);
  end if;
end $$;
