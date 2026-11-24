// Đọc hoá đơn / Z-Bon bằng AI (Claude). Khoá API nằm trong Secrets: ANTHROPIC_API_KEY
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "claude-sonnet-5-5";
const num = { type: "number" };
const nStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const nNum = { anyOf: [{ type: "number" }, { type: "null" }] };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const INVOICE = obj({
  doc_date: { ...nStr, description: "Rechnungs-/Belegdatum YYYY-MM-DD" },
  date_uncertain: { type: "boolean", description: "true, wenn das Datum handschriftlich, unleserlich oder mehrdeutig ist" },
  is_credit: { type: "boolean", description: "true bei Gutschrift / Rückvergütung / Erstattung / Rechnungskorrektur zugunsten des Restaurants (Lieferant zahlt Geld zurück)" },
  ref_invoice_no: { ...nStr, description: "Nur bei Gutschrift: Nummer der ursprünglichen Rechnung, auf die sich die Gutschrift bezieht (z.B. 'Zu Rechnung: 7839607', 'Bezug Rechnung Nr.'), sonst null" },
  supplier: { ...nStr, description: "Name des Verkäufers/Marktes, kurz (z.B. Lidl, METRO, REWE)" },
  invoice_no: nStr,
  seller_tax_id: { ...nStr, description: "USt-IdNr (DE...) oder Steuernummer des Verkäufers" },
  gross: { ...num, description: "Endbetrag brutto, den der Kunde zahlen musste (NICHT 'Gegeben'/'Bar' bezahlter Betrag, NICHT Rückgeld)" },
  taxes: { type: "array", items: obj({ rate: { type: "number", enum: [0, 7, 19] }, net: num, tax: num, gross: num }) },
  payment: { anyOf: [{ type: "string", enum: ["cash", "card", "transfer"] }, { type: "null" }] },
  lines: { type: "array", items: obj({ name: { type: "string" }, qty: { ...nNum, description: "Menge wie gedruckt (z.B. 2,5 bei 2,5 kg)" }, unit: { ...nStr, description: "Mengeneinheit wie gedruckt, kurz: kg, g, Stk, Kiste, Bund, Karton, Fl, l, Pck, Schale, Sack ..." }, unit_price: { ...nNum, description: "Preis je Einheit wie gedruckt (z.B. €/kg, €/Kiste, €/Bund)" }, total: num, rate: { anyOf: [{ type: "number", enum: [0, 7, 19] }, { type: "null" }] } }) },
});

const ZBON = obj({
  z_date: { ...nStr, description: "Geschäftstag des Z-Berichts YYYY-MM-DD" },
  z_no: nStr,
  net7: num, tax7: num, gross7: num, net19: num, tax19: num, gross19: num,
  gross0: { ...num, description: "Umsatz mit 0% (z.B. Trinkgeld als 'Umsatz 0%', Gutscheine)" },
  total: { ...num, description: "Gesamtumsatz brutto" },
  cash_pos: { ...num, description: "Bar-Zahlungen laut Kasse" },
  card_pos: { ...num, description: "Karten-Zahlungen laut Kasse (alle Kartenarten zusammen, ohne Überweisung)" },
  transfer_pos: { ...num, description: "Zahlungen per Überweisung / auf Rechnung laut Kasse, 0 wenn nicht vorhanden" },
  tip: { ...num, description: "Trinkgeld gesamt, 0 wenn nicht vorhanden" },
  storno: num, storno_count: { type: "integer" },
});

const SEGMENT = obj({
  invoices: { type: "array", items: obj({
    start_page: { type: "integer", description: "erste Seite (1-basiert)" },
    end_page: { type: "integer", description: "letzte Seite (inklusive)" },
    supplier: nStr,
    invoice_no: nStr,
  }) },
});

const PROMPT_SEG = (n: number) => `Dieses PDF hat ${n} Seiten und enthält mehrere Belege hintereinander (Eingangsrechnungen, Kassenbons oder Z-Berichte/Tagesabschlüsse einer Kasse; bei Z-Berichten zählt jeder Geschäftstag als ein Beleg).
Bestimme, welche Seiten zu welcher Rechnung gehören. WICHTIG: Eine Rechnung kann mehrere Seiten haben ("Seite 2 von 3", "Übertrag", gleiche Rechnungsnummer, Endsumme erst auf der letzten Seite, Folgeseite ohne Kopf). Folgeseiten gehören zur selben Rechnung, nicht jede Seite ist eine eigene Rechnung.
Leere Seiten, Deckblätter oder AGB-Seiten gehören zur vorherigen Rechnung (oder werden weggelassen, wenn davor keine ist).
Gib die Rechnungen in Reihenfolge zurück, ohne Überschneidungen, Seitenzahlen 1 bis ${n}.`;

