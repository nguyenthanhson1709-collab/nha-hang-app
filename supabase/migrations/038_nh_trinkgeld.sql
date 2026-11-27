-- 038: Module Trinkgeld (Trinkgeldabrechnung und Auszahlungsnachweis), theo từng quán.
-- Quyền: Chủ + Người phụ trách (nh_can_manage) xem / soạn; chỉ Chủ được Festschreiben, Korrektur, Storno, Einstellungen.
-- Số tiền lưu bằng cent (bigint), giờ lưu bằng phút (integer) để không có sai số.
-- Viết không dùng DROP để chạy lại an toàn. Không đổi dữ liệu ngoài module (chỉ thêm cột konto vào nh_cash_moves).

-- ===== Einstellungen (1 dòng / quán) =====
create table if not exists public.nh_tg_settings (
  restaurant_id uuid primary key references public.nh_restaurants(id) on delete cascade,
  rounding text not null default 'euro' check (rounding in ('cent','euro','euro5')),
  betriebsstaette text,
  konto_trinkgeld text,          -- Konto für Trinkgeld-Auszahlung (lt. Steuerberater), z. B. Durchlaufposten
  konto_kasse text,              -- Gegenkonto Kasse (lt. Steuerberater)
  kassenbuch boolean not null default true,  -- Barauszahlung als Kassenbuch-Eintrag buchen
  updated_at timestamptz not null default now()
);

-- ===== Monatsabrechnung =====
create table if not exists public.nh_tg_settlements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.nh_restaurants(id) on delete restrict,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  beleg_no text not null,
  kind text not null default 'original' check (kind in ('original','korrektur','storno')),
  ref_id uuid references public.nh_tg_settlements(id) on delete restrict,   -- Korrektur/Storno -> Ursprungsbeleg
  status text not null default 'entwurf' check (status in ('entwurf','geprueft','festgeschrieben','teilweise','ausgezahlt','korrigiert','storniert')),
  betriebsstaette text not null default '',
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  stichtag date not null,
  created_on date not null default current_date,
  tip_source text not null default 'differenz' check (tip_source in ('differenz','pos')),
  terminal_cents bigint not null default 0,      -- Kartenzahlungen lt. Kartenterminal
  z_cents bigint not null default 0,             -- Kartenzahlungen lt. Z-Berichten
  pos_tip_cents bigint,                          -- Trinkgeld lt. POS (falls separat erfasst)
  z_from text, z_to text,
  cash_tip_cents bigint not null default 0 check (cash_tip_cents >= 0),
  carry_in_cents bigint not null default 0,
  correction_cents bigint not null default 0,
  correction_reason text,
  remarks text,
  tip_confirmed boolean not null default false,  -- Differenz als Trinkgeld geprüft und bestätigt
  rounding text not null default 'euro' check (rounding in ('cent','euro','euro5')),
  available_cents bigint not null default 0,
  total_minutes integer not null default 0,
  payout_cents bigint not null default 0,
  rest_cents bigint not null default 0,
  data_source text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  checked_by uuid, checked_at timestamptz,
  locked_by uuid, locked_at timestamptz,
  updated_by uuid, updated_at timestamptz not null default now(),
  cancel_reason text,
  unique (restaurant_id, beleg_no)
);
create index if not exists nh_tg_settlements_rest on public.nh_tg_settlements(restaurant_id, period);
-- Pro Monat und Betriebsstätte höchstens eine gültige offizielle Abrechnung
create unique index if not exists nh_tg_one_official on public.nh_tg_settlements(restaurant_id, period, betriebsstaette)
  where kind = 'original' and status not in ('storniert','korrigiert');
-- Je Ursprungsbeleg höchstens ein offener (nicht festgeschriebener) Korrekturbeleg
create unique index if not exists nh_tg_one_correction on public.nh_tg_settlements(ref_id)
  where kind = 'korrektur' and status in ('entwurf','geprueft');

