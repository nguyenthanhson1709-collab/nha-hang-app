-- 035: Ngoài lần chạy mỗi sáng (nh-bank-daily), chạy thêm tối ngày cuối tháng (~22:30 giờ Berlin)
-- để nộp tiền mặt trong ngày cuối cũng vào Kassenbuch của đúng tháng (người dùng yêu cầu 27/11/2026).
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'nh-bank-monthend') then
    perform cron.schedule('nh-bank-monthend', '30 21 28-31 * *', $job$
      select net.http_post(
        url := 'https://ctjttdnkauhnybfnxgef.supabase.co/functions/v1/nh-bank',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nh_viva_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
      where extract(day from ((now() at time zone 'Europe/Berlin')::date + 1)) = 1
        and exists (select 1 from public.nh_bank_links where status = 'active' and auto_sync)
    $job$);
  end if;
end $$;
