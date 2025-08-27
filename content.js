// content.js — inject page-world WebAudio/Media hook at document_start

const HOOK_CODE = `
(() => {
  if (window.__TV_PAGE && window.__TV_PAGE.installed) return;
  const clamp01 = (x)=>Math.max(0, Math.min(1, Number(x)||0));
  let VOL = 0.20;

  // WebAudio master reroute
  const DEST2MASTER = new WeakMap();
  const CTX2MASTER  = new Map();
  const MASTERS     = new Set();

  function ensureMaster(ctx){
    let g = CTX2MASTER.get(ctx);
    if (g) return g;
    try{
      const master = ctx.createGain();
      master.gain.value = VOL;
      master.connect(ctx.destination);
      DEST2MASTER.set(ctx.destination, master);
      CTX2MASTER.set(ctx, master);
      MASTERS.add(master);
      return master;
    }catch{return null;}
  }

  const ORIG_CONNECT = window.AudioNode?.prototype?.connect;
  if (ORIG_CONNECT && !window.__TV_CONNECT_PATCHED) {
    window.__TV_CONNECT_PATCHED = true;
    window.AudioNode.prototype.connect = function(...args){
      try{
        const dest = args[0];
        if (dest && typeof dest.context !== "undefined" && DEST2MASTER.has(dest)) {
          const master = DEST2MASTER.get(dest);
          return ORIG_CONNECT.call(this, master);
        }
      }catch{}
      return ORIG_CONNECT.apply(this, args);
    };
  }

  for (const name of ["AudioContext","webkitAudioContext"]) {
    const Orig = window[name];
    if (!Orig || Orig.__tvPatched) continue;
    const Patched = new Proxy(Orig, {
      construct(Target, args){ const ctx = new Target(...args); ensureMaster(ctx); return ctx; }
    });
    Patched.__tvPatched = true;
    try { Object.defineProperty(window, name, { configurable:true, writable:true, value: Patched }); } catch {}
  }

  function syncMasters(){
    for (const g of MASTERS){
      try{
        const t = g.context?.currentTime ?? 0;
        if (g.gain?.setValueAtTime) g.gain.setValueAtTime(VOL, t);
        else g.gain.value = VOL;
      }catch{}
    }
  }
  setInterval(syncMasters, 400);

  // HTMLMediaElement volume pre-set
  const MEDIA_SELECTOR = "audio, video";
  function applyToMedia(el){
    try{
      if (Math.abs(el.volume - VOL) > 0.001) el.volume = VOL;
      el.addEventListener("loadedmetadata", ()=>{ try{ el.volume = VOL; }catch{} }, {passive:true});
    }catch{}
  }
  function applyAll(){ try{ document.querySelectorAll(MEDIA_SELECTOR).forEach(applyToMedia); }catch{} }

  // Off-DOM creations
  const OrigAudio = window.Audio;
  if (typeof OrigAudio === "function" && !OrigAudio.__tvPatched) {
    window.Audio = new Proxy(OrigAudio, {
      construct(Target, args){ const el = new Target(...args); try{ el.volume = VOL; }catch{} return el; },
      apply(Target, thisArg, args){ const el = Target.apply(thisArg, args); try{ el.volume = VOL; }catch{} return el; }
    });
    window.Audio.__tvPatched = true;
  }
  const origCreate = Document.prototype.createElement;
  if (origCreate && !origCreate.__tvPatched) {
    Document.prototype.createElement = function(name, ...rest){
      const el = origCreate.call(this, name, ...rest);
      const t = String(name||"").toLowerCase();
      if (t === "audio" || t === "video") { try{ el.volume = VOL; }catch{} }
      return el;
    };
    Document.prototype.createElement.__tvPatched = true;
  }
  const hookSet = (proto, prop) => {
    try{
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || d.set.__tvPatched) return;
      const setter = function(v){ d.set.call(this, v); try{ this.volume = VOL; }catch{} };
      setter.__tvPatched = true;
      Object.defineProperty(proto, prop, { configurable:true, get: d.get, set: setter });
    }catch{}
  };
  hookSet(HTMLMediaElement.prototype, "src");
  hookSet(HTMLMediaElement.prototype, "srcObject");

  // Observe additions + fallback
  try {
    const mo = new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches?.(MEDIA_SELECTOR)) applyToMedia(n);
        n.querySelectorAll?.(MEDIA_SELECTOR).forEach(applyToMedia);
      }
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch {}
  setInterval(applyAll, 800);
  if (document.readyState === "loading") { applyAll(); document.addEventListener("DOMContentLoaded", applyAll, { once:true }); }
  else applyAll();

  // Bridge: get volume updates from extension
  window.addEventListener("TV_SET_VOLUME", (ev)=>{ const v = ev?.detail; if (typeof v === "number"){ VOL = v; syncMasters(); applyAll(); } });

  try { console.debug("[TV(page)] hook installed at", location.href); } catch {}
  window.__TV_PAGE = { installed: true, set(v){ VOL = v; syncMasters(); applyAll(); }, get(){ return VOL; } };
})();
`;

// Inject page-world script
(function inject(){
  try {
    const s = document.createElement('script');
    s.textContent = HOOK_CODE;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  } catch {}
})();

// Bridge: get per-tab/per-origin volume and forward to page
let currentVol = 0.2;
function clamp(n){ return Math.max(0, Math.min(1, Number(n)||0)); }
function sendToPage(v){
  try { window.dispatchEvent(new CustomEvent("TV_SET_VOLUME", { detail: v })); } catch {}
}

browser.runtime.sendMessage({ type: "REPORT_NEEDS_VOLUME" })
  .then(res => {
    if (res && typeof res.volume === "number") {
      currentVol = clamp(res.volume);
      sendToPage(currentVol);
    }
  }).catch(()=>{});

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "SET_VOLUME" && typeof msg.volume === "number") {
    currentVol = clamp(msg.volume);
    sendToPage(currentVol);
  }
});

// Optional content-console ping
try { console.debug("[TV(content)] injected into", location.href); } catch {}
