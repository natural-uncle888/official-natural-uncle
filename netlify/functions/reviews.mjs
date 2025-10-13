// netlify/functions/reviews.mjs
// Node 18+ ；Cloudinary raw(JSON) + image upload；POST 支援 1~3 張圖片（eager 壓縮 q_85,f_jpg）
//
// 需要的環境變數：
// CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// ADMIN_KEY（用於 PUT/DELETE 權限）
//
// 前端 POST JSON 格式：
// {
//   nickname: "string",
//   content: "string",
//   stars: 1..5,
//   email: "string|null",
//   imagesData: ["data:image/...;base64,....", ...] // 0~3 張，可省略
// }

import crypto from 'node:crypto';

const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY     = process.env.CLOUDINARY_API_KEY;
const API_SECRET  = process.env.CLOUDINARY_API_SECRET;
const ADMIN_KEY   = process.env.ADMIN_KEY || '';

const FOLDER_JSON   = 'reviews-json';
const FOLDER_IMAGES = 'reviews-images';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 3;

const jsonResp = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const uuid = () => crypto.randomUUID();

function sign(params, secret) {
  // Cloudinary signature: sorted query (k=v&...) + secret -> sha1
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + secret;
  return crypto.createHash('sha1').update(toSign).digest('hex');
}

function parseDataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Invalid image dataURL');
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  return { mime, buf };
}

async function cloudinaryUploadImage({ folder, fileBuffer, fileMime, public_id }) {
  // 產生 eager 壓縮版（q_85,f_jpg），回存該壓縮 URL
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id,
    timestamp,
    eager: 'q_85,f_jpg', // 壓縮 85%、轉 jpg
  };
  const signature = sign(params, API_SECRET);

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: fileMime }), public_id + '.bin');
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', public_id);
  form.append('eager', 'q_85,f_jpg');
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Cloudinary image upload failed (${resp.status})`);
  const data = await resp.json();
  // 盡量拿 eager 生成的壓縮 URL；若無則退回原圖 URL
  const compressedUrl = data?.eager?.[0]?.secure_url || data.secure_url;
  return {
    secure_url: compressedUrl,
    public_id: data.public_id,
  };
}

async function cloudinaryUploadJSON({ folder, public_id, jsonObj, overwrite = false }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id,
    overwrite: overwrite ? 'true' : 'false',
    timestamp,
  };
  const signature = sign(params, API_SECRET);

  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(jsonObj)], { type: 'application/json' }), public_id + '.json');
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', public_id);
  form.append('overwrite', overwrite ? 'true' : 'false');
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Cloudinary JSON upload failed (${resp.status})`);
  return await resp.json();
}

async function cloudinarySearchRaw({ expression, next_cursor, max_results = 30 }) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;
  const body = { expression, next_cursor, max_results, resource_type: 'raw' };
  const auth = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Cloudinary search failed (${resp.status})`);
  return await resp.json(); // { resources, next_cursor }
}

async function fetchJSON(secure_url) {
  const resp = await fetch(secure_url);
  if (!resp.ok) throw new Error(`Fetch JSON failed (${resp.status})`);
  return await resp.json();
}

async function updateReviewJSON(public_id, mutator) {
  const { resources } = await cloudinarySearchRaw({
    expression: `resource_type:raw AND folder:${FOLDER_JSON} AND public_id=${FOLDER_JSON}/${public_id}`,
  });
  if (!resources?.length) throw new Error('Review JSON not found');
  const secure_url = resources[0].secure_url;
  const current = await fetchJSON(secure_url);
  const next = mutator(current);
  await cloudinaryUploadJSON({ folder: FOLDER_JSON, public_id, jsonObj: next, overwrite: true });
  return next;
}

async function cloudinaryDestroy({ public_id, resource_type = 'raw' }) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resource_type}/destroy`;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id, timestamp };
  const signature = sign(params, API_SECRET);

  const form = new URLSearchParams();
  form.set('public_id', public_id);
  form.set('timestamp', String(timestamp));
  form.set('api_key', API_KEY);
  form.set('signature', signature);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!resp.ok) throw new Error(`Cloudinary destroy failed (${resp.status})`);
  return await resp.json();
}

function requireAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!ADMIN_KEY || token !== ADMIN_KEY) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

