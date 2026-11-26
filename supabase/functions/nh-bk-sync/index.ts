// Mỗi phút (pg_cron): đọc dữ liệu đặt bàn từ app cũ (Supabase vietbowl-booking) và chép sang module Bàn đặt.
// Cần secret OLD_BK_SERVICE_KEY (khoá service_role của project cũ). Lịch gọi kèm header x-sync-secret (Vault nh_bk_sync_secret).
// Chỉ đọc app cũ, không ghi gì vào đó.
import { createClient } from "npm:@supabase/supabase-js@2";

const OLD_URL = "https://sfeqtlqibaiptnkkjecw.supabase.co";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const neu = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await neu.rpc("nh_bk_sync_secret_ok", { s: req.headers.get("x-sync-secret") || "" });
  if (ok !== true) return json({ error: "forbidden" }, 403);
  const oldKey = Deno.env.get("OLD_BK_SERVICE_KEY");
  if (!oldKey) return json({ error: "no_old_key" }, 503);
  const old = createClient(OLD_URL, oldKey, { auth: { persistSession: false } });

  // đọc hết một bảng (theo trang 1000 dòng); lỗi thì dừng, không chép dở dang
  const all = async (t: string, cols = "*") => {
    const out: unknown[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await old.from(t).select(cols).range(off, off + 999);
      if (error) throw new Error(`${t}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  try {
    const [settings, rules, areas, tables, bookings, bookingTables, notes, reviews, log, staff] = await Promise.all([
      old.from("settings").select("*").eq("id", 1).single().then((r) => { if (r.error) throw new Error(`settings: ${r.error.message}`); return r.data; }),
      all("peak_rules"), all("areas"), all("dining_tables"), all("bookings"), all("booking_tables"),
      all("guest_notes"), all("reviews"), all("booking_log"), all("staff", "id, name"),
    ]);
    const payload = {
      settings, rules, areas,
      tables,
      bookings, booking_tables: bookingTables, notes, reviews, log, staff,
    };
    const { data, error } = await neu.rpc("nh_bk_mirror_apply", { p: payload });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
