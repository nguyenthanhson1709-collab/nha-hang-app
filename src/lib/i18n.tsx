import { createContext, useContext } from 'react'

const vi = {
  appName: 'Sổ sách nhà hàng',
  login: 'Đăng nhập', email: 'Email', password: 'Mật khẩu', logout: 'Đăng xuất', loginFailed: 'Sai email hoặc mật khẩu', forgotPw: 'Quên mật khẩu?', resetSent: 'Đã gửi email. Mở email và bấm vào link để đặt mật khẩu mới.', sendResetMail: 'Gửi email đặt mật khẩu', newPassword: 'Mật khẩu mới', setNewPw: 'Đặt mật khẩu mới', pwTooShort: 'Mật khẩu cần ít nhất 8 ký tự',
  noAccess: 'Tài khoản này chưa được gán vào nhà hàng nào. Hãy nhờ chủ hoặc người phụ trách thêm vào.',
  restaurants: 'Nhà hàng', addRestaurant: 'Thêm nhà hàng', name: 'Tên', address: 'Địa chỉ', taxNumber: 'Mã số thuế (Steuernummer)',
  thisMonth: 'Tháng này', spending: 'Chi', revenue: 'Doanh thu', cash: 'Tiền mặt', card: 'Thẻ', transfer: 'Chuyển khoản', mixed: 'Kết hợp',
  cashBalance: 'Tồn quỹ', today: 'Hôm nay', scan: 'Scan', scanInvoice: 'Hoá đơn mua vào', scanZbon: 'Z-Bon', scanSales: 'Hoá đơn thu tiền',
  missingZbon: 'Ngày còn thiếu Z-Bon', toReview: 'Chờ kiểm tra', scanTile: 'Scan hoá đơn', originals: 'Lưu file gốc', origShort: 'file gốc', home: 'Trang chủ', kassenbuch: 'Kassenbuch', archive: 'Chứng từ',
  reports: 'Báo cáo', settings: 'Cài đặt', save: 'Lưu', cancel: 'Huỷ', delete: 'Xoá', deleted: 'Đã xoá', noCat: 'chưa có nhóm', dropHint: 'hoặc kéo thả file vào đây', edit: 'Sửa', back: 'Quay lại', close: 'Đóng',
  takePhoto: 'Chụp ảnh', chooseFile: 'Chọn ảnh / PDF', addPage: 'Thêm trang', reading: 'Đang đọc chứng từ…', uploading: 'Đang tải lên…',
  blurry: 'Ảnh có vẻ bị mờ. Nên chụp lại cho rõ, đủ sáng và thẳng.', retake: 'Chụp lại', useAnyway: 'Vẫn dùng ảnh này',
  supplier: 'Nhà cung cấp', date: 'Ngày', invoiceNo: 'Số hoá đơn', sellerTaxId: 'Mã số thuế người bán', note: 'Ghi chú',
  taxRate: 'Mức thuế', net: 'Netto', tax: 'MwSt', gross: 'Brutto', total: 'Tổng', payment: 'Hình thức trả', choosePayment: 'Chọn hình thức trả',
  lines: 'Dòng hàng', addLine: 'Thêm dòng', item: 'Tên hàng', qty: 'SL', price: 'Đơn giá', amount: 'Thành tiền', category: 'Nhóm',
  addRate: 'Thêm mức thuế', mismatch: 'Lệch số: Netto + MwSt ≠ Brutto hoặc tổng các mức ≠ tổng hoá đơn',
  linesMismatch: 'Tổng các dòng hàng khác tổng hoá đơn', linesNet: 'Giá dòng hàng là Netto', linesGross: 'Giá dòng hàng đang là Brutto. Nếu hoá đơn in giá Netto:', toNet: 'Đổi về Netto', over250: 'Hoá đơn trên 250 € cần mã số thuế người bán để khấu trừ Vorsteuer',
  duplicate: 'Có thể trùng: đã có hoá đơn cùng số hoá đơn, cùng ngày và cùng số tiền. Hãy kiểm tra lại.', saveAnyway: 'Vẫn lưu',
  approve: 'Duyệt và lưu', saved: 'Đã lưu', staffNote: 'Người phụ trách sẽ kiểm tra số liệu sau.',
  locked: 'Đã khoá sổ', lockedHint: 'Tháng này đã khoá sổ, chứng từ thiếu sẽ ghi vào tháng sau.',
  bookedIn: 'Ghi sổ vào tháng', cashPart: 'Phần tiền mặt', cardPart: 'Phần thẻ',
  zDate: 'Ngày Z-Bon', zNo: 'Số Z', revenue7: 'Doanh thu 7%', revenue19: 'Doanh thu 19%', revenue0: 'Doanh thu 0%',
  totalRevenue: 'Tổng doanh thu (không tip)', cashPos: 'Tiền mặt theo Kasse', cardPos: 'Thẻ theo Kasse',
  cardTerminal: 'Thẻ thực tế từ máy cà thẻ (gồm tip)', tipCard: 'Trong đó tip qua thẻ', tip: 'Tip (Trinkgeld)',
  storno: 'Storno', cashRevenue: 'Tiền mặt thực thu', cardDiff: 'Chênh lệch thẻ Kasse / máy cà thẻ',
  zExists: 'Ngày này đã có Z-Bon', count: 'Đếm két', counted: 'Tiền đếm thực tế', bookBalance: 'Theo sổ', difference: 'Chênh lệch',
  reason: 'Lý do lệch', confirmDay: 'Xác nhận ngày', einlage: 'Einlage (bỏ tiền vào)', privatentnahme: 'Privatentnahme (rút tiền riêng)',
  geldtransit: 'Nộp ngân hàng', sonstige_einnahme: 'Thu khác', sonstige_ausgabe: 'Chi khác', description: 'Nội dung',
  negativeBalance: 'Tồn quỹ sẽ bị âm. Có thể đang thiếu chứng từ thu hoặc Z-Bon.', openingCash: 'Tồn quỹ đầu kỳ', openingDate: 'Ngày bắt đầu sổ',
  lockMonth: 'Khoá sổ tháng', lockConfirm: 'Khoá sổ tháng {m}? Sau khi khoá không ai sửa được, kể cả chủ.', exportPdf: 'Lưu PDF', uploadData: 'Tải dữ liệu lên', uploadHint: 'Chọn 1 file PDF (tối đa {p} trang, {mb} MB) chứa nhiều hoá đơn. AI tự tách từng hoá đơn (kể cả hoá đơn nhiều trang); hoá đơn đọc đủ và khớp được duyệt luôn, còn lại vào Chờ kiểm tra.', bulkAdded: 'Đã thêm {n} hoá đơn', bulkSkipped: 'bỏ qua {n}', bulkUnread: 'không đọc được', dupShort: 'trùng', autoOk: 'Đã duyệt tự động', unit: 'Đơn vị', quickOk: 'Duyệt', contracts: 'Hợp đồng', stAccount: 'Tài khoản', stUpload: 'Tải Kontoauszug lên', ctAdd: 'Thêm hợp đồng', ctCompany: 'Công ty', ctMonthly: 'Tổng tiền bị rút mỗi tháng (hợp đồng còn hiệu lực)', ctInterval: 'Chu kỳ rút tiền', ctFrom: 'Từ', ctTo: 'Đến', ctNo: 'Số hợp đồng / mã khách hàng', ctFiles: 'File hợp đồng', ctFile: 'File', ctUpload: 'Tải file hợp đồng (PDF/ảnh)', uploadZ: 'Tải Z-Bon lên', uploadZHint: 'Chọn một hoặc nhiều ảnh/PDF Z-Bon (một file PDF có thể chứa nhiều ngày). AI đọc từng ngày và ghi thẳng vào Kassenbuch. Thu thẻ theo máy cà thẻ bạn vẫn nhập tay trong từng Z-Bon.', zAdded: 'Đã thêm {n} Z-Bon', zDup: 'ngày này đã có Z-Bon', zCheck: 'số liệu lệch, nên mở xem', quickAll: 'Duyệt nhanh tất cả hoá đơn hợp lệ ({n})', quickAllConfirm: 'Duyệt {n} hoá đơn không có lỗi?', quickAnyway: 'Vẫn duyệt?', unitShort: 'đv', exportZip: 'Tải ZIP cả tháng',
  exportDatev: 'Xuất DATEV', exportExcel: 'Tải Excel', month: 'Tháng', folder: 'Thư mục', search: 'Tìm mặt hàng, nhà cung cấp…',
  all: 'Tất cả', noData: 'Chưa có dữ liệu', byCategory: 'Chi theo nhóm', vat: 'Thuế MwSt (xem trước UStVA)', payments: 'Thẻ và tiền mặt',
  bySupplier: 'Theo nhà cung cấp', topItems: 'Mặt hàng mua nhiều', trend: 'Xu hướng 12 tháng', compare: 'So sánh nhà hàng', zRevenue: 'Doanh thu từ Z-Bon',
  vorsteuer: 'Thuế đầu vào (Vorsteuer)', umsatzsteuer: 'Thuế bán ra (Umsatzsteuer)', payable: 'Phải nộp (ước tính)',
  uncategorized: 'Chưa phân nhóm', count_: 'Số lượng', avgPrice: 'Giá TB', allRestaurants: 'Tất cả nhà hàng',
  users: 'Tài khoản', manager: 'Người phụ trách', staff: 'Nhân viên', owner: 'Chủ', addUser: 'Thêm tài khoản', fullName: 'Họ tên', role: 'Vai trò',
  resetPassword: 'Đổi mật khẩu', remove: 'Gỡ', language: 'Ngôn ngữ', categories: 'Danh mục nhóm hàng', account: 'Tài khoản SKR03',
  tipPaidCash: 'Tip thẻ trả nhân viên bằng tiền mặt từ két', posMap: 'Tên hình thức thanh toán trên Z-Bon', posType: 'Mẫu Z-Bon',
  datevConsultant: 'DATEV Beraternummer', datevClient: 'DATEV Mandantennummer', restaurantSettings: 'Cài đặt nhà hàng', active: 'Đang hoạt động',
  uploadedBy: 'Người tải', status: 'Trạng thái', uploaded: 'Chờ duyệt', reviewed: 'Đã duyệt', open: 'Mở', myUploads: 'Hoá đơn tôi đã tải',
  original: 'Ảnh gốc', linkedPart: 'Phần còn lại ở thư mục', confirmDelete: 'Xoá chứng từ này?', ocrFailed: 'Không đọc được, hãy nhập tay.',
  history: 'Lịch sử sửa', daysOpen: 'Mở cửa', added: 'Đã thêm', mustChoosePayment: 'Hãy chọn hình thức trả', paymentSumMismatch: 'Tổng các hình thức trả phải bằng tổng hoá đơn',
  journal: 'Sổ nhật ký (Buchungsjournal)', soll: 'Soll', haben: 'Haben', period: 'Kỳ', from: 'Từ', to: 'Đến', week: 'Tuần', quarter: 'Quý', day: 'Ngày', custom: 'Tự chọn', year: 'Năm',
  vatNote: 'Chỉ để xem. Steuerberater nộp tờ khai.', datevNote: 'Lần đầu hãy nhờ Steuerberater thử nhập file và xác nhận số tài khoản.',
  rememberedCategory: 'Nhóm đã nhớ', suggestion: 'Gợi ý', perGuest: 'Doanh thu / khách',
}
export type Dict = typeof vi
const de: Dict = {
  appName: 'Restaurant-Buchhaltung',
  login: 'Anmelden', email: 'E-Mail', password: 'Passwort', logout: 'Abmelden', loginFailed: 'E-Mail oder Passwort falsch', forgotPw: 'Passwort vergessen?', resetSent: 'E-Mail gesendet. Bitte den Link in der E-Mail öffnen und ein neues Passwort festlegen.', sendResetMail: 'E-Mail zum Zurücksetzen senden', newPassword: 'Neues Passwort', setNewPw: 'Neues Passwort festlegen', pwTooShort: 'Passwort braucht mindestens 8 Zeichen',
  noAccess: 'Dieses Konto ist keinem Restaurant zugeordnet. Bitte Inhaber oder Filialleitung fragen.',
  restaurants: 'Restaurants', addRestaurant: 'Restaurant hinzufügen', name: 'Name', address: 'Adresse', taxNumber: 'Steuernummer',
  thisMonth: 'Diesen Monat', spending: 'Ausgaben', revenue: 'Umsatz', cash: 'Bar', card: 'Karte', transfer: 'Überweisung', mixed: 'Kombiniert',
  cashBalance: 'Kassenbestand', today: 'Heute', scan: 'Scan', scanInvoice: 'Eingangsrechnung', scanZbon: 'Z-Bon', scanSales: 'Ausgangsrechnung',
  missingZbon: 'Tage ohne Z-Bon', toReview: 'Zu prüfen', scanTile: 'Beleg scannen', originals: 'Original speichern', origShort: 'Original', home: 'Start', kassenbuch: 'Kassenbuch', archive: 'Belege',
  reports: 'Berichte', settings: 'Einstellungen', save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen', deleted: 'Gelöscht', noCat: 'ohne Gruppe', dropHint: 'oder Datei hierher ziehen', edit: 'Bearbeiten', back: 'Zurück', close: 'Schließen',
  takePhoto: 'Foto aufnehmen', chooseFile: 'Bild / PDF wählen', addPage: 'Seite hinzufügen', reading: 'Beleg wird gelesen…', uploading: 'Wird hochgeladen…',
  blurry: 'Das Foto wirkt unscharf. Bitte gerade, hell und scharf neu aufnehmen.', retake: 'Neu aufnehmen', useAnyway: 'Trotzdem verwenden',
  supplier: 'Lieferant', date: 'Datum', invoiceNo: 'Rechnungsnummer', sellerTaxId: 'USt-IdNr. / Steuernr. Verkäufer', note: 'Notiz',
  taxRate: 'Steuersatz', net: 'Netto', tax: 'MwSt', gross: 'Brutto', total: 'Summe', payment: 'Zahlungsart', choosePayment: 'Zahlungsart wählen',
  lines: 'Positionen', addLine: 'Position hinzufügen', item: 'Artikel', qty: 'Menge', price: 'Preis', amount: 'Betrag', category: 'Gruppe',
  addRate: 'Steuersatz hinzufügen', mismatch: 'Abweichung: Netto + MwSt ≠ Brutto oder Summe der Sätze ≠ Rechnungsbetrag',
  linesMismatch: 'Summe der Positionen weicht vom Rechnungsbetrag ab', linesNet: 'Positionen netto', linesGross: 'Positionen sind brutto. Falls die Rechnung Nettopreise zeigt:', toNet: 'In Netto umrechnen', over250: 'Rechnung über 250 € braucht die Steuernummer des Verkäufers für den Vorsteuerabzug',
  duplicate: 'Mögliches Duplikat: gleiche Rechnungsnummer, gleiches Datum und gleicher Betrag vorhanden. Bitte prüfen.', saveAnyway: 'Trotzdem speichern',
  approve: 'Prüfen und speichern', saved: 'Gespeichert', staffNote: 'Die Filialleitung prüft die Zahlen später.',
  locked: 'Festgeschrieben', lockedHint: 'Monat festgeschrieben, fehlende Belege werden im Folgemonat gebucht.',
  bookedIn: 'Gebucht im Monat', cashPart: 'Baranteil', cardPart: 'Kartenanteil',
  zDate: 'Datum Z-Bon', zNo: 'Z-Nr.', revenue7: 'Umsatz 7%', revenue19: 'Umsatz 19%', revenue0: 'Umsatz 0%',
  totalRevenue: 'Gesamtumsatz (ohne Trinkgeld)', cashPos: 'Bar lt. Kasse', cardPos: 'Karte lt. Kasse',
  cardTerminal: 'Karte lt. EC-Terminal (inkl. Trinkgeld)', tipCard: 'davon Trinkgeld per Karte', tip: 'Trinkgeld',
  storno: 'Storno', cashRevenue: 'Bareinnahmen tatsächlich', cardDiff: 'Differenz Karte Kasse / Terminal',
  zExists: 'Für diesen Tag gibt es schon einen Z-Bon', count: 'Kassensturz', counted: 'Gezählter Bestand', bookBalance: 'Laut Buch', difference: 'Differenz',
  reason: 'Grund der Differenz', confirmDay: 'Tag bestätigen', einlage: 'Einlage', privatentnahme: 'Privatentnahme',
  geldtransit: 'Geldtransit an Bank', sonstige_einnahme: 'Sonstige Einnahme', sonstige_ausgabe: 'Sonstige Ausgabe', description: 'Text',
  negativeBalance: 'Der Kassenbestand würde negativ. Evtl. fehlen Einnahmen oder ein Z-Bon.', openingCash: 'Anfangsbestand', openingDate: 'Beginn des Kassenbuchs',
  lockMonth: 'Monat festschreiben', lockConfirm: 'Monat {m} festschreiben? Danach kann niemand mehr ändern, auch nicht der Inhaber.', exportPdf: 'PDF speichern', uploadData: 'Daten hochladen', uploadHint: 'Eine PDF-Datei (max. {p} Seiten, {mb} MB) mit mehreren Rechnungen wählen. Die KI trennt die Rechnungen (auch mehrseitige). Vollständig gelesene Rechnungen werden direkt übernommen, die übrigen landen unter Zu prüfen.', bulkAdded: '{n} Rechnungen hinzugefügt', bulkSkipped: '{n} übersprungen', bulkUnread: 'nicht lesbar', dupShort: 'Duplikat', autoOk: 'Automatisch geprüft', unit: 'Einheit', quickOk: 'Freigeben', contracts: 'Verträge', stAccount: 'Konto', stUpload: 'Kontoauszug hochladen', ctAdd: 'Vertrag hinzufügen', ctCompany: 'Firma', ctMonthly: 'Lastschriften pro Monat (laufende Verträge)', ctInterval: 'Abbuchung', ctFrom: 'Ab', ctTo: 'Bis', ctNo: 'Vertrags- / Kundennummer', ctFiles: 'Vertragsdateien', ctFile: 'Datei', ctUpload: 'Vertrag hochladen (PDF/Foto)', uploadZ: 'Z-Bons hochladen', uploadZHint: 'Ein oder mehrere Fotos/PDFs von Z-Bons wählen (eine PDF kann mehrere Tage enthalten). Die KI liest jeden Tag und trägt ihn direkt ins Kassenbuch ein. Kartenumsatz laut EC-Terminal weiterhin im Z-Bon eintragen.', zAdded: '{n} Z-Bons hinzugefügt', zDup: 'Z-Bon für diesen Tag vorhanden', zCheck: 'Abweichung, bitte prüfen', quickAll: 'Alle fehlerfreien freigeben ({n})', quickAllConfirm: '{n} fehlerfreie Rechnungen freigeben?', quickAnyway: 'Trotzdem freigeben?', unitShort: 'Einh.', exportZip: 'ZIP des Monats',
  exportDatev: 'DATEV-Export', exportExcel: 'Excel herunterladen', month: 'Monat', folder: 'Ordner', search: 'Artikel, Lieferant suchen…',
  all: 'Alle', noData: 'Keine Daten', byCategory: 'Ausgaben nach Gruppe', vat: 'Umsatzsteuer (UStVA-Vorschau)', payments: 'Karte und Bar',
  bySupplier: 'Nach Lieferant', topItems: 'Meistgekaufte Artikel', trend: 'Verlauf 12 Monate', compare: 'Restaurantvergleich', zRevenue: 'Umsatz aus Z-Bons',
  vorsteuer: 'Vorsteuer', umsatzsteuer: 'Umsatzsteuer', payable: 'Zahllast (geschätzt)',
  uncategorized: 'Ohne Gruppe', count_: 'Anzahl', avgPrice: 'Ø Preis', allRestaurants: 'Alle Restaurants',
  users: 'Benutzer', manager: 'Filialleitung', staff: 'Mitarbeiter', owner: 'Inhaber', addUser: 'Benutzer anlegen', fullName: 'Name', role: 'Rolle',
  resetPassword: 'Passwort ändern', remove: 'Entfernen', language: 'Sprache', categories: 'Warengruppen', account: 'Konto SKR03',
  tipPaidCash: 'Karten-Trinkgeld wird bar aus der Kasse ausgezahlt', posMap: 'Zahlungsarten auf dem Z-Bon', posType: 'Z-Bon-Vorlage',
  datevConsultant: 'DATEV Beraternummer', datevClient: 'DATEV Mandantennummer', restaurantSettings: 'Restaurant-Einstellungen', active: 'Aktiv',
  uploadedBy: 'Hochgeladen von', status: 'Status', uploaded: 'Ungeprüft', reviewed: 'Geprüft', open: 'Öffnen', myUploads: 'Meine Belege',
  original: 'Original', linkedPart: 'Restbetrag im Ordner', confirmDelete: 'Diesen Beleg löschen?', ocrFailed: 'Nicht lesbar, bitte manuell erfassen.',
  history: 'Änderungsverlauf', daysOpen: 'Geöffnet', added: 'Hinzugefügt', mustChoosePayment: 'Bitte Zahlungsart wählen', paymentSumMismatch: 'Summe der Zahlungsarten muss dem Rechnungsbetrag entsprechen',
  journal: 'Buchungsjournal', soll: 'Soll', haben: 'Haben', period: 'Zeitraum', from: 'Von', to: 'Bis', week: 'Woche', quarter: 'Quartal', day: 'Tag', custom: 'Zeitraum', year: 'Jahr',
  vatNote: 'Nur zur Ansicht. Die Anmeldung macht der Steuerberater.', datevNote: 'Beim ersten Mal den Import vom Steuerberater testen und Konten bestätigen lassen.',
  rememberedCategory: 'Gemerkte Gruppe', suggestion: 'Vorschlag', perGuest: 'Umsatz / Gast',
}

export const dicts = { vi, de }
export type Lang = keyof typeof dicts
export type TKey = keyof Dict

export const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'vi', setLang: () => {} })

export function useT() {
  const { lang } = useContext(LangCtx)
  const d = dicts[lang]
  return (k: TKey, vars?: Record<string, string>) => {
    let s = d[k] ?? k
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b)
    return s
  }
}
export function useLang() { return useContext(LangCtx) }
