-- 031: Viva Wallet - số dư (Guthaben) và chuyển khoản (2026-11-27).
-- Số dư: app hỏi trực tiếp Viva (GET /api/wallets) qua edge function nh-viva, lưu lần đọc cuối vào nh_viva_accounts.
-- Chuyển khoản / biến động tài khoản: Viva gửi webhook "Account Transaction Created" (EventTypeId 2054) tới
--   https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-viva?hook=<webhook_token>
-- mỗi quán một webhook_token riêng (bí mật trong URL), lưu vào nh_viva_account_tx.
alter table public.nh_viva_accounts
  add column if not exists webhook_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  add column if not exists wallets jsonb,
  add column if not exists wallets_at timestamptz,
  add column if not exists last_hook_at timestamptz;

create table if not exists public.nh_viva_account_tx (
  id text primary key,                 -- WalletTransactionId (hoặc CorrelationId/MessageId)
  restaurant_id uuid not null references public.nh_restaurants(id) on delete cascade,
  created timestamptz not null,
  value_date date,
  amount numeric(12,2) not null,
  type_id int,
  subtype_id int,
  status_id text,
  description text,
  iban text,
  wallet_id text,
  available_after numeric(12,2),
  balance_after numeric(12,2),
  raw jsonb,
  received_at timestamptz not null default now()
);
create index if not exists nh_viva_account_tx_r on public.nh_viva_account_tx(restaurant_id, created desc);
alter table public.nh_viva_account_tx enable row level security;
create policy nh_viva_atx_sel on public.nh_viva_account_tx for select to authenticated using (public.nh_can_manage(restaurant_id));
