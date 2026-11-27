// Trinkgeld: giao diện theo nút ngôn ngữ (Việt / Đức). PDF, chứng từ, dòng Kassenbuch luôn tiếng Đức.
import { useLang } from '../lib/i18n'

const VI: Record<string, string> = {
  'Übersicht': 'Tổng quan', 'Monatsabrechnung': 'Quyết toán tháng', 'Trinkgeld-Verteilung': 'Chia tip', 'Auszahlungen': 'Chi trả', 'Archiv': 'Lưu trữ', 'Einstellungen': 'Cài đặt',
  '(separat in den Z-Berichten erfasst)': '(ghi riêng trên Z-Bon)',
  '+ Neue Abrechnung erstellen': '+ Tạo quyết toán mới', 'Neue Abrechnung erstellen': 'Tạo quyết toán mới',
  '1. Ermittlung des Trinkgeldes': '1. Xác định tiền tip', '2. Verteilung': '2. Phân chia',
  'Abrechnung als Entwurf anlegen': 'Tạo bản nháp quyết toán', 'Abrechnung festschreiben?': 'Chốt quyết toán?',
  'Abrechnungshistorie': 'Lịch sử quyết toán', 'Abrechnungsjahr': 'Năm', 'Abrechnungsmonat': 'Tháng', 'Abrechnungsstichtag': 'Ngày chốt số liệu',
  'Aktion': 'Thao tác', 'Alle offenen wählen': 'Chọn tất cả người chưa nhận', 'Als geprüft markieren': 'Đánh dấu đã kiểm tra', 'Alte Werte': 'Giá trị cũ',
  'Anzahl der Mitarbeiter': 'Số nhân viên', 'Ausgezahlt': 'Đã trả', 'Ausgezahlt durch': 'Người chi tiền', 'Auszahlung erfassen': 'Ghi nhận chi trả',
  'Auszahlung stornieren': 'Huỷ khoản chi trả', 'Auszahlung storniert': 'Đã huỷ khoản chi trả', 'Auszahlungsart': 'Hình thức trả', 'Auszahlungsbeleg drucken': 'In phiếu chi',
  'Bar': 'Tiền mặt', 'Barauszahlungen als Eintrag im Kassenbuch buchen (mit Prüfung des Kassenbestands)': 'Chi tiền mặt thì ghi vào Kassenbuch (có kiểm tra tồn quỹ)',
  'Bartrinkgeld': 'Tip tiền mặt', 'Bartrinkgeld im Trinkgeldpool': 'Tip tiền mặt trong quỹ tip', 'Begründung (Pflicht)': 'Lý do (bắt buộc)',
  'Begründung der Korrekturen': 'Lý do điều chỉnh', 'Beleg-Nr.': 'Số chứng từ', 'Belege & Anhänge': 'Chứng từ & tệp đính kèm', 'Bemerkungen': 'Ghi chú', 'Benutzer': 'Người dùng',
  'Bereits ausgezahlt': 'Đã chi trả', 'Betrag': 'Số tiền', 'Betriebsstätte': 'Cơ sở', 'Betriebsstätte (Standard)': 'Cơ sở (mặc định)',
  'Bitte Begründung der Korrekturen angeben': 'Vui lòng ghi lý do điều chỉnh', 'Bitte Grund der Stornierung angeben': 'Vui lòng ghi lý do huỷ',
  'Bitte bestätigen, dass die Differenz tatsächlich Trinkgeld ist.': 'Vui lòng xác nhận khoản chênh lệch thực sự là tiền tip.',
  'Bitte nur erfassen, wenn das Geld tatsächlich ausgezahlt wurde.': 'Chỉ ghi khi đã thực sự trả tiền.',
  'Buchungsreferenz': 'Mã giao dịch ngân hàng',
  'Die Differenz ist negativ: Terminal und Z-Berichte bitte abstimmen.': 'Chênh lệch bị âm: vui lòng đối chiếu máy thẻ và Z-Bon.',
  'Die Kontonummern werden nicht vorgegeben (kein SKR03/SKR04-Zwang) und bitte mit dem Steuerberater abstimmen. Trinkgeld-Auszahlungen werden weder als Umsatz noch als Betriebsausgabe gebucht, sondern als durchlaufender Posten auf dem hier eingetragenen Konto.':
    'App không tự đặt số tài khoản (không áp SKR03/SKR04), vui lòng hỏi Steuerberater. Tiền tip chi trả không ghi là doanh thu hay chi phí, mà là khoản thu hộ - chi hộ trên tài khoản điền ở đây.',
  'Dieses Restaurant bucht das Kartentrinkgeld im Kassenbuch bereits täglich als „Trinkgeld (Karte) an Personal ausgezahlt“ (Z-Bon). Um Doppelbuchungen zu vermeiden, Kassenbuch-Buchung hier nur mit dem Steuerberater abgestimmt einschalten.':
    'Quán này đã trừ tip thẻ hằng ngày trong Kassenbuch (theo Z-Bon). Để không bị trừ hai lần, chỉ bật ghi Kassenbuch ở đây khi Steuerberater đồng ý.',
  'Differenz': 'Chênh lệch', 'Empfangsbestätigung gespeichert': 'Đã lưu giấy xác nhận nhận tiền', 'Empfangsbestätigung hochladen': 'Tải giấy xác nhận nhận tiền',
  'Entwurf löschen': 'Xoá bản nháp', 'Erfasste Auszahlungen': 'Các khoản đã chi', 'Erstellungsdatum': 'Ngày lập',
  'Es gibt bereits Auszahlungen. Bitte Korrekturbeleg statt Storno erstellen.': 'Đã có khoản chi trả. Hãy tạo chứng từ điều chỉnh thay vì huỷ.',
  'Es werden keine Auszahlungen automatisch erfasst.': 'App không tự ghi là đã trả tiền.',
  'Es wird ein Stornobeleg erstellt, der mit dem Ursprungsbeleg verknüpft ist. Der Ursprungsbeleg bleibt unverändert erhalten.': 'App tạo chứng từ huỷ liên kết với chứng từ gốc. Chứng từ gốc được giữ nguyên.',
  'Festschreiben durch die Geschäftsführung.': 'Chỉ chủ được chốt sổ.', 'Festschreiben…': 'Chốt sổ…',
  'Firmendaten (Logo, Adresse, Register, Bank) stammen aus den Unternehmenseinstellungen (Viết hoá đơn → Einstellungen) und werden nicht doppelt gespeichert.':
    'Thông tin công ty (logo, địa chỉ, đăng ký, ngân hàng) lấy từ Viết hoá đơn → Cài đặt, không lưu trùng.',
  'Firmendaten fehlen': 'Thiếu thông tin công ty', 'Firmendaten fehlen (Unternehmenseinstellungen)': 'Thiếu thông tin công ty (Viết hoá đơn → Cài đặt)',
  'Firmendaten fehlen. Bitte unter „Viết hoá đơn → Einstellungen“ (Unternehmenseinstellungen) pflegen; sie werden für die Belege übernommen.': 'Thiếu thông tin công ty. Vui lòng điền ở Viết hoá đơn → Cài đặt; chứng từ sẽ dùng thông tin đó.',
  'Für geänderte Stunden ist eine Begründung erforderlich': 'Sửa giờ thì phải ghi lý do',
  'Gegenkonto Kasse': 'Tài khoản đối ứng Kasse', 'Gesamtarbeitsstunden': 'Tổng giờ làm', 'Gesamtauszahlung': 'Tổng chia', 'Gesamtstunden': 'Tổng giờ', 'Gesamtstunden = 0': 'Tổng giờ = 0',
  'Gesamtstunden = 0: Verteilung und Festschreiben nicht möglich.': 'Tổng giờ = 0: không chia và không chốt sổ được.', 'Gespeichert': 'Đã lưu', 'Grund': 'Lý do', 'Grund der Stornierung': 'Lý do huỷ',
  'Ich habe geprüft, dass die Differenz tatsächlich Trinkgeld ist (abgestimmt mit Terminalabrechnung).': 'Tôi đã kiểm tra, khoản chênh lệch thực sự là tiền tip (đã đối chiếu với báo cáo máy thẻ).',
  'Im Archiv gespeichert (neue Version, unterschriebene Fassung bleibt erhalten)': 'Đã lưu vào Lưu trữ (bản mới, bản đã ký vẫn giữ nguyên)',
  'Jetzt festschreiben': 'Chốt sổ ngay', 'Jeweils der volle offene Betrag: gesamt': 'Mỗi người nhận đủ phần còn lại: tổng',
  'Karte + bar, ohne Übertrag': 'Thẻ + tiền mặt, không tính chuyển sang', 'Kartenterminal-Betrag bitte aus der Terminalabrechnung eintragen.': 'Vui lòng nhập số tiền thẻ theo báo cáo máy thẻ (Viva).',
  'Kartentrinkgeld': 'Tip qua thẻ', 'Kartenzahlungen lt. Kartenterminal': 'Thu thẻ theo máy thẻ (Viva)', 'Kartenzahlungen lt. Z-Berichten': 'Thu thẻ theo Z-Bon',
  'Kassenbelegnummer': 'Số phiếu chi', 'Kassenbuch': 'Kassenbuch',
  'Kein Zugriff. Trinkgelddaten sehen nur Geschäftsführung und Verantwortliche.': 'Không có quyền. Chỉ chủ và người phụ trách xem được dữ liệu tip.',
  'Keine Belege.': 'Chưa có chứng từ.', 'Keine Einträge.': 'Chưa có mục nào.',
  'Keine Mitarbeiter für diesen Monat gefunden (Mitarbeiter-Modul / Arbeitsplan prüfen). Ohne Stunden kann nicht festgeschrieben werden.': 'Không thấy nhân viên nào trong tháng này (kiểm tra Nhân sự / lịch làm). Không có giờ thì không chốt sổ được.',
  'Keine Mitarbeiter in dieser Abrechnung.': 'Quyết toán này chưa có nhân viên.', 'Konto Trinkgeld-Auszahlung': 'Tài khoản chi tip', 'Kopfdaten': 'Thông tin chung',
  'Korrekturbeleg erstellen': 'Tạo chứng từ điều chỉnh', 'Löschen': 'Xoá', 'Mitarbeiter': 'Nhân viên', 'Mitarbeiter & Stunden →': 'Nhân viên & giờ →', 'Mitarbeiter suchen…': 'Tìm nhân viên…', 'Monat': 'Tháng',
  'Nach dem Festschreiben können die Zahlen von': 'Sau khi chốt, số liệu của', 'nicht mehr geändert oder gelöscht werden. Fehler werden nur noch über einen Korrektur- oder Stornobeleg berichtigt.': 'không sửa hay xoá được nữa. Sai sót chỉ sửa bằng chứng từ điều chỉnh hoặc huỷ.',
  'Neue Werte': 'Giá trị mới', 'Noch auszuzahlen': 'Còn phải trả', 'Noch keine Abrechnungen.': 'Chưa có quyết toán.', 'Noch keine Anhänge.': 'Chưa có tệp đính kèm.',
  'Noch keine Auszahlungen erfasst. Es wird nichts automatisch als bezahlt markiert.': 'Chưa ghi khoản chi nào. App không tự đánh dấu đã trả.',
  'Nur die Geschäftsführung kann die Einstellungen ändern.': 'Chỉ chủ được sửa cài đặt.',
  'Nur für falsch erfasste Auszahlungen. Der Eintrag bleibt als storniert im Protokoll; ein Kassenbuch-Eintrag wird entfernt (nicht möglich, wenn der Monat abgeschlossen ist).': 'Chỉ dùng khi ghi nhầm. Khoản này vẫn lưu trong lịch sử với trạng thái đã huỷ; dòng Kassenbuch sẽ bị xoá (không được nếu tháng đã khoá sổ).',
  'Offen': 'Chưa trả', 'POS hat Trinkgeld separat erfasst:': 'Máy Kasse ghi riêng tiền tip:', 'Rest': 'Còn dư', 'Rest / Übertrag': 'Dư / chuyển sang tháng sau', 'Restbetrag (Übertrag)': 'Số dư (chuyển sang tháng sau)',
  'Rundungsmethode': 'Cách làm tròn', 'Rundungsmethode (nur der Endbetrag je Mitarbeiter wird gerundet)': 'Cách làm tròn (chỉ làm tròn số tiền cuối của từng người)', 'Rundungsrest → Übertrag': 'Dư do làm tròn → tháng sau',
  'Sonstige Korrekturen (±)': 'Điều chỉnh khác (±)', 'Speichern': 'Lưu', 'Status': 'Trạng thái', 'Stornieren': 'Huỷ', 'Stornieren…': 'Huỷ chứng từ…', 'Stornobeleg erstellen': 'Tạo chứng từ huỷ', 'Stunden': 'Giờ',
  'Stunden aus dem Arbeitsplan (tatsächliche Schichten, unbezahlte Pausen abgezogen). Urlaub, Krankheit, Feiertage ohne Arbeit und sonstige Abwesenheiten zählen nicht. Minijobber werden nicht automatisch ausgeschlossen; Teilnahme gemäß vereinbarter Trinkgeldregelung festlegen.':
    'Giờ lấy từ lịch làm (ca thực tế, đã trừ giờ nghỉ không lương). Không tính nghỉ phép, ốm, ngày lễ không làm và các ngày vắng khác. Minijob không bị loại tự động; chọn người tham gia theo quy định chia tip đã thống nhất.',
  'Suche: Beleg-Nr., Monat (10/2026) …': 'Tìm: số chứng từ, tháng (10/2026) …', 'Suche: Monat, Jahr, Mitarbeiter, Beleg-Nr.': 'Tìm: tháng, năm, nhân viên, số chứng từ',
  'Tatsächliches Auszahlungsdatum': 'Ngày trả tiền thực tế', 'Tatsächliches Auszahlungsdatum angeben': 'Vui lòng nhập ngày trả tiền thực tế',
  'Teilnahme': 'Tham gia', 'Teilnahme am Trinkgeldpool': 'Tham gia quỹ tip', 'Trinkgeld': 'Trinkgeld (tip)', 'Trinkgeld der letzten 12 Monate': 'Tiền tip 12 tháng gần nhất',
  'Trinkgeld im aktuellen Monat': 'Tip trong tháng', 'Trinkgeld lt. POS verwenden:': 'Dùng số tip của máy Kasse:', 'Trinkgeld pro Stunde': 'Tip mỗi giờ', 'Trinkgeld über Kartenzahlung': 'Tip qua thẻ',
  'Unterschriebene PDFs bitte in der Monatsabrechnung unter „Belege & Anhänge“ als „Trinkgeldabrechnung (unterschrieben)“ hochladen. Sie werden nie überschrieben oder gelöscht; neu erzeugte PDFs werden als weitere Version abgelegt.':
    'Bản PDF đã ký: tải lên ở Quyết toán tháng → Chứng từ & tệp đính kèm, loại "Trinkgeldabrechnung (unterschrieben)". Bản này không bao giờ bị ghi đè hay xoá; PDF tạo lại được lưu thành bản mới.',
  'Verfügbar': 'Có để chia', 'Verfügbares Trinkgeld': 'Tiền tip có để chia', 'Verteilt': 'Đã chia', 'Verteilung übersteigt das verfügbare Trinkgeld.': 'Số chia vượt quá tiền tip hiện có.',
  'Vorname': 'Tên', 'Z-Bericht bis Nr.': 'Z-Bon đến số', 'Z-Bericht von Nr.': 'Z-Bon từ số', 'Zeit': 'Thời gian', 'Zeitraum bis': 'Kỳ đến ngày', 'Zeitraum von': 'Kỳ từ ngày',
  'Zu verteilen': 'Phải chia', 'Zurück zu Entwurf': 'Trở lại bản nháp', 'lt. Steuerberater': 'theo Steuerberater', 'oder hierher ziehen': 'hoặc kéo thả vào đây', 'pro Stunde': 'mỗi giờ',
  'Änderungsprotokoll': 'Lịch sử thay đổi', 'Öffnen': 'Mở', 'Übertrag': 'Chuyển sang', 'Übertrag aus Vormonat': 'Chuyển từ tháng trước', 'Überweisung': 'Chuyển khoản',
  '🔒 Festgeschrieben: Zahlen nicht mehr änderbar. Auszahlungen können weiter erfasst werden; Fehler nur per Korrektur- oder Stornobeleg.': '🔒 Đã chốt sổ: không sửa số liệu được nữa. Vẫn ghi chi trả được; sai sót chỉ sửa bằng chứng từ điều chỉnh hoặc huỷ.',
  'Nachname': 'Họ', 'Pers.-Nr.': 'Mã NV', 'Beschäftigungsart': 'Loại hợp đồng', 'Abteilung': 'Bộ phận', 'Sammelauszahlung erfassen': 'Trả cả nhóm',
  'Zahlungen': 'Chi trả', 'Excel': 'Excel', 'CSV': 'CSV', 'PDF-Vorschau': 'Xem PDF', 'PDF-Vorschau / Drucken': 'Xem PDF / In', 'PDF herunterladen': 'Tải PDF', 'Im Archiv speichern': 'Lưu vào Lưu trữ',
  'Auszahlung bestätigen': 'Xác nhận đã trả', 'Auszahlungsbetrag': 'Số tiền trả', 'Datei hochladen (PDF, JPG, PNG)': 'Tải tệp lên (PDF, JPG, PNG)',
  'Verknüpfte Belege:': 'Chứng từ liên quan:', 'Datenquelle:': 'Nguồn dữ liệu:', 'Verteilt in': 'Đã chia', 'Verfügbar / Verteilt': 'Có để chia / Đã chia',
  'Stunden aus Zeiterfassung neu laden': 'Tải lại giờ từ lịch làm', 'Nur im Entwurf änderbar.': 'Chỉ sửa được khi là bản nháp.', 'Mitarbeiter im Pool': 'nhân viên trong quỹ',
  'mit Stunden im Pool': 'có giờ làm trong quỹ', 'Summe': 'Tổng', 'Zeiterf.:': 'Lịch làm:', 'Austritt': 'Nghỉ việc', 'Grund:': 'Lý do:', 'Monat als ZIP': 'Tải cả tháng (ZIP)',
  'Speichern…': 'Lưu…', 'Lädt…': 'Đang tải…', 'Im Kassenbuch buchen': 'Ghi vào Kassenbuch',
}