export default async (req) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return jsonResp(500, { error: 'Missing Cloudinary env' });
    }

    const url = new URL(req.url);

    // === GET：載入評論（可用 ?status=pending|approved|rejected & perPage & next） ===
    if (req.method === 'GET') {
      const status = url.searchParams.get('status'); // optional
      const perPage = Math.min(parseInt(url.searchParams.get('perPage') || '20', 10), 50);
      const next = url.searchParams.get('next') || undefined;

      const expression = `resource_type:raw AND folder:${FOLDER_JSON}`;
      const search = await cloudinarySearchRaw({ expression, next_cursor: next, max_results: perPage });

      const itemsRaw = await Promise.all((search.resources || []).map((r) => fetchJSON(r.secure_url)));
      const items = status ? itemsRaw.filter((x) => x.status === status) : itemsRaw;

      return jsonResp(200, { items, next: search.next_cursor || null });
    }

    // === POST：新增評論（升級支援多圖） ===
    if (req.method === 'POST') {
      let bodyText = await req.text();
      let body = {};
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        return jsonResp(400, { error: 'Invalid JSON body' });
      }

      const { nickname, content, stars, email, imagesData } = body || {};
      if (!nickname || !content) return jsonResp(400, { error: 'nickname, content are required' });

      const id = uuid();
      const images = [];
      const image_public_ids = [];

      // 允許 0~3 張
      const list = Array.isArray(imagesData) ? imagesData.slice(0, MAX_IMAGES) : [];
      for (let i = 0; i < list.length; i++) {
        const dataUrl = list[i];
        if (!dataUrl) continue;

        const parsed = parseDataUrlToBuffer(dataUrl);
        if (!parsed) return jsonResp(400, { error: 'Invalid image data' });
        if (parsed.buf.length > MAX_IMAGE_BYTES) {
          return jsonResp(413, { error: 'Image too large (max 5MB each)' });
        }

        const res = await cloudinaryUploadImage({
          folder: FOLDER_IMAGES,
          fileBuffer: parsed.buf,
          fileMime: parsed.mime,
          public_id: `${id}-${i + 1}`,
        });
        images.push(res.secure_url);
        image_public_ids.push(res.public_id);
      }

      const review = {
        id,
        nickname: String(nickname),
        content: String(content),
        stars: Math.max(1, Math.min(5, parseInt(stars || 5, 10))),
        images,                // ✅ 存壓縮後(或 eager) URL 陣列
        image_public_ids,      // ⛳️ 供日後刪除用
        email: email ? String(email) : null,
        status: 'pending',
        createdAt: Date.now(),
      };

      await cloudinaryUploadJSON({
        folder: FOLDER_JSON,
        public_id: id,
        jsonObj: review,
        overwrite: false,
      });

      return jsonResp(200, { ok: true, message: '評論已送出，等待審核', id });
    }

    // === PUT：審核（approve / reject） ===
    if (req.method === 'PUT') {
      requireAdmin(req);
      let bodyText = await req.text();
      let body = {};
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        return jsonResp(400, { error: 'Invalid JSON body' });
      }

      const { id, action } = body || {};
      if (!id || !['approve', 'reject'].includes(action)) {
        return jsonResp(400, { error: 'id and action(approve|reject) required' });
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      const updated = await updateReviewJSON(id, (cur) => ({
        ...cur,
        status: newStatus,
        reviewedAt: Date.now(),
      }));

      return jsonResp(200, { message: 'updated', item: updated });
    }

    // === DELETE：刪除（JSON + 關聯圖片） ===
    if (req.method === 'DELETE') {
      requireAdmin(req);
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return jsonResp(400, { error: 'id required' });

      const { resources } = await cloudinarySearchRaw({
        expression: `resource_type:raw AND folder:${FOLDER_JSON} AND public_id=${FOLDER_JSON}/${id}`,
      });
      if (!resources?.length) return jsonResp(404, { error: 'not found' });

      const data = await fetchJSON(resources[0].secure_url);

      // 先刪 JSON
      await cloudinaryDestroy({ public_id: `${FOLDER_JSON}/${id}`, resource_type: 'raw' });

      // 再刪關聯圖片
      if (Array.isArray(data.image_public_ids)) {
        for (const pid of data.image_public_ids) {
          try {
            await cloudinaryDestroy({ public_id: pid, resource_type: 'image' });
          } catch (e) {
            // 不中斷刪除流程
            console.warn('[reviews] delete image failed', pid, e?.message);
          }
        }
      }

      return jsonResp(200, { message: 'deleted', id });
    }

    return jsonResp(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[reviews] Error:', err);
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
};
