// content.js — inject page-world hook at document_start (all frames)

/* 1) Build the page-world hook code as a string */
const HOOK_CODE = `
(() => {
  if (window.__TV_PAGE && window.__TV_PAGE.installed) { return; }
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x)||0));
  let VOL = 0.20; // default until extension tells us otherwise

  // --- WebAudio master reroute (page world) ---
  const DEST2MASTER = new WeakMap();   // destination -> master
  const CTX2MASTER  = new Map();       // ctx -> master
  const MASTERS     = new Set();

  function ensureMaster(ctx){
    let g = CTX2MASTER.get(ctx);
    if (g) return g;
    try {
      const master = ctx.createGain();
      master.gain.value = VOL;
      master.connect(ctx.destination);
      DEST2MASTER.set(ctx.destination, master);
      CTX2MASTER.set(ctx, master);
      MASTERS.add(master);
      return master;
    } catch { return null; }
  }

  const ORIG_CONNECT = window.AudioNode && window.AudioNode.prototype && window.AudioNode.prototype.connect;
  if (ORIG_CONNECT && !window.__TV_CONNECT_PATCHED) {
    window.__TV_CONNECT_PATCHED = true;
    window.AudioNode.prototype.connect = function(...args){
      try {
        const dest = args[0];
        if (dest && typeof dest.context !== "undefined" && DEST2MASTER.has(dest)) {
          const master = DEST2MASTER.get(dest);
          return ORIG_CONNECT.call(this, master);
        }
      } catch {}
      return ORIG_CONNECT.apply(this, args);
    };
  }

  // Wrap constructors so *new* contexts get a master immediately
  for (const name of ["AudioContext","webkitAudioContext"]) {
    const Orig = window[name];
    if (!Orig || Orig.__tvPatched) continue;
    const Patched = new Proxy(Orig, {
      construct(Target, args){
        const ctx = new Target(...args);
        ensureMaster(ctx);
        return ctx;
      }
    });
    Patched.__tvPatched = true;
    try { Object.defineProperty(window, name, { configurable:true, writable:true, value: Patched }); } catch {}
  }

  // Keep masters in sync with VOL
  function syncMasters(){
    for (const g of MASTERS){
      try {
        const t = g.context?.currentTime ?? 0;
        if (g.gain?.setValueAtTime) g.gain.setValueAtTime(VOL, t);
        else g.gain.value = VOL;
      } catch {}
    }
  }
  setInterval(syncMasters, 400);

  // --- HTMLMediaElement control (page world) ---
  const MEDIA_SELECTOR = "audio, video";
  function applyToMedia(el){
    try {
      if (Math.abs(el.volume - VOL) > 0.001) el.volume = VOL;
      el.addEventListener("volumechange", () => {
        if (Math.abs(el.volume - VOL) > 0.05) el.volume = VOL;
      }, { passive:true });
      el.addEventListener("loadedmetadata", () => { try { el.volume = VOL; } catch{} }, { passive:true });
    } catch {}
  }
  function applyToAll(){ try { document.querySelectorAll(MEDIA_SELECTOR).forEach(applyToMedia); } catch{} }

  // Pre-apply off-DOM creations
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
      if (t === "audio" || t === "video") { try { el.volume = VOL; } catch{} }
      return el;
    };
    Document.prototype.createElement.__tvPatched = true;
  }
  // Hook src/srcObject setters
  const hookSet = (proto, prop) => {
    try {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || d.set.__tvPatched) return;
      const setter = function(v){ d.set.call(this, v); try { this.volume = VOL; } catch{} };
      setter.__tvPatched = true;
      Object.defineProperty(proto, prop, { configurable:true, get: d.get, set: setter });
    } catch {}
  };
  hookSet(HTMLMediaElement.prototype, "src");
  hookSet(HTMLMediaElement.prototype, "srcObject");

  // Observe dynamic nodes + fallback timer
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
  setInterval(applyToAll, 800);
  if (document.readyState === "loading") {
    applyToAll(); document.addEventListener("DOMContentLoaded", applyToAll, { once:true });
  } else applyToAll();

  // --- Bridge: receive volume updates from extension via CustomEvent ---
  window.addEventListener("TV_SET_VOLUME", (ev) => {
    const v = ev?.detail;
    if (typeof v === "number") { VOL = clamp01(v); syncMasters(); applyToAll(); }
  });

  // Signal to content script that we installed successfully
  try { console.debug("[TV(page)] hook installed at", location.href); } catch {}
  window.__TV_PAGE = { installed: true, set(v){ VOL = clamp01(v); syncMasters(); applyToAll(); }, get(){ return VOL; } };
})();
`;

/* 2) Inject the hook code into the PAGE world */
(function injectPageHook(){
  try {
    const s = document.createElement('script');
    s.textContent = HOOK_CODE;
    // Ensure we run as early as possible
    (document.documentElement || document.head || document.body).appendChild(s);
    s.parentNode.removeChild(s);
  } catch (_) {}
})();

/* 3) Content-script side: talk to background and forward volume to page */
let targetVolume = 0.2;

// Ask background for current per-tab volume ASAP
browser.runtime.sendMessage({ type: "REPORT_NEEDS_VOLUME" })
  .then(res => {
    if (res && typeof res.volume === "number") {
      targetVolume = clamp(res.volume);
      dispatchToPage(targetVolume);
    }
  }).catch(() => {});

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "SET_VOLUME" && typeof msg.volume === "number") {
    targetVolume = clamp(msg.volume);
    dispatchToPage(targetVolume);
  }
  if (msg.type === "DEBUG_SETTINGS") {
    // overlay handled in page code if you add one; no-op here
  }
});

function clamp(n){ return Math.max(0, Math.min(1, Number(n)||0)); }

// Send volume to page world
function dispatchToPage(v){
  try {
    const ev = new CustomEvent("TV_SET_VOLUME", { detail: v });
    window.dispatchEvent(ev);
  } catch (_) {}
}

// (Optional) visible console ping so you can see content script is alive too
try { console.debug("[TV(content)] injected into", location.href); } catch {}
