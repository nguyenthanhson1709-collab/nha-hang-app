// Trinkgeld: Datenbank (PGlite) – Rechte, Festschreiben, Duplikate, Auszahlungen, Kassenbestand, Korrektur/Storno, Protokoll.
// npx tsx tests/trinkgeld-db.mts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
grant usage on schema public, auth, storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`)
const mig = ['001_nh_schema.sql', '003_nh_hardening.sql', '004_nh_kassenbuch_order.sql', '005_nh_cash_moves_channel.sql', '009_nh_card_source.sql', '010_nh_credit_note.sql', '011_nh_credit_ref.sql', '012_nh_hr.sql', '013_nh_hr_personnel_no.sql']
for (const f of mig) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
for (const f of ['027_nh_viva_card_tip_zbon.sql', '028_nh_viva_month_tip.sql', '037_nh_viva_tip_without_zbon.sql']) {
  try { await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8')) } catch (e) { console.log(`(übersprungen ${f}: ${(e as Error).message.slice(0, 80)})`) }
}
await db.exec(readFileSync('supabase/migrations/038_nh_trinkgeld.sql', 'utf8'))
await db.exec(readFileSync('supabase/migrations/038_nh_trinkgeld.sql', 'utf8')) // zweimal: sicher wiederholbar
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;`)

const O = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const E1 = 'e1111111-1111-4111-8111-111111111111', E2 = 'e2222222-2222-4222-8222-222222222222'
await db.exec(`insert into auth.users(id,email) values ('${O}','o@t'),('${M}','m@t'),('${S}','s@t');
update public.nh_profiles set is_owner = true where id = '${O}';
insert into public.nh_restaurants(id,name,opening_cash) values ('${A}','A',150);
insert into public.nh_members values ('${A}','${M}','manager',now()),('${A}','${S}','staff',now());
insert into public.nh_employees(id, restaurant_id, last_name, first_name) values ('${E1}','${A}','Nguyen','An'),('${E2}','${A}','Tran','Binh');`)

