// content.js — enforce extension volume continuously so sites can’t override it

const clamp01 = n => Math.max(0, Math.min(1, Number(n) || 0));

(function injectPageHook(){
  const HOOK = `
(() => {
  if (window.__TV_MIN && window.__TV_MIN.installed) return;

  let VOL = 0.20;
  const CTX2MASTER = new Map();

  function makeChain(ctx) {
    try {
      const realDest = ctx.destination;
      const master = ctx.createGain();
      master.gain.value = VOL;

      const limiter = ctx.createDynamicsCompressor();
      try {
        limiter.threshold.setValueAtTime(-24, ctx.currentTime);
        limiter.knee.setValueAtTime(0, ctx.currentTime);
        limiter.ratio.setValueAtTime(30, ctx.currentTime);
        limiter.attack.setValueAtTime(0.001, ctx.currentTime);
        limiter.release.setValueAtTime(0.06, ctx.currentTime);
      } catch {}

      master.connect(limiter);
      limiter.connect(realDest);

      try { Object.defineProperty(ctx, "destination", { value: master, configurable: true }); } catch {}
      CTX2MASTER.set(ctx, master);
    } catch {}
  }

  for (const name of ["AudioContext","webkitAudioContext"]) {
    const Orig = window[name];
    if (!Orig || Orig.__tvMinPatched) continue;
    const Patched = new Proxy(Orig, {
      construct(Target, args){ const ctx = new Target(...args); makeChain(ctx); return ctx; }
    });
    Patched.__tvMinPatched = true;
    window[name] = Patched;
  }

  function ramp(to){
    VOL = Math.max(0, Math.min(1, Number(to)||0));
    for (const g of CTX2MASTER.values()) {
      try {
        const ctx = g.context, t = ctx?.currentTime ?? 0, gain = g.gain;
        if (gain.setTargetAtTime) gain.setTargetAtTime(VOL, t, 0.05);
        else if (gain.linearRampToValueAtTime) {
          gain.cancelScheduledValues(t);
          gain.setValueAtTime(gain.value ?? VOL, t);
          gain.linearRampToValueAtTime(VOL, t + 0.12);
        } else { gain.value = VOL; }
      } catch {}
    }
  }

  // Hard clamp function for all current elements
  function applyToAllMedia() {
    try {
      document.querySelectorAll("video, audio").forEach(el => {
        if (el.volume > VOL + 0.002 || el.volume < VOL - 0.002) {
          el.volume = VOL;
        }
      });
    } catch {}
  }

  // --- Listen for extension volume changes ---
  window.addEventListener("TV_SET_VOLUME", (ev) => {
    const v = ev?.detail;
    if (typeof v !== "number") return;
    ramp(v);

    // Force all elements immediately and for a short period after
    VOL = v;
    applyToAllMedia();
    let count = 0;
    const id = setInterval(() => {
      applyToAllMedia();
      if (++count > 20) clearInterval(id); // ~3s of enforcement is usually enough
    }, 150);
  });

  // Also keep clamping on natural volumechange events
  document.addEventListener("volumechange", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    if (el.volume > VOL + 0.002 || el.volume < VOL - 0.002) {
      el.volume = VOL;
    }
  }, true);

  window.__TV_MIN = { installed: true, set: ramp, get: () => VOL };
})();
`;
  const s = document.createElement("script");
  s.textContent = HOOK;
  (document.documentElement||document.head||document.body).appendChild(s);
  s.remove();
})();

// bridge
browser.runtime.sendMessage({ type: "REPORT_NEEDS_VOLUME" })
  .then(res => {
    const v = (res && typeof res.volume === "number") ? clamp01(res.volume) : 0.20;
    window.dispatchEvent(new CustomEvent("TV_SET_VOLUME", { detail: v }));
  });

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SET_VOLUME" && typeof msg.volume === "number") {
    window.dispatchEvent(new CustomEvent("TV_SET_VOLUME", { detail: clamp01(msg.volume) }));
  }
});
