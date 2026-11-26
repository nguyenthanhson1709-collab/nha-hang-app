-- Dòng địa chỉ phụ thứ hai của khách (vd. "Herrn X" + "Kostenstelle ..."), in trên tên đường
alter table public.nh_inv_customers add column if not exists supplement2 text not null default '';
