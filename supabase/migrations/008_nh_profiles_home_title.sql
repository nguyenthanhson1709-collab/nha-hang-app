-- Tiêu đề trang danh sách nhà hàng do chủ tự đặt
alter table public.nh_profiles add column if not exists home_title text;
