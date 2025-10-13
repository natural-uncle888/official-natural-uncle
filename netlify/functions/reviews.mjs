// netlify/functions/reviews.mjs
import crypto from 'node:crypto';

// === 環境變數 ===
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY     = process.env.CLOUDINARY_API_KEY;
const API_SECRET  = process.env.CLOUDINARY_API_SECRET;

// 選用：若你原本有管理員驗證（建議沿用原本 token 機制）
const ADMIN_KEY   = process.env.ADMIN_KEY || ''; // PUT/DELETE 用

// 資料夾配置（你已確認 OK）
const FOLDER_JSON   = 'reviews-json';
const FOLDER_IMAGES = 'reviews-images';

// 其他設定
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

// === 小工具 ===
const uuid = () => crypto.randomUUID();

const jsonResp = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
});

// 將 dataURI(base64) 解析為 Buffer（前端若用 <input type="file"> 可用 FileReader 轉 dataURL 傳來）
function parseDataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Invalid image dataURL');
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  return { mime, buf };
}

// 產生 Cloudinary 簽名
function sign(params, secret) {
  // Cloudinary 簽名規則：對 params (key=val&...) 以字典序串接 + secret 做 SHA1
  const toSign = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&') + secret;
  return crypto.createHash('sha1').update(toSign).digest('hex');
}

// 圖片上傳（resource_type=image）
async function cloudinaryUploadImage({ folder, fileBuffer, fileMime, public_id }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id,
    timestamp,
  };
  const signature = sign(params, API_SECRET);

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: fileMime }), public_id + '.bin');
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', public_id);
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Cloudinary image upload failed (${resp.status})`);
  return await resp.json(); // 包含 secure_url, public_id, resource_type ...
}

// JSON 上傳（resource_type=raw）
async function cloudinaryUploadJSON({ folder, public_id, jsonObj, overwrite = false }) {
  const timestamp = Math.floor(Date.now() / 1000);

  // 上傳參數：folder, public_id, overwrite, timestamp
  const params = {
    folder,
    public_id,
    overwrite: overwrite ? 'true' : 'false',
    timestamp,
  };
  const signature = sign(params, API_SECRET);

  const fileStr = JSON.stringify(jsonObj);
  const form = new FormData();
  form.append('file', new Blob([fileStr], { type: 'application/json' }), public_id + '.json');
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', public_id);
  form.append('overwrite', overwrite ? 'true' : 'false');
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Cloudinary JSON upload failed (${resp.status})`);
  return await resp.json(); // 包含 secure_url, public_id
}

