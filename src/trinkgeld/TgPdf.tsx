// PDF „Trinkgeldabrechnung und Auszahlungsnachweis“ (A4 hoch). Fußzeile wie die Rechnungsvorlage (3 Spalten).
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { Company } from '../hoadon/types'
import { trimLogoUrl } from '../hoadon/logo'
import type { Line, Payment, Settlement } from './api'
import { deMonth, dmy, ermittlung, fmtEur, fmtH, isFinal, ROUNDING, STATUS } from './calc'

const MM = 2.835
const NAVY = '#1F3A5F'
const INK = '#1F1F1F'
const MUTED = '#6B6B6B'
const LINE = '#D9DEE5'
const SIDE = 18 * MM

const s = StyleSheet.create({
  page: { paddingTop: 14 * MM, paddingBottom: 40 * MM, paddingHorizontal: SIDE, fontSize: 9, fontFamily: 'Helvetica', color: INK, lineHeight: 1.3, backgroundColor: '#FFFFFF' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 * MM },
  logo: { width: 42 * MM, height: 20 * MM, objectFit: 'contain', objectPosition: 'left top' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, textAlign: 'right', maxWidth: 105 * MM },
  draft: { marginTop: 4, fontSize: 8.5, color: '#B42318', fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 0.75, borderColor: LINE, borderRadius: 3, padding: 6, marginBottom: 5 * MM },
  metaI: { width: '50%', flexDirection: 'row', paddingVertical: 1.5 },
  metaL: { width: 34 * MM, color: MUTED },
  metaV: { flex: 1, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 4 * MM, marginBottom: 2 * MM },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.2, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  kvB: { fontFamily: 'Helvetica-Bold' },
  kvTot: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 6, backgroundColor: '#EEF2F7', fontFamily: 'Helvetica-Bold' },
  note: { fontSize: 8.5, color: '#333', marginTop: 2 * MM, lineHeight: 1.4 },
  src: { fontSize: 7.8, color: MUTED, marginTop: 1.5 * MM },
  th: { flexDirection: 'row', backgroundColor: NAVY, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 4 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingHorizontal: 4, minHeight: 9 * MM, alignItems: 'center' },
  tf: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1.2, borderTopColor: NAVY, fontFamily: 'Helvetica-Bold' },
  cNr: { width: 8 * MM }, cName: { flex: 1, paddingRight: 4 }, cH: { width: 20 * MM, textAlign: 'right' }, cAmt: { width: 24 * MM, textAlign: 'right' },
  cDate: { width: 26 * MM, paddingLeft: 6, textAlign: 'center' }, cSig: { width: 42 * MM, marginLeft: 3 * MM },
  sigLine: { borderBottomWidth: 0.8, borderBottomColor: '#999', height: 7 * MM },
  sub: { fontSize: 7.5, color: MUTED },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 * MM },
  signBox: { width: '45%' },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: '#555', height: 12 * MM },
  signLbl: { fontSize: 8, color: MUTED, marginTop: 3 },
  footer: { position: 'absolute', bottom: 13 * MM, left: SIDE, right: SIDE, borderTopWidth: 0.75, borderTopColor: '#CFCFCF', paddingTop: 7, fontSize: 7.3, color: '#555', lineHeight: 1.45 },
  footerCols: { flexDirection: 'row', justifyContent: 'space-between' },
  footerCol: { width: '31%' },
  footerHead: { fontFamily: 'Helvetica-Bold', color: INK, marginBottom: 2 },
  pageNum: { position: 'absolute', top: 297 * MM - 9 * MM, left: SIDE, right: SIDE, textAlign: 'center', fontSize: 7.5, color: '#888' },
})

export interface TgPdfProps { company: Company; s: Settlement; lines: Line[]; payments: Payment[]; restaurantName: string; storno?: Settlement | null }

function KV({ l, v, b }: { l: string; v: string; b?: boolean }) {
  return <View style={s.kv} wrap={false}><Text style={b ? s.kvB : undefined}>{l}</Text><Text style={b ? s.kvB : undefined}>{v}</Text></View>
}

