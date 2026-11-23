// Quản lý tài khoản: chủ tạo người phụ trách / nhân viên; người phụ trách tạo nhân viên của quán mình.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u.user) return json({ error: "not_authenticated" }, 401);
    const caller = u.user.id;
    const { data: prof } = await admin.from("nh_profiles").select("is_owner").eq("id", caller).maybeSingle();
    const isOwner = !!prof?.is_owner;

    const body = await req.json();
    const { action, restaurant_id, role } = body;

    const canManage = async (rid: string) => {
      if (isOwner) return true;
      const { data } = await admin.from("nh_members").select("role").eq("restaurant_id", rid).eq("user_id", caller).maybeSingle();
      return data?.role === "manager";
    };

    if (action === "create_user") {
      const { email, password, full_name, lang } = body;
      if (!email || !password || password.length < 8) return json({ error: "invalid_input" }, 400);
      if (!["manager", "staff"].includes(role)) return json({ error: "invalid_role" }, 400);
      if (role === "manager" && !isOwner) return json({ error: "forbidden" }, 403);
      if (!(await canManage(restaurant_id))) return json({ error: "forbidden" }, 403);

      let userId: string | undefined;
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name, lang: lang || "vi" },
      });
      if (error) {
        // Tài khoản đã có: chỉ gán vào quán
        // Chỉ chủ được gán một tài khoản đã có (tránh người phụ trách chiếm tài khoản người khác)
        if (!isOwner) return json({ error: "email_exists" }, 400);
        const { data: existing } = await admin.from("nh_profiles").select("id").eq("email", email).maybeSingle();
        if (!existing) return json({ error: error.message }, 400);
        userId = existing.id;
      } else userId = created.user?.id;
      if (role === "manager") {
        await admin.from("nh_members").delete().eq("restaurant_id", restaurant_id).eq("role", "manager");
      }
      const { error: me } = await admin.from("nh_members").upsert({ restaurant_id, user_id: userId, role });
      if (me) return json({ error: me.message }, 400);
      return json({ ok: true, user_id: userId });
    }

    if (action === "set_password") {
      const { user_id, password } = body;
      if (!password || password.length < 8) return json({ error: "invalid_input" }, 400);
      const { data: m } = await admin.from("nh_members").select("role").eq("restaurant_id", restaurant_id).eq("user_id", user_id).maybeSingle();
      if (!m) return json({ error: "not_found" }, 404);
      if (m.role === "manager" && !isOwner) return json({ error: "forbidden" }, 403);
      if (!(await canManage(restaurant_id))) return json({ error: "forbidden" }, 403);
      if (!isOwner) {
        const { data: tp } = await admin.from("nh_profiles").select("is_owner").eq("id", user_id).maybeSingle();
        if (tp?.is_owner) return json({ error: "forbidden" }, 403);
        const { data: all } = await admin.from("nh_members").select("restaurant_id, role").eq("user_id", user_id);
        for (const r of all || []) {
          if (r.role !== "staff" || !(await canManage(r.restaurant_id))) return json({ error: "forbidden" }, 403);
        }
      }
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "remove_member") {
      const { user_id } = body;
      const { data: m } = await admin.from("nh_members").select("role").eq("restaurant_id", restaurant_id).eq("user_id", user_id).maybeSingle();
      if (!m) return json({ error: "not_found" }, 404);
      if (m.role === "manager" && !isOwner) return json({ error: "forbidden" }, 403);
      if (!(await canManage(restaurant_id))) return json({ error: "forbidden" }, 403);
      await admin.from("nh_members").delete().eq("restaurant_id", restaurant_id).eq("user_id", user_id);
      // Không khoá tài khoản: project dùng chung đăng nhập với app hoá đơn. Mất quyền quán là không vào được dữ liệu.
      return json({ ok: true });
    }

    if (action === "set_role") {
      // Chỉ chủ đổi vai trò người phụ trách <-> nhân viên
      if (!isOwner) return json({ error: "forbidden" }, 403);
      if (!["manager", "staff"].includes(role)) return json({ error: "invalid_role" }, 400);
      // Mỗi quán 1 người phụ trách: người phụ trách cũ thành nhân viên
      if (role === "manager") await admin.from("nh_members").update({ role: "staff" }).eq("restaurant_id", restaurant_id).eq("role", "manager").neq("user_id", body.user_id);
      const { error } = await admin.from("nh_members").update({ role }).eq("restaurant_id", restaurant_id).eq("user_id", body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