const PROMPT_INV = `Du liest einen deutschen Kassenbon bzw. eine Eingangsrechnung eines Restaurants (Fotos/Scans, evtl. mehrere Seiten derselben Rechnung).
Extrahiere die Daten exakt wie gedruckt. Regeln:
- gross = zu zahlender Endbetrag (Summe / zu zahlen / Gesamt). "Bar", "Gegeben", "Rückgeld" sind Zahlungsangaben, nicht der Betrag.
- taxes: aus dem MwSt-Block (z.B. "A 7% Netto Steuer Brutto"). Je Steuersatz eine Zeile. Prüfe: net + tax = gross, Summe aller gross = Endbetrag. Fehlt der Block, berechne aus den Positionen.
- lines: jede Artikelzeile mit Zeilenbetrag; qty, unit und unit_price genau wie in der Zeile (z.B. "2,350 kg x 3,99 €/kg" -> qty 2.35, unit kg, unit_price 3.99; "3 Bund à 0,99" -> qty 3, unit Bund; "1 Kiste"); Pfand ist eine eigene Zeile. Rabatte als negative Zeile. rate über den Buchstaben (A/B) und die Legende.
- payment: cash bei Bar/Gegeben, card bei EC/Girocard/Kreditkarte/Visa/Mastercard, transfer bei Überweisung/Zahlungsziel/Lastschrift, sonst null.
- Datum: deutsches Format TT.MM.JJ oder TT.MM.JJJJ (Tag zuerst, dann Monat, dann Jahr). Bei "06.10.26" ist 26 das JAHR (2026), Tag 06, Monat 10 – die letzte Zahl nie als Tag lesen. Handschriftliche Daten Ziffer für Ziffer lesen. date_uncertain = true bei handschriftlichem, schwer lesbarem oder mehrdeutigem Datum (dann wird der Beleg manuell geprüft).
- Gutschrift (is_credit = true, z.B. "Gutschrift", "Kaufmännische Gutschrift", "Ihre Forderung", "Erstattung"): alle Beträge positiv angeben (ohne Minus), auch taxes und lines. Den MwSt-Block trotzdem vollständig lesen (Steuersatz, Netto, Steuer, Brutto).
- Nachgestelltes Minus wie "28,20-" oder "1,97-" bedeutet einen negativen Betrag (typisch bei Gutschriften).
- Unleserliches: bestmöglich schätzen; Felder, die nicht vorhanden sind: null.`;

const PROMPT_Z = (map: Record<string, string>) => `Du liest einen Z-Bericht (Tagesabschluss) einer deutschen Restaurantkasse.
Extrahiere die Tageswerte nach Steuersatz (7%, 19%, 0%), Gesamtumsatz, Zahlungsarten, Trinkgeld und Stornos.
Zuordnung der Zahlungsarten-Bezeichnungen dieser Kasse: ${JSON.stringify(map)} (cash = bar, card = Karte, transfer = Überweisung). Unbekannte Kartenarten zählen als card; Überweisung / Rechnung / auf Rechnung zählt als transfer_pos (nicht card_pos).
Trinkgeld: der auf dem Bericht ausgewiesene Trinkgeld-Betrag (wird per Karte bezahlt).
Prüfe: net + tax = gross je Satz; gross7 + gross19 + gross0 ≈ total. Nicht vorhandene Werte = 0.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "no_key" }, 503);
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "not_authenticated" }, 401);
    const { kind, restaurant_id, files, pages } = await req.json() as { kind: string; restaurant_id: string; files: { type: string; data: string }[]; pages?: number };
    // Chỉ thành viên của quán (hoặc chủ) mới được dùng
    const { data: prof } = await admin.from("nh_profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
    if (!prof?.is_owner) {
      const { data: mem } = await admin.from("nh_members").select("role").eq("restaurant_id", restaurant_id).eq("user_id", u.user.id).maybeSingle();
      if (!mem) return json({ error: "forbidden" }, 403);
    }
    if (!files?.length || files.length > 8) return json({ error: "invalid_input" }, 400);
    let map: Record<string, string> = {};
    if (kind === "zbon") {
      const { data: r } = await admin.from("nh_restaurants").select("pos_payment_map").eq("id", restaurant_id).maybeSingle();
      map = r?.pos_payment_map || {};
    }

    const content: Anthropic.ContentBlockParam[] = files.map((f) =>
      f.type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
        : { type: "image", source: { type: "base64", media_type: (["image/png", "image/webp", "image/gif"].includes(f.type) ? f.type : "image/jpeg") as "image/jpeg", data: f.data } });
    content.push({ type: "text", text: kind === "zbon" ? PROMPT_Z(map) : kind === "segment" ? PROMPT_SEG(pages || 0) : PROMPT_INV });

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "between_tools" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: kind === "zbon" ? ZBON : kind === "segment" ? SEGMENT : INVOICE } },
      messages: [{ role: "user", content }],
    } as never) as Anthropic.Message;
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return json({ error: msg.stop_reason }, 502);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return json({ result: JSON.parse(text), usage: msg.usage, model: MODEL });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return json({ error: "ai_failed", status, message: String((e as Error)?.message || e).slice(0, 500) }, 502);
  }
});
