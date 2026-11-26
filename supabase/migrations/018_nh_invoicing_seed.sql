-- Dữ liệu ban đầu cho Vietbowl Mitte GmbH (đã chạy trên Supabase nha-hang-app ngày 26.11.2026).
-- Thông tin công ty đầy đủ (địa chỉ, USt-IdNr., Steuernummer, ngân hàng) được chép thẳng từ app hoá đơn cũ
-- vào bảng nh_inv_company trên database, không ghi vào mã nguồn; sửa trong app ở Viết hoá đơn > Cài đặt.
insert into public.nh_inv_company (restaurant_id, name)
select id, 'Vietbowl Mitte GmbH' from public.nh_restaurants where name = 'Vietbowl Mitte GmbH'
on conflict (restaurant_id) do nothing;

-- Dãy số hoá đơn tháng 11/2026 tiếp tục sau 202611002 (đã cấp ở app cũ), người dùng chốt 26.11.2026.
insert into public.nh_inv_counters (restaurant_id, period, last_value)
select id, '202611', 2 from public.nh_restaurants where name = 'Vietbowl Mitte GmbH'
on conflict (restaurant_id, period) do nothing;
