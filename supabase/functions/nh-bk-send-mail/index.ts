// Gửi email cho khách đặt bàn (bảng nh_bk_email_outbox) qua Brevo. Chép từ hàm send-mail của app đặt bàn cũ.
// Mỗi phút pg_cron gọi (migration 025) kèm header x-sync-secret (Vault nh_bk_sync_secret).
// Secrets: BREVO_API_KEY (bắt buộc), tuỳ chọn MAIL_FROM, APP_URL, OWNER_COPY ("off" = không gửi bản sao cho quán).
// Hiện chỉ Vietbowl Potsdamer Platz (Vietbowl Mitte GmbH) dùng đặt bàn nên tên, địa chỉ quán ghi sẵn dưới đây.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const FROM = Deno.env.get("MAIL_FROM") ?? "potsdamerplatz@vietbowl.de";
const APP = Deno.env.get("APP_URL") ?? "https://potsdamerplatz.vietbowl.de";
const MAPS = "https://maps.app.goo.gl/dua1NhLpHr2oGLSz5";
const NAME = "Vietbowl Potsdamer Platz";
const ADDRESS = "Marlene-Dietrich-Platz 1, 10785 Berlin";
const PHONE = "030 25931200";
// The restaurant gets a copy of what the guest receives, with the guest's name, date and time in the subject (owner request 2026-11-22).
// OWNER_COPY secret overrides the address; set it to "off" to stop the copies.
const COPY = Deno.env.get("OWNER_COPY") ?? FROM;
const COPY_KINDS = ["confirmed", "pending", "cancelled"];

