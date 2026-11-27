// Hàm thuần cho nh-bank (Enable Banking): ký JWT, đổi dữ liệu giao dịch / số dư. Kiểm tra: npx tsx tests/bank.mts

const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function derLen(n: number) {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}
const der = (tag: number, body: Uint8Array) => new Uint8Array([tag, ...derLen(body.length), ...body]);

/** PEM -> DER PKCS#8. Nhận "BEGIN PRIVATE KEY" (PKCS#8) lẫn "BEGIN RSA PRIVATE KEY" (PKCS#1, tự bọc lại). */
export function pemToPkcs8(pem: string): Uint8Array {
  const m = pem.match(/-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/);
  if (!m) throw new Error("invalid_key");
  const raw = Uint8Array.from(atob(m[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  if (m[1] === "PRIVATE KEY") return raw;
  // PKCS#1 -> PKCS#8: SEQ { INT 0, SEQ { OID rsaEncryption, NULL }, OCTET STRING pkcs1 }
  const ver = new Uint8Array([0x02, 0x01, 0x00]);
  const alg = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const oct = der(0x04, raw);
  return der(0x30, new Uint8Array([...ver, ...alg, ...oct]));
}

export function isPem(s: string) { return /-----BEGIN (RSA )?PRIVATE KEY-----/.test(s || ""); }

/** JWT RS256 cho Enable Banking API (kid = Application ID, tối đa 24 giờ) */
export async function makeJwt(appId: string, pem: string, ttl = 3600, now = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const body = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + ttl }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

type O = Record<string, unknown>;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Chọn số dư hiển thị: ưu tiên khả dụng (ITAV/CLAV/XPCD), sau đó số dư sổ sách (CLBD/ITBD) */
export function pickBalance(balances: O[]): { amount: number; type: string; currency: string } | null {
  const order = ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "OPAV", "PRCD", "INFO", "OTHR"];
  const list = (balances || []).filter((b) => num((b.balance_amount as O)?.amount) != null);
  if (!list.length) return null;
  list.sort((a, b) => {
    const ia = order.indexOf(String(a.balance_type)), ib = order.indexOf(String(b.balance_type));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const b = list[0], amt = b.balance_amount as O;
  return { amount: Number(amt.amount), type: String(b.balance_type || ""), currency: String(amt.currency || "EUR") };
}

async function sha1(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface TxRow {
  id: string; iban: string | null; booking_date: string | null; value_date: string | null; amount: number; currency: string
  counterparty: string | null; counterparty_iban: string | null; purpose: string | null; status: string | null; raw: O
}

/** Giao dịch Enable Banking -> dòng nh_bank_tx (số tiền có dấu: tiền ra là âm) */
export async function toTxRow(t: O, accountIban: string | null): Promise<TxRow> {
  const amt = t.transaction_amount as O || {};
  let amount = Math.abs(Number(amt.amount || 0));
  if (String(t.credit_debit_indicator || "").toUpperCase() === "DBIT") amount = -amount;
  amount = Math.round(amount * 100) / 100;
  const out = amount < 0;
  const cp = (out ? t.creditor : t.debtor) as O | undefined;
  const cpAcc = (out ? t.creditor_account : t.debtor_account) as O | undefined;
  const ri = t.remittance_information;
  const purpose = Array.isArray(ri) ? ri.filter(Boolean).join(" ") : (ri ? String(ri) : null);
  const booking = (t.booking_date || t.transaction_date || t.value_date || null) as string | null;
  const status = (t.status as string) || null;
  // entry_reference không duy nhất toàn cục, nên ghép thêm các trường để băm
  const key = [accountIban || "", booking || "", amount.toFixed(2), purpose || "", cp?.name || "", t.entry_reference || "", status === "PDNG" ? "P" : ""].join("|");
  return {
    id: await sha1(key), iban: accountIban, booking_date: booking ? booking.slice(0, 10) : null,
    value_date: t.value_date ? String(t.value_date).slice(0, 10) : null, amount, currency: String(amt.currency || "EUR"),
    counterparty: (cp?.name as string) || null, counterparty_iban: (cpAcc?.iban as string) || null,
    purpose: purpose ? purpose.replace(/\s+/g, " ").trim().slice(0, 1000) : null, status, raw: t,
  };
}

/** Tiêu đề PSU khi chủ đang mở app (giúp không bị giới hạn 4 lần/ngày). Gửi đủ hoặc không gửi gì. */
export function psuHeaders(required: string[], req: { ip?: string | null; ua?: string | null; lang?: string | null; referer?: string | null; accept?: string | null; enc?: string | null }) {
  const all: Record<string, string | null | undefined> = {
    "psu-ip-address": req.ip, "psu-user-agent": req.ua, "psu-accept-language": req.lang, "psu-referer": req.referer,
    "psu-accept": req.accept || "application/json", "psu-accept-charset": "utf-8", "psu-accept-encoding": req.enc || "gzip, deflate, br",
  };
  if (!req.ip) return {};
  const h: Record<string, string> = {};
  for (const r of required.length ? required : ["Psu-Ip-Address", "Psu-User-Agent"]) {
    const v = all[r.toLowerCase()];
    if (!v) return {}; // thiếu trường bắt buộc -> coi như chạy nền
    h[r] = v;
  }
  return h;
}
