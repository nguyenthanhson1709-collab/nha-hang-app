-- Viết hoá đơn: danh sách lời mở đầu / lời kết đã lưu để chọn lại (theo quán)
alter table public.nh_inv_company
  add column if not exists text_presets jsonb not null default '{"intro": [], "closing": []}'::jsonb;
