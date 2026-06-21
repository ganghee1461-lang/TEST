const OWNER = 'ganghee1461-lang';
const REPO = 'TEST';
const BRANCH = 'claude/tender-johnson-yhq5ej';
const Q_FILE = 'questions.json';
const P_FILE = 'progress.json';

const BASE = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function getFile(headers, path) {
  const res = await fetch(`${BASE}/${path}?ref=${encodeURIComponent(BRANCH)}`, { headers });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const file = await res.json();
  const raw = decodeURIComponent(escape(atob(file.content.replace(/\s/g, ''))));
  return { data: JSON.parse(raw), sha: file.sha };
}

async function putFile(headers, path, data, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return (await res.json()).content?.sha;
}

export async function onRequest(context) {
  try {
    const token = context.env.token;
    const method = context.request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!token) return resp({ error: 'token env variable not set' }, 500);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gas-exam-app',
    };

    if (method === 'GET') {
      const [qr, pr] = await Promise.all([
        getFile(headers, Q_FILE),
        getFile(headers, P_FILE),
      ]);
      const questions = qr.data || [];
      const progress = pr.data || {};
      const data = questions.map(q => ({ ...q, count: progress[q.id] || 0 }));
      return resp({ data, sha_p: pr.sha });
    }

    if (method === 'POST') {
      const body = await context.request.json();
      const { id } = body;
      if (!id) return resp({ error: 'id required' }, 400);
      // always fetch latest progress to avoid sha conflicts
      const pr = await getFile(headers, P_FILE);
      const progress = pr.data || {};
      progress[id] = (progress[id] || 0) + 1;
      const newSha = await putFile(headers, P_FILE, progress, pr.sha, 'update progress');
      return resp({ sha_p: newSha, count: progress[id] });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (e) {
    return resp({ error: e.message }, 500);
  }
}
