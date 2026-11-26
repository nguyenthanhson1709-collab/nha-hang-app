// Đăng nhập bằng mã PIN cho app nhân viên đặt bàn (chép từ hàm pin-login của app cũ).
// Body: { slug: "potsdamerplatz", pin: "1234" }. Trả { token_hash } để trình duyệt đổi lấy phiên:
// supabase.auth.verifyOtp({ token_hash, type: "magiclink" }).
// Mỗi nhân viên PIN có một tài khoản ẩn (không mật khẩu) để RLS (auth.uid()) nhận ra họ;
// tài khoản này chỉ có quyền trên bảng đặt bàn của quán mình (nh_bk_access), không vào được app nhà hàng.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let slug = "", pin = "";
  try { ({ slug = "potsdamerplatz", pin = "" } = await req.json()); } catch { return json({ error: "body" }, 400); }
  if (!/^[0-9]{4}$/.test(pin)) return json({ result: "pin" }, 400);

  const ip = req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const { data: check, error } = await admin.rpc("nh_bk_pin_check", { p_slug: slug, p_pin: pin, p_ip: ip });
  if (error) return json({ error: "server" }, 500);
  if (check.result !== "ok") return json(check, check.result === "locked" ? 429 : 401);

  let email = `bk-staff-${check.staff_id}@staff.vietbowl.invalid`;
  let authUser: string | null = check.auth_user;
  if (authUser) {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(authUser);
    if (uErr || !u.user?.email) return json({ error: "server" }, 500);
    email = u.user.email;
  } else {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { bk_staff_id: check.staff_id, full_name: check.name },
    });
    if (cErr || !created.user) return json({ error: "server" }, 500);
    authUser = created.user.id;
    await admin.rpc("nh_bk_set_staff_auth", { p_staff: check.staff_id, p_auth: authUser });
  }
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr || !link.properties?.hashed_token) return json({ error: "server" }, 500);
  return json({ result: "ok", name: check.name, token_hash: link.properties.hashed_token });
});
