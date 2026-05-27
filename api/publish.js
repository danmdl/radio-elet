/* Vercel serverless function: receives content from the admin and commits
   it to content.json on the GitHub repo, which auto-deploys via Vercel.
   Requires env var GITHUB_TOKEN (fine-grained PAT with contents:write on this repo). */

const PASS_HASH = '5312483a9608c7f943cde4dfd7b99ce2f89f39f5da5a5178faf880b2fea02dfe';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }

  // Diagnostic: GET /api/publish shows whether the token is visible to the
  // function (without revealing it), the target repo and branch.
  if (req.method === 'GET') {
    const tk = process.env.GITHUB_TOKEN || '';
    res.status(200).json({
      tokenConfigured: !!tk,
      tokenLength: tk.length,
      repo: process.env.GITHUB_REPO || 'danmdl/radio-elet',
      branch: process.env.GITHUB_BRANCH || 'claude/deploy-radio-elet-dcCxa'
    });
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
  const { passwordHash, content } = body || {};

  if (passwordHash !== PASS_HASH) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!content || typeof content !== 'object') {
    res.status(400).json({ error: 'invalid_content' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'danmdl/radio-elet';
  const branch = process.env.GITHUB_BRANCH || 'claude/deploy-radio-elet-dcCxa';
  const filePath = 'content.json';

  if (!token) {
    res.status(503).json({
      error: 'github_token_missing',
      message: 'El backend todavía no está configurado. Pedile al desarrollador que agregue la variable GITHUB_TOKEN en Vercel.'
    });
    return;
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'elet-admin'
  };

  try {
    // 1. Get current SHA of content.json so GitHub accepts the update
    const getUrl = `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders });
    let sha = null;
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    } else if (getRes.status !== 404) {
      const detail = await getRes.text();
      res.status(getRes.status).json({ error: 'github_get_failed', detail });
      return;
    }

    // 2. Encode and commit
    const text = JSON.stringify(content, null, 2) + '\n';
    const encoded = Buffer.from(text, 'utf-8').toString('base64');
    const putBody = {
      message: 'admin: update site content',
      content: encoded,
      branch
    };
    if (sha) putBody.sha = sha;

    const putUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const detail = await putRes.text();
      res.status(putRes.status).json({ error: 'github_put_failed', detail });
      return;
    }

    const result = await putRes.json();
    res.status(200).json({ ok: true, commit: result.commit?.sha || null });
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
