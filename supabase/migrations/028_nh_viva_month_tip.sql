-- 028: Quán "Theo Viva Wallet" (người dùng chốt 2026-11-26 17:08):
-- Kartenzahlung = số Viva từng ngày, KHÔNG có dòng Trinkgeld từng ngày.
-- Một dòng cả tháng "Trinkgeld von Viva Wallet" (Einnahmen) = Σ Viva − Σ Kreditzahlung, ngày cuối tháng.
create or replace view public.nh_kassenbuch with (security_invoker = true) as
with rows as (
  select d.restaurant_id, greatest(d.doc_date, to_date(d.period||'-01','YYYY-MM-DD')) as entry_date, d.period,
         d.created_at as sort_ts, 'beleg'::text as source, d.id as source_id,
         case when d.is_credit then 'Gutschrift ' else '' end || coalesce(d.supplier,'Beleg') || coalesce(' Nr. '||d.invoice_no,'') ||
           case when d.doc_date < to_date(d.period||'-01','YYYY-MM-DD') then ' (Belegdatum '||to_char(d.doc_date,'DD.MM.YYYY')||')' else '' end as text,
         case when d.is_credit then p.amount::numeric else 0 end as einnahme, case when d.is_credit then 0 else p.amount::numeric end as ausgabe,
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
         z.cash_revenue - coalesce(z.transfer_pos, 0), 0, '7%/19%'
  from public.nh_zbons z
  union all
  select z.restaurant_id, z.z_date, z.period, z.created_at, 'tip', z.id,
         'Auszahlung Trinkgeld (Karte) an Personal', 0, case when z.tip_card > 0 then z.tip_card else z.tip end, null
  from public.nh_zbons z join public.nh_restaurants r on r.id = z.restaurant_id
  where r.card_source is distinct from 'viva' and (z.tip_card > 0 or z.tip > 0)
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
         'Kartenzahlung (Viva Wallet − Kreditzahlung)',
         case when v.card_z is null then 0 else greatest(0, v.card_z - v.amount) end,
         case when v.card_z is null then v.amount else greatest(0, v.amount - v.card_z) end, null
  from (select m.restaurant_id, m.move_date, min(m.period) as period, max(m.created_at) as ts, (array_agg(m.id order by m.created_at))[1] as id, sum(m.amount) as amount,
               (select sum(z.total - z.cash_revenue) from public.nh_zbons z where z.restaurant_id = m.restaurant_id and z.z_date = m.move_date) as card_z
        from public.nh_cash_moves m join public.nh_restaurants rr on rr.id = m.restaurant_id
        where m.channel = 'viva' and rr.card_source = 'viva' group by m.restaurant_id, m.move_date) v
  union all
  -- Một dòng cả tháng: Trinkgeld von Viva Wallet = Σ Viva − Σ Kreditzahlung (các ngày có cả Viva và Z-Bon)
  select t.restaurant_id, (to_date(t.period||'-01','YYYY-MM-DD') + interval '1 month' - interval '1 day')::date, t.period, now(), 'vivatip', t.restaurant_id,
         'Trinkgeld von Viva Wallet', greatest(0, t.diff), greatest(0, -t.diff), null
  from (select m.restaurant_id, m.period, sum(m.amount) - sum(z.card) as diff
        from (select restaurant_id, move_date, min(period) as period, sum(amount) as amount from public.nh_cash_moves where channel = 'viva' group by restaurant_id, move_date) m
        join (select restaurant_id, z_date, sum(total - cash_revenue) as card from public.nh_zbons group by restaurant_id, z_date) z on z.restaurant_id = m.restaurant_id and z.z_date = m.move_date
        join public.nh_restaurants rr on rr.id = m.restaurant_id
        where rr.card_source = 'viva'
        group by m.restaurant_id, m.period) t
  where t.diff <> 0
)
select r.*,
  row_number() over (partition by r.restaurant_id, r.period order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source) as nr,
  rs.opening_cash + sum(r.einnahme - r.ausgabe) over (partition by r.restaurant_id order by r.entry_date, case when r.source = 'zbon' then 2 when r.source = 'tip' then 3 when r.source = 'move' and r.ausgabe > 0 then 4 else 1 end, r.sort_ts, r.source_id, r.source
     rows between unbounded preceding and current row) as saldo
from rows r join public.nh_restaurants rs on rs.id = r.restaurant_id
where rs.opening_date is null or r.entry_date >= rs.opening_date;
