// netlify/functions/works.js
// Node 18+
// Cloudinary Search API: https://cloudinary.com/documentation/search_api

export async function handler(event) {
  try {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    const key = process.env.CLOUDINARY_API_KEY;
    const secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud || !key || !secret) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cloudinary env missing" }) };
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const folder = params.get("folder") || "collages"; // e.g. works/collages
    const perPage = parseInt(params.get("perPage") || "3", 10);
    const nextCursor = params.get("next") || null;

    // Build Cloudinary Search request
    const url = `https://api.cloudinary.com/v1_1/${cloud}/resources/search`;
    const body = {
      expression: `resource_type:image AND folder=${folder}`,
      sort_by: [{ uploaded_at: "desc" }],
      max_results: 50
    };
    if (nextCursor) body.next_cursor = nextCursor;

    const auth = Buffer.from(`${key}:${secret}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Cloudinary error", detail: txt }) };
    }

    const data = await res.json();
    let items = (data.resources || []).map(r => ({
      id: r.public_id,
      thumb: `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_480/${r.public_id}.${r.format}`,
      full:  `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_1600/${r.public_id}.${r.format}`,
      uploaded_at: r.created_at,
      tags: r.tags || [],
      folder: r.folder || ""
    }));

    // Randomize client payload every request
    if (Array.isArray(items) && items.length > 0) {
      // Fisher-Yates for unbiased shuffle
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      items = items.slice(0, Math.max(1, perPage || 3));
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" },
      body: JSON.stringify({ items, next: data.next_cursor || null })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
}