export function TgPdf({ company, s: st, lines, payments, restaurantName }: TgPdfProps) {
  const e = ermittlung(st)
  const active = payments.filter((p) => !p.cancelled_at)
  const paidOf = (l: Line) => active.filter((p) => p.line_id === l.id || (l.employee_id && p.employee_id === l.employee_id))
  const shown = lines.filter((l) => l.participates && (l.minutes > 0 || l.amount_cents > 0))
  const paidTotal = shown.reduce((sum, l) => sum + Math.min(l.amount_cents, paidOf(l).reduce((a, p) => a + p.amount_cents, 0)), 0)
  const register = [company.register_court ? `Amtsgericht ${company.register_court}` : '', company.register_number || ''].filter(Boolean).join(', ')
  const official = isFinal(st.status)
  const title = st.kind === 'storno' ? 'Stornobeleg zur Trinkgeldabrechnung' : st.kind === 'korrektur' ? 'Korrekturbeleg – Trinkgeldabrechnung und Auszahlungsnachweis' : 'Trinkgeldabrechnung und Auszahlungsnachweis'
  const meta: [string, string][] = [
    ['Firmenname', company.name || restaurantName], ['Beleg-Nr.', st.beleg_no],
    ['Betriebsstätte', st.betriebsstaette || restaurantName], ['Abrechnungsmonat', deMonth(st.period)],
    ['Abrechnungszeitraum', `${dmy(st.period_from)} – ${dmy(st.period_to)}`], ['Abrechnungsstichtag', dmy(st.stichtag)],
    ['Erstellungsdatum', dmy(st.created_on)], ['Status', STATUS[st.status]],
  ]
  return (
    <Document title={`${st.beleg_no} Trinkgeldabrechnung`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {company.logo_url ? <Image style={s.logo} src={company.logo_url} /> : <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 13 }}>{company.name}</Text>}
          <View>
            <Text style={s.title}>{title}</Text>
            {!official ? <Text style={s.draft}>ENTWURF – nicht festgeschrieben, kein gültiger Beleg</Text> : null}
          </View>
        </View>
        <View style={s.meta}>
          {meta.map(([l, v]) => <View key={l} style={s.metaI}><Text style={s.metaL}>{l}</Text><Text style={s.metaV}>{v}</Text></View>)}
        </View>
        {st.kind === 'storno' ? <Text style={s.note}>Dieser Beleg storniert die Abrechnung {st.remarks || ''}. Grund: {st.cancel_reason || '—'}</Text> : null}

        <Text style={s.h2} minPresenceAhead={60}>1. Ermittlung des Trinkgeldes</Text>
        <KV l="Kartenzahlungen laut Kartenterminal" v={fmtEur(st.terminal_cents)} />
        <KV l="Kartenzahlungen laut Z-Berichten" v={fmtEur(st.z_cents)} />
        <KV l="Differenz" v={fmtEur(e.differenz)} />
        {st.tip_source === 'pos' && st.pos_tip_cents != null ? <KV l="Trinkgeld lt. POS (separat erfasst, verwendet)" v={fmtEur(st.pos_tip_cents)} /> : null}
        <KV l={`Sonstige Korrekturen${st.correction_reason ? ` (${st.correction_reason})` : ''}`} v={fmtEur(st.correction_cents)} />
        <KV l="Kartentrinkgeld" v={fmtEur(e.karten)} b />
        <KV l="Bartrinkgeld" v={fmtEur(st.cash_tip_cents)} />
        <KV l="Übertrag aus Vormonat" v={fmtEur(st.carry_in_cents)} />
        <View style={s.kvTot} wrap={false}><Text>Verfügbares Trinkgeld</Text><Text>{fmtEur(e.available)}</Text></View>
        <Text style={s.src}>
          Datenquelle: {st.data_source || '—'}{st.z_from || st.z_to ? ` · Z-Berichte Nr. ${st.z_from || '?'} bis ${st.z_to || '?'}` : ''}
        </Text>

        <Text style={s.h2} minPresenceAhead={60}>2. Verteilungsschlüssel</Text>
        <KV l="Gesamtarbeitsstunden" v={fmtH(st.total_minutes)} />
        <KV l="Trinkgeld pro Arbeitsstunde" v={st.total_minutes ? `${(e.available / 100 / (st.total_minutes / 60)).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €` : '—'} />
        <KV l="Rundungsmethode" v={ROUNDING[st.rounding]} />
        <Text style={s.note}>Die Verteilung erfolgt gemäß der vereinbarten Trinkgeldregelung im Verhältnis der tatsächlich geleisteten Arbeitsstunden der teilnahmeberechtigten Mitarbeiter.</Text>

        <Text style={s.h2} minPresenceAhead={80}>3. Trinkgeld-Verteilung und Empfangsbestätigung</Text>
        <View>
          <View style={s.th} fixed>
            <Text style={s.cNr}>Nr.</Text><Text style={s.cName}>Mitarbeiter</Text><Text style={s.cH}>Stunden</Text>
            <Text style={s.cAmt}>Betrag (€)</Text><Text style={s.cDate}>Empfangsdatum</Text><Text style={s.cSig}>Unterschrift</Text>
          </View>
          {shown.map((l, i) => {
            const ps = paidOf(l)
            return (
              <View key={l.id} style={s.tr} wrap={false}>
                <Text style={s.cNr}>{i + 1}</Text>
                <View style={s.cName}>
                  <Text>{[l.last_name, l.first_name].filter(Boolean).join(', ')}</Text>
                  {l.personnel_no || l.exit_date ? <Text style={s.sub}>{[l.personnel_no && `Pers.-Nr. ${l.personnel_no}`, l.exit_date && `Austritt ${dmy(l.exit_date)}`].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                <Text style={s.cH}>{fmtH(l.minutes, false)}</Text>
                <Text style={s.cAmt}>{fmtEur(l.amount_cents, false)}</Text>
                <Text style={s.cDate}>{ps.map((p) => dmy(p.paid_on)).filter((v, j, a) => a.indexOf(v) === j).join('\n')}</Text>
                <View style={s.cSig}><View style={s.sigLine} /></View>
              </View>
            )
          })}
          <View style={s.tf} wrap={false}>
            <Text style={s.cNr} /><Text style={s.cName}>Summe ({shown.length} Mitarbeiter)</Text><Text style={s.cH}>{fmtH(st.total_minutes, false)}</Text>
            <Text style={s.cAmt}>{fmtEur(st.payout_cents, false)}</Text><Text style={s.cDate} /><Text style={s.cSig} />
          </View>
        </View>
        <Text style={s.note}>Mit ihrer Unterschrift bestätigen die Mitarbeiter den tatsächlichen Erhalt des jeweils ausgewiesenen Trinkgeldbetrags.</Text>

        <View wrap={false}>
          <Text style={s.h2}>4. Zusammenfassung</Text>
          <KV l="Verfügbares Trinkgeld" v={fmtEur(e.available)} />
          <KV l="Gesamter Verteilungsbetrag" v={fmtEur(st.payout_cents)} />
          <KV l="Tatsächlich ausgezahlter Betrag" v={fmtEur(paidTotal)} />
          <KV l="Noch auszuzahlender Betrag" v={fmtEur(st.payout_cents - paidTotal)} />
          <KV l="Rundungsbedingter Restbetrag" v={fmtEur(st.rest_cents)} />
          <KV l="Übertrag auf Folgemonat" v={fmtEur(st.rest_cents)} b />
          <Text style={s.note}>Der rundungsbedingte Restbetrag verbleibt im Trinkgeldpool und wird bei der nächsten Trinkgeldverteilung berücksichtigt.</Text>
          <Text style={s.note}>Die freiwilligen Trinkgelder der Gäste werden treuhänderisch für die Mitarbeiter vereinnahmt und weitergeleitet. Bei Vorliegen der gesetzlichen Voraussetzungen sind sie gemäß § 3 Nr. 51 EStG steuerfrei.</Text>
        </View>

        <View style={s.signRow} wrap={false}>
          <View style={s.signBox}><View style={s.signLine} /><Text style={s.signLbl}>Ort, Datum</Text></View>
          <View style={s.signBox}><View style={s.signLine} /><Text style={s.signLbl}>Geschäftsführung / Unterschrift</Text></View>
        </View>

        <View style={s.footer} fixed>
          <View style={s.footerCols}>
            <View style={s.footerCol}>
              <Text style={s.footerHead}>Kontaktdaten</Text>
              <Text>{company.name}</Text>
              {company.street ? <Text>{company.street}</Text> : null}
              <Text>{[company.zip, company.city].filter(Boolean).join(' ')}</Text>
              {company.phone ? <Text>Tel. {company.phone}</Text> : null}
              {company.email ? <Text>{company.email}</Text> : null}
              {company.website ? <Text>{company.website.replace(/^https?:\/\//, '')}</Text> : null}
            </View>
            <View style={s.footerCol}>
              <Text style={s.footerHead}>Unternehmensdaten</Text>
              {company.managing_director ? <Text>Geschäftsführer: {company.managing_director}</Text> : null}
              {register ? <Text>{register}</Text> : null}
              {company.vat_id ? <Text>USt-IdNr.: {company.vat_id}</Text> : null}
              {company.tax_number ? <Text>Steuernummer: {company.tax_number}</Text> : null}
            </View>
            <View style={s.footerCol}>
              <Text style={s.footerHead}>Bankverbindung</Text>
              {company.account_holder ? <Text>Kontoinhaber: {company.account_holder}</Text> : null}
              {company.bank_name ? <Text>{company.bank_name}</Text> : null}
              {company.iban ? <Text>IBAN: {company.iban}</Text> : null}
              {company.bic ? <Text>BIC: {company.bic}</Text> : null}
            </View>
          </View>
        </View>
        <Text style={s.pageNum} fixed render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  )
}

export async function renderTgPdf(p: TgPdfProps): Promise<Blob> {
  const company = p.company.logo_url ? { ...p.company, logo_url: await trimLogoUrl(p.company.logo_url) } : p.company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(createElement(TgPdf, { ...p, company }) as any).toBlob()
}

/** Auszahlungsbeleg (Quittung) für eine einzelne Auszahlung */
export function ReceiptPdf({ company, s: st, line, payment }: { company: Company; s: Settlement; line: Line; payment: Payment }) {
  const name = [line.first_name, line.last_name].filter(Boolean).join(' ')
  return (
    <Document title={`Auszahlungsbeleg ${st.beleg_no} ${name}`} author={company.name}>
      <Page size="A5" orientation="landscape" style={{ ...s.page, paddingBottom: 14 * MM, paddingTop: 10 * MM }}>
        <View style={s.head}>
          {company.logo_url ? <Image style={{ ...s.logo, width: 32 * MM, height: 14 * MM }} src={company.logo_url} /> : <Text style={{ fontFamily: 'Helvetica-Bold' }}>{company.name}</Text>}
          <Text style={s.title}>Auszahlungsbeleg Trinkgeld</Text>
        </View>
        <KV l="Beleg-Nr. Abrechnung" v={st.beleg_no} />
        <KV l="Abrechnungsmonat" v={deMonth(st.period)} />
        <KV l="Mitarbeiter" v={`${name}${line.personnel_no ? ` (Pers.-Nr. ${line.personnel_no})` : ''}`} />
        <KV l="Auszahlungsbetrag" v={fmtEur(payment.amount_cents)} b />
        <KV l="Tatsächliches Auszahlungsdatum" v={dmy(payment.paid_on)} />
        <KV l="Auszahlungsart" v={payment.method === 'bar' ? 'Barauszahlung' : 'Banküberweisung'} />
        {payment.receipt_no ? <KV l="Kassenbelegnummer" v={payment.receipt_no} /> : null}
        {payment.booking_ref ? <KV l="Buchungsreferenz" v={payment.booking_ref} /> : null}
        {payment.paid_by ? <KV l="Ausgezahlt durch" v={payment.paid_by} /> : null}
        <Text style={s.note}>Hiermit bestätige ich den Erhalt des oben genannten Trinkgeldbetrags.</Text>
        <View style={{ ...s.signRow, marginTop: 10 * MM }} wrap={false}>
          <View style={s.signBox}><View style={s.signLine} /><Text style={s.signLbl}>Ort, Datum</Text></View>
          <View style={s.signBox}><View style={s.signLine} /><Text style={s.signLbl}>Unterschrift Mitarbeiter/in</Text></View>
        </View>
        <Text style={{ ...s.pageNum, top: undefined, bottom: 5 * MM }} fixed>{[company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</Text>
      </Page>
    </Document>
  )
}
export async function renderReceipt(p: { company: Company; s: Settlement; line: Line; payment: Payment }): Promise<Blob> {
  const company = p.company.logo_url ? { ...p.company, logo_url: await trimLogoUrl(p.company.logo_url) } : p.company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(createElement(ReceiptPdf, { ...p, company }) as any).toBlob()
}
