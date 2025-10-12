// netlify/functions/reviews.mjs
import { jsonResp, parseBody, hmacVerify, blobGetJSON, blobSetJSON, requireAdmin, generateCoupon, sendCouponByEmail, cloudinaryUpload } from './_shared.mjs';

/**
 * 資料結構（Blobs）
 * - reviews/index.json: { list: [ {id, status, createdAt, who, name, area, service, rating, comment, images, ownerReply, tokenPayload, couponCode, email } ] }
 * - coupons/index.json: { used: { CODE: { used_at } }, issued: { CODE: {...} } }
 */

const REVIEWS_KEY = 'reviews/index.json';
const COUPONS_KEY = 'coupons/index.json';

export default async (req) => {
  try {
    if (req.method === 'GET') return getReviews(req);
    if (req.method === 'POST') return createReview(req);
    if (req.method === 'PUT') return adminAction(req);
    return jsonResp(405, { error: 'Method not allowed' });
  } catch (err) {
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
}

async function getReviews(req) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'approved';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('page_size') || '9', 10);

  const db = await blobGetJSON(REVIEWS_KEY, { list: [] });
  const filtered = db.list.filter(it => it.status === status).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const slice = filtered.slice(start, end);

  return jsonResp(200, {
    items: slice.map(({ tokenPayload, ...rest }) => rest),
    page, pageSize, total: filtered.length,
    hasMore: end < filtered.length
  });
}

async function createReview(req) {
  const body = await parseBody(req);
  const { token, name, area, service, rating, comment, images = [], email } = body || {};

  const payload = hmacVerify(token);
  if (!payload) return jsonResp(401, { error: '無效或過期的專屬連結' });

  if (!Array.isArray(images) || images.length < 1 || images.length > 2) {
    return jsonResp(400, { error: '請上傳 1–2 張與本次服務相關之照片' });
  }

  if (!name || !service || !area) return jsonResp(400, { error: 'name / service / area 為必填' });
  const ratingInt = parseInt(rating, 10);
  if (Number.isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return jsonResp(400, { error: 'rating 需為 1–5' });
  }

  // 上傳圖片到 Cloudinary（支援 base64 data URL 或 http(s) URL）
  const uploaded = [];
  for (let i=0;i<images.length;i++) {
    const file = images[i];
    try {
      const res = await cloudinaryUpload({ file, folder: 'natural-uncle/ugc' });
      uploaded.push(res.secure_url);
    } catch (e) {
      return jsonResp(500, { error: '圖片上傳失敗，請稍後再試' });
    }
  }

  const db = await blobGetJSON(REVIEWS_KEY, { list: [] });
  const id = 'r' + Math.random().toString(36).slice(2, 8);
  const nowIso = new Date().toISOString();
  const item = {
    id,
    status: 'pending',
    createdAt: nowIso,
    who: 'customer',
    name,
    area,
    service,
    rating: ratingInt,
    comment: String(comment || ''),
    images: uploaded,
    ownerReply: '',
    tokenPayload: payload,
    email: email || ''
  };
  db.list.push(item);
  await blobSetJSON(REVIEWS_KEY, db);

  return jsonResp(200, { ok: true, id });
}

async function adminAction(req) {
  requireAdmin(req);
  const body = await parseBody(req);
  const { id, action, ownerReply } = body || {};
  if (!id || !action) return jsonResp(400, { error: 'id 與 action 必填' });

  const db = await blobGetJSON(REVIEWS_KEY, { list: [] });
  const idx = db.list.findIndex(r => r.id === id);
  if (idx === -1) return jsonResp(404, { error: 'review not found' });

  const item = db.list[idx];

  if (action === 'approve') {
    item.status = 'approved';
    // 發放折扣碼
    const coupons = await blobGetJSON(COUPONS_KEY, { used: {}, issued: {} });
    let code;
    do { code = generateCoupon(); } while (coupons.issued?.[code]);
    coupons.issued = coupons.issued || {};
    coupons.issued[code] = { created_at: new Date().toISOString(), review_id: id, order_id: item?.tokenPayload?.order_id || null };
    item.couponCode = code;
    await blobSetJSON(COUPONS_KEY, coupons);

    if (item.email) {
      try { await sendCouponByEmail({ toEmail: item.email, toName: item.name, coupon: code }); }
      catch(e) { item.couponSendError = String(e.message || e); }
    }
  } else if (action === 'reject') {
    item.status = 'rejected';
  } else if (action === 'remove') {
    item.status = 'removed';
  } else if (action === 'reply') {
    item.ownerReply = String(ownerReply || '');
  } else {
    return jsonResp(400, { error: '未知 action' });
  }

  db.list[idx] = item;
  await blobSetJSON(REVIEWS_KEY, db);
  return jsonResp(200, { ok: true, item });
}
