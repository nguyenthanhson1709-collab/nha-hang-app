// Viva Wallet: lấy tiền thẻ từng ngày từ Viva rồi điền vào ô Viva Wallet của Kassenbuch (nh_cash_moves, channel 'viva').
// Khoá API (Merchant ID + API Key) của từng quán nằm trong bảng nh_viva_keys: chỉ hàm này (service_role) đọc được,
// app không bao giờ đọc lại khoá. Chủ nhập khoá trong trang Viva Wallet của quán.
//
// Gọi từ app (đăng nhập):  { action: 'save' | 'remove' | 'test' | 'sync', restaurant_id, ... }
// Gọi từ pg_cron (header x-sync-secret): {} -> mọi quán bật tự động, 3 ngày kinh doanh gần nhất.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aggregate, daysBetween, fetchDates, txList, type VivaDay } from "./viva.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DESC = "Kartenzahlung (Viva Wallet API)";

interface Account { restaurant_id: string; merchant_id: string; source_codes: string | null; terminal_ids: string | null; cutoff_hour: number; demo: boolean; auto_sync: boolean }
const list = (s: string | null) => (s || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Ngày hôm nay ở Berlin (YYYY-MM-DD) dịch đi n ngày */
function berlinDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

class VivaError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/** API cũ của Viva (Basic auth Merchant ID:API Key): GET /api/transactions?date=YYYY-MM-DD */
async function fetchDay(acc: Account, key: string, date: string) {
  const host = acc.demo ? "https://demo.vivapayments.com" : "https://www.vivapayments.com";
  const res = await fetch(`${host}/api/transactions?date=${date}`, {
    headers: { Authorization: "Basic " + btoa(`${acc.merchant_id.trim()}:${key.trim()}`), Accept: "application/json" },
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new VivaError("viva_auth", `Viva ${res.status}: Merchant ID oder API-Schlüssel falsch`);
  if (!res.ok) throw new VivaError("viva_http", `Viva ${res.status}: ${text.slice(0, 200)}`);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new VivaError("viva_format", `Viva: unerwartete Antwort ${text.slice(0, 120)}`); }
  const b = body as Record<string, unknown>;
  if (b && b.Success === false && b.ErrorCode) throw new VivaError("viva_error", `Viva ErrorCode ${b.ErrorCode}: ${b.ErrorText || ""}`);
  return txList(body);
}

async function pull(acc: Account, key: string, from: string, to: string) {
  const txs: Record<string, unknown>[] = [];
  for (const d of fetchDates(from, to)) txs.push(...await fetchDay(acc, key, d));
  const agg = aggregate(txs, { sourceCodes: list(acc.source_codes), terminalIds: list(acc.terminal_ids), cutoffHour: acc.cutoff_hour });
  const days: VivaDay[] = daysBetween(from, to).map((d) => agg.get(d) || { day: d, amount: 0, tip: 0, refunds: 0, n: 0 });
  return { days, raw: txs.length };
}

/** Lưu kết quả: bảng nh_viva_days luôn; ô Viva Wallet trong Kassenbuch chỉ khi tháng chưa khoá và ngày có giao dịch */
async function store(db: SupabaseClient, rid: string, days: VivaDay[]) {
  const now = new Date().toISOString();
  const { error: e1 } = await db.from("nh_viva_days").upsert(days.map((d) => ({ restaurant_id: rid, day: d.day, amount: d.amount, tip: d.tip, refunds: d.refunds, n_tx: d.n, synced_at: now })));
  if (e1) throw new Error(e1.message);
  const periods = [...new Set(days.map((d) => d.day.slice(0, 7)))];
  const { data: lk } = await db.from("nh_periods").select("period").eq("restaurant_id", rid).in("period", periods);
  const locked = new Set((lk || []).map((x) => x.period as string));
  let written = 0, skippedLocked = 0;
  for (const d of days) {
    // ngày không có giao dịch: không xoá số đã nhập tay (có thể quán nghỉ, hoặc giao dịch nằm ở tài khoản khác)
    if (d.n === 0 || d.amount <= 0) continue;
    if (locked.has(d.day.slice(0, 7))) { skippedLocked++; continue; }
    const { data: cur } = await db.from("nh_cash_moves").select("id, amount, description").eq("restaurant_id", rid).eq("channel", "viva").eq("move_date", d.day);
    if (cur?.length === 1 && Number(cur[0].amount) === d.amount && cur[0].description === DESC) continue;
    const del = await db.from("nh_cash_moves").delete().eq("restaurant_id", rid).eq("channel", "viva").eq("move_date", d.day);
    if (del.error) throw new Error(del.error.message);
    const ins = await db.from("nh_cash_moves").insert({ restaurant_id: rid, move_date: d.day, period: d.day.slice(0, 7), type: "geldtransit", amount: d.amount, description: DESC, channel: "viva" });
    if (ins.error) throw new Error(ins.error.message);
    written++;
  }
  return { written, skippedLocked };
}

async function syncOne(db: SupabaseClient, acc: Account, from: string, to: string) {
  const { data: k } = await db.from("nh_viva_keys").select("api_key").eq("restaurant_id", acc.restaurant_id).maybeSingle();
  if (!k?.api_key) throw new VivaError("no_key", "Kein API-Schlüssel gespeichert");
  try {
    const { days, raw } = await pull(acc, k.api_key, from, to);
    const st = await store(db, acc.restaurant_id, days);
    await db.from("nh_viva_accounts").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("restaurant_id", acc.restaurant_id);
    return { from, to, raw, days: days.filter((d) => d.n > 0).length, total: days.reduce((a, d) => a + d.amount, 0), ...st };
  } catch (e) {
    await db.from("nh_viva_accounts").update({ last_error: String((e as Error).message || e).slice(0, 500), last_error_at: new Date().toISOString() }).eq("restaurant_id", acc.restaurant_id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // ---- Lịch chạy hằng ngày ----
    const cronSecret = req.headers.get("x-sync-secret");
    if (cronSecret) {
      const { data: ok } = await db.rpc("nh_viva_cron_secret_ok", { s: cronSecret });
      if (ok !== true) return json({ error: "forbidden" }, 403);
      const { data: accs } = await db.from("nh_viva_accounts").select("*").eq("auto_sync", true).eq("has_key", true);
      const out: Record<string, unknown> = {};
      for (const a of (accs || []) as Account[]) {
        try { out[a.restaurant_id] = await syncOne(db, a, berlinDay(-3), berlinDay(-1)); }
        catch (e) { out[a.restaurant_id] = { error: String((e as Error).message || e) }; }
      }
      return json(out);
    }

    // ---- Gọi từ app ----
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u, error: ue } = await db.auth.getUser(token);
    if (ue || !u.user) return json({ error: "not_authenticated" }, 401);
    const { data: prof } = await db.from("nh_profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
    const isOwner = !!prof?.is_owner;
    const body = await req.json();
    const rid = String(body.restaurant_id || "");
    if (!rid) return json({ error: "invalid_input" }, 400);
    const { data: mem } = await db.from("nh_members").select("role").eq("restaurant_id", rid).eq("user_id", u.user.id).maybeSingle();
    const canManage = isOwner || mem?.role === "manager";
    if (!canManage) return json({ error: "forbidden" }, 403);

    if (body.action === "save") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const merchant = String(body.merchant_id || "").trim();
      if (!/^[0-9a-fA-F-]{8,64}$/.test(merchant)) return json({ error: "invalid_merchant" }, 400);
      const cutoff = Math.max(0, Math.min(8, Math.round(Number(body.cutoff_hour ?? 4))));
      const { error } = await db.from("nh_viva_accounts").upsert({
        restaurant_id: rid, merchant_id: merchant, source_codes: String(body.source_codes || "").trim() || null,
        terminal_ids: String(body.terminal_ids || "").trim() || null, cutoff_hour: cutoff, auto_sync: body.auto_sync !== false,
        demo: !!body.demo, updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
      const key = String(body.api_key || "").trim();
      if (key) {
        const { error: ke } = await db.from("nh_viva_keys").upsert({ restaurant_id: rid, api_key: key, updated_at: new Date().toISOString() });
        if (ke) return json({ error: ke.message }, 500);
        await db.from("nh_viva_accounts").update({ has_key: true }).eq("restaurant_id", rid);
      }
      return json({ ok: true });
    }
    if (body.action === "remove") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      await db.from("nh_viva_keys").delete().eq("restaurant_id", rid);
      await db.from("nh_viva_accounts").delete().eq("restaurant_id", rid);
      return json({ ok: true });
    }

    const { data: acc } = await db.from("nh_viva_accounts").select("*").eq("restaurant_id", rid).maybeSingle();
    if (!acc) return json({ error: "not_connected" }, 400);

    if (body.action === "test") {
      // chỉ đọc, không ghi: hôm qua
      const { data: k } = await db.from("nh_viva_keys").select("api_key").eq("restaurant_id", rid).maybeSingle();
      if (!k?.api_key) return json({ error: "no_key" }, 400);
      const day = berlinDay(-1);
      const { days, raw } = await pull(acc as Account, k.api_key, day, day);
      return json({ ok: true, day, raw, ...days[0] });
    }
    if (body.action === "sync") {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      const to = re.test(body.to) ? body.to : berlinDay(-1);
      const from = re.test(body.from) ? body.from : to;
      if (from > to || daysBetween(from, to).length > 62) return json({ error: "invalid_range" }, 400);
      return json(await syncOne(db, acc as Account, from, to));
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const code = e instanceof VivaError ? e.code : "error";
    return json({ error: code, message: String((e as Error).message || e) }, 502);
  }
});
