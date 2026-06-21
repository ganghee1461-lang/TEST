const OWNER = 'ganghee1461-lang';
const REPO = 'TEST';
const BRANCH = 'claude/tender-johnson-yhq5ej';
const FILE_PATH = 'data.json';

const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

export async function onRequest(context) {
  const token = context.env.token;
  const method = context.request.method;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // GET: 데이터 읽기
  if (method === 'GET') {
    const res = await fetch(`${GITHUB_API}?ref=${BRANCH}`, { headers });
    if (res.status === 404) {
      return new Response(JSON.stringify([]), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const json = await res.json();
    const content = JSON.parse(atob(json.content.replace(/\n/g, '')));
    return new Response(JSON.stringify({ data: content, sha: json.sha }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // POST: 데이터 저장
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

    const json = await res.json();
    return new Response(JSON.stringify({ sha: json.content?.sha }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}
