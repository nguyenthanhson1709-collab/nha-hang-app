-- 033: Chọn tài khoản (IBAN) nào hiện ở quán nào (2026-11-27).
-- Một lần đăng nhập Volksbank có thể trả về nhiều tài khoản của nhiều quán: chỉ tài khoản enabled mới được lấy số và hiện.
alter table public.nh_bank_accounts add column if not exists enabled boolean not null default true;
