// Khung chat ghi chú xếp lịch: người quản lý gõ tự nhiên (tiếng Việt / tiếng Đức), AI đổi thành các ghi chú có cấu trúc
// (nghỉ phép, ốm, xin nghỉ, ngày đóng cửa, ca cố định). Hàm này KHÔNG ghi gì vào DB: app hiện lại để người dùng bấm Lưu.
// Chỉ chọn trong danh sách nhân viên mà app gửi lên (app đã lọc theo quyền). Khoá API nằm trong Secrets: ANTHROPIC_API_KEY
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
const date = { type: "string", description: "YYYY-MM-DD" };

type Emp = { id: string; pnr: string | null; name: string; hours: number | null; days: number | null };
type Body = {
  text: string; lang: "vi" | "de"; today: string; month: string;
  history?: { role: "user" | "assistant"; text: string }[];
  employees: Emp[];
  absences: { id: string; employee_id: string; kind: string; from: string; to: string; note: string | null }[];
  closed: { day: string; note: string | null }[];
  special?: { day: string; from: string; to: string; note: string | null }[];
  fixed: { id: string; employee_id: string; day: string; start: string; end: string; note: string | null }[];
};

const schema = (ids: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["reply", "absences", "closed_add", "closed_remove", "special_add", "special_remove", "fixed", "delete_absence_ids", "delete_fixed_ids"],
  properties: {
    reply: { type: "string", description: "Kurze Antwort in der Sprache des Nutzers: was eingetragen wird, Annahmen, oder Rückfrage wenn unklar" },
    absences: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["employee_id", "kind", "from", "to", "note"],
        properties: {
          employee_id: { type: "string", enum: ids },
          kind: { type: "string", enum: ["vacation", "sick", "other", "unpaid"], description: "vacation=Urlaub/nghỉ phép, sick=Krank/ốm, other=Wunschfrei/xin nghỉ/không làm được, unpaid=unbezahlt/nghỉ không lương" },
          from: date, to: date, note: nStr,
        },
      },
    },
    closed_add: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "note"], properties: { day: date, note: nStr } } },
    closed_remove: { type: "array", items: date, description: "Ruhetage, die wieder geöffnet werden (nur aus der Liste der vorhandenen Ruhetage)" },
    special_add: {
      type: "array", description: "verkürzte Öffnungszeit eines Tages (z. B. 26.12. nur 11–17 Uhr verkaufen)",
      items: { type: "object", additionalProperties: false, required: ["day", "from", "to", "note"], properties: { day: date, from: { type: "string", description: "HH:MM" }, to: { type: "string", description: "HH:MM" }, note: nStr } },
    },
    special_remove: { type: "array", items: date, description: "vorhandene verkürzte Öffnungszeiten entfernen" },
    fixed: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["employee_id", "day", "start", "end", "note"],
        properties: { employee_id: { type: "string", enum: ids }, day: date, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM, Mitternacht = 24:00" }, note: nStr },
      },
    },
    delete_absence_ids: { type: "array", items: { type: "string" }, description: "ids vorhandener Abwesenheiten, die gelöscht werden sollen" },
    delete_fixed_ids: { type: "array", items: { type: "string" }, description: "ids vorhandener fester Dienste, die gelöscht werden sollen" },
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
    const text = String(b.text || "").trim().slice(0, 2000);
    const emps = (b.employees || []).slice(0, 300);
    if (!text || !emps.length || !/^\d{4}-\d{2}$/.test(String(b.month))) return json({ error: "invalid_input" }, 400);
    const name = (id: string) => emps.find((e) => e.id === id)?.name || id;

    const system = `Du hilfst dem Restaurantleiter, Hinweise für den Dienstplan einzutragen. Monat: ${b.month}. Heute: ${String(b.today).slice(0, 10)}.
Der Nutzer schreibt Vietnamesisch oder Deutsch, oft ohne Akzente oder mit Tippfehlern. Wandle seine Nachricht in strukturierte Einträge um:
- absences: Urlaub (nghỉ phép/urlaub), Krank (ốm), Wunschfrei (xin nghỉ, không làm được, frei) = other, unbezahlt = unpaid. Zeiträume "3–5/12" = from 3., to 5.
- closed_add / closed_remove: Tage, an denen das Restaurant geschlossen ist (đóng cửa) bzw. doch öffnet.
- special_add / special_remove: verkürzte Öffnungszeit eines Tages ("26/12 bán từ 11h–17h", "nur 11–17 geöffnet"); der Plan legt dann nur Schichten in diesem Zeitraum.
- fixed: feste Dienste "X arbeitet am Tag D von a bis b" (auch an Ruhetagen, z. B. 25.12 mit wenigen Leuten). Ohne Uhrzeit: Beginn 11:00, Ende = Beginn + Std./Tag des Mitarbeiters + Pause (über 7 Std. Arbeit 2 Std. Pause, 5–7 Std. 1 Std., darunter keine); nenne die Annahme in reply.
- delete_*: nur wenn der Nutzer vorhandene Einträge löschen/ändern will (bei Änderung: alten löschen und neuen anlegen).
Mitarbeiter unscharf zuordnen (Vor- oder Nachname, Personal-Nr., ohne Akzente). Nur ids aus der Liste. Wenn ein Name mehrdeutig oder unbekannt ist, nichts dafür eintragen und in reply nachfragen.
Datum ohne Jahr: im Monat ${b.month} bzw. das nächstliegende passende Jahr. Nichts erfinden, was nicht gesagt wurde.
reply auf ${b.lang === "de" ? "Deutsch" : "Vietnamesisch"}, höchstens 3 kurze Sätze, ohne Markdown.`;

    const ctx = [
      `Mitarbeiter (id | Personal-Nr. | Name | Std./Tag | Tage/Woche):\n${emps.map((e) => `${e.id} | ${e.pnr || "-"} | ${e.name} | ${e.hours ?? "-"} | ${e.days ?? "-"}`).join("\n")}`,
      `Vorhandene Abwesenheiten (id | Mitarbeiter | Art | von | bis | Notiz):\n${(b.absences || []).slice(0, 300).map((a) => `${a.id} | ${name(a.employee_id)} | ${a.kind} | ${a.from} | ${a.to} | ${a.note || ""}`).join("\n") || "(keine)"}`,
      `Vorhandene Ruhetage: ${(b.closed || []).map((c) => `${c.day}${c.note ? ` (${c.note})` : ""}`).join(", ") || "(keine)"}`,
      `Vorhandene verkürzte Öffnungszeiten: ${(b.special || []).map((x) => `${x.day} ${x.from}–${x.to}`).join(", ") || "(keine)"}`,
      `Vorhandene feste Dienste (id | Mitarbeiter | Tag | von | bis):\n${(b.fixed || []).slice(0, 300).map((f) => `${f.id} | ${name(f.employee_id)} | ${f.day} | ${f.start} | ${f.end}`).join("\n") || "(keine)"}`,
    ].join("\n\n");
    const hist = (b.history || []).slice(-6).map((h) => `${h.role === "user" ? "Nutzer" : "Assistent"}: ${String(h.text).slice(0, 600)}`).join("\n");

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      output_config: { effort: "low", format: { type: "json_schema", schema: schema(emps.map((e) => e.id)) } },
      messages: [{ role: "user", content: [{ type: "text", text: ctx }, ...(hist ? [{ type: "text", text: `Bisheriger Verlauf:\n${hist}` }] : []), { type: "text", text: `Nachricht: ${text}` }] }],
    } as never) as Anthropic.Message;
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return json({ error: msg.stop_reason }, 502);
    const out = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    return json({ result: JSON.parse(out), model: MODEL });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return json({ error: "ai_failed", status, message: String((e as Error)?.message || e).slice(0, 500) }, 502);
  }
});
