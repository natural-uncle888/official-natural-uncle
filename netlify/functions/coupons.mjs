// netlify/functions/coupons.mjs
import { jsonResp, parseBody, requireAdmin, blobGetJSON, blobSetJSON } from './_shared.mjs';

const COUPONS_KEY = 'coupons/index.json';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'verify';

    if (req.method === 'POST' && action === 'verify') return verify(req);
    if (req.method === 'POST' && action === 'redeem') return redeem(req);
    return jsonResp(405, { error: 'Method not allowed' });
  } catch (err) {
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
}

async function verify(req) {
  const { code } = await parseBody(req);
  if (!code) return jsonResp(400, { error: 'code 必填' });
  const db = await blobGetJSON(COUPONS_KEY, { used: {}, issued: {} });
  const issued = db.issued?.[code];
  const used = db.used?.[code];
  return jsonResp(200, {
    exists: Boolean(issued),
    used: Boolean(used),
    used_at: used?.used_at || null
  });
}

async function redeem(req) {
  requireAdmin(req);
  const { code } = await parseBody(req);
  if (!code) return jsonResp(400, { error: 'code 必填' });
  const db = await blobGetJSON(COUPONS_KEY, { used: {}, issued: {} });
  if (!db.issued?.[code]) return jsonResp(404, { error: 'code 不存在' });
  if (db.used?.[code]) return jsonResp(409, { error: 'code 已使用' });

  db.used = db.used || {};
  db.used[code] = { used_at: new Date().toISOString() };
  await blobSetJSON(COUPONS_KEY, db);
  return jsonResp(200, { ok: true });
}
