# Netlify Functions & Admin UI — Cloudinary 版優惠碼與評論後台整合

本文件包含：

1. `netlify/functions/coupons.mjs`（完整可用）
2. `admin-reviews.html` 需加入的前端 JS 區塊（可直接覆蓋或插入）
3. 測試與部署說明

---

## 1) `netlify/functions/coupons.mjs`

**用途**：用 Cloudinary Raw JSON 管理固定折扣碼 `NATURAL200`；提供查詢、初始化、Email 寄送。

```js
// netlify/functions/coupons.mjs
import crypto from 'node:crypto';

// ===== 環境變數 =====
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY     = process.env.CLOUDINARY_API_KEY;
const API_SECRET  = process.env.CLOUDINARY_API_SECRET;
const ADMIN_KEY   = process.env.ADMIN_KEY || '';

// Brevo (Email)
const BREVO_KEY   = process.env.BREVO_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const BREVO_SENDER_NAME  = process.env.BREVO_SENDER_NAME  || 'Natural Uncle 客服';
const BRAND_NAME  = process.env.BRAND_NAME || 'Natural Uncle';

// ===== 常數設定 =====
const COUPON_FOLDER = 'coupons-json';
const DEFAULT_CODE  = 'NATURAL200';
const DEFAULT_AMOUNT = 200; // NT$
const TWO_YEARS_MS   = 2 * 365 * 24 * 60 * 60 * 1000;

// ===== 通用工具 =====
const nowTs = () => Date.now();

const jsonResp = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

function sign(params, secret) {
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + secret;
  return crypto.createHash('sha1').update(toSign).digest('hex');
}

async function cloudinarySearchRaw({ expression, next_cursor, max_results = 30 }) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;
  const body = { expression, next_cursor, max_results, resource_type: 'raw' };
  const auth = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Cloudinary search failed (${r.status})`);
  return await r.json();
}

async function fetchJSON(secure_url) {
  const r = await fetch(secure_url);
  if (!r.ok) throw new Error(`Fetch JSON failed (${r.status})`);
  return await r.json();
}

async function uploadJSON({ folder, public_id, jsonObj, overwrite = false }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id, overwrite: overwrite ? 'true' : 'false', timestamp };
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
  const r = await fetch(url, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Cloudinary JSON upload failed (${r.status})`);
  return await r.json();
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

async function getCouponByCode(code) {
  const expression = `resource_type:raw AND folder:${COUPON_FOLDER} AND public_id=${COUPON_FOLDER}/${code}`;
  const { resources } = await cloudinarySearchRaw({ expression });
  if (!resources || !resources.length) return null;
  return await fetchJSON(resources[0].secure_url);
}

function buildEmailHTML({ code, amount, expireAt, brand, links }) {
  const expireStr = new Date(expireAt).toLocaleDateString('zh-TW');
  return `
  <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;line-height:1.7;color:#222">
    <p>親愛的顧客您好，</p>
    <p>感謝您抽空給予評論 💬 您的鼓勵是我們持續進步的動力！</p>
    <p>🎁 以下是您的專屬回饋優惠：</p>
    <ul>
      <li><b>折扣碼：</b>${code}</li>
      <li><b>優惠內容：</b>折抵 NT$${amount}</li>
      <li><b>使用方式：</b>到店結帳出示此折扣碼即可使用</li>
      <li><b>使用期限：</b>${expireStr} 前有效（自發送日起 2 年內）</li>
    </ul>
    <p>聯絡我們：<br/>
      LINE 官方：<a href="${links.line}" target="_blank">${links.line}</a><br/>
      官網：<a href="${links.site}" target="_blank">${links.site}</a>
    </p>
    <p>期待再次為您服務 🙌<br/>${brand} 感謝您的支持 🍀</p>
    <hr/>
    <p style="font-size:13px;color:#666"><b>【優惠使用說明】</b><br/>
    ・本折扣碼限現場結帳使用。<br/>
    ・每次限用一次，恕不找零或兌換現金。<br/>
    ・不得與其他活動併用，除非另行公告。<br/>
    ・限本人使用，不得轉售或公開流傳。</p>
    <p style="font-size:12px;color:#777"><b>【店家權益保留條款】</b><br/>
    本店保留修改、變更、暫停或終止本折扣活動之權利，如有未盡事宜以店面公告或官方說明為準。</p>
  </div>`;
}

async function sendEmailCoupon({ toEmail, subject, html }) {
  if (!BREVO_KEY || !BREVO_SENDER_EMAIL) throw new Error('Brevo env missing');
  const url = 'https://api.brevo.com/v3/smtp/email';
  const payload = {
    sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
    to: [{ email: toEmail }],
    subject,
    htmlContent: html
  };
  const r = await fetch(url, { method: 'POST', headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Brevo send failed (${r.status})`);
  return await r.json();
}