let fails = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
async function as<T>(uid: string, fn: () => Promise<T>): Promise<T | Error> {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`)
  try { const r = await fn(); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return e as Error }
}
const q = (s: string, p: unknown[] = []) => db.query(s, p).then((r) => r.rows as Record<string, unknown>[])
const err = (x: unknown, re: RegExp) => x instanceof Error && re.test(x.message)
const newSet = (uid: string, beleg: string, extra = '') => as(uid, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, betriebsstaette, period_from, period_to, stichtag, available_cents, total_minutes, payout_cents, rest_cents, terminal_cents, z_cents ${extra ? ',' + extra.split('=')[0] : ''})
  values ($1,'2026-10',$2,'A','2026-10-01','2026-10-31','2026-10-31', 30050, 600, 30000, 50, 130050, 100000 ${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [A, beleg]))

// Anlegen als Verantwortlicher (Entwurf)
const s1 = await newSet(M, 'TG-2026-10')
ok(!(s1 instanceof Error), 'Verantwortlicher legt Abrechnung als Entwurf an')
const sid = (s1 as Record<string, unknown>[])[0].id as string
const lines = await as(M, () => q(`insert into nh_tg_lines(settlement_id, restaurant_id, employee_id, first_name, last_name, minutes_auto, minutes, amount_cents)
  values ($1,$2,$3,'An','Nguyen',360,360,18000),($1,$2,$4,'Binh','Tran',240,240,12000) returning id`, [sid, A, E1, E2])) as Record<string, unknown>[]
const L1 = lines[0].id as string, L2 = lines[1].id as string

ok(err(await newSet(M, 'TG-2026-10-2'), /nh_tg_one_official/), 'Keine zweite gültige Abrechnung im selben Monat / Betriebsstätte')
ok(err(await newSet(O, 'TG-2026-10'), /duplicate|unique/), 'Doppelte Beleg-Nr. abgelehnt')
const staffSees = await as(S, () => q(`select count(*)::int n from nh_tg_settlements`))
ok(!(staffSees instanceof Error) && staffSees[0].n === 0, 'Mitarbeiter (staff) sieht keine Trinkgelddaten')
const staffLines = await as(S, () => q(`select count(*)::int n from nh_tg_lines`))
ok(!(staffLines instanceof Error) && staffLines[0].n === 0, 'Mitarbeiter sieht keine Beträge anderer')

ok(err(await as(M, () => q(`update nh_tg_lines set minutes = 300 where id = $1`, [L1])), /Begründung/), 'Stunden ändern ohne Begründung abgelehnt')
ok(!(await as(M, () => q(`update nh_tg_lines set minutes = 360, edit_reason = null where id = $1`, [L1])) instanceof Error), 'Stunden = Zeiterfassung ohne Begründung ok')
ok(!(await as(M, () => q(`update nh_tg_lines set minutes = 300, edit_reason = 'Stempelfehler 15.10.' where id = $1`, [L1])) instanceof Error), 'Stunden ändern mit Begründung ok')
await as(M, () => q(`update nh_tg_lines set minutes = 360, edit_reason = 'zurück' where id = $1`, [L1]))

ok(err(await as(M, () => q(`select nh_tg_pay($1, 1000, current_date, 'bar', '', '', '', '', true)`, [L1])), /Festschreiben/), 'Auszahlung vor Festschreiben abgelehnt')
ok(!((await as(M, () => q(`update nh_tg_settlements set status='geprueft' where id=$1`, [sid]))) instanceof Error), 'Verantwortlicher markiert als geprüft')
ok(err(await as(M, () => q(`update nh_tg_settlements set status='festgeschrieben' where id=$1`, [sid])), /Geschäftsführung/), 'Nur Geschäftsführung kann festschreiben')
await as(O, () => q(`update nh_tg_settlements set total_minutes = 0 where id=$1`, [sid]))
ok(err(await as(O, () => q(`update nh_tg_settlements set status='festgeschrieben' where id=$1`, [sid])), /Gesamtstunden = 0/), 'Gesamtstunden 0: Festschreiben blockiert')
await as(O, () => q(`update nh_tg_settlements set total_minutes = 600, payout_cents = 40000 where id=$1`, [sid]))
ok(err(await as(O, () => q(`update nh_tg_settlements set status='festgeschrieben' where id=$1`, [sid])), /übersteigt/), 'Verteilung > verfügbar: Festschreiben blockiert')
await as(O, () => q(`update nh_tg_settlements set payout_cents = 30000 where id=$1`, [sid]))
const lk = await as(O, () => q(`update nh_tg_settlements set status='festgeschrieben' where id=$1 returning locked_by, checked_by`, [sid]))
ok(!(lk instanceof Error) && lk[0].locked_by === O && lk[0].checked_by === M, 'Festgeschrieben, Prüfer und Festschreiber protokolliert')

ok(err(await as(O, () => q(`update nh_tg_settlements set terminal_cents = 1 where id=$1`, [sid])), /Festgeschriebene/), 'Festgeschrieben: Zahlen nicht änderbar (auch nicht von Geschäftsführung)')
ok(err(await as(O, () => q(`delete from nh_tg_settlements where id=$1`, [sid])), /Entwürfe/), 'Festgeschrieben: kein Löschen')
ok(err(await as(O, () => q(`update nh_tg_lines set participates = false where id=$1`, [L2])), /festgeschrieben/), 'Festgeschrieben: Mitarbeiterzeilen gesperrt')

// Auszahlungen
const p1 = await as(M, () => q(`select nh_tg_pay($1, 10000, current_date - 2, 'bar', 'K-1', '', 'Chef', '', true) id`, [L1]))
ok(!(p1 instanceof Error), 'Teilauszahlung bar erfasst')
const mv = await q(`select description, amount::float a, channel, move_date from nh_cash_moves where channel='trinkgeld'`)
ok(mv.length === 1 && mv[0].a === 100 && /Trinkgeld-Auszahlung 10\/2026 – An Nguyen – TG-2026-10/.test(String(mv[0].description)), 'Kassenbuch-Eintrag „Trinkgeld-Auszahlung 10/2026 – Name – TG-2026-10“')
ok((await q(`select status from nh_tg_settlements where id=$1`, [sid]))[0].status === 'teilweise', 'Status: Teilweise ausgezahlt')
ok(err(await as(M, () => q(`select nh_tg_pay($1, 9000, current_date, 'bar', '', '', '', '', true)`, [L1])), /offenen Betrag/), 'Überzahlung abgelehnt')
ok(err(await as(M, () => q(`select nh_tg_pay($1, 8000, current_date, 'bar', '', '', '', '', true)`, [L1])), /Kassenbestand reicht nicht/), 'Nicht genug Bargeld in der Kasse: abgelehnt (kein negativer Bestand)')
ok(err(await as(M, () => q(`select nh_tg_pay($1, 100, current_date + 3, 'bar', '', '', '', '', true)`, [L1])), /Zukunft/), 'Auszahlungsdatum in der Zukunft abgelehnt')
ok(!(await as(M, () => q(`select nh_tg_pay($1, 8000, current_date - 1, 'ueberweisung', '', 'SEPA-123', '', '', true)`, [L1])) instanceof Error), 'Restzahlung per Überweisung (kein Kassenbuch-Eintrag)')
ok((await q(`select count(*)::int n from nh_cash_moves where channel='trinkgeld'`))[0].n === 1, 'Überweisung bucht nichts im Kassenbuch')
ok(err(await as(M, () => q(`delete from nh_cash_moves where channel='trinkgeld'`)), /nh_tg_payments|foreign key/), 'Verknüpfter Kassenbuch-Eintrag kann nicht direkt gelöscht werden')
{ const x = await as(M, () => q(`delete from nh_tg_payments returning id`)); ok(err(x, /stornieren/) || (Array.isArray(x) && x.length === 0), 'Auszahlungen können nicht gelöscht werden') }
ok((await q(`select count(*)::int n from nh_tg_payments`))[0].n === 2, 'Auszahlungen bleiben erhalten')
ok(!(await as(M, () => q(`select nh_tg_pay($1, 12000, current_date, 'ueberweisung', '', '', '', '', false)`, [L2])) instanceof Error), 'Zweiter Mitarbeiter ausgezahlt')
ok((await q(`select status from nh_tg_settlements where id=$1`, [sid]))[0].status === 'ausgezahlt', 'Status: Vollständig ausgezahlt')

const pid = (p1 as Record<string, unknown>[])[0].id as string
ok(err(await as(M, () => q(`select nh_tg_cancel_payment($1, 'falsch')`, [pid])), /Geschäftsführung/), 'Nur Geschäftsführung storniert Auszahlungen')
ok(!(await as(O, () => q(`select nh_tg_cancel_payment($1, 'doppelt erfasst')`, [pid])) instanceof Error), 'Auszahlung storniert')
ok((await q(`select count(*)::int n from nh_cash_moves where channel='trinkgeld'`))[0].n === 0 && (await q(`select status from nh_tg_settlements where id=$1`, [sid]))[0].status === 'teilweise', 'Storno entfernt Kassenbuch-Eintrag, Status zurück auf teilweise')

// Korrektur / Storno
ok(err(await as(O, () => q(`update nh_tg_settlements set status='storniert', cancel_reason='x' where id=$1`, [sid])), /Auszahlungen/), 'Storno mit Auszahlungen abgelehnt (Korrekturbeleg nötig)')
const k1 = await as(O, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, kind, ref_id, betriebsstaette, period_from, period_to, stichtag, available_cents, total_minutes, payout_cents, rest_cents)
  values ($1,'2026-10','TG-2026-10-K1','korrektur',$2,'A','2026-10-01','2026-10-31','2026-10-31',30050,600,30000,50) returning id`, [A, sid]))
