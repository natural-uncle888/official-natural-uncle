// netlify/functions/reviews.mjs
import { getStore, initCloudinary, assertEnv, env, dataURLtoBuffer, rid } from './_shared.mjs';
import * as jose from 'jose';

export const handler = async (event) => {
  try {
    assertEnv();
    const store = getStore();

    if (event.httpMethod === 'OPTIONS') {
      return ok({ ok: true }); // 簡易 CORS
    }

    if (event.httpMethod === 'GET') {
      // /reviews?status=approved&page=1&page_size=6
      const url = new URL(event.rawUrl);
      const status = url.searchParams.get('status') || 'approved';
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const size = parseInt(url.searchParams.get('page_size') || '6', 10);
      // 從 blobs 讀 index
      const idxKey = `idx_${status}.json`;
      const idx = await readJSON(store, idxKey) || [];
      const start = (page - 1) * size;
      const ids = idx.slice(start, start + size);
      const items = [];
      for (const id of ids) {
        const it = await readJSON(store, `review_${id}.json`);
        if (it) items.push(it);
      }
      return ok({ items, hasMore: start + size < idx.length });
    }

    if (event.httpMethod === 'POST') {
      // 送出投稿：驗證 token、限制圖片、上傳 Cloudinary、存 pending
      const body = JSON.parse(event.body || '{}');

      // token 驗證（與 /.netlify/functions/token 使用同一把 TOKEN_SECRET）
      const { token, name, area, service, rating, comment, images } = body;
      if (!token) return bad('missing_token');
      try {
        await jose.jwtVerify(token, new TextEncoder().encode(env.TOKEN_SECRET));
      } catch (e) {
        return bad('invalid_or_expired_token');
      }

      // 檢查欄位
      if (!name || !service || !area) return bad('missing_fields');
      const score = Number(rating || 0);
      if (!(score >= 1 && score <= 5)) return bad('invalid_rating');

      // 圖片必填、最多 2 張、10MB 限制、4:3 裁切
      const imgs = Array.isArray(images) ? images.slice(0, 2) : [];
      if (imgs.length < 1) return bad('need_at_least_one_image');

      // 上傳
      const cld = initCloudinary();
      const uploadedUrls = [];
      for (const d of imgs) {
        const { mime, buf } = dataURLtoBuffer(d);
        const sizeMB = buf.byteLength / (1024 * 1024);
        if (sizeMB > 10) return bad('image_too_large');

        // 使用 upload_stream 較穩
        const url = await new Promise((resolve, reject) => {
          const stream = cld.uploader.upload_stream(
            {
              folder: 'ugc',
              resource_type: 'image',
              overwrite: false,
              transformation: [
                { aspect_ratio: "4:3", crop: "fill", gravity: "auto" }
              ]
            },
            (err, res) => {
              if (err) reject(err);
              else resolve(res.secure_url);
            }
          );
          stream.end(buf);
        });
        uploadedUrls.push(url);
      }

      const now = new Date().toISOString();
      const id = rid('r');
      const review = {
        id,
        name,
        area,
        service,
        rating: score,
        comment: (comment || '').toString().slice(0, 2000),
        images: uploadedUrls,
        ownerReply: "",
        status: "pending",
        createdAt: now
      };

      await writeJSON(store, `review_${id}.json`, review);
      await appendIndex(store, 'pending', id);

      return ok({ ok: true, id });
    }

    return notFound();
  } catch (err) {
    console.error('reviews error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};

function ok(data) {
  return resp(200, data);
}
function bad(msg) {
  return resp(400, { error: msg });
}
function notFound() {
  return resp(404, { error: 'not_found' });
}
function resp(code, data) {
  return {
    statusCode: code,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-admin-key'
    },
    body: JSON.stringify(data)
  };
}

async function readJSON(store, key) {
  const r = await store.get(key);
  if (!r) return null;
  return JSON.parse(await r.text());
}
async function writeJSON(store, key, obj) {
  await store.set(key, JSON.stringify(obj), { contentType: 'application/json; charset=utf-8' });
}
async function appendIndex(store, status, id) {
  const key = `idx_${status}.json`;
  const arr = (await readJSON(store, key)) || [];
  arr.unshift(id);
  await writeJSON(store, key, arr);
}
