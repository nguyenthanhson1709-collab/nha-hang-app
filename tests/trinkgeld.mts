// Trinkgeld: Berechnung (Cent, Rundung, Verteilung, Stunden, Belegnummern). npx tsx tests/trinkgeld.mts
import { belegNo, distribute, ermittlung, fmtEur, fmtH, monthMinutes, parseHours, payState, pdfName, archiveDir } from '../src/trinkgeld/calc'

let fails = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const L = (minutes: number, participates = true) => ({ minutes, participates })

// Formate
ok(fmtEur(887806) === '8.878,06 €', 'Geld: 8.878,06 €')
ok(fmtH(12480) === '208,00 h', 'Stunden: 208,00 h')
ok(parseHours('208,5') === 12510 && parseHours('7:30') === 450 && parseHours('x') === null, 'Stunden-Eingabe 208,5 / 7:30')

// Ermittlung: Differenz Terminal − Z, Korrekturen, Bar, Übertrag
const e = ermittlung({ tip_source: 'differenz', terminal_cents: 2_600_000, z_cents: 2_500_000, pos_tip_cents: null, correction_cents: -5_000, cash_tip_cents: 20_000, carry_in_cents: 1_234 })
ok(e.differenz === 100_000 && e.karten === 95_000 && e.available === 116_234, 'Kartendifferenz + Korrektur + Bar + Übertrag')
const ep = ermittlung({ tip_source: 'pos', terminal_cents: 2_600_000, z_cents: 2_500_000, pos_tip_cents: 98_000, correction_cents: 0, cash_tip_cents: 0, carry_in_cents: 0 })
ok(ep.karten === 98_000 && ep.posMismatch === -2_000, 'POS-Trinkgeld vorrangig, Abweichung zur Terminal-Differenz gemeldet')

// Keine Mitarbeiter / 0 Stunden
let d = distribute(100_000, [], 'euro')
ok(d.payout === 0 && d.rest === 100_000 && d.totalMinutes === 0, 'Keine Mitarbeiter: nichts verteilt, alles Übertrag')
d = distribute(100_000, [L(0), L(0)], 'cent')
ok(d.totalMinutes === 0 && d.payout === 0, 'Gesamtstunden 0: keine Verteilung')

// Rundung: nur Endbetrag, Summe ≤ verfügbar, Rest = Übertrag
const lines = [L(12480), L(9000), L(4530), L(600, false), L(1)]
for (const r of ['cent', 'euro', 'euro5'] as const) {
  d = distribute(887_806, lines, r)
  const step = r === 'cent' ? 1 : r === 'euro' ? 100 : 500
  ok(d.payout <= 887_806 && d.payout + d.rest === 887_806 && d.amounts.every((a) => a % step === 0), `Rundung ${r}: Summe ≤ verfügbar, Rest ${fmtEur(d.rest)}`)
  ok(d.amounts[3] === 0, `Rundung ${r}: nicht teilnehmender Mitarbeiter erhält 0`)
}
d = distribute(887_806, lines, 'cent')
ok(d.totalMinutes === 26011 && d.amounts[0] === Math.floor(887_806 * 12480 / 26011), 'Centgenau = abgerundeter Anteil nach Stunden (kein gerundeter Stundensatz)')
ok(d.rest < lines.length, 'Centgenau: Rundungsrest < 1 Cent je Mitarbeiter')
// Gleitkomma-Falle: 0,1 + 0,2
d = distribute(30, [L(1), L(1), L(1)], 'cent')
ok(d.amounts.join() === '10,10,10' && d.rest === 0, 'Ganzzahl-Cent ohne Gleitkommafehler')
d = distribute(-500, [L(60)], 'euro')
ok(d.payout === 0, 'Negatives Trinkgeld: nichts verteilt')
// Großer Betrag, exakt (BigInt)
d = distribute(99_999_999, [L(99_999), L(1)], 'cent')
ok(d.payout <= 99_999_999 && d.amounts[0] === Math.floor(99_999_999 * 99_999 / 100_000), 'Große Beträge exakt')

// Stunden aus Zeiterfassung: Pause abgezogen, Urlaub/Krank nicht, Austritt im Monat zählt
const sh = (employee_id: string, shift_date: string, start_time: string, end_time: string, break_min = 0) => ({ id: shift_date + employee_id, employee_id, shift_date, start_time, end_time, break_min, note: null })
const mm = monthMinutes([
  sh('a', '2026-10-01', '10:00', '18:30', 30), sh('a', '2026-10-02', '17:00', '01:00', 0), sh('a', '2026-10-05', '10:00', '15:00'),
  sh('b', '2026-10-03', '11:00', '15:00'), sh('b', '2026-09-30', '11:00', '15:00'),
], [{ employee_id: 'a', from_date: '2026-10-05', to_date: '2026-10-06', kind: 'vacation' }], '2026-10')
ok(mm.get('a')!.minutes === 480 + 480 && mm.get('a')!.skipped === 1, 'Pause abgezogen, Nachtschicht über Mitternacht, Urlaubstag nicht gezählt')
ok(mm.get('b')!.minutes === 240, 'Schicht im Vormonat nicht gezählt (Austritt im Monat: Stunden bis Austritt)')

// Belegnummern, keine Duplikate
ok(belegNo('2026-10', 'original', []) === 'TG-2026-10', 'Beleg-Nr. TG-2026-10')
ok(belegNo('2026-10', 'original', ['TG-2026-10']) === 'TG-2026-10-2', 'Neue Abrechnung nach Storno: TG-2026-10-2')
ok(belegNo('2026-10', 'korrektur', ['TG-2026-10', 'TG-2026-10-K1']) === 'TG-2026-10-K2', 'Korrekturbeleg -K2')
ok(belegNo('2026-10', 'storno', ['TG-2026-10']) === 'TG-2026-10-S1', 'Stornobeleg -S1')
ok(pdfName('TG-2026-10', 'Vietbowl Mitte GmbH') === 'TG-2026-10_Vietbowl-Mitte-GmbH_Trinkgeldabrechnung.pdf', 'Dateiname nach Vorgabe')
ok(archiveDir('2026-10') === 'Trinkgeld/2026/10-Oktober', 'Archivordner Trinkgeld/2026/10-Oktober')

// Auszahlungsstatus, mehrere Zahlungen
ok(payState(10_000, 0) === 'offen' && payState(10_000, 4_000) === 'teilweise' && payState(10_000, 10_000) === 'ausgezahlt' && payState(0, 0) === null, 'Status Offen / Teilweise / Ausgezahlt')

console.log(fails ? `\n${fails} Fehler` : '\nAlle Trinkgeld-Berechnungen OK')
process.exit(fails ? 1 : 0)
