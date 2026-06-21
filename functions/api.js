const OWNER = 'ganghee1461-lang';
const REPO = 'TEST';
const BRANCH = 'claude/tender-johnson-yhq5ej';
const FILE_PATH = 'data.json';

const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  try {
    const token = context.env.token;
    const method = context.request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (!token) return json({ error: 'token env variable not set' }, 500);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wrong-note-app',
    };

    if (method === 'GET') {
      const url = `${GITHUB_API}?ref=${encodeURIComponent(BRANCH)}`;
      const res = await fetch(url, { headers });

      if (res.status === 404) return json({ data: [], sha: null });

      if (!res.ok) {
        const err = await res.text();
        return json({ error: `GitHub API error ${res.status}: ${err}` }, 502);
      }

      const file = await res.json();
      const raw = decodeURIComponent(escape(atob(file.content.replace(/\s/g, ''))));
      const data = JSON.parse(raw);
      return json({ data, sha: file.sha });
    }

    if (method === 'POST') {
      const body = await context.request.json();
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(body.data, null, 2))));

      const payload = {
        message: 'update wrong answers data',
        content,
        branch: BRANCH,
        ...(body.sha ? { sha: body.sha } : {}),
      };

      const res = await fetch(GITHUB_API, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        return json({ error: `GitHub API error ${res.status}: ${err}` }, 502);
      }

      const result = await res.json();
      return json({ sha: result.content?.sha });
    }

    return new Response('Method not allowed', { status: 405 });

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
