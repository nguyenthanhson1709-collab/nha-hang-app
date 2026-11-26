-- Phép năm nay và phép còn lại (theo danh sách nhân viên hằng tháng của văn phòng lương)
alter table public.nh_employees add column if not exists vacation_year numeric;
alter table public.nh_employees add column if not exists vacation_left numeric;
alter table public.nh_employees add column if not exists vacation_as_of text;
