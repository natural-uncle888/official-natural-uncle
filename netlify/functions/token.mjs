import { jsonResp, requireAdmin, parseBody } from './_shared.mjs';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

cloudinary.config({
  cloud_name: 'dvz4druzc',
  api_key: '621946199565916',
  api_secret: '6zrHnSHoUiTPMHNUJ6aiJAW7aHk'
});

function generateShortToken(length = 6) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return jsonResp(405, { error: 'Method not allowed' });
    requireAdmin(req);
    const { order_id, phone_last4, service, area } = await parseBody(req);

    const token = generateShortToken(6);

    const payload = {
      order_id: order_id || null,
      phone_last4: phone_last4 || null,
      service: service || null,
      area: area || null,
      created_at: new Date().toISOString()
    };

    await cloudinary.uploader.upload_stream({
      resource_type: 'raw',
      public_id: `orders/${token}`,
      format: 'json',
      type: 'upload',
      folder: 'orders'
    }, (error, result) => {
      if (error) throw new Error('Cloudinary 上傳失敗');
    }).end(JSON.stringify(payload));

    return jsonResp(200, { token });
  } catch (err) {
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
}
