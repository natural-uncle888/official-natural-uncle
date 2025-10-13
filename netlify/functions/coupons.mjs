// coupons.mjs - Cloudinary 版本固定折扣碼 NATURAL200
// 功能：初始化折扣碼、查詢折扣碼、寄送 Email（Brevo）

import crypto from 'node:crypto';

// ===== 環境變數 =====
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY     = process.env.CLOUDINARY_API_KEY;
const API_SECRET  = process.env.CLOUDINARY_API_SECRET;
const ADMIN_KEY   = process.env.ADMIN_KEY || '';

const BREVO_KEY   = process.env.BREVO_KEY; // 必填
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL; // 必填
const BREVO_SENDER_NAME  = process.env.BREVO_SENDER_NAME || "Natural Uncle 客服";
const BRAND_NAME  = process.env.BRAND_NAME || "Natural Uncle";

// ===== 折扣碼設定 =====
const COUPON_CODE = "NATURAL200"; // 固定折扣碼
const COUPON_AMOUNT = 200;
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const COUPON_DESC = "評論回饋折扣";

// ===== Cloudinary JSON 資料夾 =====
const COUPON_FOLDER = "coupons-json";

// ===== 工具 =====
const jsonResp = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

function sign(params, secret) {
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&") + secret;
  return crypto.createHash("sha1").update(toSign).digest("hex");
}

async function cloudinaryUploadJSON({ folder, public_id, jsonObj, overwrite = false }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id, overwrite: overwrite ? "true" : "false", timestamp };
  const signature = sign(params, API_SECRET);

  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(jsonObj)], { type: "application/json" }));
  form.append("api_key", API_KEY);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("public_id", public_id);
  form.append("overwrite", overwrite);
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, {
    method: "POST",
    body: form
  });

  if (!res.ok) throw new Error(`Cloudinary JSON upload failed (${res.status})`);
  return await res.json();
}

async function cloudinarySearchJSON(public_id) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;
  const auth = "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
  const body = {
    expression: `resource_type:raw AND public_id=${COUPON_FOLDER}/${public_id}`,
    max_results: 1
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Cloudinary search failed (${res.status})`);
  const data = await res.json();
  return data.resources?.[0] || null;
}

async function sendCouponEmail(toEmail, code, amount) {
  const html = `
    <p>親愛的顧客您好，</p>
    <p>感謝您分享使用回饋 💚 以下是您的折扣禮：</p>
    <ul>
      <li><b>折扣碼：</b>${code}</li>
      <li><b>折扣金額：</b>NT$${amount}</li>
      <li><b>使用方式：</b>到店結帳出示即可使用</li>
      <li><b>有效期限：</b>2 年</li>
    </ul>
    <p>LINE 聯絡我們：<a href="https://line.me/R/ti/p/@uncle888">點這裡</a></p>
    <hr/>
    <p style="font-size:12px;color:#777">
      本店保留修改、變更、終止活動之權利
    </p>
  `;

  const payload = {
    sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
    to: [{ email: toEmail }],
    subject: `${BRAND_NAME} 感謝您的評論 🎁 送您專屬折扣碼`,
    htmlContent: html
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`Brevo send email failed (${res.status})`);
  return await res.json();
}
// ===== API Handler =====
export default async (req) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return jsonResp(500, { error: "Missing Cloudinary config" });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const code = url.searchParams.get("code") || COUPON_CODE;

    // ✅ GET 查詢折扣碼
    if (req.method === "GET") {
      const item = await cloudinarySearchJSON(code);
      if (!item) {
        return jsonResp(200, {
          code,
          valid: false,
          amount: 0,
          expireAt: null,
          desc: null,
        });
      }
      const jsonData = await (await fetch(item.secure_url)).json();
      const valid = Date.now() < jsonData.expireAt;
      return jsonResp(200, {
        code: jsonData.code,
        valid,
        amount: jsonData.amount,
        expireAt: jsonData.expireAt,
        desc: jsonData.desc,
      });
    }

    // ✅ 管理者權限驗證
    if (["POST"].includes(req.method)) {
      const auth = req.headers.get("authorization")?.replace("Bearer ", "");
      if (auth !== ADMIN_KEY) {
        return jsonResp(401, { error: "Unauthorized" });
      }
    }

    // ✅ POST 初始化折扣碼
    if (req.method === "POST" && action === "init") {
      const exists = await cloudinarySearchJSON(COUPON_CODE);
      if (exists) {
        return jsonResp(200, { message: "Coupon already exists", code: COUPON_CODE });
      }

      const couponData = {
        code: COUPON_CODE,
        amount: COUPON_AMOUNT,
        desc: COUPON_DESC,
        createdAt: Date.now(),
        expireAt: Date.now() + TWO_YEARS_MS,
      };

      await cloudinaryUploadJSON({
        folder: COUPON_FOLDER,
        public_id: COUPON_CODE,
        jsonObj: couponData,
        overwrite: false,
      });

      return jsonResp(200, {
        ok: true,
        message: "Coupon created",
        code: COUPON_CODE,
      });
    }

    // ✅ POST 寄送折扣碼
    if (req.method === "POST" && action === "send") {
      const body = await req.json().catch(() => null);
      if (!body?.email) {
        return jsonResp(400, { error: "Email is required" });
      }

      // 確認折扣碼存在
      const couponRes = await cloudinarySearchJSON(COUPON_CODE);
      if (!couponRes) {
        return jsonResp(400, { error: "Coupon not initialized" });
      }

      // 發信
      await sendCouponEmail(body.email, COUPON_CODE, COUPON_AMOUNT);

      return jsonResp(200, { ok: true, message: "Coupon email sent" });
    }

    return jsonResp(405, { error: "Method Not Allowed" });
  } catch (err) {
    console.error("[coupons] Error:", err);
    return jsonResp(500, { error: err.message || "Server error" });
  }
};
