# Deploy to Netlify

## Quick start
1. Push these files to a GitHub repository.
2. In Netlify: **Add new site** → **Import from Git** → select the repo.
3. Build settings:
   - Build command: _leave empty_
   - Publish directory: `.`
4. Add your custom domain in **Site settings → Domain management**.

## Optional: Cloudinary image delivery
If you want automatic format and quality:
- Create a Cloudinary account and note your **cloud name**.
- Replace image URLs in HTML with a fetch URL like:

```
https://res.cloudinary.com/<cloud_name>/image/fetch/f_auto,q_auto/https://<your-domain>/logo-mark.jpg
```

For assets that will live in this repo, you can upload them to Cloudinary and reference:

```
https://res.cloudinary.com/<cloud_name>/image/upload/f_auto,q_auto/<public_id>.jpg
```

## Notes
- No Cloudflare-specific files were found. DNS cutover is the only Cloudflare step.
- If you need SPA-style routing, add an `_redirects` file with `/* /index.html 200`.
