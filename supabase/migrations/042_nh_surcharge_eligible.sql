-- 042: Phụ cấp đêm / Chủ nhật / lễ theo từng nhân viên (Zuschlagsberechtigt).
-- null = tự động (không phụ cấp khi ≤ 10 giờ/tuần), false = không bao giờ (ví dụ chủ), true = luôn có.
alter table public.nh_employees add column if not exists surcharge_eligible boolean;
