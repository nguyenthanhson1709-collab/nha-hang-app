// Ngân hàng (chỉ đọc) qua Open Banking - Enable Banking: số dư + giao dịch tài khoản của quán (vd. Berliner Volksbank).
// App không bao giờ thấy PIN/TAN: chủ đăng nhập và xác nhận trên trang của ngân hàng (SecureGo plus).
// Khoá riêng của ứng dụng Enable Banking nằm ở bảng nh_bank_secrets: chỉ hàm này (service_role) đọc được.
//
// Gọi từ app (đăng nhập): { action: 'config_save' | 'aspsps' | 'connect' | 'callback' | 'sync' | 'remove', ... }
// Gọi từ pg_cron (header x-sync-secret = nh_viva_cron_secret): {} -> mọi kết nối đang hoạt động, 5 ngày gần nhất.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isPem, makeJwt, pickBalance, psuHeaders, toTxRow } from "./bank.ts";

const API = "https://api.enablebanking.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const REDIRECTS = ["https://app.vietbowlmitte.de/", "http://localhost:5173/"];

class BankError extends Error { constructor(public code: string, msg: string, public status = 0) { super(msg); } }

type O = Record<string, unknown>;
interface Link { id: string; restaurant_id: string; aspsp_name: string; aspsp_country: string; status: string; valid_until: string | null; psu_headers: string[]; auto_sync: boolean }

const isoDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function client(db: SupabaseClient) {
  const [{ data: app }, { data: sec }] = await Promise.all([
    db.from("nh_bank_app").select("app_id").eq("id", 1).maybeSingle(),
    db.from("nh_bank_secrets").select("private_key").eq("id", 1).maybeSingle(),
  ]);
  if (!app?.app_id || !sec?.private_key) throw new BankError("no_app", "Enable Banking ist noch nicht eingerichtet");
  return eb(app.app_id, sec.private_key);
}

