import { v4 as uuidv4 } from 'uuid';
import { v2 as cloudinary } from 'cloudinary';
import { streamToBuffer } from 'node:stream/consumers';

const BREVO_KEY = process.env.BREVO_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadJSONToCloudinary(data, token) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        public_id: `reviews/${token}`,
        format: 'json',
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    const buffer = Buffer.from(JSON.stringify(data));
    stream.end(buffer);
  });
}

async function sendEmailNotification(data) {
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "投稿通知", email: BREVO_SENDER_EMAIL },
      to: [{ email: ADMIN_EMAIL }],
      subject: "收到一則新投稿",
      htmlContent: `
        <p><strong>訂單編號：</strong>${data.orderNumber || "(未填)"}</p>
        <p><strong>服務項目：</strong>${data.service || "(未填)"}</p>
        <p><strong>地區：</strong>${data.area || "(未填)"}</p>
        <p><strong>客戶電話後四碼：</strong>${data.phone || "(未填)"}</p>
        <p><a href="${data.link}" target="_blank">點我查看投稿表單</a></p>
      `
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("❌ 寄信失敗", resp.status, errText);
    throw new Error("寄信失敗");
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await req.json();
    console.log("📥 收到投稿資料", data);

    const token = uuidv4().slice(0, 8);
    data.token = token;
    data.link = \`\${req.url.replace(/\/\.netlify.*/, "")}upload.html?r=\${token}\`;

    console.log("☁️ 上傳 JSON 至 Cloudinary...");
    const result = await uploadJSONToCloudinary(data, token);
    console.log("✅ Cloudinary 上傳成功", result.secure_url);

    console.log("📧 準備寄送 Email 給管理員...");
    await sendEmailNotification(data);
    console.log("✅ Email 寄送成功");

    return new Response(JSON.stringify({ success: true, token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("🔥 發生錯誤：", err);
    return new Response(JSON.stringify({ error: "提交失敗", details: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
