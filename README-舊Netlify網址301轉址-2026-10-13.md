# 自然大叔官方網站｜舊 Netlify 網址 301 永久轉址

更新日期：2026-10-13

## 本次修改
- 將 `https://natural-uncle-official.netlify.app/*` 以 HTTP 301 永久轉址至 `https://naturaluncle.com/:splat`。
- 保留原路徑，例如：
  - `https://natural-uncle-official.netlify.app/` → `https://naturaluncle.com/`
  - `https://natural-uncle-official.netlify.app/pricing.html` → `https://naturaluncle.com/pricing.html`
- 使用 `force = true`，確保舊 Netlify 網址不再直接提供重複內容。

## 不影響
- `https://naturaluncle.com/` 正式網址正常提供內容。
- Netlify 部署與 GitHub 自動部署流程不變。
- 現有頁面、SEO、Sitemap 與功能程式不變。
