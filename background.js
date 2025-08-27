// Firefox MV3 event background (no modules)
const DEFAULT_GLOBAL_VOLUME = 0.20; // 20%
const tabVolumes = new Map(); // tabId -> 0..1

// In-memory ring buffers
const RECENT_ERRORS = [];
const RECENT_INFO = [];
function pushBuf(buf, obj, cap=500){ buf.push(obj); if (buf.length > cap) buf.shift(); }
function logError(where, err){ pushBuf(RECENT_ERRORS, { ts: Date.now(), where, msg: String(err && err.message || err) }); }
function logInfo(where, msg){ pushBuf(RECENT_INFO, { ts: Date.now(), where, msg: String(msg) }); }

function clamp(n){ return Math.max(0, Math.min(1, Number(n)||0)); }
async function getGlobalDefault(){
  const { globalDefaultVolume } = await browser.storage.local.get("globalDefaultVolume");
  return typeof globalDefaultVolume === "number" ? clamp(globalDefaultVolume) : DEFAULT_GLOBAL_VOLUME;
}
async function setGlobalDefault(vol){ await browser.storage.local.set({ globalDefaultVolume: clamp(vol) }); }
async function getTabVolume(tabId){
  return tabVolumes.has(tabId) ? tabVolumes.get(tabId) : (await getGlobalDefault());
}
async function setTabVolume(tabId, vol){
  const v = clamp(vol);
  tabVolumes.set(tabId, v);
  setBadge(tabId, v, "#666");
  try { await browser.tabs.sendMessage(tabId, { type: "SET_VOLUME", volume: v }); } catch (e) {}
}
browser.tabs.onRemoved.addListener(tabId => tabVolumes.delete(tabId));

function setBadge(tabId, v01, color){
  const text = v01 == null ? "!" : String(Math.round(v01*100));
  try { browser.action.setBadgeText({ tabId, text }); } catch(e){}
  try { browser.action.setBadgeBackgroundColor({ tabId, color }); } catch(e){}
}

// Ping content early and mark unreachable tabs with red "!"
browser.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  const v = await getTabVolume(tabId);
  try {
    await browser.tabs.sendMessage(tabId, { type: "HEALTH_PING" });
    setBadge(tabId, v, "#666");
    logInfo("onCommitted", `OK ${url}`);
  } catch {
    setBadge(tabId, null, "#c23");
    logInfo("onCommitted", `FAIL ${url}`);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "loading") {
    const v = await getTabVolume(tabId);
    try { await browser.tabs.sendMessage(tabId, { type: "SET_VOLUME", volume: v }); } catch(e){}
    setBadge(tabId, v, "#666");
  }
});

browser.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    const tabId = sender?.tab?.id;

    if (msg?.type === "GET_VOLUME") {
      return { volume: await getTabVolume(tabId) };
    }
    if (msg?.type === "REPORT_NEEDS_VOLUME") {
      const v = await getTabVolume(tabId);
      setBadge(tabId, v, "#666");
      return { volume: v };
    }
    if (msg?.type === "SET_TAB_VOLUME") {
      await setTabVolume(tabId, msg.volume);
      return { ok: true };
    }
    if (msg?.type === "SET_GLOBAL_DEFAULT") {
      await setGlobalDefault(msg.volume); return { ok: true };
    }
    if (msg?.type === "SET_DEBUG_SETTINGS") {
      const { debugEnabled, overlayEnabled } = msg;
      await browser.storage.local.set({ debugEnabled: !!debugEnabled, overlayEnabled: !!overlayEnabled });
      if (typeof tabId === "number") {
        try { await browser.tabs.sendMessage(tabId, { type: "DEBUG_SETTINGS", debugEnabled, overlayEnabled }); } catch(e){}
      }
      return { ok: true };
    }
    if (msg?.type === "GET_DEBUG_SETTINGS") {
      const { debugEnabled = false, overlayEnabled = true } = await browser.storage.local.get(["debugEnabled","overlayEnabled"]);
      return { debugEnabled, overlayEnabled };
    }
    if (msg?.type === "HEALTH_PING") { return { ok: true }; }

    if (msg?.type === "HEARTBEAT") {
      logInfo(`heartbeat tab:${tabId}`, msg.note || "tick"); return { ok: true };
    }
    if (msg?.type === "REPORT_ERROR") {
      logError(msg.where || `content[${sender?.frameId}]`, msg.error || "unknown"); return { ok: true };
    }
    if (msg?.type === "REPORT_INFO") {
      logInfo(msg.where || `content[${sender?.frameId}]`, msg.info || ""); return { ok: true };
    }
    if (msg?.type === "GET_RECENT_ERRORS") {
      return { errors: RECENT_ERRORS.slice(-200), infos: RECENT_INFO.slice(-200) };
    }
  } catch (e) {
    logError("background.onMessage", e);
    return { error: String(e?.message || e) };
  }
});