type Lang = "de" | "en" | "vi";
const T: Record<Lang, Record<string, string>> = {
  de: {
    confirmed: "Ihre Reservierung ist bestätigt", pending: "Wir haben Ihre Anfrage erhalten",
    approved: "Ihre Reservierung ist bestätigt", cancelled: "Ihre Reservierung wurde storniert",
    rejected: "Leider können wir Ihre Anfrage nicht bestätigen",
    hello: "Hallo", pendingTxt: "Wir prüfen Ihre Anfrage und melden uns per E-Mail.",
    date: "Datum", time: "Uhrzeit", party: "Personen", code: "Buchungsnummer",
    manage: "Reservierung ansehen oder stornieren", bye: "Wir freuen uns auf Ihren Besuch!",
    again: "Neu reservieren", route: "Route", note: "Notiz", cancelledTxt: "Ihre Reservierung wurde storniert. Wir hoffen, Sie bald wieder bei uns zu sehen.", rejectedTxt: "Zu diesem Zeitpunkt ist leider kein Tisch mehr frei. Gerne können Sie eine andere Zeit wählen.", confirmedTxt: "Ihr Tisch ist reserviert. Bitte geben Sie uns Bescheid, falls Sie später kommen oder absagen möchten.",
    review: "Wie war Ihr Besuch?", reviewTxt: "Vielen Dank, dass Sie gestern bei uns waren! Wie hat es Ihnen gefallen? Ein Klick auf die Sterne genügt.", google: "Bewertung auf Google schreiben", googleTxt: "Sie möchten anderen Gästen von Ihrem Besuch erzählen? Wir freuen uns über Ihre Bewertung auf Google.", why: "Sie erhalten diese einmalige E-Mail, weil Sie bei Ihrer Reservierung zugestimmt haben.", visit: "Ihr Besuch",
  },
  en: {
    confirmed: "Your reservation is confirmed", pending: "We have received your request",
    approved: "Your reservation is confirmed", cancelled: "Your reservation has been cancelled",
    rejected: "Unfortunately we cannot confirm your request",
    hello: "Hello", pendingTxt: "We will check your request and reply by e-mail.",
    date: "Date", time: "Time", party: "Guests", code: "Booking number",
    manage: "View or cancel your reservation", bye: "We look forward to your visit!",
    again: "Book again", route: "Directions", note: "Note", cancelledTxt: "Your reservation has been cancelled. We hope to see you again soon.", rejectedTxt: "Unfortunately there is no table left at this time. Please feel free to choose another time.", confirmedTxt: "Your table is reserved. Please let us know if you will be late or need to cancel.",
    review: "How was your visit?", reviewTxt: "Thank you for dining with us yesterday! How did you like it? One click on the stars is all it takes.", google: "Write a review on Google", googleTxt: "Would you like to tell other guests about your visit? We would love a review on Google.", why: "You are receiving this one-time e-mail because you agreed to it when booking.", visit: "Your visit",
  },
  vi: {
    confirmed: "Đặt bàn của bạn đã được xác nhận", pending: "Chúng tôi đã nhận yêu cầu đặt bàn",
    approved: "Đặt bàn của bạn đã được xác nhận", cancelled: "Đặt bàn của bạn đã được hủy",
    rejected: "Rất tiếc chúng tôi không thể nhận yêu cầu này",
    hello: "Xin chào", pendingTxt: "Quán sẽ kiểm tra và trả lời bạn qua email.",
    date: "Ngày", time: "Giờ", party: "Số người", code: "Mã đặt bàn",
    manage: "Xem hoặc hủy đặt bàn", bye: "Hẹn gặp bạn tại quán!",
    again: "Đặt bàn mới", route: "Chỉ đường", note: "Ghi chú", cancelledTxt: "Đặt bàn của bạn đã được hủy. Mong sớm gặp lại bạn.", rejectedTxt: "Rất tiếc giờ này đã hết bàn. Bạn có thể chọn giờ khác.", confirmedTxt: "Bàn của bạn đã được giữ. Nếu đến muộn hoặc muốn hủy, vui lòng báo cho quán.",
    review: "Bữa ăn của bạn thế nào?", reviewTxt: "Cảm ơn bạn đã đến quán hôm qua! Bạn thấy thế nào? Chỉ cần bấm vào số sao.", google: "Viết đánh giá trên Google", googleTxt: "Bạn muốn chia sẻ với khách khác? Quán rất vui nếu bạn đánh giá trên Google.", why: "Bạn nhận email này một lần vì đã đồng ý khi đặt bàn.", visit: "Lần đến quán",
  },
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function render(kind: string, b: any, google = MAPS) {
  const lang: Lang = (["de", "en", "vi"].includes(b.lang) ? b.lang : "de") as Lang;
  const t = T[lang];
  const [y, m, d] = String(b.day).split("-");
  const wd = new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString(({ de: "de-DE", en: "en-GB", vi: "vi-VN" } as any)[lang], { weekday: "long", timeZone: "UTC" });
  const link = `${APP}/?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(b.manage_token)}&lang=${lang}`;
  const again = `${APP}/?lang=${lang}`;
  const live = ["confirmed", "approved", "pending"].includes(kind);
  const txt = kind === "pending" ? t.pendingTxt : kind === "cancelled" ? t.cancelledTxt : kind === "rejected" ? t.rejectedTxt : t.confirmedTxt;
  const accent = kind === "cancelled" || kind === "rejected" ? "#B23B3B" : kind === "pending" ? "#2F5C9E" : "#2E7D4F";
  const det: [string, string][] = [[t.date, `${wd}, ${d}.${m}.${y}`], [t.time, String(b.slot).slice(0, 5)], [t.party, String(b.party)], [t.code, b.code]];
  if (b.note) det.push([t.note, b.note]);
  const rows = det.map(([k, v]) => `<tr><td style="padding:8px 0;color:#7a6e64;font-size:14px;border-bottom:1px solid #f0e8df;width:42%">${esc(k)}</td><td style="padding:8px 0;font-size:15px;font-weight:bold;color:#211A15;border-bottom:1px solid #f0e8df">${esc(v)}</td></tr>`).join("");
  const btn = (href: string, label: string, solid: boolean) => `<a href="${href}" style="display:inline-block;margin:6px 8px 6px 0;padding:12px 22px;border-radius:999px;font-weight:bold;font-size:15px;text-decoration:none;${solid ? "background:#F28C28;color:#1b1006" : "border:2px solid #F28C28;color:#B65C0C"}">${esc(label)}</a>`;
  if (kind === "review") {
    const rv = (n: number) => `${APP}/?review=${encodeURIComponent(b.code)}&t=${encodeURIComponent(b.manage_token)}&s=${n}&lang=${lang}`;
    const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${rv(n)}" style="display:inline-block;width:46px;text-align:center;margin:0 3px;font-size:40px;line-height:1;color:#F5B301;text-decoration:none" title="${n}">&#9733;</a>`).join("");
    const nums = [1, 2, 3, 4, 5].map((n) => `<a href="${rv(n)}" style="display:inline-block;width:46px;text-align:center;margin:0 3px;font-size:13px;color:#7a6e64;text-decoration:none">${n}</a>`).join("");
    const visit = `${wd}, ${d}.${m}.${y} · ${String(b.slot).slice(0, 5)} · ${b.party} ${t.party}`;
    const rhtml = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#f4efe9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#211A15">
<tr><td style="background:#14100c;padding:22px 28px;text-align:center"><img src="${APP}/img/logo-mail.png" width="120" alt="Vietbowl" style="display:inline-block;width:120px;height:auto;border:0"><div style="color:#F7A21B;font-size:12px;letter-spacing:3px;margin-top:6px">POTSDAMER PLATZ</div><div style="margin-top:6px;font-size:13px"><a href="${MAPS}" style="color:#d9cdbf;text-decoration:none">${ADDRESS}</a></div></td></tr>
<tr><td style="height:5px;background:#F5B301"></td></tr>
<tr><td style="padding:28px;text-align:center">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#211A15">${esc(t.review)}</h1>
<p style="margin:0 0 6px;font-size:15px">${esc(t.hello)} ${esc(b.name)},</p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#4a4039">${esc(t.reviewTxt)}</p>
<p style="margin:0 0 18px;font-size:13px;color:#7a6e64">${esc(t.visit)}: ${esc(visit)}</p>
<div style="margin:0 0 2px;white-space:nowrap">${stars}</div><div style="margin:0 0 22px;white-space:nowrap">${nums}</div>
<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#4a4039">${esc(t.googleTxt)}</p>
${btn(google, t.google, false)}
</td></tr>
<tr><td style="background:#faf6f1;padding:18px 28px;font-size:13px;line-height:1.6;color:#7a6e64">
<b style="color:#211A15">${NAME}</b><br><a href="${MAPS}" style="color:#7a6e64">${ADDRESS}</a><br>
<a href="tel:+493025931200" style="color:#7a6e64">${PHONE}</a> · <a href="mailto:${FROM}" style="color:#7a6e64">${FROM}</a><br><span style="font-size:12px">${esc(t.why)}</span></td></tr>
</table></td></tr></table></body></html>`;
    const rtext = [t.review, "", `${t.hello} ${b.name},`, t.reviewTxt, `${t.visit}: ${visit}`, "", ...[1, 2, 3, 4, 5].map((n) => `${"*".repeat(n)}  ${rv(n)}`), "", `${t.google}: ${google}`, "", `${NAME} · ${ADDRESS} · ${PHONE}`, t.why].join("\n");
    return { subject: `${t.review} – ${NAME}`, html: rhtml, text: rtext };
  }
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#f4efe9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#211A15">
<tr><td style="background:#14100c;padding:22px 28px;text-align:center"><img src="${APP}/img/logo-mail.png" width="120" alt="Vietbowl" style="display:inline-block;width:120px;height:auto;border:0"><div style="color:#F7A21B;font-size:12px;letter-spacing:3px;margin-top:6px">POTSDAMER PLATZ</div><div style="margin-top:6px;font-size:13px"><a href="${MAPS}" style="color:#d9cdbf;text-decoration:none">${ADDRESS}</a></div></td></tr>
<tr><td style="height:5px;background:${accent}"></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#211A15">${esc(t[kind])}</h1>
<p style="margin:0 0 6px;font-size:15px">${esc(t.hello)} ${esc(b.name)},</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#4a4039">${esc(txt)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>
${live ? btn(link, t.manage, true) + btn(MAPS, t.route, false) : btn(again, t.again, true)}
${live ? `<p style="margin:20px 0 0;font-size:15px">${esc(t.bye)}</p>` : ""}
</td></tr>
<tr><td style="background:#faf6f1;padding:18px 28px;font-size:13px;line-height:1.6;color:#7a6e64">
<b style="color:#211A15">${NAME}</b><br><a href="${MAPS}" style="color:#7a6e64">${ADDRESS}</a><br>
<a href="tel:+493025931200" style="color:#7a6e64">${PHONE}</a> · <a href="mailto:${FROM}" style="color:#7a6e64">${FROM}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [t[kind], "", `${t.hello} ${b.name},`, txt, "", ...det.map(([k, v]) => `${k}: ${v}`), "", live ? `${t.manage}: ${link}` : `${t.again}: ${again}`, "", `${NAME} · ${ADDRESS} · ${PHONE}`].join("\n");
  return { subject: `${t[kind]} – ${NAME}`, html, text };
}

Deno.serve(async (req) => {
  const { data: ok } = await db.rpc("nh_bk_sync_secret_ok", { s: req.headers.get("x-sync-secret") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  if (!Deno.env.get("BREVO_API_KEY")) return new Response("BREVO_API_KEY missing", { status: 503 });
  const { data: jobs, error } = await db.from("nh_bk_email_outbox")
    .select("id, kind, nh_bk_bookings(restaurant_id, code, manage_token, day, slot, party, name, email, lang, note)")
    .is("sent_at", null).is("error", null).order("id").limit(50);
  if (error) return new Response(error.message, { status: 500 });
  const { data: sts } = await db.from("nh_bk_settings").select("restaurant_id, google_review_url");
  const googleOf = (rid: string) => (sts ?? []).find((x: any) => x.restaurant_id === rid)?.google_review_url || MAPS;
  let sent = 0;
  for (const j of jobs ?? []) {
    const b: any = (j as any).nh_bk_bookings;
    if (!b?.email) { await db.from("nh_bk_email_outbox").update({ error: "no email" }).eq("id", j.id); continue; }
    const { subject, html, text } = render(j.kind, b, googleOf(b?.restaurant_id));
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ sender: { name: NAME, email: FROM }, to: [{ email: b.email, name: b.name }], replyTo: { email: FROM, name: NAME }, subject, htmlContent: html, textContent: text }),
    });
    if (r.ok) {
      await db.from("nh_bk_email_outbox").update({ sent_at: new Date().toISOString() }).eq("id", j.id); sent++;
      if (COPY !== "off" && COPY_KINDS.includes(j.kind) && COPY.toLowerCase() !== String(b.email).toLowerCase()) {
        const [y, m, d] = String(b.day).split("-");
        const tag = ({ confirmed: "Neue Reservierung", pending: "Neue Anfrage", cancelled: "Storniert" } as any)[j.kind];
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json" },
          body: JSON.stringify({ sender: { name: NAME, email: FROM }, to: [{ email: COPY, name: NAME }], replyTo: { email: b.email, name: b.name },
            subject: `[Kopie] ${tag}: ${b.name} · ${d}.${m}.${y} ${String(b.slot).slice(0, 5)} · ${b.party} P.`, htmlContent: html, textContent: text }),
        }).catch(() => {});
      }
    }
    else await db.from("nh_bk_email_outbox").update({ error: `${r.status} ${(await r.text()).slice(0, 200)}` }).eq("id", j.id);
  }
  return new Response(JSON.stringify({ sent }), { headers: { "content-type": "application/json" } });
});
