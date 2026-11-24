// Chạy một lần: chép cấu hình app nhà hàng từ project cũ (hoadon-app) sang project này.
// Cần secret OLD_SERVICE_KEY (khoá service_role của project cũ). Gọi kèm header x-run = token trong bảng nh_import_token.
import { createClient } from "npm:@supabase/supabase-js@2";

const OLD_URL = "https://hwyrvsydubazmfrtysju.supabase.co";
// Chỉ chép cấu hình. Chứng từ, Z-Bon, Kassenbuch, đếm quỹ, audit, file là dữ liệu thử nghiệm: bắt đầu lại sạch.
const TABLES = ["nh_profiles", "nh_restaurants", "nh_members", "nh_categories", "nh_item_memory", "nh_suppliers"];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const neu = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: tok } = await neu.from("nh_import_token").select("token").maybeSingle();
  if (!tok?.token || req.headers.get("x-run") !== tok.token) return json({ error: "forbidden" }, 403);
  const oldKey = Deno.env.get("OLD_SERVICE_KEY");
  if (!oldKey) return json({ error: "no_old_key" }, 503);
  const old = createClient(OLD_URL, oldKey, { auth: { persistSession: false } });
  const step = new URL(req.url).searchParams.get("step") || "data";
  const log: Record<string, unknown> = {};

  if (step === "data") {
    // Dữ liệu bảng → bảng tạm nh_import (SQL chép tiếp vào bảng thật, tắt trigger)
    for (const t of TABLES) {
      let n = 0
      for (let off = 0; ; off += 1000) {
        const { data, error } = await old.from(t).select("*").range(off, off + 999);
        if (error) { log[t] = "ERR " + error.message; break; }
        if (!data?.length) break;
        const { error: e2 } = await neu.from("nh_import").insert(data.map((d) => ({ tbl: t, data: d })));
        if (e2) { log[t] = "ERR insert " + e2.message; break; }
        n += data.length;
        if (data.length < 1000) break;
      }
      if (!log[t]) log[t] = n;
    }
    return json(log);
  }

  if (step === "users") {
    // Tài khoản: tạo lại với cùng id và email (mật khẩu đặt lại sau)
    const { data: profs } = await old.from("nh_profiles").select("id, email, full_name, lang");
    let ok = 0; const errs: string[] = [];
    for (const p of profs || []) {
      if (!p.email) continue;
      const { error } = await neu.auth.admin.createUser({
        id: p.id, email: p.email, email_confirm: true, password: crypto.randomUUID() + "Aa1!",
        user_metadata: { full_name: p.full_name, lang: p.lang },
      } as never);
      if (error && !/already|exists|registered/i.test(error.message)) errs.push(`${p.email}: ${error.message}`); else ok++;
    }
    return json({ users: ok, errs });
  }

  return json({ error: "unknown_step" }, 400);
});
