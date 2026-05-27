/* Vercel serverless function: uploads an image (base64) to the GitHub repo,
   which auto-deploys via Vercel. Used by the /admin inline editor so a
   non-technical user can change photos with drag-and-drop.
   Requires env var GITHUB_TOKEN (fine-grained PAT with contents:write). */

const PASS_HASH = '5312483a9608c7f943cde4dfd7b99ce2f89f39f5da5a5178faf880b2fea02dfe';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = await readJson(req); } catch (_) { body = null; }
  }
  const { passwordHash, filename, dataBase64, message } = body || {};

  if (passwordHash !== PASS_HASH) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!filename || !dataBase64) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  // Sanitize filename — only allow simple names in the repo root.
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe.includes('..')) {
    res.status(400).json({ error: 'bad_filename' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'danmdl/radio-elet';
  const branch = process.env.GITHUB_BRANCH || 'claude/deploy-radio-elet-dcCxa';

  if (!token) {
    res.status(503).json({
      error: 'github_token_missing',
      message: 'El backend todavía no está configurado. Pedile al desarrollador que agregue GITHUB_TOKEN en Vercel.'
    });
    return;
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'elet-admin'
  };

  try {
    const getUrl = `https://api.github.com/repos/${repo}/contents/${safe}?ref=${encodeURIComponent(branch)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders });
    let sha = null;
    if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else if (getRes.status !== 404) {
      res.status(getRes.status).json({ error: 'github_get_failed', detail: await getRes.text() });
      return;
    }

    const putBody = {
      message: message || ('admin: subir imagen ' + safe),
      content: dataBase64,
      branch
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${safe}`, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      res.status(putRes.status).json({ error: 'github_put_failed', detail: await putRes.text() });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error', detail: String(err && err.message || err) });
  }
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