export default async (req) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return jsonResp(500, { error: 'Missing Cloudinary env' });
    }

    const url = new URL(req.url);
    const method = req.method;
    const action = url.searchParams.get('action') || '';

    // ====== GET：查詢折扣碼狀態（完整資訊） ======
    if (method === 'GET') {
      const code = url.searchParams.get('code') || DEFAULT_CODE;
      const item = await getCouponByCode(code);
      if (!item) return jsonResp(200, { code, valid: false, amount: 0, expireAt: 0, desc: '' });
      const valid = nowTs() < (item.expireAt || 0);
      return jsonResp(200, { code: item.code, valid, amount: item.amount, expireAt: item.expireAt, desc: item.desc || '' });
    }

    // ====== POST?action=init ：初始化固定折扣碼（管理員限定） ======
    if (method === 'POST' && action === 'init') {
      requireAdmin(req);
      const code = DEFAULT_CODE;
      const exist = await getCouponByCode(code);
      if (exist) return jsonResp(200, { message: 'exists', code });
      const data = {
        code,
        type: 'fixed',
        amount: DEFAULT_AMOUNT,
        desc: '評論回饋折扣',
        createdAt: nowTs(),
        expireAt: nowTs() + TWO_YEARS_MS
      };
      await uploadJSON({ folder: COUPON_FOLDER, public_id: code, jsonObj: data, overwrite: false });
      return jsonResp(200, { message: 'created', code });
    }

    // ====== POST?action=send ：寄送折扣碼 Email（管理員限定） ======
    if (method === 'POST' && action === 'send') {
      requireAdmin(req);
      const bodyText = await req.text();
      let body = {};
      try { body = JSON.parse(bodyText || '{}'); } catch {}
      const { email } = body;
      if (!email) return jsonResp(400, { error: 'email required' });

      const code = DEFAULT_CODE;
      const item = await getCouponByCode(code);
      if (!item) return jsonResp(400, { error: 'coupon not initialized' });

      const subject = `${BRAND_NAME} 感謝支持！送您 $${item.amount} 折扣碼 🎁`;
      const html = buildEmailHTML({
        code: item.code,
        amount: item.amount,
        expireAt: item.expireAt,
        brand: BRAND_NAME,
        links: {
          line: 'https://line.me/R/ti/p/@uncle888',
          site: 'https://natural-uncle-official.netlify.app/'
        }
      });

      const r = await sendEmailCoupon({ toEmail: email, subject, html });
      return jsonResp(200, { message: 'sent', email, brevo: r?.messageId || null });
    }

    return jsonResp(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[coupons] Error:', err);
    return jsonResp(err.status || 500, { error: err.message || 'Server error' });
  }
};
```

---

## 2) `admin-reviews.html` — 新增／覆蓋的前端 JS

將下列 `<script>` 區塊放到 `admin-reviews.html` 底部（在 `</body>` 前）。

> 功能：
>
> * 讀取 `pending / approved / rejected` 列表
> * 審核（Approve/Reject/Delete）
> * **寄送折扣碼（Email）**
> * **複製折扣碼（LINE 使用）**

```html
<script>
const ADMIN_KEY = localStorage.getItem('ADMIN_KEY') || prompt('請輸入管理金鑰');
if (ADMIN_KEY) localStorage.setItem('ADMIN_KEY', ADMIN_KEY);

const API_REVIEWS = '/.netlify/functions/reviews';
const API_COUPONS = '/.netlify/functions/coupons';
const COUPON_CODE = 'NATURAL200';

async function req(url, options={}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function loadReviews(status='pending') {
  const data = await req(`${API_REVIEWS}?status=${encodeURIComponent(status)}&perPage=50`);
  renderList(status, data.items || []);
}

function el(tag, attrs={}, children=[]) {
  const d = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{ if (k==='class') d.className=v; else d.setAttribute(k,v); });
  (Array.isArray(children)?children:[children]).forEach(c=>{ if (typeof c==='string') d.appendChild(document.createTextNode(c)); else if (c) d.appendChild(c); });
  return d;
}

