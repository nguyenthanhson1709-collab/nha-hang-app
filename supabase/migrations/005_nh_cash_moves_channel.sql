alter table public.nh_cash_moves add column if not exists channel text;
comment on column public.nh_cash_moves.channel is 'Kênh thanh toán thẻ, ví dụ viva = Viva Wallet (Kartenzahlung)';

-- Viva Wallet (thu thẻ nhập tay, channel = 'viva'): thay phần thẻ của Z-Bon ngày đó; chỉ phần vượt quá mới làm giảm tồn quỹ
create or replace view public.nh_kassenbuch with (security_invoker = true) as
with rows as (
  select d.restaurant_id, greatest(d.doc_date, to_date(d.period||'-01','YYYY-MM-DD')) as entry_date, d.period,
         d.created_at as sort_ts, 'beleg'::text as source, d.id as source_id,
         coalesce(d.supplier,'Beleg') || coalesce(' Nr. '||d.invoice_no,'') ||
           case when d.doc_date < to_date(d.period||'-01','YYYY-MM-DD') then ' (Belegdatum '||to_char(d.doc_date,'DD.MM.YYYY')||')' else '' end as text,
         0::numeric as einnahme, p.amount::numeric as ausgabe,
         (select string_agg(distinct (t.rate::int)::text||'%', '/') from public.nh_document_taxes t where t.document_id = d.id) as mwst
  from public.nh_documents d join public.nh_document_payments p on p.document_id = d.id and p.method = 'cash'
  where d.kind = 'purchase' and d.status = 'reviewed'
  union all
  select d.restaurant_id, greatest(d.doc_date, to_date(d.period||'-01','YYYY-MM-DD')), d.period, d.created_at, 'beleg', d.id,
         'Einnahme ' || coalesce(d.supplier,'') || coalesce(' Nr. '||d.invoice_no,''), p.amount, 0,
         (select string_agg(distinct (t.rate::int)::text||'%', '/') from public.nh_document_taxes t where t.document_id = d.id)
  from public.nh_documents d join public.nh_document_payments p on p.document_id = d.id and p.method = 'cash'
  where d.kind = 'sales' and d.status = 'reviewed'
  union all
  select z.restaurant_id, z.z_date, z.period, z.created_at, 'zbon', z.id,
         'Bareinnahmen lt. Z-Bon ' || to_char(z.z_date,'DD.MM.YYYY') || coalesce(' Nr. '||z.z_no,''),
         z.cash_revenue, 0, '7%/19%'
  from public.nh_zbons z
  union all
  select z.restaurant_id, z.z_date, z.period, z.created_at, 'tip', z.id,
         'Auszahlung Trinkgeld (Karte) an Personal', 0, z.tip_card, null
  from public.nh_zbons z join public.nh_restaurants r on r.id = z.restaurant_id
  where r.tip_paid_cash and z.tip_card > 0
  union all
  select m.restaurant_id, m.move_date, m.period, m.created_at, 'move', m.id,
         case m.type when 'einlage' then 'Einlage' when 'privatentnahme' then 'Privatentnahme'
           when 'geldtransit' then 'Geldtransit an Bank' when 'sonstige_einnahme' then 'Sonstige Einnahme' else 'Sonstige Ausgabe' end
           || coalesce(': '||m.description,''),
         case when m.type in ('einlage','sonstige_einnahme') then m.amount else 0 end,
         case when m.type in ('privatentnahme','geldtransit','sonstige_ausgabe') then m.amount else 0 end, null
  from public.nh_cash_moves m
  where m.channel is distinct from 'viva'
  union all
  select v.restaurant_id, v.move_date, v.period, v.ts, 'move', v.id,
         'Kartenzahlung (Viva Wallet)', 0,
         greatest(0, v.amount - coalesce((select sum(z.total - z.cash_revenue) from public.nh_zbons z where z.restaurant_id = v.restaurant_id and z.z_date = v.move_date), 0)), null
  from (select m.restaurant_id, m.move_date, min(m.period) as period, max(m.created_at) as ts, (array_agg(m.id order by m.created_at))[1] as id, sum(m.amount) as amount
        from public.nh_cash_moves m where m.channel = 'viva' group by m.restaurant_id, m.move_date) v
)
select r.*,
  row_number() over (partition by r.restaurant_id, r.period order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source) as nr,
  rs.opening_cash + sum(r.einnahme - r.ausgabe) over (partition by r.restaurant_id order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source
     rows between unbounded preceding and current row) as saldo
from rows r join public.nh_restaurants rs on rs.id = r.restaurant_id
where rs.opening_date is null or r.entry_date >= rs.opening_date;

grant select on public.nh_kassenbuch to authenticated;
