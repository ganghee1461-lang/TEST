/* 가스기능사 실기 연습장 — 서비스 워커
   ① data/·img/ 요청을 enc/ 안의 암호 파일로 바꿔 받아, 이 기기에 저장된 열쇠로 풀어서 돌려준다.
   ② 푼 파일과 앱 화면 파일을 기기에 보관해 두어 다음부터는 빠르고, 인터넷이 없어도 문제를 볼 수 있다. */
const SHELL = "gp-shell-v3";
const SHELL_FILES = ["./", "index.html", "app.html", "shim.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "enc/meta.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("gp-shell") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

function idbKey(){
  return new Promise((ok, no) => {
    const r = indexedDB.open("gp-web", 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs"); if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys"); };
    r.onsuccess = () => { const t = r.result.transaction("keys", "readonly").objectStore("keys").get("data"); t.onsuccess = () => ok(t.result || null); t.onerror = () => no(t.error); };
    r.onerror = () => no(r.error);
  });
}
const TYPES = {json: "application/json; charset=utf-8", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml"};

async function plainVersion(){
  try { const r = await caches.match(new URL("enc/meta.json", self.registration.scope).href) || await fetch(new URL("enc/meta.json", self.registration.scope).href); return (await r.clone().json()).version || "0"; } catch(e){ return "0"; }
}

/* 데이터 버전: 1분에 한 번만 서버에 물어봄 */
let verMemo = {v: null, t: 0, p: null};
async function currentVersion(){
  if (verMemo.v && Date.now() - verMemo.t < 60000) return verMemo.v;
  verMemo.p ||= fetch(new URL("enc/meta.json", self.registration.scope).href, {cache: "no-cache"}).then(r => r.json()).then(j => j.version).catch(() => null)
    .then(async v => { verMemo = {v: v || verMemo.v || await plainVersion(), t: Date.now(), p: null}; return verMemo.v; });
  return verMemo.p;
}
async function serveEncrypted(req, rel){
  const ver = await currentVersion();
  const store = await caches.open("gp-plain-" + ver);
  const hit = await store.match(req.url.split("?")[0]);
  if (hit) return hit;
  const k = await idbKey();
  if (!k) return new Response("locked", {status: 401});
  const r = await fetch(new URL("enc/" + rel + ".bin", self.registration.scope).href);
  if (!r.ok) return new Response("not found", {status: 404});
  const buf = new Uint8Array(await r.arrayBuffer());
  let plain;
  try { plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(0, 12)}, k, buf.slice(12)); }
  catch(e){ return new Response("bad key", {status: 403}); }
  const ext = rel.split(".").pop().toLowerCase();
  const res = new Response(plain, {status: 200, headers: {"content-type": TYPES[ext] || "application/octet-stream"}});
  try { await store.put(req.url.split("?")[0], res.clone()); } catch(e) {}
  /* 옛 버전 캐시 정리 */
  caches.keys().then(ks => ks.filter(x => x.startsWith("gp-plain-") && x !== "gp-plain-" + ver).forEach(x => caches.delete(x)));
  return res;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || e.request.method !== "GET") return;
  const rel = decodeURIComponent(url.pathname.slice(scope.pathname.length));
  if (/^(data|img)\//.test(rel)){ e.respondWith(serveEncrypted(e.request, rel)); return; }
  /* 앱 화면 파일: 인터넷이 되면 새 것, 안 되면 보관본 */
  if (SHELL_FILES.includes(rel) || rel === ""){
    e.respondWith(fetch(e.request).then(r => { if (r.ok){ const c = r.clone(); caches.open(SHELL).then(s => s.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match(new URL("index.html", scope).href))));
  }
});
