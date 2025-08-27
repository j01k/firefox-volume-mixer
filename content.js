// content.js — compat-first: per-origin opt-in, page-world master + limiter, play-time clamp for media
// Run this content script at: document_start, all_frames: true, match_about_blank: true

const clamp01 = n => Math.max(0, Math.min(1, Number(n)||0));
const sendToPage = v => { try { window.dispatchEvent(new CustomEvent("TV_SET_VOLUME", { detail: v })); } catch {} };
// ---- SMART SUBFRAME GATE (put this at the very top of content.js) ----
(function () {
  // Skip obvious noise frames
  if (location.protocol === "about:" || location.href === "about:blank") return;

  // If we're in a subframe, allow only same-origin frames.
  if (window !== window.top) {
    let sameOrigin = false;
    try {
      // Accessing top.location.origin throws on cross-origin — catch it.
      sameOrigin = window.top.location.origin === window.location.origin;
    } catch (_) {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      // Quietly skip cross-origin frames (e.g., YouTube chat, accounts).
      return;
    }
  }
})();

(async function decideAndInject() {
  const origin = location.origin;
  let targetVol = 1.0;

  // quick local read
  try {
    const { volumesByOrigin = {} } = await browser.storage.local.get("volumesByOrigin");
    if (typeof volumesByOrigin[origin] === "number") targetVol = clamp01(volumesByOrigin[origin]);
  } catch {}

  // background truth
  try {
    const res = await browser.runtime.sendMessage({ type: "REPORT_NEEDS_VOLUME" });
    if (res && typeof res.volume === "number") targetVol = clamp01(res.volume);
  } catch {}

  if (targetVol >= 0.999) { // 100%: don't hook this origin
    try { console.debug("[TV(content)] skip hooks (100%)", location.href); } catch {}
    return;
  }

  injectPageHook();
  sendToPage(targetVol);

  browser.runtime.onMessage.addListener(msg => {
    if (msg?.type === "SET_VOLUME" && typeof msg.volume === "number") {
      sendToPage(clamp01(msg.volume));
    }
  });

  try { console.debug("[TV(content)] injected into", location.href); } catch {}
})();

function injectPageHook() {
  const HOOK_CODE = `
(() => {
  if (window.__TV_PAGE?.installed) return;

  // Start very low to avoid startup spikes; we ramp to the real value.
  let VOL = 0.01;

  // Track masters per context
  const CTX2NODES = new Map(); // ctx -> { master, limiter, realDest }

  function ensureChain(ctx){
    let nodes = CTX2NODES.get(ctx);
    if (nodes) return nodes;
    try {
      const realDest = ctx.destination;
      const master = ctx.createGain();
      master.gain.value = VOL;
      const limiter = ctx.createDynamicsCompressor();
      try {
        limiter.threshold.setValueAtTime(-18, ctx.currentTime);
        limiter.knee.setValueAtTime(0, ctx.currentTime);
        limiter.ratio.setValueAtTime(20, ctx.currentTime);
        limiter.attack.setValueAtTime(0.003, ctx.currentTime);
        limiter.release.setValueAtTime(0.08, ctx.currentTime);
      } catch {}
      master.connect(limiter);
      limiter.connect(realDest);
      try {
        Object.defineProperty(ctx, "destination", {
          configurable: true,
          enumerable: true,
          get() { return master; }
        });
      } catch {}
      nodes = { master, limiter, realDest };
      CTX2NODES.set(ctx, nodes);
      return nodes;
    } catch { return null; }
  }

  (function proxyContexts(){
    for (const name of ["AudioContext","webkitAudioContext"]) {
      const Orig = window[name];
      if (!Orig || Orig.__tvPatched) continue;
      const Patched = new Proxy(Orig, {
        construct(Target, args){ const ctx = new Target(...args); ensureChain(ctx); return ctx; }
      });
      Patched.__tvPatched = true;
      try { Object.defineProperty(window, name, { configurable: true, writable: true, value: Patched }); } catch {}
    }
  })();

  function ramp(to){
    VOL = Math.max(0, Math.min(1, Number(to)||0));
    for (const { master } of CTX2NODES.values()) {
      try {
        const ctx = master.context;
        const t = ctx?.currentTime ?? 0;
        const g = master.gain;
        if (g.setTargetAtTime) g.setTargetAtTime(VOL, t, 0.05);
        else if (g.linearRampToValueAtTime) {
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value ?? 0.01, t);
          g.linearRampToValueAtTime(VOL, t + 0.12);
        } else {
          g.value = VOL;
        }
      } catch {}
    }
  }

  // ---- Media elements ----
  const MEDIA_SEL = "audio, video";
  const appliedTo = new WeakSet(); // Keep track of elements we've already attached listeners to

  function apply(el){
    if (appliedTo.has(el)) return; // Don't attach listeners more than once

    // Pre-set volume on the element
    try { if (Math.abs(el.volume - VOL) > 0.001) el.volume = VOL; } catch {}

    // On metadata load, re-apply the volume.
    try { el.addEventListener("loadedmetadata", () => { try { el.volume = VOL; } catch {} }, { passive: true }); } catch {}

    // *** THE CORE FIX ***
    // When the page changes the volume, instantly correct it if it's wrong.
    try {
      el.addEventListener("volumechange", () => {
        if (Math.abs(el.volume - VOL) > 0.001) {
          el.volume = VOL;
        }
      }, { passive: true });
    } catch {}

    // On play, temporarily clamp the volume to defeat aggressive scripts.
    try {
      el.addEventListener("play", () => {
        let t0 = performance.now();
        const tick = () => {
          try { if (el.volume > VOL + 0.003) el.volume = VOL; } catch {}
          if (performance.now() - t0 < 600 && !el.paused) { requestAnimationFrame(tick); }
        };
        requestAnimationFrame(tick);
      }, { capture: true, passive: true });
    } catch {}

    appliedTo.add(el); // Mark this element as handled
  }

  function scan(){ try { document.querySelectorAll(MEDIA_SEL).forEach(apply); } catch {} }

  // Scan for media elements using MutationObserver for reliability
  const observer = new MutationObserver(scan);
  observer.observe(document, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  // Bridge from extension: set target volume
  window.addEventListener("TV_SET_VOLUME", ev => {
    const v = ev?.detail;
    if (typeof v === "number") { ramp(v); scan(); }
  });

  console.debug?.("[TV(page)] hook installed at", location.href);
  window.__TV_PAGE = { installed: true, set: v => { ramp(v); scan(); }, get: () => VOL };
})();
`;

  try {
    const s = document.createElement("script");
    s.textContent = HOOK_CODE;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  } catch {}
}