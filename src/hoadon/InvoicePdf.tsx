import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { isPeriod } from './types'
import { T, companyText } from './pdfText'
import type { Company, Invoice, InvoiceItem } from './types'
import { addDays, computeTotals, fmt, fmtDate, fmtQty, netOf, round2 } from './money'
import { fillTemplate } from './template'
import { countryName } from './countries'
import { qrReference } from './girocode'

// A4 = 595 × 842 pt; 1 mm ≈ 2,835 pt
const MM = 2.835
const ACCENT = '#F88712'
const INK = '#1F1F1F'
const MUTED = '#6B6B6B'
const LINE = '#E3E3E3'
const SHADE = '#F2F2F2'
const SIDE = 20 * MM // Rand links/rechts 20 mm
const TOP = 15 * MM // Rand oben 15 mm
// DIN 5008 Form B: Anschriftfeld 45–90 mm von oben, 20 mm von links, 85 mm breit; Zusatz- und Vermerkzone 17,7 mm
const ADDR_TOP = 45 * MM
const ADDR_H = 45 * MM
const ADDR_W = 85 * MM
const NOTE_ZONE = 17.7 * MM

const s = StyleSheet.create({
  page: { paddingTop: TOP, paddingBottom: 44 * MM, paddingHorizontal: SIDE, fontSize: 9.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.3 },
  header: { height: ADDR_TOP - TOP, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 42 * MM, height: 21 * MM, objectFit: 'contain', objectPosition: 'left top' },
  titleBox: { alignItems: 'flex-end' },
  title: { fontSize: 24, fontFamily: 'Helvetica-Bold', letterSpacing: 1, lineHeight: 1 },
  titleNr: { fontSize: 10, color: MUTED, marginTop: 6 },
  titleBar: { width: 44, height: 2, backgroundColor: ACCENT, marginTop: 5 },

  addrRow: { height: ADDR_H, flexDirection: 'row', justifyContent: 'space-between' },
  addrCol: { width: ADDR_W },
  noteZone: { height: NOTE_ZONE, justifyContent: 'flex-end', paddingBottom: 4 },
  sender: { fontSize: 7, color: MUTED, textDecoration: 'underline' },
  recipient: { fontSize: 10.5, lineHeight: 1.35 },
  recipientName: { fontFamily: 'Helvetica-Bold' },
  meta: { width: 76 * MM, paddingTop: NOTE_ZONE - 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.2 },
  metaLabel: { color: MUTED, fontSize: 9 },
  metaValue: { fontFamily: 'Helvetica-Bold', fontSize: 9, textAlign: 'right' },

  intro: { marginTop: 4 * MM, marginBottom: 4 * MM, fontSize: 10, lineHeight: 1.4 },

  th: { flexDirection: 'row', backgroundColor: SHADE, borderBottomWidth: 1.5, borderBottomColor: ACCENT, paddingVertical: 6, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  cPos: { width: 28 },
  cName: { flex: 1, paddingRight: 8 },
  cQty: { width: 42, textAlign: 'right' },
  cUnit: { width: 48, paddingLeft: 8 },
  cPrice: { width: 66, textAlign: 'right' },
  cTotal: { width: 70, textAlign: 'right' },
  desc: { color: MUTED, fontSize: 8.5, marginTop: 2 },

  sums: { alignSelf: 'flex-end', width: 92 * MM, marginTop: 5 * MM },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 10, fontSize: 10 },
  sumLabel: { color: '#444' },
  sumSub: { color: MUTED, fontSize: 8.5 },
  grandBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: SHADE, paddingVertical: 9, paddingHorizontal: 10, marginTop: 6 },
  grandLabel: { fontFamily: 'Helvetica-Bold', fontSize: 11.5 },
  grandValue: { fontFamily: 'Helvetica-Bold', fontSize: 15 },

  closing: { marginTop: 6 * MM, fontSize: 10, lineHeight: 1.45 },

  payBox: { flexDirection: 'row', alignItems: 'center', marginTop: 5 * MM, borderWidth: 0.75, borderColor: LINE, borderRadius: 6, padding: 10 },
  qr: { width: 27 * MM, height: 27 * MM, marginRight: 14 },
  payTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 3 },
  payText: { color: MUTED, fontSize: 8.5, marginBottom: 5 },
  payRow: { flexDirection: 'row', fontSize: 8.5, paddingVertical: 0.8 },
  payLabel: { width: 84, color: MUTED },

  footer: { position: 'absolute', bottom: 14 * MM, left: SIDE, right: SIDE, borderTopWidth: 0.75, borderTopColor: '#CFCFCF', paddingTop: 8, fontSize: 7.5, color: '#555', lineHeight: 1.45 },
  footerCols: { flexDirection: 'row', justifyContent: 'space-between' },
  footerCol: { width: '31%' },
  footerHead: { fontFamily: 'Helvetica-Bold', color: INK, marginBottom: 2 },
  pageNum: { position: 'absolute', top: 297 * MM - 11 * MM, left: SIDE, right: SIDE, textAlign: 'center', fontSize: 7.5, color: '#888' },
})