/** tr('Deutscher Text') -> tiếng Việt khi chọn Tiếng Việt, ngược lại giữ nguyên */
export function useTT() {
  const de = useLang().lang === 'de'
  return (s: string) => (de ? s : VI[s] ?? s)
}
/** Nhãn trạng thái, làm tròn … (giao diện) */
export const STATUS_VI: Record<string, string> = {
  entwurf: 'Nháp', geprueft: 'Đã kiểm tra', festgeschrieben: 'Đã chốt sổ', teilweise: 'Đã trả một phần', ausgezahlt: 'Đã trả đủ', korrigiert: 'Đã điều chỉnh', storniert: 'Đã huỷ',
}
export const ROUNDING_VI: Record<string, string> = { cent: 'Chính xác đến cent', euro: 'Làm tròn xuống Euro nguyên', euro5: 'Làm tròn xuống bội số 5 Euro' }
export const PAY_VI: Record<string, string> = { offen: 'Chưa trả', teilweise: 'Trả một phần', ausgezahlt: 'Đã trả' }
export const FILE_VI: Record<string, string> = {
  terminal: 'Báo cáo máy thẻ', zbericht: 'Z-Bon', abstimmung: 'Đối chiếu', arbeitszeit: 'Bảng giờ làm', sonstige: 'Chứng từ khác', abrechnung: 'Bản quyết toán',
  signiert: 'Bản quyết toán đã ký', auszahlung: 'Giấy nhận tiền', korrektur: 'Chứng từ điều chỉnh',
}
export function useLabels() {
  const de = useLang().lang === 'de'
  return { de, pick: <T extends string>(deMap: Record<T, string>, vi: Record<string, string>, k: T) => (de ? deMap[k] : vi[k] ?? deMap[k]) }
}
/** Lỗi từ cơ sở dữ liệu (tiếng Đức) -> tiếng Việt theo mã */
export const ERR_VI: [RegExp, string][] = [
  [/Nur die Geschäftsführung kann festschreiben/, 'Chỉ chủ được chốt sổ'],
  [/Gesamtstunden = 0/, 'Tổng giờ = 0, không chốt sổ được'],
  [/übersteigt verfügbares/, 'Số chia vượt quá tiền tip hiện có'],
  [/Festgeschriebene Abrechnung/, 'Quyết toán đã chốt, không sửa được (tạo chứng từ điều chỉnh hoặc huỷ)'],
  [/Kassenbestand reicht nicht \(Bestand (.*)\)/, 'Tồn quỹ không đủ (còn $1)'],
  [/übersteigt den offenen Betrag/, 'Số tiền lớn hơn phần còn phải trả'],
  [/nicht in der Zukunft/, 'Nhập ngày trả thực tế (không được ở tương lai)'],
  [/erst nach dem Festschreiben/, 'Chỉ ghi chi trả sau khi chốt sổ'],
  [/Begründung erforderlich/, 'Phải ghi lý do'],
  [/bereits eine gültige Abrechnung/, 'Tháng này đã có quyết toán chính thức cho cơ sở này'],
  [/offenen Korrektur/, 'Chứng từ này đã có một bản điều chỉnh đang mở'],
  [/Auszahlungen kann nicht storniert/, 'Đã có chi trả, không huỷ được (hãy tạo chứng từ điều chỉnh)'],
]
/** vd('tiếng Việt', 'Deutsch') cho câu có số liệu chèn vào */
export function useVD() {
  const de = useLang().lang === 'de'
  return (vi: string, d: string) => (de ? d : vi)
}
