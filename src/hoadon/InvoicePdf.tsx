import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { isPeriod } from './types'
import { T, companyText } from './pdfText'
import type { Company, Invoice, InvoiceItem } from './types'
import { computeTotals, fmt, fmtDate, fmtQty, netOf, round2 } from './money'
import { fillTemplate } from './template'
import { countryName } from './countries'

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 110, paddingHorizontal: 50, fontSize: 9, fontFamily: 'Helvetica', color: '#222' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  logo: { width: 140, height: 60, objectFit: 'contain' },
  metaBox: { alignItems: 'flex-end' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  metaLine: { flexDirection: 'row', marginBottom: 1 },
  metaLabel: { width: 80, textAlign: 'right', marginRight: 10 },
  metaValue: { minWidth: 70, textAlign: 'right' },
  addrRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  sender: { fontSize: 7, textDecoration: 'underline', marginBottom: 6, color: '#555' },
  recipient: { fontSize: 10, lineHeight: 1.35 },
  companyBlock: { alignItems: 'flex-end', fontSize: 9, lineHeight: 1.35 },
  intro: { marginTop: 40, marginBottom: 14, fontSize: 10 },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 4, fontFamily: 'Helvetica-Bold' },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#ccc' },
  cPos: { width: 30 },
  cName: { flex: 1, paddingRight: 8 },
  cQty: { width: 45, textAlign: 'right' },
  cUnit: { width: 45, paddingLeft: 8 },
  cPrice: { width: 60, textAlign: 'right' },
  cTotal: { width: 65, textAlign: 'right' },
  desc: { color: '#555', marginTop: 2 },
  totalRow: { flexDirection: 'row', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#222', fontFamily: 'Helvetica-Bold', fontSize: 10 },
  sumRow: { flexDirection: 'row', marginTop: 4, fontSize: 9.5 },
  taxNote: { marginTop: 10, fontSize: 8.5 },
  closing: { marginTop: 18, fontSize: 10, lineHeight: 1.4 },
  qrRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  qr: { width: 70, height: 70, marginRight: 12 },
  footer: { position: 'absolute', bottom: 30, left: 50, right: 50, borderTopWidth: 0.5, borderTopColor: '#999', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#444', lineHeight: 1.4 },
  footerCol: { width: '32%' },
  pageNum: { position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: '#666' },
})

export interface InvoicePdfProps {
  company: Company
  invoice: Invoice
  items: InvoiceItem[]
  qrDataUrl?: string | null
}


