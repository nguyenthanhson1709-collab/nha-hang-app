-- Gutschrift ghi số hoá đơn gốc (hàng trả lại) để nối với hoá đơn đã nhập
alter table public.nh_documents add column if not exists ref_invoice_no text;
