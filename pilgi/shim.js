/* 가스기능사 필기 연습장 — Claude 연결
   - sample    → 이 기기에 넣은 Anthropic API 키로 Messages API 직접 호출(스트리밍·도구)
   - downloads → 브라우저 다운로드
   - 그 밖(db 등) → null : 풀이 기록은 앱이 이 브라우저(localStorage)에 저장
   ⚙ 버튼: API 키 넣기·연결 확인·지우기, 모델, 사용량 */
(() => {
  "use strict";
  const LS = {
    get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  };
  const CFG_KEY = "gas-pilgi-api", USE_KEY = "gas-pilgi-usage";
  const cfg = () => ({apiKey: "", tutorModel: "claude-sonnet-5-5", maxTokens: 4096, ...LS.get(CFG_KEY, {})});
  const MODELS = {quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5"};
  const PRICE = {"claude-haiku-5-5": [1, 5], "claude-sonnet-5-5": [3, 15], "claude-opus-5-5": [5, 25]};
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
      if (name === "sample") return cfg().apiKey ? sample : null;
      if (name === "downloads") return downloads;
      return null;
    }
  };
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
      <h2>설정 · Claude 연결</h2>
      <label>Anthropic API 키<input name="key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${c.apiKey ? "••••••••" + c.apiKey.slice(-4) : ""}"></label>
      <p class="gp-note">키는 이 기기 브라우저에만 저장되고 Anthropic 서버로만 보내집니다. 질문할 때마다 이 키의 계정에 사용료가 나갑니다.</p>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-test">연결 확인</button><span id="gp-test-out" class="gp-note"></span>${c.apiKey ? `<button type="button" class="gp-btn" id="gp-del">키 지우기</button>` : ""}</div>
      <div class="gp-row"><label>질문에 쓸 모델<select name="tutor">${[["claude-sonnet-5-5", "Sonnet 5.5 (기본)"], ["claude-haiku-5-5", "Haiku 5.5 (빠르고 저렴)"], ["claude-opus-5-5", "Opus 5.5 (가장 똑똑, 비쌈)"]].map(([m, t]) => `<option value="${m}" ${m === c.tutorModel ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <h3>사용량 (이 기기)</h3>
      <p class="gp-note">${u.lines.length ? u.lines.join("<br>") + `<br>대략 $${u.usd.toFixed(2)}` : "아직 없음"}</p>
      <div class="gp-row"><button type="button" class="gp-btn" id="gp-use-reset">사용량 초기화</button></div>
      <div class="gp-row gp-end"><button value="cancel" class="gp-btn">닫기</button><button value="save" class="gp-btn gp-primary">저장</button></div>
    </form>`;
    document.body.append(d);
    const f = d.querySelector("form");
    d.querySelector("#gp-test").onclick = async () => {
      const out = d.querySelector("#gp-test-out"); out.textContent = "확인 중…";
      const k = f.key.value.startsWith("••") ? c.apiKey : f.key.value.trim();
      if (!k){ out.textContent = "키를 먼저 넣으세요"; return; }
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"content-type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"}, body: JSON.stringify({model: "claude-haiku-5-5", max_tokens: 5, messages: [{role: "user", content: "ok"}]})});
        out.textContent = r.ok ? "연결됨 ✓" : r.status === 401 ? "키가 맞지 않습니다 (401)" : `실패 (${r.status})`;
      } catch(e){ out.textContent = "인터넷 연결 확인"; }
    };
    if (d.querySelector("#gp-del")) d.querySelector("#gp-del").onclick = () => { if (!confirm("이 기기에서 API 키를 지울까요?")) return; LS.set(CFG_KEY, {...c, apiKey: ""}); location.reload(); };
    d.querySelector("#gp-use-reset").onclick = () => { LS.set(USE_KEY, {}); openSettings(); };
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
    b.id = "gp-gear"; b.type = "button"; b.title = "설정 (Claude API 키)"; b.setAttribute("aria-label", "설정"); b.textContent = "⚙";
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
})();
