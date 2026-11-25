-- Personal-Nr. từ bảng lương DATEV: dùng để gắn bảng lương hàng tháng vào đúng nhân viên
alter table public.nh_employees add column if not exists personnel_no text;
create unique index if not exists nh_employees_pnr on public.nh_employees(restaurant_id, personnel_no) where personnel_no is not null;
create index if not exists nh_employee_docs_period on public.nh_employee_docs(employee_id, kind, period);
