// netlify/functions/works.js
// Safe Mixed Strategy (debug) for sampling images from collages/*
// Node 18+ assumed. This function queries Cloudinary Search API and returns
// a sampled list of items. It includes debug info for testing.
// Backup of previous file is stored as works.js.bak2 in same folder.

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
    const poolLimit = parseInt(params.get("pool_limit") || "200", 10); // how many newest to pool from

    // If the caller specified a specific subfolder like "collages/900211" we will by default
    // search the whole "collages" tree so that sampling is across all subfolders.
    // If the caller includes a wildcard (e.g. "collages/*") we will respect it.
    let searchFolder = folder;
    if (!folder.includes('*') && folder.startsWith('collages/')) {
      searchFolder = 'collages';
    } // how many newest to pool from

    // Build Cloudinary Search request to include subfolders under `folder`
    const url = `https://api.cloudinary.com/v1_1/${cloud}/resources/search`;
    const body = {
      expression: `resource_type:image AND folder:"${searchFolder}/*"`,
      sort_by: [{ uploaded_at: "desc" }],
      max_results: maxResults
    };

    // Prepare basic auth header for Cloudinary
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
      // Return Cloudinary response text for debugging
      const txt = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Cloudinary error", status: res.status, detail: txt, debug: { expression: body.expression, max_results: maxResults } }) };
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
// Mixed Strategy:
    // 1) sort by uploaded_at desc (newest first)
    // 2) take newest poolLimit items into a pool
    // 3) shuffle pool and sample perPage items
    items.sort((a,b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    const poolSize = Math.min(items.length, poolLimit);
    let pool = items.slice(0, poolSize);

    // Shuffle pool with Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const sampled = pool.slice(0, Math.max(1, perPage || 3));

    // Return sampled items with debug information
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: sampled,
        debug: {
          expression: body.expression,
          totalFound: totalFound,
          returnedCount: (data.resources || []).length,
          poolCount: pool.length,
          sampledIds: sampled.map(it => ({ id: it.id, folder: it.folder })),
          note: "This is a debug build. Remove debug before promoting to production."
        },
        next: data.next_cursor || null
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
}