// 搜尋 reviews-json 下的 JSON 檔（支援分頁）
async function cloudinarySearchJSON({ expression, next_cursor, max_results = 30 }) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;
  const body = {
    expression,
    max_results,
    next_cursor,
    resource_type: 'raw',
  };
  const auth = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Cloudinary search failed (${resp.status})`);
  return await resp.json(); // { resources, next_cursor }
}

// 讀取單一 JSON（用 secure_url）
async function fetchJSON(secure_url) {
  const resp = await fetch(secure_url, { method: 'GET' });
  if (!resp.ok) throw new Error(`Fetch JSON failed (${resp.status})`);
  return await resp.json();
}

// 覆寫（更新）JSON：先讀、改、再覆寫
async function updateReviewJSON(public_id, mutator) {
  // 先找 secure_url
  const { resources } = await cloudinarySearchJSON({
    expression: `resource_type:raw AND folder:${FOLDER_JSON} AND public_id=${FOLDER_JSON}/${public_id}`
  });
  if (!resources?.length) throw new Error('Review JSON not found');
  const secure_url = resources[0].secure_url;
  const current = await fetchJSON(secure_url);
  const next = mutator(current);
  await cloudinaryUploadJSON({ folder: FOLDER_JSON, public_id, jsonObj: next, overwrite: true });
  return next;
}

// 刪除 JSON 或圖片（Admin API destroy）
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

// 簡單的 Body 解析（JSON）
async function parseJSON(req) {
  const text = await req.text();
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON body'); }
}

// 權限（PUT/DELETE）
function requireAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

// === 主處理 ===
export default async (req) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return jsonResp(500, { error: 'Missing Cloudinary env' });
    }

    const url = new URL(req.url);

    // === 1) 取得評論（支援 status 篩選、分頁） ===
    if (req.method === 'GET') {
      const status = url.searchParams.get('status'); // 可選：pending/approved/rejected
      const perPage = Math.min(parseInt(url.searchParams.get('perPage') || '20', 10), 50);
      const next = url.searchParams.get('next') || undefined;

      // 搜尋 reviews-json 底下的所有 raw
      const expression = `resource_type:raw AND folder:${FOLDER_JSON}`;
      const search = await cloudinarySearchJSON({ expression, next_cursor: next, max_results: perPage });

      // 下載每筆 JSON
      const itemsRaw = await Promise.all(
        (search.resources || []).map(r => fetchJSON(r.secure_url))
      );

      // status 篩選（如果有帶）
      const items = status ? itemsRaw.filter(x => x.status === status) : itemsRaw;

      return jsonResp(200, { items, next: search.next_cursor || null });
    }

    // === 2) 新增評論（圖片可選） ===
    if (req.method === 'POST') {
      const body = await parseJSON(req);
      const { nickname, content, stars, email, imageData } = body || {};

      if (!nickname || !content) return jsonResp(400, { error: 'nickname, content are required' });

      const id = uuid();
      let imageUrl = null;
      let imagePublicId = null;

      if (imageData) {
        const parsed = parseDataUrlToBuffer(imageData);
        if (!parsed) return jsonResp(400, { error: 'Invalid image data' });
        if (parsed.buf.length > MAX_IMAGE_BYTES) {
          return jsonResp(413, { error: 'Image too large (max 5MB)' });
        }
        // 上傳圖片
        const res = await cloudinaryUploadImage({
          folder: FOLDER_IMAGES,
          fileBuffer: parsed.buf,
          fileMime: parsed.mime,
          public_id: id, // 與評論同 id，便於關聯
        });
        imageUrl = res.secure_url || null;
        imagePublicId = res.public_id || null;
      }

      const review = {
        id,
        nickname: String(nickname),
        content: String(content),
        stars: Math.max(1, Math.min(5, parseInt(stars || 5, 10))),
        image: imageUrl,
        image_public_id: imagePublicId, // 之後 DELETE 會用到
        email: email ? String(email) : null,
        status: 'pending', // 預設待審核
        createdAt: Date.now(),
      };

      // 上傳 JSON（raw）
      await cloudinaryUploadJSON({
        folder: FOLDER_JSON,
        public_id: id,           // reviews-json/<id>.json
        jsonObj: review,
        overwrite: false,
      });

      return jsonResp(200, { message: '投稿成功', id });
    }

    // === 3) 審核（需要管理員） ===
    if (req.method === 'PUT') {
      requireAdmin(req);
      const body = await parseJSON(req);
      const { id, action } = body || {};
      if (!id || !['approve', 'reject'].includes(action)) {
        return jsonResp(400, { error: 'id and action(approve|reject) required' });
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      const updated = await updateReviewJSON(id, (cur) => ({
        ...cur,
        status: newStatus,
        // 可視需要補上 reviewedAt, reviewer...
        reviewedAt: Date.now(),
      }));

      return jsonResp(200, { message: 'updated', item: updated });
    }

    // === 4) 刪除（需要管理員） ===
    if (req.method === 'DELETE') {
      requireAdmin(req);
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return jsonResp(400, { error: 'id required' });

      // 找到 JSON，為了拿 image_public_id
      const { resources } = await cloudinarySearchJSON({
        expression: `resource_type:raw AND folder:${FOLDER_JSON} AND public_id=${FOLDER_JSON}/${id}`
      });
      if (!resources?.length) return jsonResp(404, { error: 'not found' });
      const data = await fetchJSON(resources[0].secure_url);

      // 先刪 JSON
      await cloudinaryDestroy({ public_id: `${FOLDER_JSON}/${id}`, resource_type: 'raw' });

      // 再刪圖片（如果有）
      if (data.image_public_id) {
        await cloudinaryDestroy({ public_id: data.image_public_id, resource_type: 'image' });
      }

      return jsonResp(200, { message: 'deleted', id });
    }

    return jsonResp(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[reviews] Error:', err);
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
};
