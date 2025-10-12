// fixed reviews.js
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    if (!body.name || !body.text) {
      return { statusCode: 400, body: JSON.stringify({ error: "缺少必要欄位" }) };
    }
    if (!body.images || body.images.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "請至少上傳一張圖片" }) };
    }
    const uploadPromises = body.images.slice(0, 3).map((image) =>
      cloudinary.uploader.upload(image, {
        folder: "ugc",
        transformation: [{ width: 1200, height: 1200, crop: "limit" }]
      })
    );
    const uploadResults = await Promise.all(uploadPromises);
    const imageUrls = uploadResults.map((file) => file.secure_url);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "投稿成功", images: imageUrls })
    };
  } catch (error) {
    console.error("Reviews API Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "伺服器錯誤，請稍後再試" }) };
  }
};