-- ===== Mitarbeiter-Zeilen =====
create table if not exists public.nh_tg_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.nh_tg_settlements(id) on delete cascade,
  restaurant_id uuid not null,
  employee_id uuid references public.nh_employees(id) on delete set null,
  personnel_no text, first_name text not null default '', last_name text not null default '',
  emp_type text, department text, exit_date date,
  minutes_auto integer not null default 0 check (minutes_auto >= 0),   -- aus Zeiterfassung
  minutes integer not null default 0 check (minutes >= 0),             -- verwendet
  edit_reason text,
  participates boolean not null default true,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  sort integer not null default 0
);
create index if not exists nh_tg_lines_set on public.nh_tg_lines(settlement_id);

-- ===== Auszahlungen (nur tatsächliche Zahlungen, nie automatisch) =====
create table if not exists public.nh_tg_payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.nh_tg_settlements(id) on delete restrict,
  line_id uuid not null references public.nh_tg_lines(id) on delete restrict,
  restaurant_id uuid not null,
  employee_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null check (method in ('bar','ueberweisung')),
  receipt_no text, booking_ref text, paid_by text, remarks text,
  files text[] not null default '{}',
  cash_move_id uuid unique references public.nh_cash_moves(id) on delete restrict,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists nh_tg_payments_set on public.nh_tg_payments(settlement_id);

