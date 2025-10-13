import { jsonResp, parseBody, blobGetJSON, blobSetJSON, cloudinaryUpload, generateCoupon, sendCouponByEmail, requireAdmin, ENV } from './_shared.mjs';

const REVIEW_KEY = 'reviews/index.json';

export default async (req) => {
  try {
    // === GET：載入待審核 ===
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const status = url.searchParams.get('status') || 'pending';
      const db = await blobGetJSON(REVIEW_KEY, []);
      const items = db.filter(r => r.status === status);
      return jsonResp(200, { items });
    }

    // === PUT：審核或回覆 ===
    if (req.method === 'PUT') {
      requireAdmin(req);
      const { id, action, ownerReply } = await parseBody(req);
      const db = await blobGetJSON(REVIEW_KEY, []);
      const item = db.find(r => r.id === id);
      if (!item) return jsonResp(404, { error: '找不到資料' });

      if (action === 'approve') {
        item.status = 'approved';
        if (item.email) {
          const coupon = generateCoupon();
          await sendCouponByEmail({ toEmail: item.email, toName: item.name, coupon });
          item.coupon = coupon;
        }
      } else if (action === 'reject') {
        item.status = 'rejected';
      } else if (action === 'remove') {
        item.status = 'removed';
      } else if (action === 'reply') {
        item.ownerReply = ownerReply || '';
      } else {
        return jsonResp(400, { error: '未知的操作' });
      }

      await blobSetJSON(REVIEW_KEY, db);
      return jsonResp(200, { ok: true });
    }

    // === POST：提交新評論 ===
    if (req.method !== 'POST') return jsonResp(405, { error: 'Method not allowed' });
    const { token, name, area, service, rating, text, images, email } = await parseBody(req);

    if (!name || !text) return jsonResp(400, { error: '缺少必要欄位' });
    if (!images || images.length === 0) return jsonResp(400, { error: '請至少上傳一張圖片' });

    const uploadedImages = [];
    for (const img of images.slice(0, 3)) {
      const up = await cloudinaryUpload({ file: img });
      uploadedImages.push(up.secure_url);
    }

    const review = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      name, area, service, rating, comment: text, images: uploadedImages,
      email: email || '',
    };

    const db = await blobGetJSON(REVIEW_KEY, []);
    db.push(review);
    await blobSetJSON(REVIEW_KEY, db);

    return jsonResp(200, { message: '投稿成功' });

  } catch (err) {
    console.error('[reviews] Error:', err);
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
};
