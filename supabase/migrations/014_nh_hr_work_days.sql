-- Số ngày làm/tuần và giờ làm/ngày (theo danh sách nhân viên hằng tháng của văn phòng lương)
alter table public.nh_employees add column if not exists work_days numeric;
alter table public.nh_employees add column if not exists daily_hours numeric;
