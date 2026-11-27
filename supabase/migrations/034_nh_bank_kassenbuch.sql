-- 034: Nộp tiền mặt vào ngân hàng (Einzahlung) -> tự ghi "Geldtransit an Bank" vào Kassenbuch (2026-11-27).
-- nh_bank_tx.kb_state: null = chưa xử lý, 'booked' = app đã ghi dòng mới, 'matched' = khớp với dòng nhập tay sẵn có,
-- 'skip' = bỏ qua (vd. dòng Kassenbuch bị xoá tay thì không ghi lại).
alter table public.nh_bank_tx add column if not exists kb_state text check (kb_state in ('booked', 'matched', 'skip'));
alter table public.nh_bank_tx add column if not exists kb_move_id uuid;
alter table public.nh_cash_moves add column if not exists bank_tx_id text;
