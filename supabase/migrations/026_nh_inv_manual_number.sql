-- Số hoá đơn nhập tay: người dùng có thể ghi số mong muốn vào bản nháp (desired_number).
-- Số vẫn chỉ được gán khi hoàn tất qua nh_inv_finalize: kiểm tra định dạng và không trùng trong quán.
-- Nếu số nhập tay thuộc dãy tự động của tháng (YYYYMM###), bộ đếm được nâng lên để số tự động sau không bị trùng.
alter table public.nh_invoices add column if not exists desired_number text;

create or replace function public.nh_inv_finalize(p_invoice uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_inv public.nh_invoices; v_period text; v_next int; v_number text; v_days int; v_manual text;
begin
  select * into v_inv from public.nh_invoices where id = p_invoice for update;
  if v_inv.id is null or not public.nh_can_manage(v_inv.restaurant_id) then raise exception 'not allowed'; end if;
  if v_inv.invoice_number is not null then return v_inv.invoice_number; end if;
  if v_inv.status <> 'draft' then raise exception 'only drafts can be finalized'; end if;
  if not exists (select 1 from public.nh_invoice_items where invoice_id = p_invoice) then raise exception 'Rechnung ohne Positionen'; end if;
  v_period := case when v_inv.doc_type = 'quote' then 'AG' else '' end || to_char(v_inv.invoice_date, 'YYYYMM');
  v_manual := nullif(btrim(coalesce(v_inv.desired_number, '')), '');

  if v_manual is not null then
    if v_manual !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then
      raise exception 'Ungültige Rechnungsnummer "%": nur Buchstaben, Ziffern und . _ / - (max. 40 Zeichen)', v_manual;
    end if;
    if exists (select 1 from public.nh_invoices where restaurant_id = v_inv.restaurant_id and invoice_number = v_manual) then
      raise exception 'Rechnungsnummer % ist bereits vergeben', v_manual;
    end if;
    v_number := v_manual;
    -- Thuộc dãy tự động của một tháng: nâng bộ đếm tháng đó
    if v_manual ~ '^(AG)?[0-9]{6}[0-9]{3}$' then
      insert into public.nh_inv_counters(restaurant_id, period, last_value)
        values (v_inv.restaurant_id, left(v_manual, length(v_manual) - 3), right(v_manual, 3)::int)
        on conflict (restaurant_id, period) do update set last_value = greatest(public.nh_inv_counters.last_value, excluded.last_value);
    end if;
  else
    -- Số tự động; bỏ qua số đã có người nhập tay
    loop
      insert into public.nh_inv_counters(restaurant_id, period, last_value) values (v_inv.restaurant_id, v_period, 1)
        on conflict (restaurant_id, period) do update set last_value = public.nh_inv_counters.last_value + 1
        returning last_value into v_next;
      v_number := v_period || lpad(v_next::text, 3, '0');
      exit when not exists (select 1 from public.nh_invoices where restaurant_id = v_inv.restaurant_id and invoice_number = v_number);
    end loop;
  end if;

  select payment_days into v_days from public.nh_inv_company where restaurant_id = v_inv.restaurant_id;
  perform set_config('nh.inv_finalize', '1', true);
  update public.nh_invoices set invoice_number = v_number, status = 'open',
    due_date = coalesce(due_date, invoice_date + case when v_inv.doc_type = 'quote' then 14 else coalesce(v_days, 7) end)
    where id = p_invoice;
  perform set_config('nh.inv_finalize', '', true);
  return v_number;
end $$;
