# Natural Uncle UGC 留言牆（官方整合包）— 部署教學

本專案提供：
- 首頁「使用者回饋 Reviews」區（讀取審核通過的回饋）
- 投稿頁 `/upload.html`（一次性 token、上傳 1–2 張照片）
- 後台 `/admin-reviews.html`（審核/回覆/通過即發 $100 折扣碼）
- Netlify Functions 後端（`reviews` / `token` / `coupons`）
- Cloudinary（自動加右下角小浮水印、壓縮、移除 EXIF）
- Brevo（Sendinblue）寄送折扣碼 Email
- 資料儲存採 Netlify Blobs（免資料庫）

---

## 一、部署步驟（5 分鐘）

1. **下載壓縮檔並上傳到 Netlify 專案**
   - 將本專案完整上傳或推送到連結的 Git repo（保持目錄結構不變）。
   - 根目錄已有 `netlify.toml`：
     - `publish = "public"`
     - `functions = "netlify/functions"`

2. **設定環境變數（Netlify → Site settings → Environment variables）**
   - 依 `.env.example` 建立下列變數：
     - `ADMIN_KEY`：你的後台審核密鑰（如：`Aa278071jesnkimo`）
     - `TOKEN_SECRET`：簽發一次性 token 的秘密字串（請改為強隨機）
     - `BLOB_NS`：預設 `ugc-reviews`
     - `COUPON_PREFIX`：預設 `NU`
     - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
     - `WATERMARK_URL`（你的透明 logo）/ `WATERMARK_WIDTH=120` / `WATERMARK_OPACITY=45` / `WATERMARK_GRAVITY=south_east` / `WATERMARK_OFFSET_X=20` / `WATERMARK_OFFSET_Y=16`
     - `MAX_WIDTH=1600`
     - `BREVO_KEY`（Brevo API key）
     - `BREVO_SENDER_EMAIL=natural.uncle@gmail.com`
     - `BREVO_SENDER_NAME=自然大叔 客服中心`
     - `BRAND_NAME=Natural Uncle`
     - `TOKEN_TTL_HOURS=336`

3. **部署**
   - 直接 Deploy（連 GitHub 則 push 即自動部署）。
   - 完成後，前端頁會在 `https://你的站點.netlify.app/`，
     後端 Functions 會在 `/.netlify/functions/*` 下。

---

## 二、操作流程

### 1) 產生一次性投稿連結（完工後發 LINE/簡訊）
- 呼叫 `POST /.netlify/functions/token`，Header 帶 `X-Admin-Key: <你的 ADMIN_KEY>`
- body JSON：
```json
{ "order_id": "20251012-001", "phone_last4": "1234", "service": "冷氣深度清洗", "area": "台中市・西屯區" }
```
- 回應：`{ "token": "..." }`
- 將連結發給客人：
  `https://你的站點.netlify.app/upload.html?r=<token>`

> LINE 文案模板請見 `LINE_TEMPLATE.txt`。

### 2) 客戶投稿（upload.html）
- 客戶開啟帶 token 的頁面，上傳 1–2 張圖、評分與留言。
- 前端會將影像轉為 base64 傳給後端，後端會：
  1. 驗證 token（14 天有效）
  2. 上傳到 Cloudinary（自動套用：`q_auto,f_auto,w_1600,fl_strip_profile` + 右下角浮水印）
  3. 存入 Netlify Blobs，狀態為 `pending`

### 3) 店家審核（admin-reviews.html）
- 進入 `/admin-reviews.html` → 輸入 `X-Admin-Key` → 載入 `pending`
- 可「通過並發券 / 退回 / 撤下 / 店家回覆」
- **通過**時：系統自動生成折扣碼（格式：`NU-YYMM-XXXX`），若投稿有 Email 會嘗試寄送

### 4) 首頁顯示（index.html）
- 首頁會以 API 讀取審核 `approved` 清單：
  `GET /.netlify/functions/reviews?status=approved&page=1&page_size=9`
- 支援載入更多、照片最多 2 張、星等、姓氏＋稱謂、地區、服務、留言收合、店家回覆、「幾天前」。

---

## 三、維護與安全

- **不公開投稿入口**：僅憑 token 可投稿（安全）
- **Admin Key**：後台/核銷需帶 `X-Admin-Key`
- **Cloudinary**：伺服器端簽名上傳（安全，不暴露 API Secret）
- **圖片**：強制 1–2 張、最大寬 1600、自動壓縮、移除 EXIF、浮水印
- **資料**：存於 Netlify Blobs；可日後導出遷移
- **折扣碼**：`NU-YYMM-XXXX`；可改 `COUPON_PREFIX` 調整樣式

---

## 四、常見修改

- 修改品牌綠：直接改 HTML Tailwind 顏色（`emerald` 系列）
- 修改浮水印大小/位置：調整 `.env` 的 `WATERMARK_*`
- 修改優惠文字：在 `netlify/functions/_shared.mjs` 的 `sendCouponByEmail()` 內調整郵件主旨/內容
- 調整 token 有效期：更改 `TOKEN_TTL_HOURS`

---

Made for **Natural Uncle** — 溫暖 × 專業 × 真實信任
