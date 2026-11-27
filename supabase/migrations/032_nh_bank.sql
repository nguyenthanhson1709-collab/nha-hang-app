-- 032: Kết nối tài khoản ngân hàng (Berliner Volksbank...) qua Open Banking - Enable Banking (2026-11-27).
-- CHỈ ĐỌC: số dư + giao dịch. App không bao giờ thấy PIN: chủ đăng nhập trên trang của ngân hàng.
-- nh_bank_app:      cài đặt chung (Application ID của Enable Banking), chỉ chủ xem.
-- nh_bank_secrets:  khoá riêng (.pem) của ứng dụng Enable Banking - KHÔNG ai đọc được qua app (chỉ edge function nh-bank).
-- nh_bank_links:    mỗi lần kết nối một ngân hàng cho một quán (hiệu lực ~90-180 ngày, sau đó xác nhận lại).
-- nh_bank_link_keys: session_id / state của từng kết nối - chỉ edge function đọc.
-- nh_bank_accounts: tài khoản + số dư lần đọc cuối.  nh_bank_tx: giao dịch.
-- Mỗi sáng ~6:15 Berlin: lấy số dư + giao dịch 5 ngày gần nhất (ngân hàng thường cho 4 lần/ngày khi chủ không online).

create table if not exists public.nh_bank_app (
  id int primary key default 1 check (id = 1),
  app_id text not null,
  has_key boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.nh_bank_app enable row level security;
create policy nh_bank_app_sel on public.nh_bank_app for select to authenticated using (public.nh_is_owner());
grant select on public.nh_bank_app to authenticated;

create table if not exists public.nh_bank_secrets (
  id int primary key default 1 check (id = 1),
  private_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.nh_bank_secrets enable row level security;
revoke all on public.nh_bank_secrets from anon, authenticated;

create table if not exists public.nh_bank_links (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  aspsp_name text not null,
  aspsp_country text not null default 'DE',
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'error')),
  valid_until timestamptz,
  psu_headers text[] not null default '{}',   -- required_psu_headers của ngân hàng
  auto_sync boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists nh_bank_links_r on public.nh_bank_links(restaurant_id);
alter table public.nh_bank_links enable row level security;
create policy nh_bank_links_sel on public.nh_bank_links for select to authenticated using (public.nh_can_manage(restaurant_id));
grant select on public.nh_bank_links to authenticated;

create table if not exists public.nh_bank_link_keys (
  link_id uuid primary key references public.nh_bank_links(id) on delete cascade,
  state text unique,
  session_id text,
  updated_at timestamptz not null default now()
);
alter table public.nh_bank_link_keys enable row level security;
revoke all on public.nh_bank_link_keys from anon, authenticated;

create table if not exists public.nh_bank_accounts (
  uid text primary key,                    -- account uid của Enable Banking (theo từng kết nối)
  link_id uuid not null references public.nh_bank_links(id) on delete cascade,
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  iban text,
  name text,
  currency text,
  balance numeric(14,2),
  balance_type text,
  balance_at timestamptz,
  tx_synced_until date,
  updated_at timestamptz not null default now()
);
create index if not exists nh_bank_accounts_r on public.nh_bank_accounts(restaurant_id);
alter table public.nh_bank_accounts enable row level security;
create policy nh_bank_acc_sel on public.nh_bank_accounts for select to authenticated using (public.nh_can_manage(restaurant_id));
grant select on public.nh_bank_accounts to authenticated;

create table if not exists public.nh_bank_tx (
  id text primary key,                     -- băm từ IBAN + ngày + số tiền + nội dung (+ entry_reference)
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  iban text,                               -- tài khoản của quán (giữ lại khi kết nối lại)
  account_uid text,
  booking_date date,
  value_date date,
  amount numeric(14,2) not null,           -- dương = tiền vào, âm = tiền ra
  currency text,
  counterparty text,
  counterparty_iban text,
  purpose text,
  status text,
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists nh_bank_tx_r on public.nh_bank_tx(restaurant_id, booking_date desc);
alter table public.nh_bank_tx enable row level security;
create policy nh_bank_tx_sel on public.nh_bank_tx for select to authenticated using (public.nh_can_manage(restaurant_id));
grant select on public.nh_bank_tx to authenticated;

-- Lịch chạy: dùng chung mật mã với Viva (nh_viva_cron_secret, đã có từ 030)
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-bank-daily') then
    perform cron.schedule('nh-bank-daily', '15 5 * * *', $job$
      select net.http_post(
        url := 'https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-bank',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nh_viva_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
      where exists (select 1 from public.nh_bank_links where status = 'active' and auto_sync)
    $job$);
  end if;
end $$;