export function InvoicePdf({ company, invoice, items, qrDataUrl }: InvoicePdfProps) {
  const totals = computeTotals(items, invoice.price_mode ?? 'gross')
  const lang = invoice.language === 'en' ? 'en' : 'de'
  const t = T[lang]
  const c = invoice.customer_snapshot
  const vars = { tage: String(company.payment_days), nummer: invoice.invoice_number ?? '', firma: company.name, gueltig: fmtDate(invoice.due_date) }
  const taxNote = totals.taxGroups
    .map(g => g.rate === 0 ? `${fmt(g.gross)} € ${t.noTax}` : `${t.vat} ${fmt(g.rate).replace(',00', '')} % (${fmt(g.tax)} €)`)
    .join(', ')
  const isDraft = !invoice.invoice_number
  const isQuote = invoice.doc_type === 'quote'
  const isNet = invoice.price_mode === 'net'
  const unitPrice = (it: InvoiceItem) => isNet ? round2(netOf(it.unit_price_gross, it.tax_rate)) : Number(it.unit_price_gross)
  const lineTotal = (it: InvoiceItem) => round2(Number(it.quantity) * unitPrice(it))
  const docTitle = isQuote ? (isDraft ? t.quoteDraft : t.quote) : (isDraft ? t.draft : t.invoice)

  return (
    <Document title={`${isQuote ? t.quote : t.invoice} ${invoice.invoice_number ?? t.draftShort}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>{company.logo_url ? <Image style={s.logo} src={company.logo_url} /> : null}</View>
          <View style={s.metaBox}>
            <Text style={s.title}>{docTitle}</Text>
            <View style={s.metaLine}><Text style={s.metaLabel}>{isQuote ? t.quoteNumber : t.number}</Text><Text style={s.metaValue}>{invoice.invoice_number ?? '—'}</Text></View>
            {c.customer_number ? <View style={s.metaLine}><Text style={s.metaLabel}>{t.customerNo}</Text><Text style={s.metaValue}>{c.customer_number}</Text></View> : null}
            <View style={s.metaLine}><Text style={s.metaLabel}>{t.date}</Text><Text style={s.metaValue}>{fmtDate(invoice.invoice_date)}</Text></View>
            {invoice.delivery_type && invoice.delivery_type !== 'none' && invoice.delivery_date ? <View style={s.metaLine}><Text style={s.metaLabel}>{t.delivery[invoice.delivery_type]}:</Text><Text style={s.metaValue}>{fmtDate(invoice.delivery_date)}{isPeriod(invoice.delivery_type) && invoice.delivery_end ? ` – ${fmtDate(invoice.delivery_end)}` : ''}</Text></View> : null}
            {isQuote && invoice.due_date ? <View style={s.metaLine}><Text style={s.metaLabel}>{t.validUntil}</Text><Text style={s.metaValue}>{fmtDate(invoice.due_date)}</Text></View> : null}
            {invoice.service_period ? <View style={s.metaLine}><Text style={s.metaLabel}>{t.service}</Text><Text style={s.metaValue}>{invoice.service_period}</Text></View> : null}
          </View>
        </View>

        <View style={s.addrRow}>
          <View style={{ width: '55%' }}>
            <Text style={s.sender}>{company.name}, {company.street}, {company.zip} {company.city}</Text>
            <View style={s.recipient}>
              <Text>{c.name}</Text>
              {c.supplement ? <Text>{c.supplement}</Text> : null}
              {c.street ? <Text>{c.street}</Text> : null}
              <Text>{[c.zip, c.city].filter(Boolean).join(' ')}</Text>
              {c.country && c.country !== 'DE' ? <Text>{countryName(c.country)}</Text> : null}
            </View>
          </View>
          <View style={s.companyBlock}>
            <Text>{company.name}</Text>
            <Text>{company.street}</Text>
            <Text>{company.zip} {company.city}</Text>
            {company.phone ? <Text>{t.phone} {company.phone}</Text> : null}
            {company.email ? <Text>{company.email}</Text> : null}
            {company.website ? <Text>{company.website}</Text> : null}
          </View>
        </View>

        <Text style={s.intro}>{fillTemplate(invoice.intro_text || companyText(company, lang, 'intro_text', invoice.doc_type), vars)}</Text>

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

        {isNet ? (
          <View wrap={false}>
            <View style={s.sumRow}><Text style={{ flex: 1 }}>{t.netSum}</Text><Text style={s.cTotal}>{fmt(totals.net)}</Text></View>
            {totals.taxGroups.filter(g => g.rate > 0).map(g => (
              <View style={s.sumRow} key={g.rate}><Text style={{ flex: 1 }}>{t.plusVat(fmt(g.rate).replace(',00', ''))}</Text><Text style={s.cTotal}>{fmt(g.tax)}</Text></View>
            ))}
            <View style={s.totalRow}>
              <Text style={{ flex: 1 }}>{t.grandNet}</Text>
              <Text style={s.cTotal}>{fmt(totals.gross)}</Text>
            </View>
          </View>
        ) : <>
          <View style={s.totalRow} wrap={false}>
            <Text style={{ flex: 1 }}>{t.grand}</Text>
            <Text style={s.cTotal}>{fmt(totals.gross)}</Text>
          </View>
          <Text style={s.taxNote}>
            {[t.taxIntro(fmt(totals.gross), fmt(totals.net)), t.taxVerb(totals.taxGroups.length > 1), taxNote].filter(Boolean).join(' ')}{t.taxEnd ? ` ${t.taxEnd}` : '.'}
          </Text>
        </>}

        <Text style={s.closing}>{fillTemplate(invoice.closing_text || companyText(company, lang, 'closing_text', invoice.doc_type), vars)}</Text>

        {qrDataUrl && !isQuote ? (
          <View style={s.qrRow} wrap={false}>
            <Image style={s.qr} src={qrDataUrl} />
            <View>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t.qrTitle}</Text>
              <Text>{t.qr1}</Text>
              <Text>{t.qr2}</Text>
            </View>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <View style={s.footerCol}>
            <Text>{company.name}</Text>
            <Text>{company.street}</Text>
            <Text>{company.zip} {company.city}</Text>
            {company.phone ? <Text>{t.phone} {company.phone}</Text> : null}
            {company.email ? <Text>{company.email}</Text> : null}
            {company.website ? <Text>{company.website}</Text> : null}
          </View>
          <View style={s.footerCol}>
            {company.vat_id ? <Text>{t.vatId} {company.vat_id}</Text> : null}
            {company.tax_number ? <Text>{t.taxNo} {company.tax_number}</Text> : null}
            {company.managing_director ? <Text>{t.md} {company.managing_director}</Text> : null}
          </View>
          <View style={s.footerCol}>
            {company.account_holder ? <Text>{company.account_holder}</Text> : null}
            {company.bank_name ? <Text>{company.bank_name}</Text> : null}
            {company.iban ? <Text>IBAN: {company.iban}</Text> : null}
            {company.bic ? <Text>BIC: {company.bic}</Text> : null}
          </View>
        </View>
        <Text style={s.pageNum} fixed render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  )
}
