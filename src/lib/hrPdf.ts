// Personalbogen (Meldungsbogen PERSONAL) als PDF – immer auf Deutsch
import { jsPDF } from 'jspdf'
import { dmy, eur, pdfText } from './format'
import { EMP_TYPES, POSITIONS, type Employee } from './hr'
import type { Restaurant } from './supabase'

const W = 210, M = 16

export function personalbogenPdf(e: Employee, r: Restaurant, company: string | null): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text('Meldungsbogen PERSONAL', M, 20)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  pdf.text(pdfText([company || e.company, r.name, r.address].filter(Boolean).join(' · ')), M, 26)
  pdf.setDrawColor(170); pdf.line(M, 29, W - M, 29)
  let y = 37
  const yn = (b: boolean | null) => (b == null ? '' : b ? 'Ja' : 'Nein')
  const num = (n: number | null, s = '') => (n == null ? '' : `${String(n).replace('.', ',')}${s}`)
  const section = (title: string, rows: [string, string | null | undefined][]) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(pdfText(title), M, y); y += 2
    pdf.setDrawColor(210); pdf.line(M, y, W - M, y); y += 5
    pdf.setFontSize(9.5)
    for (const [k, v] of rows) {
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(90); pdf.text(pdfText(k), M, y)
      pdf.setTextColor(0)
      const lines = pdf.splitTextToSize(pdfText(v || ''), W - M - 80) as string[]
      pdf.text(lines.length ? lines : [''], 80, y)
      pdf.setDrawColor(235); pdf.line(80, y + 1.5, W - M, y + 1.5)
      y += Math.max(1, lines.length) * 4.6 + 2.2
    }
    y += 4
  }
  section('Persönliche Angaben', [
    ['Name', e.last_name], ['Vorname', e.first_name], ['Anschrift', e.address],
    ['Geburtsdatum', dmy(e.birth_date)], ['Geburtsort', e.birth_place], ['Nationalität', e.nationality],
    ['Telefon', e.phone], ['E-Mail', e.email],
  ])
  section('Aufenthalt und Erwerbstätigkeit', [
    ['Aufenthaltstitel', e.residence_permit], ['gültig bis', dmy(e.residence_permit_until)],
    ['Erwerbstätigkeit gestattet', yn(e.work_permitted)],
  ])
  section('Beschäftigung', [
    ['Firma', company || e.company], ['Restaurant', r.name], ['Personal-Nr.', e.personnel_no], ['Eintrittsdatum', dmy(e.entry_date)],
    ['Tätigkeit', e.job_title || (e.position ? POSITIONS[e.position][1] : '')],
    ['Beschäftigungsart', e.employment_type ? EMP_TYPES[e.employment_type][1] : ''],
    ['Wöchentliche Arbeitszeit', num(e.weekly_hours, ' Std.')], ['Monatlicher Bruttolohn', e.gross_monthly == null ? '' : eur(e.gross_monthly)],
    ['Stundenlohn', e.hourly_wage == null ? '' : eur(e.hourly_wage)], ['Urlaubstage / Jahr', num(e.vacation_days)],
    ['Mehrfachbeschäftigung', yn(e.multiple_employment)],
    ...(e.exit_date ? [['Austrittsdatum', dmy(e.exit_date)] as [string, string]] : []),
  ])
  section('Steuer und Sozialversicherung', [
    ['Lohnsteuerklasse', e.tax_class ? String(e.tax_class) : ''], ['Steuer-Identifikationsnummer', e.tax_id],
    ['Rentenversicherungsnummer', e.pension_no], ['Krankenkasse', e.health_insurance],
  ])
  section('Bankverbindung', [['IBAN', e.iban], ['BIC', e.bic], ['Bank', e.bank_name]])
  if (y > 250) { pdf.addPage(); y = 30 }
  y = Math.max(y + 10, 255)
  pdf.setDrawColor(120)
  pdf.line(M, y, M + 70, y); pdf.line(W - M - 70, y, W - M, y)
  pdf.setFontSize(8); pdf.setTextColor(90)
  pdf.text('Ort, Datum / Unterschrift Arbeitnehmer', M, y + 4)
  pdf.text('Unterschrift Arbeitgeber', W - M - 70, y + 4)
  return pdf.output('blob')
}