export interface InvoicePdfProps {
  company: Company
  invoice: Invoice
  items: InvoiceItem[]
  qrDataUrl?: string | null
}

const rateLabel = (r: number) => fmt(r).replace(',00', '')

export function InvoicePdf({ company, invoice, items, qrDataUrl }: InvoicePdfProps) {
  const totals = computeTotals(items, invoice.price_mode ?? 'gross')
  const lang = invoice.language === 'en' ? 'en' : 'de'
  const t = T[lang]
  const c = invoice.customer_snapshot
  const vars = { tage: String(company.payment_days), nummer: invoice.invoice_number ?? '', firma: company.name, gueltig: fmtDate(invoice.due_date) }
  const isDraft = !invoice.invoice_number
  const isQuote = invoice.doc_type === 'quote'
  const isNet = invoice.price_mode === 'net'
  const unitPrice = (it: InvoiceItem) => isNet ? round2(netOf(it.unit_price_gross, it.tax_rate)) : Number(it.unit_price_gross)
  const lineTotal = (it: InvoiceItem) => round2(Number(it.quantity) * unitPrice(it))
  const docTitle = isQuote ? (isDraft ? t.quoteDraft : t.quote) : (isDraft ? t.draft : t.invoice)
  // Finalisierte Rechnungen haben immer due_date; Entwürfe zeigen dasselbe Datum, das beim Abschluss gesetzt würde
  const dueDate = invoice.due_date || (!isQuote && invoice.invoice_date ? addDays(invoice.invoice_date, company.payment_days ?? 7) : null)
  const manyRates = totals.taxGroups.length > 1
  const hasDelivery = invoice.delivery_type && invoice.delivery_type !== 'none' && invoice.delivery_date
  const register = [company.register_court ? `${t.court} ${company.register_court}` : '', company.register_number ? (/^\d/.test(company.register_number) ? `HRB ${company.register_number}` : company.register_number) : ''].filter(Boolean).join(', ')
  const senderLine = [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')

  const meta: [string, string][] = [
    [isQuote ? t.quoteNumber : t.number, invoice.invoice_number ?? '—'],
    ...(c.customer_number ? [[t.customerNo, String(c.customer_number)] as [string, string]] : []),
    [isQuote ? t.quoteDate : t.date, fmtDate(invoice.invoice_date)],
    ...(hasDelivery ? [[t.delivery[invoice.delivery_type], `${fmtDate(invoice.delivery_date)}${isPeriod(invoice.delivery_type) && invoice.delivery_end ? ` – ${fmtDate(invoice.delivery_end)}` : ''}`] as [string, string]] : []),
    ...(invoice.service_period ? [[t.service, invoice.service_period] as [string, string]] : []),
    ...(dueDate ? [[isQuote ? t.validUntil : t.dueDate, fmtDate(dueDate)] as [string, string]] : []),
  ]

  return (
    <Document title={`${isQuote ? t.quote : t.invoice} ${invoice.invoice_number ?? t.draftShort}`} author={company.name}>
      <Page size="A4" style={s.page}>
        {/* Kopf: Logo links, Titel rechts */}
        <View style={s.header}>
          <View>{company.logo_url ? <Image style={s.logo} src={company.logo_url} /> : <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14 }}>{company.name}</Text>}</View>
          <View style={s.titleBox}>
            <Text style={s.title}>{docTitle.toUpperCase()}</Text>
            {invoice.invoice_number ? <Text style={s.titleNr}>{t.nr} {invoice.invoice_number}</Text> : null}
            <View style={s.titleBar} />
          </View>
        </View>

        {/* Anschriftfeld (DIN 5008 Form B) links, Rechnungsdaten rechts */}
        <View style={s.addrRow}>
          <View style={s.addrCol}>
            <View style={s.noteZone}><Text style={s.sender}>{senderLine}</Text></View>
            <View style={s.recipient}>
              <Text style={s.recipientName}>{c.name}</Text>
              {c.supplement ? <Text>{c.supplement}</Text> : null}
              {c.supplement2 ? <Text>{c.supplement2}</Text> : null}
              {c.street ? <Text>{c.street}</Text> : null}
              <Text>{[c.zip, c.city].filter(Boolean).join(' ')}</Text>
              {c.country && c.country !== 'DE' ? <Text>{countryName(c.country)}</Text> : null}
            </View>
          </View>
          <View style={s.meta}>
            {meta.map(([k, v]) => (
              <View style={s.metaRow} key={k}><Text style={s.metaLabel}>{k}</Text><Text style={s.metaValue}>{v}</Text></View>
            ))}
          </View>
        </View>

        <Text style={s.intro}>{fillTemplate(invoice.intro_text || companyText(company, lang, 'intro_text', invoice.doc_type), vars)}</Text>

        {/* Positionen: Kopfzeile wiederholt sich auf jeder Seite, Zeilen werden nicht getrennt */}
        <View>
          <View style={s.th} fixed>
            <Text style={s.cPos}>{t.pos}</Text>
            <Text style={s.cName}>{t.desc}</Text>
            <Text style={s.cQty}>{t.qty}</Text>
            <Text style={s.cUnit}>{t.unit}</Text>
            <Text style={s.cPrice}>{isNet ? t.priceNet : t.price}</Text>
            <Text style={s.cTotal}>{isNet ? t.totalNet : t.total}</Text>
          </View>
          {items.map((it, i) => (
            <View style={s.tr} key={i} wrap={false}>
              <Text style={s.cPos}>{i + 1}</Text>
              <View style={s.cName}>
                <Text>{it.name}</Text>
                {it.description ? <Text style={s.desc}>{it.description}</Text> : null}
              </View>
              <Text style={s.cQty}>{fmtQty(Number(it.quantity))}</Text>
              <Text style={s.cUnit}>{it.unit}</Text>
              <Text style={s.cPrice}>{fmt(unitPrice(it))}</Text>
              <Text style={s.cTotal}>{fmt(lineTotal(it))}</Text>
            </View>
          ))}
        </View>

        {/* Summen: Netto, USt je Steuersatz, Gesamtbetrag */}
        <View style={s.sums} wrap={false}>
          <View style={s.sumRow}><Text style={s.sumLabel}>{t.netSum}</Text><Text>{fmt(totals.net)} €</Text></View>
          {totals.taxGroups.map((g) => (
            <View style={s.sumRow} key={g.rate}>
              <Text style={s.sumLabel}>
                {g.rate === 0 ? t.noVat : t.vatLine(rateLabel(g.rate))}
                {manyRates ? <Text style={s.sumSub}>  {t.vatOn(fmt(g.net))}</Text> : null}
              </Text>
              <Text>{fmt(g.tax)} €</Text>
            </View>
          ))}
          <View style={s.grandBox}><Text style={s.grandLabel}>{t.grand}</Text><Text style={s.grandValue}>{fmt(totals.gross)} €</Text></View>
        </View>

        <Text style={s.closing}>{fillTemplate(invoice.closing_text || companyText(company, lang, 'closing_text', invoice.doc_type), vars)}</Text>

        {/* Zahlung: QR links, Hinweise rechts (nur Rechnungen) */}
        {!isQuote && company.iban ? (
          <View style={s.payBox} wrap={false}>
            {qrDataUrl ? <Image style={s.qr} src={qrDataUrl} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={s.payTitle}>{qrDataUrl ? t.qrTitle : t.payTitle}</Text>
              {qrDataUrl ? <Text style={s.payText}>{t.qrText}</Text> : null}
              <View style={s.payRow}><Text style={s.payLabel}>{t.recipient}</Text><Text>{company.account_holder || company.name}</Text></View>
              <View style={s.payRow}><Text style={s.payLabel}>IBAN</Text><Text>{company.iban}</Text></View>
              {company.bic ? <View style={s.payRow}><Text style={s.payLabel}>BIC</Text><Text>{company.bic}</Text></View> : null}
              {invoice.invoice_number ? <View style={s.payRow}><Text style={s.payLabel}>{t.reference}</Text><Text>{qrReference(invoice.invoice_number)}</Text></View> : null}
              <View style={s.payRow}><Text style={s.payLabel}>{t.amount}</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{fmt(totals.gross)} €</Text></View>
            </View>
          </View>
        ) : null}

        {/* Fußzeile: fest am Seitenende */}
        <View style={s.footer} fixed>
          <View style={s.footerCols}>
          <View style={s.footerCol}>
            <Text style={s.footerHead}>{t.fContact}</Text>
            <Text>{company.name}</Text>
            {company.street ? <Text>{company.street}</Text> : null}
            <Text>{[company.zip, company.city].filter(Boolean).join(' ')}</Text>
            {company.phone ? <Text>{t.phone} {company.phone}</Text> : null}
            {company.email ? <Text>{company.email}</Text> : null}
            {company.website ? <Text>{company.website.replace(/^https?:\/\//, '')}</Text> : null}
          </View>
          <View style={s.footerCol}>
            <Text style={s.footerHead}>{t.fCompany}</Text>
            {company.managing_director ? <Text>{t.md}: {company.managing_director}</Text> : null}
            {register ? <Text>{register}</Text> : null}
            {company.vat_id ? <Text>{t.vatId}: {company.vat_id}</Text> : null}
            {company.tax_number ? <Text>{t.taxNo}: {company.tax_number}</Text> : null}
          </View>
          <View style={s.footerCol}>
            <Text style={s.footerHead}>{t.fBank}</Text>
            {company.account_holder ? <Text>{t.holder}: {company.account_holder}</Text> : null}
            {company.bank_name ? <Text>{company.bank_name}</Text> : null}
            {company.iban ? <Text>IBAN: {company.iban}</Text> : null}
            {company.bic ? <Text>BIC: {company.bic}</Text> : null}
          </View>
          </View>
        </View>
        <Text style={s.pageNum} fixed render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  )
}