ok(!(k1 instanceof Error), 'Korrekturbeleg TG-2026-10-K1 verknüpft angelegt')
ok(err(await as(O, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, kind, ref_id, betriebsstaette, period_from, period_to, stichtag) values ($1,'2026-10','TG-2026-10-K2','korrektur',$2,'A','2026-10-01','2026-10-31','2026-10-31')`, [A, sid])), /nh_tg_one_correction/), 'Nur ein offener Korrekturbeleg je Ursprungsbeleg')
ok(err(await as(O, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, kind, betriebsstaette, period_from, period_to, stichtag) values ($1,'2026-10','TG-X','korrektur','A','2026-10-01','2026-10-31','2026-10-31')`, [A])), /Ursprungsbeleg/), 'Korrektur ohne Ursprungsbeleg abgelehnt')
ok(err(await as(M, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, kind, ref_id, betriebsstaette, period_from, period_to, stichtag) values ($1,'2026-10','TG-2026-10-S1','storno',$2,'A','2026-10-01','2026-10-31','2026-10-31')`, [A, sid])), /Geschäftsführung/), 'Storno nur durch Geschäftsführung')
const kid = (k1 as Record<string, unknown>[])[0].id as string
await as(O, () => q(`insert into nh_tg_lines(settlement_id, restaurant_id, employee_id, first_name, last_name, minutes_auto, minutes, amount_cents) values ($1,$2,$3,'An','Nguyen',360,360,18000),($1,$2,$4,'Binh','Tran',240,240,12000)`, [kid, A, E1, E2]))
ok(!(await as(O, () => q(`update nh_tg_settlements set status='festgeschrieben' where id=$1`, [kid])) instanceof Error), 'Korrekturbeleg festgeschrieben')
ok(!(await as(O, () => q(`update nh_tg_settlements set status='korrigiert' where id=$1`, [sid])) instanceof Error), 'Ursprungsbeleg bleibt erhalten, Status „Korrigiert“')
const kl = await q(`select id from nh_tg_lines where settlement_id=$1 and employee_id=$2`, [kid, E1])
ok(err(await as(M, () => q(`select nh_tg_pay($1, 10001, current_date, 'ueberweisung', '', '', '', '', false)`, [kl[0].id])), /offenen Betrag/), 'Zahlungen des Ursprungsbelegs zählen in der Korrektur (keine Doppelzahlung)')
ok(!(await as(M, () => q(`select nh_tg_pay($1, 10000, current_date, 'ueberweisung', '', '', '', '', false)`, [kl[0].id])) instanceof Error), 'Restbetrag über Korrekturbeleg ausgezahlt')
ok((await q(`select status from nh_tg_settlements where id=$1`, [kid]))[0].status === 'ausgezahlt', 'Korrekturbeleg: Vollständig ausgezahlt (Zahlungen der Kette)')

// Protokoll
const au = await as(M, () => q(`select tbl, action, old_values, new_values, reason from nh_tg_audit where settlement_id=$1 order by id`, [sid]))
ok(!(au instanceof Error) && au.some((a) => a.tbl === 'nh_tg_lines' && a.reason === 'Stempelfehler 15.10.' && (a.old_values as Record<string, unknown>).minutes === 360 && (a.new_values as Record<string, unknown>).minutes === 300), 'Protokoll: alte/neue Stunden mit Begründung')
ok(!(au instanceof Error) && au.some((a) => a.tbl === 'nh_tg_settlements' && (a.new_values as Record<string, unknown>).status === 'festgeschrieben'), 'Protokoll: Statuswechsel')
const sa = await as(S, () => q(`select count(*)::int n from nh_tg_audit`))
ok(!(sa instanceof Error) && sa[0].n === 0, 'Protokoll für Mitarbeiter nicht sichtbar')

// Entwurf löschen erlaubt
const s2 = await newSet(O, 'TG-2026-09', "period='2026-09'")
void s2
const d2 = await as(O, () => q(`insert into nh_tg_settlements(restaurant_id, period, beleg_no, betriebsstaette, period_from, period_to, stichtag) values ($1,'2026-09','TG-2026-09','A','2026-09-01','2026-09-30','2026-09-30') returning id`, [A]))
ok(!(d2 instanceof Error) && !(await as(O, () => q(`delete from nh_tg_settlements where id=$1`, [(d2 as Record<string, unknown>[])[0].id])) instanceof Error), 'Entwurf kann gelöscht werden')

console.log(fails ? `\n${fails} Fehler` : '\nAlle Trinkgeld-Datenbanktests OK')
process.exit(fails ? 1 : 0)
