(function () {
  const $ = (s) => document.querySelector(s);
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const pct = (n01) => `${Math.round(clamp01(n01) * 100)}%`;

  async function activeTab() {
    const [t] = await browser.tabs.query({ active: true, currentWindow: true });
    return t;
  }
  function originOf(url) {
    try { return new URL(url).origin; } catch { return null; }
  }

  async function init() {
    const tab = await activeTab();
    const origin = originOf(tab.url);

    // Load current saved volume for this origin
    let cur = 0.2;
    try {
      const res = await browser.runtime.sendMessage({ type: "GET_ORIGIN_VOLUME", url: tab.url });
      if (typeof res?.volume === "number") cur = clamp01(res.volume);
      // Optional: show origin somewhere if you want
    } catch {}

    $("#vol").value = Math.round(cur * 100);
    $("#volLabel").textContent = pct(cur);

    // Persist per-origin and broadcast to matching tabs as you drag
    $("#vol").addEventListener("input", async (e) => {
      const v = clamp01(e.target.value / 100);
      $("#volLabel").textContent = pct(v);
      await browser.runtime.sendMessage({ type: "SET_ORIGIN_VOLUME", origin, volume: v });
    });

    // Health (content reachability)
    try {
      const res = await browser.tabs.sendMessage(tab.id, { type: "HEALTH_PING" });
      $("#health").textContent = res?.ok ? "OK" : "No response";
    } catch {
      $("#health").textContent = "No response";
    }
  }

  init();
})();
