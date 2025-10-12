// netlify/functions/token.mjs
import { jsonResp, requireAdmin, newToken, parseBody } from './_shared.mjs';

export default async (req) => {
  try {
    if (req.method !== 'POST') return jsonResp(405, { error: 'Method not allowed' });
    requireAdmin(req);
    const { order_id, phone_last4, service, area } = await parseBody(req);
    if (!order_id || !phone_last4) return jsonResp(400, { error: 'order_id 與 phone_last4 必填' });
    const token = newToken({ order_id, phone_last4, service, area });
    return jsonResp(200, { token });
  } catch (err) {
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
}
