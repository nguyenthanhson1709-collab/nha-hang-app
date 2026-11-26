-- 022: Việc chạy nền của module Đặt bàn (pg_cron):
--   mỗi phút: đơn đã xác nhận tự chuyển "Đã đến" sau N phút (theo cài đặt từng quán)
--   9:00 Berlin (8:00 UTC): xếp email mời đánh giá cho khách hôm qua (chỉ quán đã bật nhận khách online)
--   4:30 UTC: xoá đơn cũ hơn 12 tháng (GDPR)
-- Lịch gửi email (gọi hàm gửi mail) sẽ thêm khi chuyển trang khách sang DB này.
create extension if not exists pg_cron;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-bk-auto-arrive') then
    perform cron.schedule('nh-bk-auto-arrive', '* * * * *', 'select public.nh_bk_auto_arrive()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'nh-bk-review-mails') then
    perform cron.schedule('nh-bk-review-mails', '0 8 * * *', 'select public.nh_bk_queue_review_mails()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'nh-bk-purge-old') then
    perform cron.schedule('nh-bk-purge-old', '30 4 * * *', 'select public.nh_bk_purge_old()');
  end if;
end $$;
