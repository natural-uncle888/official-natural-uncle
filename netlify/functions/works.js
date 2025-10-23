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
      return { statusCode: 500, body: JSON.stringify((() => { const resp = { items: sampled, next: data.next_cursor || null }; if (debugFlag) { resp.debug = { expression: body.expression, totalFound: totalFound, returnedCount: (data.resources || []).length, poolCount: pool.length, sampledIds: sampled.map(it => ({ id: it.id, folder: it.folder })) }; } return resp; })()),};
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
}
