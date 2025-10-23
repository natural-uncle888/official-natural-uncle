// netlify/functions/works.js - production build (debug removed)
export async function handler(event) {
  try {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    const key = process.env.CLOUDINARY_API_KEY;
    const secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud || !key || !secret) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cloudinary env missing" }) };
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const folder = params.get("folder") || "collages";
    const perPage = parseInt(params.get("perPage") || "3", 10);
    const maxResults = parseInt(params.get("max_results") || "300", 10);
    const poolLimit = parseInt(params.get("pool_limit") || "200", 10);

    // If a specific subfolder like "collages/900211" is provided, search the whole collages tree
    let searchFolder = folder;
    if (!folder.includes('*') && folder.startsWith('collages/')) {
      searchFolder = 'collages';
    }

    const url = `https://api.cloudinary.com/v1_1/${cloud}/resources/search`;
    const body = {
      expression: `resource_type:image AND folder:"${searchFolder}/*"`,
      sort_by: [{ uploaded_at: "desc" }],
      max_results: maxResults
    };

    const auth = Buffer.from(`${key}:${secret}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      // Return Cloudinary response text without debug details
      return { statusCode: 502, body: JSON.stringify({ error: "Cloudinary error", status: res.status, detail: txt }) };
    }

    const data = await res.json();
    const totalFound = data.total_count || (Array.isArray(data.resources) ? data.resources.length : 0);
    let items = (data.resources || []).map(r => {
      // derive folder from r.folder if present, otherwise from public_id
      let folderVal = (r.folder && String(r.folder).trim()) ? r.folder : "";
      if (!folderVal && r.public_id && r.public_id.includes("/")) {
        const parts = r.public_id.split("/");
        folderVal = parts.slice(0, parts.length - 1).join("/");
      }

      return {
        id: r.public_id,
        thumb: `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_480/${r.public_id}.${r.format}`,
        full:  `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_1600/${r.public_id}.${r.format}`,
        uploaded_at: r.created_at,
        tags: r.tags || [],
        folder: folderVal
      };
    });

    // Mixed Strategy: take newest poolLimit, shuffle, sample perPage
    items.sort((a,b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    const poolSize = Math.min(items.length, poolLimit);
    let pool = items.slice(0, poolSize);

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const sampled = pool.slice(0, Math.max(1, perPage || 3));

    // Production response: only items and next cursor
    const resp = {
      items: sampled,
      next: data.next_cursor || null
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resp)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
}
