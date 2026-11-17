/* 가스기능사 실기 연습장 — 웹앱 어댑터
   claude.ai 아티팩트에서 쓰던 window.claude.use(...) 기능을 이 웹앱에서 그대로 쓰게 바꿔 준다.
   - sample   → 내 Anthropic API 키로 Messages API 직접 호출 (스트리밍·도구·사진 지원)
   - db       → 이 기기 IndexedDB (풀이 기록·설정·Claude 대화)
   - downloads→ 브라우저 다운로드
   - 그 밖    → null (앱이 알아서 그 기능을 숨김)
   앱 코드(app.html)는 고치지 않고, 이 파일이 먼저 실행되도록 build.py가 <body> 바로 뒤에 넣는다. */
(() => {
  "use strict";
  const LS = {
    get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  };
  const CFG_KEY = "gp-web-config", USE_KEY = "gp-web-usage";
  const cfg = () => ({apiKey: "", tutorModel: "claude-sonnet-5-5", gradeModel: "claude-haiku-5-5", maxTokens: 4096, ...LS.get(CFG_KEY, {})});
  const MODELS = {quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5"};
  /* 1M 토큰당 달러(대략값, 설정 화면의 참고용) */
  const PRICE = {"claude-haiku-5-5": [1, 5], "claude-sonnet-5-5": [3, 15], "claude-opus-5-5": [5, 25]};

  /* ───────── IndexedDB: 작은 문서 저장소 ───────── */
  const IDB_NAME = "gp-web", IDB_VER = 1;
  let dbp = null;
  function idb(){
    return dbp ||= new Promise((ok, no) => {
      const r = indexedDB.open(IDB_NAME, IDB_VER);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs"); if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys"); };
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
  }
  async function tx(store, mode, fn){
    const d = await idb();
    return new Promise((ok, no) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => ok(out && "result" in out ? out.result : out); t.onerror = () => no(t.error); t.onabort = () => no(t.error); });
  }
  const docGet = path => tx("docs", "readonly", s => s.get(path));
  const docPut = (path, v) => tx("docs", "readwrite", s => s.put(v, path));
  const docDel = path => tx("docs", "readwrite", s => s.delete(path));
  async function docAll(){
    const d = await idb();
    return new Promise((ok, no) => {
      const out = []; const t = d.transaction("docs", "readonly"); const c = t.objectStore("docs").openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur){ out.push([cur.key, cur.value]); cur.continue(); } };
      t.oncomplete = () => ok(out); t.onerror = () => no(t.error);
    });
  }
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const snapDoc = (id, v) => ({id, exists: v !== undefined, data: () => clone(v)});

  function makeQuery(col, filters = [], order = null, lim = 0){
    const q = {
      where(f, op, val){ return makeQuery(col, [...filters, [f, op, val]], order, lim); },
      orderBy(f, dir = "asc"){ return makeQuery(col, filters, [f, dir], lim); },
      limit(n){ return makeQuery(col, filters, order, n); },
      async get(){
        const pre = col + "/";
        let rows = (await docAll()).filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => [k.slice(pre.length), v]);
        const test = (a, op, b) => ({"==": a === b, "eq": a === b, "!=": a !== b, "ne": a !== b, "<": a < b, "lt": a < b, "<=": a <= b, "lte": a <= b, ">": a > b, "gt": a > b, ">=": a >= b, "gte": a >= b, "in": Array.isArray(b) && b.includes(a), "array-contains": Array.isArray(a) && a.includes(b)})[op];
        for (const [f, op, val] of filters) rows = rows.filter(([, v]) => test(v?.[f], op, val));
        if (order){ const [f, dir] = order; rows.sort((x, y) => (x[1]?.[f] > y[1]?.[f] ? 1 : x[1]?.[f] < y[1]?.[f] ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map(([id, v]) => snapDoc(id, v));
        return {docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn)};
      },
      onSnapshot(cb, err){ q.get().then(cb, err || (() => {})); return () => {}; }
    };
    return q;
  }
  function makeDoc(path){
    return {
      id: path.split("/").pop(), path,
      async get(){ return snapDoc(path.split("/").pop(), await docGet(path)); },
      async set(v, opt){ const cur = opt?.merge ? (await docGet(path)) || {} : {}; await docPut(path, clone({...cur, ...v})); },
      async update(v){ const cur = (await docGet(path)) || {}; await docPut(path, clone({...cur, ...v})); },
      async delete(){ await docDel(path); },
      collection(name){ return makeCol(path + "/" + name); },
      onSnapshot(cb, err){ this.get().then(cb, err || (() => {})); return () => {}; }
    };
  }
  function makeCol(path){
    const q = makeQuery(path);
    return {...q, id: path.split("/").pop(), path, doc(id){ return makeDoc(path + "/" + (id || Math.random().toString(36).slice(2))); }, async add(v){ const d = makeDoc(path + "/" + Math.random().toString(36).slice(2)); await d.set(v); return d; }};
  }
  const dbApi = {collection: makeCol, doc: makeDoc};

  /* ───────── 처음 한 번: 아티팩트에서 옮겨 온 풀이 기록 넣기 ───────── */
  const seeded = (async () => {
    if (LS.get("gp-web-seeded", false)) return;
    try {
      const r = await fetch("data/progress-export.json", {cache: "no-cache"});
      if (!r.ok) throw 0;
      const ex = await r.json();
      if ((await docAll()).length === 0){
        for (const [sid, v] of Object.entries(ex.prog || {})) await docPut("progress/" + sid, v);
        if (ex.settings) await docPut("settings/main", ex.settings);
        for (const [k, v] of Object.entries(ex.chats || {})) await docPut(k, v);
        for (const [k, v] of Object.entries(ex.local || {})) if (/^gas-practice/.test(k) && localStorage.getItem(k) == null) try { localStorage.setItem(k, v); } catch(e) {}
      }
    } catch(e) {}
    LS.set("gp-web-seeded", true);
  })();

  /* ───────── Claude: Anthropic Messages API ───────── */
  const err = (code, message, text) => Object.assign(new Error(message || code), {code, text});
  async function blobB64(b){ const buf = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }
  async function toMessages(input, images){
    const msgs = typeof input === "string" ? [{role: "user", content: input}] : input.map(m => ({role: m.role, content: String(m.content ?? "")}));
    if (images && images.length){
      const last = msgs[msgs.length - 1];
      const blocks = [];
      for (const b of images){ const mt = /^image\/(jpeg|png|gif|webp)$/.test(b.type) ? b.type : "image/jpeg"; blocks.push({type: "image", source: {type: "base64", media_type: mt, data: await blobB64(b)}}); }
      last.content = [...blocks, {type: "text", text: last.content}];
    }
    return msgs;
  }
  function addUsage(model, u){
    if (!u) return;
    const all = LS.get(USE_KEY, {}); const m = all[model] ||= {in: 0, out: 0, calls: 0};
    m.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); m.out += u.output_tokens || 0; m.calls++;
    LS.set(USE_KEY, all);
  }
  async function call(body, signal, onDelta){
    const c = cfg();
    if (!c.apiKey) throw err("not_granted", "API 키가 없습니다. ⚙ 설정에서 넣어 주세요.");
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", signal, headers: {"content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"}, body: JSON.stringify({...body, stream: !!onDelta})});
    } catch(e){ if (e?.name === "AbortError") throw err("cancelled"); throw err("upstream_error", "인터넷 연결을 확인하세요."); }
    if (!r.ok){
      let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch(e) {}
      if (r.status === 401 || r.status === 403) throw err("auth_error", "API 키가 맞지 않습니다. ⚙ 설정에서 확인하세요. " + msg);
      if (r.status === 429) throw err("rate_limited", "요청이 많아 잠시 막혔습니다. 조금 뒤 다시 하세요.");
      if (r.status === 400) throw err("invalid_request", msg);
      throw err("upstream_error", msg || "Claude 서버 오류 " + r.status);
    }
    if (!onDelta){ const j = await r.json(); addUsage(body.model, j.usage); return j; }
    /* 스트리밍(SSE) 읽기 */
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    const msg = {content: [], stop_reason: null, usage: {}};
    let cur = null;
    try {
      for (;;){
        const {value, done} = await rd.read(); if (done) break;
        buf += dec.decode(value, {stream: true});
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0){
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find(l => l.startsWith("data:")); if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch(e){ continue; }
          if (ev.type === "message_start"){ msg.usage = ev.message?.usage || {}; }
          else if (ev.type === "content_block_start"){ cur = {...ev.content_block}; if (cur.type === "text") cur.text = cur.text || ""; if (cur.type === "tool_use") cur._json = ""; msg.content[ev.index] = cur; }
          else if (ev.type === "content_block_delta"){
            const b = msg.content[ev.index];
            if (ev.delta.type === "text_delta"){ b.text += ev.delta.text; onDelta(ev.delta.text); }
            else if (ev.delta.type === "input_json_delta"){ b._json += ev.delta.partial_json; }
          }
          else if (ev.type === "content_block_stop"){ const b = msg.content[ev.index]; if (b?.type === "tool_use"){ try { b.input = b._json ? JSON.parse(b._json) : {}; } catch(e){ b.input = {}; } delete b._json; } }
          else if (ev.type === "message_delta"){ msg.stop_reason = ev.delta?.stop_reason || msg.stop_reason; if (ev.usage) msg.usage = {...msg.usage, ...ev.usage}; }
          else if (ev.type === "error"){ throw err("upstream_error", ev.error?.message); }
        }
      }
    } catch(e){ if (e?.name === "AbortError") throw err("cancelled"); throw e; }
    addUsage(body.model, msg.usage);
    msg.content = msg.content.filter(Boolean);
    return msg;
  }
  async function sample(input, opts = {}){
    const c = cfg();
    const model = opts.model || (opts.modelTier ? MODELS[opts.modelTier] : null) || c.tutorModel;
    const messages = await toMessages(input, opts.images);
    const tools = (opts.tools || []).map(t => ({name: t.name, description: t.description, input_schema: t.inputSchema || {type: "object", properties: {}}}));
    let text = "", truncated = false;
    const emit = d => { text += d; try { opts.onText?.({text, delta: d}); } catch(e) {} };
    const ctl = new AbortController();
    if (opts.signal){ if (opts.signal.aborted) throw err("cancelled"); opts.signal.addEventListener("abort", () => ctl.abort(), {once: true}); }
    try {
      for (let round = 0; round < 6; round++){
        const last = round === 5;
        const body = {model, max_tokens: opts.maxTokens || c.maxTokens, messages, ...(tools.length && !last ? {tools} : {})};
        if (round > 0 && text && !text.endsWith("\n\n")) emit("\n\n");
        const res = await call(body, ctl.signal, emit);
        truncated = res.stop_reason === "max_tokens";
        const uses = res.content.filter(b => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !uses.length) break;
        messages.push({role: "assistant", content: res.content});
        const results = [];
        for (const u of uses){
          const t = (opts.tools || []).find(x => x.name === u.name);
          let out, isErr = false;
          try { out = t ? await t.execute(u.input || {}, {signal: ctl.signal}) : (isErr = true, "Error: no such tool"); }
          catch(e){ isErr = true; out = "Error: " + (e?.message || e); }
          results.push({type: "tool_result", tool_use_id: u.id, content: typeof out === "string" ? out : JSON.stringify(out).slice(0, 32000), ...(isErr ? {is_error: true} : {})});
        }
        messages.push({role: "user", content: results});
      }
    } catch(e){ if (e?.code === "cancelled") throw err("cancelled", "중지함", text); if (text && !e.text) e.text = text; throw e; }
    if (!text.trim()) throw err("empty_completion");
    return {text, truncated, modelApplied: true, modelTierApplied: opts.modelTier || "default"};
  }
  sample.json = async (input, opts = {}) => {
    const res = await sample(input, {...opts, onText: undefined});
    const s = res.text;
    const tryP = t => { try { return JSON.parse(t); } catch(e){ return undefined; } };
    let v = tryP(s);
    if (v === undefined){ const m = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) v = tryP(m[1]); }
    if (v === undefined){ const a = Math.min(...["{", "["].map(ch => { const i = s.indexOf(ch); return i < 0 ? Infinity : i; })); const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")); if (isFinite(a) && b > a) v = tryP(s.slice(a, b + 1)); }
    if (v === undefined) throw err("invalid_json", "JSON을 읽지 못했습니다", s);
    return v;
  };
  sample.limits = async () => ({images: {maxCount: 20, maxBytes: 5 * 1024 * 1024}, tools: true});

  /* ───────── 파일 저장 ───────── */
  const downloads = {
    async save({filename, data}){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "download";
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return {status: "saved"};
    }
  };

  window.claude = {
    async use(name){
      if (name === "db"){ await seeded; return dbApi; }
      if (name === "sample") return cfg().apiKey ? sample : null;
      if (name === "downloads") return downloads;
      return null;
    }
  };

  /* ───────── ⚙ 설정 패널: API 키 · 모델 · 사용량 · 백업 ───────── */
  async function exportBackup(){
    const docs = Object.fromEntries(await docAll());
    const local = {}; for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k !== CFG_KEY) local[k] = localStorage.getItem(k); }
    const blob = new Blob([JSON.stringify({kind: "gas-practice-backup", v: 1, at: new Date().toISOString(), docs, local})], {type: "application/json"});
    await downloads.save({filename: `gas-practice-backup-${new Date().toISOString().slice(0, 10)}.json`, data: blob});
  }
  async function importBackup(file){
    const j = JSON.parse(await file.text());
    if (j.kind !== "gas-practice-backup") throw new Error("이 앱의 백업 파일이 아닙니다");
    for (const [k, v] of Object.entries(j.docs || {})) await docPut(k, v);
    for (const [k, v] of Object.entries(j.local || {})) try { localStorage.setItem(k, v); } catch(e) {}
  }
  function usageText(){
    const all = LS.get(USE_KEY, {}); let usd = 0, lines = [];
    for (const [m, u] of Object.entries(all)){ const p = PRICE[m] || [3, 15]; const c = u.in / 1e6 * p[0] + u.out / 1e6 * p[1]; usd += c; lines.push(`${m.replace("claude-", "")}: ${u.calls}회 · 입력 ${(u.in / 1000).toFixed(1)}k · 출력 ${(u.out / 1000).toFixed(1)}k 토큰`); }
    return {lines, usd};
  }
  function openSettings(){
    const c = cfg();
    let d = document.getElementById("gp-settings");
    if (d) d.remove();
    d = document.createElement("dialog"); d.id = "gp-settings";
    const u = usageText();
    d.innerHTML = `<form method="dialog" class="gp-form">
      <h2>웹앱 설정</h2>
      <label>Anthropic API 키<input name="key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${c.apiKey ? "••••••••" + c.apiKey.slice(-4) : ""}"></label>
      <p class="gp-note">키는 이 기기 브라우저에만 저장되고 Anthropic 서버로만 보내집니다.</p>
      <div class="gp-row"><label>질문(튜터) 모델<select name="tutor">${["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"].map(m => `<option ${m === c.tutorModel ? "selected" : ""}>${m}</option>`).join("")}</select></label></div>
      <p class="gp-note">채점·손글씨 읽기는 앱이 정한 빠른 모델(Haiku)을 씁니다.</p>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-test">연결 확인</button><span id="gp-test-out" class="gp-note"></span></div>
      <h3>사용량 (이 기기)</h3>
      <p class="gp-note">${u.lines.length ? u.lines.join("<br>") + `<br>대략 $${u.usd.toFixed(2)}` : "아직 없음"}</p>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-use-reset">사용량 초기화</button></div>
      <h3>기록 백업</h3>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-exp">백업 파일 저장</button><label class="gp-btn">백업 불러오기<input type="file" id="gp-imp" accept="application/json,.json" hidden></label></div>
      <h3>기타</h3>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-refresh">문제 데이터 새로 받기</button><button type="button" class="gp-btn" id="gp-lock">잠그기(비밀번호 다시 입력)</button></div>
      <div class="gp-row gp-end"><button value="cancel" class="gp-btn">닫기</button><button value="save" class="gp-btn gp-primary">저장</button></div>
    </form>`;
    document.body.append(d);
    const f = d.querySelector("form");
    d.querySelector("#gp-test").onclick = async () => {
      const out = d.querySelector("#gp-test-out"); out.textContent = "확인 중…";
      const k = f.key.value.startsWith("••") ? c.apiKey : f.key.value.trim();
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"content-type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"}, body: JSON.stringify({model: "claude-haiku-5-5", max_tokens: 5, messages: [{role: "user", content: "ok"}]})});
        out.textContent = r.ok ? "연결됨 ✓" : `실패 (${r.status})`;
      } catch(e){ out.textContent = "인터넷 연결 확인"; }
    };
    d.querySelector("#gp-use-reset").onclick = () => { LS.set(USE_KEY, {}); openSettings(); };
    d.querySelector("#gp-exp").onclick = () => exportBackup().catch(e => alert(e.message));
    d.querySelector("#gp-imp").onchange = async e => { const file = e.target.files[0]; if (!file) return; try { await importBackup(file); alert("불러왔습니다. 화면을 새로 고칩니다."); location.reload(); } catch(x){ alert("불러오기 실패: " + x.message); } };
    d.querySelector("#gp-refresh").onclick = async () => { try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith("gp-plain")).map(k => caches.delete(k))); } catch(e) {} location.reload(); };
    d.querySelector("#gp-lock").onclick = async () => { if (!confirm("이 기기에서 데이터 잠금을 풉니다(비밀번호를 다시 입력해야 함). 풀이 기록은 그대로 남습니다.")) return; await tx("keys", "readwrite", s => s.delete("data")); try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith("gp-plain")).map(k => caches.delete(k))); } catch(e) {} location.href = "./"; };
    d.addEventListener("close", () => {
      if (d.returnValue !== "save") return;
      const n = {...c, tutorModel: f.tutor.value};
      const kv = f.key.value.trim();
      if (!kv.startsWith("••")) n.apiKey = kv;
      LS.set(CFG_KEY, n);
      location.reload();
    });
    d.showModal();
  }
  function mountGear(){
    const st = document.createElement("style");
    st.textContent = `#gp-gear{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:45;width:40px;height:40px;border-radius:50%;border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:var(--fg,#000);font-size:18px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.12)}
#gp-gear.nokey::after{content:"";position:absolute;right:2px;top:2px;width:9px;height:9px;border-radius:50%;background:#e0a800}
#gp-settings{border:1px solid var(--line,#ccc);border-radius:12px;background:var(--surface,#fff);color:var(--fg,#000);padding:0;max-width:min(520px,calc(100vw - 32px));width:100%}
#gp-settings::backdrop{background:rgba(0,0,0,.45)}
.gp-form{display:flex;flex-direction:column;gap:10px;padding:20px;font:15px var(--font,sans-serif)}
.gp-form h2{margin:0;font-size:1.1rem}.gp-form h3{margin:8px 0 0;font-size:.9rem;color:var(--muted,#666)}
.gp-form label{display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:var(--muted,#666)}
.gp-form input,.gp-form select{font:inherit;color:var(--fg,#000);padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--bg,#fff)}
.gp-note{font-size:.8rem;color:var(--muted,#666);margin:0}
.gp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.gp-end{justify-content:flex-end;margin-top:8px}
.gp-btn{font:inherit;font-size:.85rem;padding:7px 14px;border-radius:6px;border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:var(--fg,#000);cursor:pointer;display:inline-flex;flex-direction:row}
.gp-primary{background:var(--accent,#e0a800);border-color:var(--accent,#e0a800);color:var(--accent-ink,#3a2c00)}`;
    document.head.append(st);
    const b = document.createElement("button");
    b.id = "gp-gear"; b.type = "button"; b.title = "웹앱 설정"; b.setAttribute("aria-label", "웹앱 설정"); b.textContent = "⚙";
    if (!cfg().apiKey) b.classList.add("nokey");
    b.onclick = openSettings;
    document.body.append(b);
    /* 머리줄(풀이 화면 .bar, 홈 .top)이 있으면 그 안으로 옮김 */
    const place = () => {
      const host = document.querySelector(".bar .row1") || document.querySelector(".top > :last-child");
      if (host){ if (b.parentElement !== host){ host.append(b); } b.classList.add("inbar"); }
      else if (b.parentElement !== document.body){ document.body.append(b); b.classList.remove("inbar"); }
    };
    new MutationObserver(place).observe(document.body, {childList: true, subtree: true});
    place();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountGear); else mountGear();
  window.gpOpenSettings = openSettings;
  /* 출처 표시: 쪽수면 '교재 N쪽', 아니면 글 그대로 */
  window.srcLabel = v => { v = String(v ?? "").trim(); return !v || v === "—" ? "" : /^[\d\s~,\-–]+$/.test(v) ? `교재 ${v}쪽` : v; };
})();
