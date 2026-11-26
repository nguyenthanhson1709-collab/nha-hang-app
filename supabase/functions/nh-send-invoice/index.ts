// Gửi hoá đơn/Angebot (PDF đính kèm) qua SMTP, mặc định Gmail + App Password.
// Secrets (người dùng tự đặt trong Supabase > Edge Functions > Secrets):
//   SMTP_USER (vd. ten@gmail.com), SMTP_PASS (App Password của Google)
//   tuỳ chọn: SMTP_HOST (mặc định smtp.gmail.com), SMTP_PORT (465), MAIL_FROM_NAME, MAIL_BCC
// Chỉ chủ / người phụ trách của quán sở hữu hoá đơn mới gửi được (RLS của nh_invoices quyết định).
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, key, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  if (!u?.user) return json({ error: "Chưa đăng nhập" }, 401);

  let payload: { invoiceId?: string; to?: string[]; subject?: string; body?: string; pdfBase64?: string; filename?: string };
  try { payload = await req.json(); } catch { return json({ error: "Dữ liệu không hợp lệ" }, 400); }
  const { invoiceId, to, subject, body, pdfBase64, filename } = payload;
  if (!Array.isArray(to) || !to.length || to.length > 10) return json({ error: "Danh sách người nhận không hợp lệ" }, 400);
  if (!to.every((a) => typeof a === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) return json({ error: "Email không hợp lệ" }, 400);
  if (typeof pdfBase64 !== "string" || pdfBase64.length > 15_000_000) return json({ error: "File PDF không hợp lệ" }, 400);

  // Hoá đơn phải thấy được (RLS: chủ / người phụ trách của quán) và đã hoàn tất
  const { data: inv } = await supabase.from("nh_invoices").select("invoice_number, restaurant_id, doc_type").eq("id", invoiceId).maybeSingle();
  if (!inv) return json({ error: "Không có quyền" }, 403);
  if (!inv.invoice_number) return json({ error: "Hoá đơn chưa hoàn tất" }, 400);

  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) return json({ error: "Chưa cấu hình email gửi đi (SMTP_USER, SMTP_PASS trong Supabase Secrets)." }, 500);

  const { data: company } = await supabase.from("nh_inv_company").select("name, email").eq("restaurant_id", inv.restaurant_id).maybeSingle();
  const port = Number(Deno.env.get("SMTP_PORT") ?? 465);
  const transport = nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com", port, secure: port === 465, auth: { user, pass },
  });
  const bcc = Deno.env.get("MAIL_BCC");
  const fallbackName = `${inv.doc_type === "quote" ? "Angebot" : "Rechnung"}_${inv.invoice_number}.pdf`;
  try {
    const info = await transport.sendMail({
      from: { name: company?.name || Deno.env.get("MAIL_FROM_NAME") || "", address: user },
      to, bcc: bcc || undefined,
      replyTo: company?.email || undefined,
      subject: String(subject ?? "").slice(0, 300),
      text: String(body ?? ""),
      attachments: [{ filename: String(filename || fallbackName).replace(/[\\/\r\n]/g, "_").slice(0, 120), content: pdfBase64, encoding: "base64", contentType: "application/pdf" }],
    });
    return json({ ok: true, id: info.messageId });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Invalid login|Username and Password not accepted|535/i.test(msg)) return json({ error: "Gmail từ chối đăng nhập: kiểm tra SMTP_USER và mật khẩu ứng dụng (App Password)." }, 502);
    return json({ error: msg }, 502);
  }
});