function eb(appId: string, pem: string) {
  let jwt = "", exp = 0;
  return async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<O> {
    if (!jwt || Date.now() / 1000 > exp - 60) { jwt = await makeJwt(appId, pem); exp = Date.now() / 1000 + 3600; }
    const res = await fetch(API + path, {
      method, headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let j: O = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
    if (!res.ok) {
      const code = String(j.error || j.code || "");
      const msg = `Enable Banking ${res.status}${code ? ` ${code}` : ""}: ${String(j.message || j.detail || text).slice(0, 300)}`;
      if (res.status === 401 && !path.startsWith("/accounts") && !path.startsWith("/sessions/")) throw new BankError("eb_auth", msg, 401);
      if (/EXPIRED|REVOKED|CLOSED_SESSION|INVALID_SESSION|SESSION_DOES_NOT_EXIST|ACCESS_DENIED/i.test(code + " " + msg) || res.status === 401) throw new BankError("expired", msg, res.status);
      if (res.status === 429) throw new BankError("rate_limit", msg, 429);
      throw new BankError("eb_http", msg, res.status);
    }
    return j;
  };
}
type Call = ReturnType<typeof eb>;

async function storeError(db: SupabaseClient, linkId: string, e: unknown) {
  const expired = e instanceof BankError && e.code === "expired";
  await db.from("nh_bank_links").update({
    last_error: String((e as Error).message || e).slice(0, 500), last_error_at: new Date().toISOString(), ...(expired ? { status: "expired" } : {}),
  }).eq("id", linkId);
}

/** Lấy số dư + giao dịch của mọi tài khoản thuộc một kết nối */
async function syncLink(db: SupabaseClient, call: Call, link: Link, headers: Record<string, string>, firstDays = 90) {
  if (link.valid_until && new Date(link.valid_until) < new Date()) {
    await db.from("nh_bank_links").update({ status: "expired" }).eq("id", link.id);
    throw new BankError("expired", "Zustimmung abgelaufen – bitte erneut verbinden");
  }
  const { data: accs } = await db.from("nh_bank_accounts").select("*").eq("link_id", link.id);
  let nTx = 0;
  try {
    for (const a of accs || []) {
      const bal = await call("GET", `/accounts/${encodeURIComponent(a.uid)}/balances`, undefined, headers);
      const b = pickBalance((bal.balances || []) as O[]);
      const from = a.tx_synced_until ? new Date(new Date(a.tx_synced_until).getTime() - 5 * 86400000).toISOString().slice(0, 10) : isoDay(-firstDays);
      const rows = [];
      let ck: string | null = null, pages = 0;
      do {
        const q = new URLSearchParams({ date_from: from });
        if (ck) q.set("continuation_key", ck);
        const r = await call("GET", `/accounts/${encodeURIComponent(a.uid)}/transactions?${q}`, undefined, headers);
        for (const t of (r.transactions || []) as O[]) rows.push(await toTxRow(t, a.iban));
        ck = (r.continuation_key as string) || null;
      } while (ck && ++pages < 60);
      // giao dịch đang chờ (PDNG) đổi mã khi được ghi sổ -> xoá bản chờ cũ rồi ghi lại
      await db.from("nh_bank_tx").delete().eq("restaurant_id", link.restaurant_id).eq("iban", a.iban).eq("status", "PDNG");
      const uniq = new Map(rows.map((r) => [r.id, { ...r, restaurant_id: link.restaurant_id, account_uid: a.uid, synced_at: new Date().toISOString() }]));
      const list = [...uniq.values()];
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await db.from("nh_bank_tx").upsert(list.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      nTx += list.length;
      await db.from("nh_bank_accounts").update({
        ...(b ? { balance: b.amount, balance_type: b.type, currency: b.currency, balance_at: new Date().toISOString() } : {}),
        tx_synced_until: isoDay(0), updated_at: new Date().toISOString(),
      }).eq("uid", a.uid);
    }
    await db.from("nh_bank_links").update({ last_sync_at: new Date().toISOString(), last_error: null, status: "active" }).eq("id", link.id);
    return { accounts: (accs || []).length, tx: nTx };
  } catch (e) { await storeError(db, link.id, e); throw e; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // ---- Lịch chạy hằng ngày (chạy nền, không gửi tiêu đề PSU) ----
    const cronSecret = req.headers.get("x-sync-secret");
    if (cronSecret) {
      const { data: ok } = await db.rpc("nh_viva_cron_secret_ok", { s: cronSecret });
      if (ok !== true) return json({ error: "forbidden" }, 403);
      const call = await client(db);
      const { data: links } = await db.from("nh_bank_links").select("*").eq("status", "active").eq("auto_sync", true);
      const out: O = {};
      for (const l of (links || []) as Link[]) {
        try { out[l.id] = await syncLink(db, call, l, {}); } catch (e) { out[l.id] = { error: String((e as Error).message || e) }; }
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
    const canManage = async (rid: string) => {
      if (isOwner) return true;
      const { data: mem } = await db.from("nh_members").select("role").eq("restaurant_id", rid).eq("user_id", u.user!.id).maybeSingle();
      return mem?.role === "manager";
    };
    // Tiêu đề PSU: chủ/người phụ trách đang mở app
    const reqInfo = {
      ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      ua: String(body.user_agent || req.headers.get("user-agent") || "").slice(0, 300) || null,
      lang: String(body.language || req.headers.get("accept-language") || "de-DE"),
      referer: String(body.referer || "https://app.vietbowlmitte.de/"),
    };

    if (body.action === "config_save") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const appId = String(body.app_id || "").trim();
      if (!/^[0-9a-fA-F-]{20,64}$/.test(appId)) return json({ error: "invalid_app_id" }, 400);
      let pem = String(body.private_key || "").trim();
      if (!pem) {
        const { data: sec } = await db.from("nh_bank_secrets").select("private_key").eq("id", 1).maybeSingle();
        pem = sec?.private_key || "";
        if (!pem) return json({ error: "no_key" }, 400);
      } else if (!isPem(pem)) return json({ error: "invalid_key" }, 400);
      // Thử gọi API trước khi lưu
      let app: O;
      try { app = await eb(appId, pem)("GET", "/application"); }
      catch (e) { if (e instanceof BankError && (e.status === 401 || e.status === 403)) return json({ error: "eb_auth", message: e.message }, 400); throw e; }
      const now = new Date().toISOString();
      const { error: e1 } = await db.from("nh_bank_secrets").upsert({ id: 1, private_key: pem, updated_at: now });
      if (e1) return json({ error: e1.message }, 500);
      const { error: e2 } = await db.from("nh_bank_app").upsert({ id: 1, app_id: appId, has_key: true, updated_at: now });
      if (e2) return json({ error: e2.message }, 500);
      return json({ ok: true, name: app.name ?? null, active: app.active ?? null, redirect_urls: app.redirect_urls ?? null });
    }

    if (body.action === "aspsps") {
      const call = await client(db);
      const r = await call("GET", `/aspsps?country=${encodeURIComponent(String(body.country || "DE"))}&service=AIS`);
      const list = ((r.aspsps || []) as O[]).map((a) => ({
        name: a.name, country: a.country, logo: a.logo, psu_types: a.psu_types, beta: !!a.beta, max_days: Math.floor(Number(a.maximum_consent_validity || 0) / 86400) || null,
      }));
      return json({ aspsps: list });
    }

    if (body.action === "connect") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const rid = String(body.restaurant_id || ""), name = String(body.aspsp_name || ""), country = String(body.country || "DE");
      const redirect = String(body.redirect_url || "");
      if (!rid || !name) return json({ error: "invalid_input" }, 400);
      if (!REDIRECTS.includes(redirect)) return json({ error: "invalid_redirect" }, 400);
      const call = await client(db);
      const r = await call("GET", `/aspsps?country=${encodeURIComponent(country)}`);
      const asp = ((r.aspsps || []) as O[]).find((a) => a.name === name);
      if (!asp) return json({ error: "unknown_bank" }, 400);
      const types = (asp.psu_types || []) as string[];
      const psuType = types.includes(String(body.psu_type)) ? String(body.psu_type) : (types.includes("business") ? "business" : types[0] || "personal");
      const maxSec = Number(asp.maximum_consent_validity || 0) || 90 * 86400;
      const validUntil = new Date(Date.now() + Math.min(maxSec, 180 * 86400) * 1000 - 60000).toISOString();
      const { data: link, error } = await db.from("nh_bank_links").insert({
        restaurant_id: rid, aspsp_name: name, aspsp_country: country, status: "pending", valid_until: validUntil,
        psu_headers: (asp.required_psu_headers || []) as string[], created_by: u.user.id,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      const state = crypto.randomUUID();
      await db.from("nh_bank_link_keys").insert({ link_id: link.id, state });
      const auth = await call("POST", "/auth", {
        access: { valid_until: validUntil }, aspsp: { name, country }, state, redirect_url: redirect, psu_type: psuType, language: body.language === "vi" ? "en" : "de",
      }, psuHeaders((asp.required_psu_headers || []) as string[], reqInfo));
      return json({ url: auth.url });
    }

    if (body.action === "callback") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const state = String(body.state || ""), code = String(body.code || "");
      const { data: k } = await db.from("nh_bank_link_keys").select("link_id").eq("state", state).maybeSingle();
      if (!k) return json({ error: "unknown_state" }, 400);
      const { data: link } = await db.from("nh_bank_links").select("*").eq("id", k.link_id).single();
      if (body.error || !code) {
        await db.from("nh_bank_links").delete().eq("id", link.id);
        return json({ error: "cancelled", message: String(body.error_description || body.error || ""), restaurant_id: link.restaurant_id }, 400);
      }
      const call = await client(db);
      const s = await call("POST", "/sessions", { code });
      const accounts = (s.accounts || []) as O[];
      await db.from("nh_bank_link_keys").update({ session_id: s.session_id, state: null, updated_at: new Date().toISOString() }).eq("link_id", link.id);
      const validUntil = ((s.access as O)?.valid_until as string) || link.valid_until;
      await db.from("nh_bank_links").update({ status: "active", valid_until: validUntil, last_error: null }).eq("id", link.id);
      const rows = accounts.map((a) => ({
        uid: String(a.uid), link_id: link.id, restaurant_id: link.restaurant_id,
        iban: ((a.account_id as O)?.iban as string) || null, name: (a.name as string) || (a.product as string) || (a.details as string) || null, currency: (a.currency as string) || "EUR",
      }));
      if (rows.length) await db.from("nh_bank_accounts").upsert(rows);
      // kết nối cũ cùng ngân hàng của quán này: đóng lại (giao dịch đã lấy vẫn giữ theo IBAN)
      const { data: old } = await db.from("nh_bank_links").select("id").eq("restaurant_id", link.restaurant_id).eq("aspsp_name", link.aspsp_name).neq("id", link.id);
      for (const o of old || []) {
        const { data: ok } = await db.from("nh_bank_link_keys").select("session_id").eq("link_id", o.id).maybeSingle();
        if (ok?.session_id) await call("DELETE", `/sessions/${ok.session_id}`).catch(() => null);
        await db.from("nh_bank_links").delete().eq("id", o.id);
      }
      let synced: O | null = null, syncError: string | null = null;
      try { synced = await syncLink(db, call, { ...link, status: "active", valid_until: validUntil } as Link, psuHeaders(link.psu_headers || [], reqInfo)); }
      catch (e) { syncError = String((e as Error).message || e); }
      return json({ ok: true, restaurant_id: link.restaurant_id, accounts: rows.length, synced, sync_error: syncError });
    }

    if (body.action === "sync") {
      const rid = String(body.restaurant_id || "");
      if (!rid || !(await canManage(rid))) return json({ error: "forbidden" }, 403);
      const call = await client(db);
      const { data: links } = await db.from("nh_bank_links").select("*").eq("restaurant_id", rid).eq("status", "active");
      const out: O[] = [];
      for (const l of (links || []) as Link[]) {
        try { out.push({ bank: l.aspsp_name, ...(await syncLink(db, call, l, psuHeaders(l.psu_headers || [], reqInfo))) }); }
        catch (e) { out.push({ bank: l.aspsp_name, error: e instanceof BankError ? e.code : "error", message: String((e as Error).message || e) }); }
      }
      return json({ results: out });
    }

    if (body.action === "remove") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const { data: link } = await db.from("nh_bank_links").select("id").eq("id", String(body.link_id || "")).maybeSingle();
      if (!link) return json({ error: "not_found" }, 404);
      const { data: k } = await db.from("nh_bank_link_keys").select("session_id").eq("link_id", link.id).maybeSingle();
      if (k?.session_id) { try { await (await client(db))("DELETE", `/sessions/${k.session_id}`); } catch { /* đã hết hạn */ } }
      await db.from("nh_bank_links").delete().eq("id", link.id);
      return json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const code = e instanceof BankError ? e.code : "error";
    return json({ error: code, message: String((e as Error).message || e) }, 502);
  }
});