-- ===== Anhänge / Archiv =====
create table if not exists public.nh_tg_files (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.nh_tg_settlements(id) on delete restrict,
  restaurant_id uuid not null,
  kind text not null check (kind in ('terminal','zbericht','abstimmung','arbeitszeit','sonstige','abrechnung','signiert','auszahlung','korrektur')),
  path text not null unique,
  name text not null default '',
  payment_id uuid references public.nh_tg_payments(id) on delete restrict,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists nh_tg_files_set on public.nh_tg_files(settlement_id);

-- ===== Änderungsprotokoll =====
create table if not exists public.nh_tg_audit (
  id bigserial primary key,
  restaurant_id uuid not null,
  settlement_id uuid,
  tbl text not null, row_id uuid, action text not null,
  old_values jsonb, new_values jsonb, reason text,
  by_user uuid default auth.uid(), at timestamptz not null default now()
);
create index if not exists nh_tg_audit_set on public.nh_tg_audit(settlement_id, at);

-- Kassenbuch: Konto pro Bewegung (für Trinkgeld-Auszahlung lt. Einstellungen)
alter table public.nh_cash_moves add column if not exists konto text;

-- ===== Trigger =====
create or replace function public.nh_tg_is_final(s text) returns boolean language sql immutable as $$
  select s in ('festgeschrieben','teilweise','ausgezahlt','korrigiert','storniert')
$$;

-- Abrechnung: nach Festschreiben nur noch Status ändern (Zahlungen / Korrektur / Storno), kein Löschen
create or replace function public.nh_tg_guard_settlement() returns trigger
language plpgsql security definer set search_path = public as $$
declare keep text[] := array['status','updated_at','updated_by','cancel_reason'];
begin
  if tg_op = 'INSERT' then
    if new.kind = 'storno' then
      if not public.nh_is_owner() then raise exception 'NH_TG_ROLE: Nur die Geschäftsführung kann stornieren'; end if;
      new.status := 'festgeschrieben'; new.locked_by := auth.uid(); new.locked_at := now();
    elsif new.status <> 'entwurf' then raise exception 'NH_TG_STATE: Neue Abrechnung beginnt als Entwurf';
    end if;
    if new.kind <> 'original' and new.ref_id is null then raise exception 'NH_TG_REF: Korrektur/Storno braucht einen Ursprungsbeleg'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then raise exception 'NH_TG_LOCKED: Nur Entwürfe können gelöscht werden'; end if;
    if exists (select 1 from public.nh_tg_payments p where p.settlement_id = old.id) then
      raise exception 'NH_TG_LOCKED: Abrechnung mit Auszahlungen kann nicht gelöscht werden';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if public.nh_tg_is_final(old.status) and (to_jsonb(new) - keep) <> (to_jsonb(old) - keep) then
      raise exception 'NH_TG_LOCKED: Festgeschriebene Abrechnung kann nicht geändert werden (Korrektur- oder Stornobeleg erstellen)';
    end if;
    if not public.nh_tg_is_final(old.status) and public.nh_tg_is_final(new.status) then
      if not public.nh_is_owner() then raise exception 'NH_TG_ROLE: Nur die Geschäftsführung kann festschreiben'; end if;
      if new.kind <> 'storno' then
        if new.total_minutes <= 0 then raise exception 'NH_TG_HOURS: Gesamtstunden = 0, Festschreiben nicht möglich'; end if;
        if new.payout_cents > new.available_cents then raise exception 'NH_TG_SUM: Verteilung übersteigt verfügbares Trinkgeld'; end if;
        if new.payout_cents <> coalesce((select sum(amount_cents) from public.nh_tg_lines l where l.settlement_id = new.id and l.participates), 0) then
          raise exception 'NH_TG_SUM: Summe der Mitarbeiterbeträge stimmt nicht';
        end if;
      end if;
      new.locked_by := auth.uid(); new.locked_at := now();
    end if;
    if old.status = 'entwurf' and new.status = 'geprueft' then new.checked_by := auth.uid(); new.checked_at := now(); end if;
    if old.status = 'geprueft' and new.status = 'entwurf' then new.checked_by := null; new.checked_at := null; end if;
    if new.status in ('korrigiert','storniert') and old.status not in ('korrigiert','storniert') and not public.nh_is_owner() then
      raise exception 'NH_TG_ROLE: Nur die Geschäftsführung kann korrigieren oder stornieren';
    end if;
    if new.status = 'storniert' and old.status <> 'storniert' and exists (select 1 from public.nh_tg_payments p where p.settlement_id = old.id and p.cancelled_at is null) then
      raise exception 'NH_TG_PAID: Abrechnung mit Auszahlungen kann nicht storniert werden (Korrekturbeleg erstellen)';
    end if;
    new.updated_by := auth.uid(); new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.nh_tg_guard_child() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid; st text;
begin
  sid := case when tg_op = 'DELETE' then old.settlement_id else new.settlement_id end;
  select status into st from public.nh_tg_settlements where id = sid;
  if tg_table_name = 'nh_tg_lines' then
    if public.nh_tg_is_final(st) then raise exception 'NH_TG_LOCKED: Abrechnung ist festgeschrieben'; end if;
    if tg_op = 'UPDATE' and new.minutes <> old.minutes and new.minutes <> new.minutes_auto and coalesce(btrim(new.edit_reason),'') = '' then
      raise exception 'NH_TG_REASON: Für geänderte Stunden ist eine Begründung erforderlich';
    end if;
  elsif tg_table_name = 'nh_tg_files' then
    if tg_op = 'DELETE' and (public.nh_tg_is_final(st) or old.kind = 'signiert') then
      raise exception 'NH_TG_LOCKED: Belege einer festgeschriebenen Abrechnung können nicht gelöscht werden';
    end if;
    if tg_op = 'UPDATE' then raise exception 'NH_TG_LOCKED: Belege können nicht überschrieben werden'; end if;
  elsif tg_table_name = 'nh_tg_payments' then
    if tg_op = 'DELETE' then raise exception 'NH_TG_LOCKED: Auszahlungen können nicht gelöscht werden (stornieren)'; end if;
    if tg_op = 'INSERT' and st not in ('festgeschrieben','teilweise','ausgezahlt') then
      raise exception 'NH_TG_STATE: Auszahlungen erst nach dem Festschreiben';
    end if;
    if tg_op = 'UPDATE' and ((to_jsonb(new) - array['cancelled_at','cancelled_by','cancel_reason','files','cash_move_id']) <> (to_jsonb(old) - array['cancelled_at','cancelled_by','cancel_reason','files','cash_move_id'])) then
      raise exception 'NH_TG_LOCKED: Auszahlung kann nicht geändert werden';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Protokoll: alte und neue Werte (nur geänderte Felder)
create or replace function public.nh_tg_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; k text; oc jsonb := '{}'; nc jsonb := '{}'; sid uuid; rsn text;
begin
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','updated_by') and (o -> k) is distinct from (n -> k) then
        oc := oc || jsonb_build_object(k, o -> k); nc := nc || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if nc = '{}'::jsonb then return new; end if;
  else oc := o; nc := n; end if;
  sid := case when tg_table_name = 'nh_tg_settlements' then coalesce(n, o) ->> 'id' else coalesce(n, o) ->> 'settlement_id' end;
  rsn := coalesce(n ->> 'edit_reason', n ->> 'cancel_reason', n ->> 'correction_reason');
  insert into public.nh_tg_audit(restaurant_id, settlement_id, tbl, row_id, action, old_values, new_values, reason)
  values ((coalesce(n, o) ->> 'restaurant_id')::uuid, sid, tg_table_name, (coalesce(n, o) ->> 'id')::uuid, lower(tg_op), oc, nc, rsn);
  return coalesce(new, old);
end $$;
revoke execute on function public.nh_tg_guard_settlement(), public.nh_tg_guard_child(), public.nh_tg_log() from public, anon, authenticated;

do $$
declare t text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'nh_tg_settlements_guard') then
    create trigger nh_tg_settlements_guard before insert or update or delete on public.nh_tg_settlements for each row execute function public.nh_tg_guard_settlement();
  end if;
  foreach t in array array['nh_tg_lines','nh_tg_files','nh_tg_payments'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_guard') then
      execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.nh_tg_guard_child()', t || '_guard', t);
    end if;
  end loop;
  foreach t in array array['nh_tg_settlements','nh_tg_lines','nh_tg_payments','nh_tg_files'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_log') then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.nh_tg_log()', t || '_log', t);
    end if;
  end loop;
end $$;

-- ===== Auszahlung erfassen (atomar): prüft offenen Betrag, Kassenbestand, legt Kassenbuch-Eintrag an =====
create or replace function public.nh_tg_pay(p_line uuid, p_amount bigint, p_date date, p_method text, p_receipt text, p_ref text,
  p_by text, p_remarks text, p_kassenbuch boolean) returns uuid
language plpgsql security invoker set search_path = public as $$
declare l record; s record; paid bigint; due bigint; mv uuid; pid uuid; bal numeric; lowest numeric; amt numeric; konto text; txt text;
begin
  select * into l from public.nh_tg_lines where id = p_line;
  if l.id is null then raise exception 'NH_TG_NOTFOUND'; end if;
  select * into s from public.nh_tg_settlements where id = l.settlement_id;
  if not public.nh_can_manage(s.restaurant_id) then raise exception 'NH_TG_ROLE'; end if;
  if s.status not in ('festgeschrieben','teilweise','ausgezahlt') then raise exception 'NH_TG_STATE: Auszahlungen erst nach dem Festschreiben'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'NH_TG_AMOUNT: Betrag muss größer als 0 sein'; end if;
  if p_date is null or p_date > current_date then raise exception 'NH_TG_DATE: Tatsächliches Auszahlungsdatum angeben (nicht in der Zukunft)'; end if;
  -- bereits gezahlt für diese Person in der ganzen Belegkette (Ursprungsbeleg + Korrekturen)
  select coalesce(sum(p.amount_cents), 0) into paid from public.nh_tg_payments p
    join public.nh_tg_lines pl on pl.id = p.line_id
    join public.nh_tg_settlements ps on ps.id = p.settlement_id
   where p.cancelled_at is null
     and (pl.id = l.id or (l.employee_id is not null and pl.employee_id = l.employee_id))
     and coalesce(ps.ref_id, ps.id) = coalesce(s.ref_id, s.id);
  due := l.amount_cents - paid;
  if p_amount > due then raise exception 'NH_TG_OVERPAY: Betrag übersteigt den offenen Betrag (% Cent offen)', greatest(due, 0); end if;
  insert into public.nh_tg_payments(settlement_id, line_id, restaurant_id, employee_id, amount_cents, paid_on, method, receipt_no, booking_ref, paid_by, remarks)
  values (s.id, l.id, s.restaurant_id, l.employee_id, p_amount, p_date, p_method, nullif(btrim(p_receipt),''), nullif(btrim(p_ref),''), nullif(btrim(p_by),''), nullif(btrim(p_remarks),''))
  returning id into pid;
  if p_method = 'bar' and p_kassenbuch then
    amt := p_amount / 100.0;
    -- Kassenbestand am Auszahlungstag und an allen späteren Tagen darf nicht negativ werden
    select k.saldo into bal from public.nh_kassenbuch k where k.restaurant_id = s.restaurant_id and k.entry_date <= p_date order by k.entry_date desc, k.nr desc limit 1;
    if bal is null then select coalesce(opening_cash, 0) into bal from public.nh_restaurants where id = s.restaurant_id; end if;
    select min(k.saldo) into lowest from public.nh_kassenbuch k where k.restaurant_id = s.restaurant_id and k.entry_date > p_date;
    if least(bal, coalesce(lowest, bal)) - amt < 0 then
      raise exception 'NH_TG_CASH: Kassenbestand reicht nicht (Bestand % €)', to_char(least(bal, coalesce(lowest, bal)), 'FM999G999G990D00');
    end if;
    select st.konto_trinkgeld into konto from public.nh_tg_settings st where st.restaurant_id = s.restaurant_id;
    txt := 'Trinkgeld-Auszahlung ' || substr(s.period, 6, 2) || '/' || substr(s.period, 1, 4) || ' – ' || btrim(l.first_name || ' ' || l.last_name) || ' – ' || s.beleg_no;
    insert into public.nh_cash_moves(restaurant_id, move_date, period, type, amount, description, channel, konto)
    values (s.restaurant_id, p_date, to_char(p_date, 'YYYY-MM'), 'sonstige_ausgabe', amt, txt, 'trinkgeld', nullif(konto, ''))
    returning id into mv;
    update public.nh_tg_payments set cash_move_id = mv where id = pid;
  end if;
  perform public.nh_tg_refresh_status(s.id);
  return pid;
end $$;

-- Auszahlung stornieren (falsch erfasst): Kassenbuch-Eintrag wird entfernt, solange der Monat nicht abgeschlossen ist
create or replace function public.nh_tg_cancel_payment(p_id uuid, p_reason text) returns void
language plpgsql security invoker set search_path = public as $$
declare p record; mv uuid;
begin
  select * into p from public.nh_tg_payments where id = p_id;
  if p.id is null or p.cancelled_at is not null then raise exception 'NH_TG_NOTFOUND'; end if;
  if not public.nh_is_owner() then raise exception 'NH_TG_ROLE: Nur die Geschäftsführung kann Auszahlungen stornieren'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'NH_TG_REASON: Begründung erforderlich'; end if;
  mv := p.cash_move_id;
  update public.nh_tg_payments set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason, cash_move_id = null where id = p_id;
  if mv is not null then delete from public.nh_cash_moves where id = mv; end if;
  perform public.nh_tg_refresh_status(p.settlement_id);
end $$;

-- Status nach Zahlungen: festgeschrieben -> teilweise -> ausgezahlt
create or replace function public.nh_tg_refresh_status(p_sid uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare s record; total bigint; paid bigint; st text;
begin
  select * into s from public.nh_tg_settlements where id = p_sid;
  if s.status not in ('festgeschrieben','teilweise','ausgezahlt') then return; end if;
  select coalesce(sum(amount_cents), 0) into total from public.nh_tg_lines where settlement_id = p_sid and participates;
  select coalesce(sum(p.amount_cents), 0) into paid from public.nh_tg_payments p where p.cancelled_at is null
    and p.settlement_id in (select id from public.nh_tg_settlements x where coalesce(x.ref_id, x.id) = coalesce(s.ref_id, s.id))
    and (p.line_id in (select id from public.nh_tg_lines where settlement_id = p_sid)
      or p.employee_id in (select employee_id from public.nh_tg_lines where settlement_id = p_sid and participates));
  st := case when paid <= 0 then 'festgeschrieben' when paid >= total then 'ausgezahlt' else 'teilweise' end;
  if st <> s.status then update public.nh_tg_settlements set status = st where id = p_sid; end if;
end $$;
revoke execute on function public.nh_tg_pay(uuid,bigint,date,text,text,text,text,text,boolean), public.nh_tg_cancel_payment(uuid,text), public.nh_tg_refresh_status(uuid) from public, anon;
grant execute on function public.nh_tg_pay(uuid,bigint,date,text,text,text,text,text,boolean), public.nh_tg_cancel_payment(uuid,text), public.nh_tg_refresh_status(uuid) to authenticated;

-- ===== RLS =====
do $$
declare t text;
begin
  foreach t in array array['nh_tg_settings','nh_tg_settlements','nh_tg_lines','nh_tg_payments','nh_tg_files','nh_tg_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  grant select, insert, update, delete on public.nh_tg_settlements, public.nh_tg_lines, public.nh_tg_files to authenticated;
  grant select, insert, update on public.nh_tg_settings, public.nh_tg_payments to authenticated;
  grant select on public.nh_tg_audit to authenticated;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_tg_settings' and policyname = 'nh_tg_settings_sel') then
    create policy nh_tg_settings_sel on public.nh_tg_settings for select to authenticated using (public.nh_can_manage(restaurant_id));
    create policy nh_tg_settings_ins on public.nh_tg_settings for insert to authenticated with check (public.nh_is_owner());
    create policy nh_tg_settings_upd on public.nh_tg_settings for update to authenticated using (public.nh_is_owner()) with check (public.nh_is_owner());
  end if;
  foreach t in array array['nh_tg_settlements','nh_tg_lines','nh_tg_files'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_all') then
      execute format('create policy %I on public.%I for all to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id))', t || '_all', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_tg_payments' and policyname = 'nh_tg_payments_sel') then
    create policy nh_tg_payments_sel on public.nh_tg_payments for select to authenticated using (public.nh_can_manage(restaurant_id));
    create policy nh_tg_payments_ins on public.nh_tg_payments for insert to authenticated with check (public.nh_can_manage(restaurant_id));
    create policy nh_tg_payments_upd on public.nh_tg_payments for update to authenticated using (public.nh_can_manage(restaurant_id)) with check (public.nh_can_manage(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'nh_tg_audit' and policyname = 'nh_tg_audit_sel') then
    create policy nh_tg_audit_sel on public.nh_tg_audit for select to authenticated using (public.nh_can_manage(restaurant_id));
  end if;
end $$;

-- ===== Kho file riêng tư: <restaurant_id>/<settlement_id>/<uuid>.<ext> — chỉ thêm, không ghi đè =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('nh-trinkgeld', 'nh-trinkgeld', false, 20971520)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_tg_files_sel') then
    create policy nh_tg_files_sel on storage.objects for select to authenticated
      using (bucket_id = 'nh-trinkgeld' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_tg_files_ins') then
    create policy nh_tg_files_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'nh-trinkgeld' and public.nh_can_manage(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'nh_tg_files_del') then
    create policy nh_tg_files_del on storage.objects for delete to authenticated
      using (bucket_id = 'nh-trinkgeld' and public.nh_can_manage(((storage.foldername(name))[1])::uuid)
        and not exists (select 1 from public.nh_tg_files f where f.path = name));
  end if;
end $$;
