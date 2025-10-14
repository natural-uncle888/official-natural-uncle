import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import cloudinary from 'cloudinary';

const FOLDER_JSON = 'natural_uncle_json';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const sendEmailNotification = async (review) => {
  const contentHTML = `
    <p><b>有新投稿：</b></p>
    <ul>
      <li><b>訂單編號：</b>${review.orderId || '(未填)'}</li>
      <li><b>電話後四碼：</b>${review.phone || '(未填)'}</li>
      <li><b>地區：</b>${review.region || '(未填)'}</li>
      <li><b>服務項目：</b>${review.service || '(未填)'}</li>
      <li><b>留言：</b><br>${(review.content || '').split('\n').join('<br>')}</li>
    </ul>
  `;

  const payload = {
    sender: { name: process.env.BREVO_SENDER_NAME || "投稿系統", email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: process.env.ADMIN_EMAIL }],
    subject: "📝 收到新投稿通知",
    htmlContent: contentHTML,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Send email failed:", errText);
    throw new Error("寄送 Email 通知失敗");
  }
};

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const review = await req.json();
    const token = uuidv4();

    // 儲存為 temp json file
    const tempPath = path.join(tmpdir(), `${token}.json`);
    writeFileSync(tempPath, JSON.stringify(review, null, 2));

    // 寄送 email
    await sendEmailNotification(review);

    // 上傳 JSON 到 Cloudinary
    const buffer = Buffer.from(JSON.stringify(review));
    await new Promise((resolve, reject) => {
      cloudinary.v2.uploader.upload_stream({
        folder: FOLDER_JSON,
        public_id: token,
        resource_type: 'raw',
        format: 'json'
      }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }).end(buffer);
    });

    return new Response(JSON.stringify({ success: true, token }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("處理投稿失敗:", err);
    return new Response(JSON.stringify({ error: "投稿儲存或通知失敗" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
