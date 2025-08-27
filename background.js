// Firefox MV3 event background (no modules)
const DEFAULT_GLOBAL_VOLUME = 0.20;

// Persistent map: { origin: 0..1 }
let volumesByOrigin = {}; // cached mirror of storage.local

const clamp = n => Math.max(0, Math.min(1, Number(n) || 0));
const getOrigin = (url) => { try { return new URL(url).origin; } catch { return null; } };

async function loadVolumes() {
  const { volumesByOrigin: stored = {} } = await browser.storage.local.get("volumesByOrigin");
  volumesByOrigin = stored;
}
async function saveVolumes() {
  await browser.storage.local.set({ volumesByOrigin });
}

// Helper: apply to a specific tab (no save)
async function pushVolumeToTab(tabId, vol) {
  const v = clamp(vol);
  try {
    await browser.tabs.sendMessage(tabId, { type: "SET_VOLUME", volume: v });
    await browser.action.setBadgeText({ tabId, text: String(Math.round(v * 100)) });
    await browser.action.setBadgeBackgroundColor({ tabId, color: "#666" });
  } catch {
    // unreachable content (blocked page); show "!"
    await browser.action.setBadgeText({ tabId, text: "!" });
    await browser.action.setBadgeBackgroundColor({ tabId, color: "#c23" });
  }
}

// Helper: apply to all tabs of an origin (no save)
async function broadcastToOrigin(origin, vol) {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map(async (t) => {
    if (getOrigin(t.url) === origin) await pushVolumeToTab(t.id, vol);
  }));
}

// On navigation, push the stored per-origin volume (top frame only)
browser.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  await loadVolumes();
  const origin = getOrigin(url);
  const v = (origin && typeof volumesByOrigin[origin] === "number")
    ? clamp(volumesByOrigin[origin])
    : DEFAULT_GLOBAL_VOLUME;
  await pushVolumeToTab(tabId, v);
});

// Also set a sensible badge right when a tab starts loading
browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === "loading") {
    await loadVolumes();
    const origin = getOrigin(tab.url);
    const v = (origin && typeof volumesByOrigin[origin] === "number")
      ? clamp(volumesByOrigin[origin])
      : DEFAULT_GLOBAL_VOLUME;
    try {
      await browser.action.setBadgeText({ tabId, text: String(Math.round(v * 100)) });
      await browser.action.setBadgeBackgroundColor({ tabId, color: "#666" });
    } catch {}
  }
});

// Messages from popup/content
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (!msg || !msg.type) return;

  if (msg.type === "HEALTH_PING") return { ok: true };

  if (msg.type === "GET_ORIGIN_VOLUME") {
    await loadVolumes();
    const origin = getOrigin(msg.url || (await browser.tabs.get(sender?.tab?.id)).url);
    const v = (origin && typeof volumesByOrigin[origin] === "number")
      ? clamp(volumesByOrigin[origin])
      : DEFAULT_GLOBAL_VOLUME;
    return { origin, volume: v };
  }

  if (msg.type === "SET_ORIGIN_VOLUME") {
    const { origin, volume } = msg;
    if (!origin || typeof volume !== "number") return { error: "bad args" };
    await loadVolumes();
    volumesByOrigin[origin] = clamp(volume);
    await saveVolumes();
    await broadcastToOrigin(origin, volumesByOrigin[origin]);
    return { ok: true };
  }

  // Back-compat: set for the sender tab's origin
  if (msg.type === "SET_TAB_VOLUME") {
    const tabId = sender?.tab?.id;
    if (!tabId) return { error: "no tab" };
    const tab = await browser.tabs.get(tabId);
    const origin = getOrigin(tab.url);
    if (origin) {
      volumesByOrigin[origin] = clamp(msg.volume);
      await saveVolumes();
      await broadcastToOrigin(origin, volumesByOrigin[origin]);
      return { ok: true };
    }
    return { error: "no origin" };
  }

  if (msg.type === "REPORT_NEEDS_VOLUME") {
    await loadVolumes();
    const tabId = sender?.tab?.id;
    if (!tabId) return { volume: DEFAULT_GLOBAL_VOLUME };
    const tab = await browser.tabs.get(tabId);
    const origin = getOrigin(tab.url);
    const v = (origin && typeof volumesByOrigin[origin] === "number")
      ? clamp(volumesByOrigin[origin])
      : DEFAULT_GLOBAL_VOLUME;
    return { volume: v };
  }
});
