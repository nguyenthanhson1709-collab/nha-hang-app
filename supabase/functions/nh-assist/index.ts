// Trợ lý giọng nói: hiểu câu lệnh (tiếng Việt / tiếng Đức) và trả về trang cần mở.
// Chỉ chọn trong danh sách quán / nhân viên mà app gửi lên; app kiểm tra lại quyền trước khi mở.
// Khoá API nằm trong Secrets: ANTHROPIC_API_KEY
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "claude-opus-5-5";
const nStr = { anyOf: [{ type: "string" }, { type: "null" }] };

type Page = { key: string; desc: string };
type Body = {
  text: string; lang: "vi" | "de"; today: string; current_restaurant_id: string | null;
  pages: Page[]; restaurants: { id: string; name: string }[];
  employees: { id: string; name: string; restaurant_id: string; pnr?: string | null }[];
};

const schema = (pages: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["page", "restaurant_id", "employee_ids", "month", "reply"],
  properties: {
    page: { type: "string", enum: [...pages, "unknown"], description: "Trang cần mở; unknown nếu câu không yêu cầu mở/tìm gì trong app" },
    restaurant_id: { ...nStr, description: "id quán được nhắc tới; null nếu không nói (app dùng quán đang mở)" },
    employee_ids: { type: "array", items: { type: "string" }, description: "id nhân viên khớp với tên được nói (nhiều id nếu tên trùng); rỗng nếu không nhắc tên" },
    month: { ...nStr, description: "Tháng YYYY-MM nếu câu nói nhắc tới tháng (tháng 10, tháng trước, Oktober, letzten Monat), sonst null" },
    reply: { type: "string", description: "Một câu ngắn, ngôn ngữ của người dùng, nói sẽ mở gì (hoặc vì sao không làm được)" },
  },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "no_key" }, 503);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "not_authenticated" }, 401);

    const b = await req.json() as Body;
    const text = String(b.text || "").trim().slice(0, 500);
    if (!text || !Array.isArray(b.pages) || !b.pages.length) return json({ error: "invalid_input" }, 400);
    const pages = b.pages.slice(0, 60).map((p) => ({ key: String(p.key).slice(0, 40), desc: String(p.desc).slice(0, 200) }));
    const rest = (b.restaurants || []).slice(0, 50);
    const emps = (b.employees || []).slice(0, 1500);

    const system = `Du bist der Sprachassistent einer Restaurant-Verwaltungs-App (Buchhaltung, Kassenbuch, Personal, Rechnungen, Reservierungen, Rezepte) für mehrere Restaurants in Deutschland.
Der Nutzer spricht Vietnamesisch oder Deutsch; der Text kommt aus der Spracherkennung und kann Tippfehler, fehlende vietnamesische Akzente oder falsch erkannte Namen enthalten.
Deine Aufgabe: bestimme, welche Seite der App geöffnet werden soll, und für welches Restaurant, welche(n) Mitarbeiter und welchen Monat.
Regeln:
- Wähle page nur aus der Liste. Lohnabrechnung / bảng lương / phiếu lương eines Mitarbeiters = "payslip"; Personalakte / hồ sơ eines Mitarbeiters = "employee".
- employee_ids: nur ids aus der Mitarbeiterliste. Namen unscharf vergleichen (Vor- oder Nachname, ohne Akzente, ähnlich klingend). Bevorzuge Mitarbeiter des genannten bzw. aktuellen Restaurants. Bei mehreren gleich guten Treffern alle zurückgeben.
- restaurant_id: nur ids aus der Restaurantliste, null wenn keins genannt.
- month: heute ist ${String(b.today).slice(0, 10)}. "tháng 10" ohne Jahr = der letzte Oktober, der nicht in der Zukunft liegt. "tháng này"/"diesen Monat" = aktueller Monat, "tháng trước"/"letzten Monat" = Vormonat.
- reply in ${b.lang === "de" ? "Deutsch" : "Vietnamesisch"}, höchstens 12 Wörter, ohne Anführungszeichen.`;

    const ctx = `Seiten:\n${pages.map((p) => `${p.key}: ${p.desc}`).join("\n")}\n\nRestaurants (id | Name):\n${rest.map((r) => `${r.id} | ${r.name}`).join("\n")}\nAktuelles Restaurant: ${b.current_restaurant_id || "keins"}\n\nMitarbeiter (id | Name | restaurant_id | Personal-Nr.):\n${emps.map((e) => `${e.id} | ${e.name} | ${e.restaurant_id} | ${e.pnr || "-"}`).join("\n") || "(keine Berechtigung)"}`;

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      output_config: { effort: "low", format: { type: "json_schema", schema: schema(pages.map((p) => p.key)) } },
      messages: [{ role: "user", content: [{ type: "text", text: ctx }, { type: "text", text: `Befehl: ${text}` }] }],
    } as never) as Anthropic.Message;
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return json({ error: msg.stop_reason }, 502);
    const out = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    return json({ result: JSON.parse(out), model: MODEL });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return json({ error: "ai_failed", status, message: String((e as Error)?.message || e).slice(0, 500) }, 502);
  }
});
