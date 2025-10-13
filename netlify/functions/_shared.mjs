import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const ENV = {
  ADMIN_KEY: process.env.ADMIN_KEY,
  BLOB_NS: process.env.BLOB_NS || 'ugc-reviews',
  COUPON_PREFIX: process.env.COUPON_PREFIX || 'NU',

  // Email (Brevo)
  BREVO_KEY: process.env.BREVO_KEY || '',
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || '',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || '自然大叔 客服中心',
  BRAND_NAME: process.env.BRAND_NAME || 'Natural Uncle',

  // Token
  TOKEN_SECRET: process.env.TOKEN_SECRET || 'replace_me',
  TOKEN_TTL_HOURS: parseInt(process.env.TOKEN_TTL_HOURS || '336', 10),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  MAX_WIDTH: parseInt(process.env.MAX_WIDTH || '1600', 10)
};

export function jsonResp(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export function requireAdmin(req) {
  const key = req.headers.get('x-admin-key');
  if (!key || key !== ENV.ADMIN_KEY) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
}

export function hmacSign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', ENV.TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function hmacVerify(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expSig = crypto.createHmac('sha256', ENV.TOKEN_SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expSig))) return null;
  const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (obj.exp && Date.now() > obj.exp) return null;
  return obj;
}

export function newToken({ order_id, phone_last4, service, area }) {
  const now = Date.now();
  const exp = now + ENV.TOKEN_TTL_HOURS * 3600 * 1000;
  return hmacSign({ order_id, phone_last4, service, area, iat: now, exp });
}

export async function parseBody(req) {
  try { return await req.json(); } catch { return {}; }
}

export function store() {
  return getStore({ name: ENV.BLOB_NS });
}

export async function blobGetJSON(key, fallback) {
  const s = store();
  const val = await s.get(key, { type: 'json' });
  return val ?? fallback;
}

export async function blobSetJSON(key, obj) {
  const s = store();
  await s.set(key, JSON.stringify(obj), { contentType: 'application/json' });
}

export function generateCoupon() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rnd = crypto.randomInt(0, 9999).toString().padStart(4, '0');
  return `${ENV.COUPON_PREFIX}-${yy}${mm}-${rnd}`;
}

// === Brevo mail ===
export async function sendCouponByEmail({ toEmail, toName, coupon }) {
  if (!ENV.BREVO_KEY || !toEmail) return { skipped: true };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': ENV.BREVO_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { email: ENV.BREVO_SENDER_EMAIL, name: ENV.BREVO_SENDER_NAME },
      to: [{ email: toEmail, name: toName || '' }],
      subject: `[${ENV.BRAND_NAME}] 您的 $100 回饋折抵序號`,
      htmlContent: `<p>感謝您的分享！這是您的折抵序號：</p><p style="font-size:18px"><strong>${coupon}</strong></p><p>於下次預約時出示即可折抵（有效期 60 天）。</p>`
    })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error('Brevo send failed: ' + JSON.stringify(data));
  return data;
}

// === Cloudinary simple upload without watermark ===
function cloudinarySign(params) {
  const entries = Object.entries(params).filter(([k,v]) => v !== undefined && v !== null && v !== '');
  entries.sort(([a],[b]) => a.localeCompare(b));
  const toSign = entries.map(([k,v]) => `${k}=${v}`).join('&') + ENV.CLOUDINARY_API_SECRET;
  return crypto.createHash('sha1').update(toSign).digest('hex');
}

export async function cloudinaryUpload({ file, folder = 'ugc', public_id = undefined }) {
  const ts = Math.floor(Date.now()/1000);
  const transformation = `q_auto,f_auto,w_${ENV.MAX_WIDTH},fl_strip_profile`;

  const params = {
    timestamp: ts,
    folder,
    transformation
  };
  if (public_id) params.public_id = public_id;

  const signature = cloudinarySign(params);
  const form = new FormData();
  for (const [k,v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', ENV.CLOUDINARY_API_KEY);
  form.append('signature', signature);
  form.append('file', file);

  const url = `https://api.cloudinary.com/v1_1/${ENV.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error('Cloudinary upload failed: ' + JSON.stringify(data));
  return data;
}