async function approve(id) {
  await req(API_REVIEWS, { method:'PUT', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer '+ADMIN_KEY }, body: JSON.stringify({ id, action: 'approve' }) });
  alert('已核准');
  await loadReviews('pending');
}

async function reject(id) {
  await req(API_REVIEWS, { method:'PUT', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer '+ADMIN_KEY }, body: JSON.stringify({ id, action: 'reject' }) });
  alert('已退回');
  await loadReviews('pending');
}

async function delReview(id) {
  if (!confirm('確定刪除這則評論？')) return;
  await req(`${API_REVIEWS}?id=${encodeURIComponent(id)}`, { method:'DELETE', headers: { 'Authorization': 'Bearer '+ADMIN_KEY } });
  alert('已刪除');
  await loadReviews('pending');
}

async function sendCoupon(email) {
  if (!email) { alert('此評論沒有 Email，請使用「複製折扣碼」後用 LINE 傳送'); return; }
  const body = { email };
  await req(`${API_COUPONS}?action=send`, { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer '+ADMIN_KEY }, body: JSON.stringify(body) });
  alert('折扣碼已寄出');
}

async function copyCouponToClipboard() {
  const info = await req(`${API_COUPONS}?code=${encodeURIComponent(COUPON_CODE)}`);
  if (!info.valid) { alert('折扣碼目前無效或已過期'); return; }
  const expireStr = new Date(info.expireAt).toLocaleDateString('zh-TW');
  const text = `您的回饋折扣碼：${info.code}\n優惠內容：折抵 NT$${info.amount}\n使用方式：到店結帳出示此折扣碼即可\n有效期限：${expireStr} 前\n（本店保留修改、變更、暫停或終止活動之權利）`;
  await navigator.clipboard.writeText(text);
  alert('已複製折扣碼內容，可貼到 LINE');
}

function renderList(status, items) {
  const root = document.getElementById('reviews-root') || document.body;
  root.innerHTML = '';

  const tabs = el('div', {class:'tabs'}, [
    el('button', {onclick:'loadReviews("pending")'}, '待審核'),
    el('button', {onclick:'loadReviews("approved")'}, '已通過'),
    el('button', {onclick:'loadReviews("rejected")'}, '已退回'),
  ]);
  root.appendChild(tabs);

  items.forEach(it => {
    const card = el('div', {class:'card', style:'border:1px solid #ddd;padding:12px;margin:10px 0;border-radius:8px;'});
    const title = el('div', {class:'title', style:'font-weight:600;margin-bottom:6px;'}, `${it.nickname || '匿名'} ・ ${new Date(it.createdAt).toLocaleString('zh-TW')}`);
    const content = el('div', {}, it.content || '');
    const stars = el('div', {style:'color:#fa0;margin:6px 0;'}, '★'.repeat(it.stars||5));
    const img = it.image ? el('img', {src: it.image, style:'max-width:160px;display:block;margin:8px 0;border-radius:6px;'}) : null;

    const row = el('div', {style:'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;'});
    if (status==='pending') {
      row.appendChild(el('button', {onclick:`approve('${it.id}')`}, '核准'));
      row.appendChild(el('button', {onclick:`reject('${it.id}')`}, '退回'));
      row.appendChild(el('button', {onclick:`delReview('${it.id}')`}, '刪除'));
    } else if (status==='approved') {
      row.appendChild(el('button', {onclick:`sendCoupon('${it.email||''}')`}, '✉ 寄折扣碼'));
      row.appendChild(el('button', {onclick:`copyCouponToClipboard()`}, '📋 複製折扣碼'));
      row.appendChild(el('button', {onclick:`delReview('${it.id}')`}, '刪除'));
    } else {
      row.appendChild(el('button', {onclick:`delReview('${it.id}')`}, '刪除'));
    }

    card.appendChild(title);
    card.appendChild(content);
    card.appendChild(stars);
    if (img) card.appendChild(img);
    if (it.email) card.appendChild(el('div', {style:'font-size:12px;color:#555;'}, `Email：${it.email}`));
    card.appendChild(row);
    root.appendChild(card);
  });
}

// 初始化：確保折扣碼存在
(async function ensureCoupon() {
  try {
    await req(`${API_COUPONS}?action=init`, { method:'POST', headers:{ 'Authorization': 'Bearer '+ADMIN_KEY } });
  } catch (e) { /* ignore if exists */ }
  loadReviews('pending');
})();
</script>
```

> 視覺你可再搭配現有 CSS；如沒有容器，請在頁面增加一個 `<div id="reviews-root"></div>`。

---

## 3) 測試與部署

### A) 環境變數（Netlify）

* `CLOUDINARY_CLOUD_NAME`
* `CLOUDINARY_API_KEY`
* `CLOUDINARY_API_SECRET`
* `ADMIN_KEY`（自行設定）
* `BREVO_KEY`
* `BREVO_SENDER_EMAIL`
* `BREVO_SENDER_NAME`（可用：Natural Uncle 客服）
* `BRAND_NAME`（Natural Uncle）

### B) 初始化折扣碼

部署後，打開 `admin-reviews.html`，第一次載入會自動呼叫 `/.netlify/functions/coupons?action=init` 建立 `NATURAL200`（若已存在則略過）。

### C) 手動測 API（本地或佈署後）

* 查詢折扣碼：

  * `GET /.netlify/functions/coupons?code=NATURAL200`
* 寄送 Email（需管理員）：

  * `POST /.netlify/functions/coupons?action=send`，Body：`{"email":"user@example.com"}`，Header：`Authorization: Bearer <ADMIN_KEY>`

### D) 前端操作

* 待審核頁籤：核准、退回、刪除
* 已通過頁籤：

  * ✉ 寄折扣碼（若該評論有填 Email）
  * 📋 複製折扣碼（貼到 LINE）

---

## 備註

* 本方案依你的需求**不記錄使用人與次數**，僅提供查詢有效性（有效期 2 年）與發送/複製。
* 若未來要增加「每人一次」或「使用統計」，可在 `coupons.mjs` 另建 `/logs-json/` 以 id 或日期做輕量紀錄。
