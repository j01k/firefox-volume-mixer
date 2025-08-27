(function(){
  const $ = (s)=>document.querySelector(s);
  const clamp01 = (n)=> Math.max(0, Math.min(1, n));
  const pct = (n01)=> `${Math.round(clamp01(n01)*100)}%`;

  async function getActiveTab(){
    const [tab] = await browser.tabs.query({ active:true, currentWindow:true });
    return tab;
  }
  async function getTabVolume(tabId){
    try { const res = await browser.tabs.sendMessage(tabId, { type:"GET_VOLUME" });
      return typeof res?.volume === "number" ? res.volume : null;
    } catch { return null; }
  }

  async function init(){
    const tab = await getActiveTab();
    const cur = await getTabVolume(tab.id);
    $("#vol").value = Math.round((cur ?? 0.2)*100);
    $("#volLabel").textContent = pct((cur ?? 0.2));

    $("#vol").addEventListener("input", async (e)=>{
      const v = clamp01(e.target.value/100);
      $("#volLabel").textContent = pct(v);
      await browser.runtime.sendMessage({ type:"SET_TAB_VOLUME", volume: v });
    });
    $("#mute").addEventListener("click", async ()=>{
      await browser.runtime.sendMessage({ type:"SET_TAB_VOLUME", volume: 0 });
      $("#vol").value = 0; $("#volLabel").textContent = "0%";
    });
    $("#unmute").addEventListener("click", async ()=>{
      const v = 0.2;
      await browser.runtime.sendMessage({ type:"SET_TAB_VOLUME", volume: v });
      $("#vol").value = Math.round(v*100); $("#volLabel").textContent = pct(v);
    });

    // toggles
    const { debugEnabled=false, overlayEnabled=true } = await browser.runtime.sendMessage({ type:"GET_DEBUG_SETTINGS" });
    $("#debug").checked = !!debugEnabled;
    $("#overlay").checked = !!overlayEnabled;

    $("#debug").addEventListener("change", async (e)=>{
      await browser.runtime.sendMessage({ type:"SET_DEBUG_SETTINGS", debugEnabled: e.target.checked, overlayEnabled: $("#overlay").checked });
    });
    $("#overlay").addEventListener("change", async (e)=>{
      await browser.runtime.sendMessage({ type:"SET_DEBUG_SETTINGS", debugEnabled: $("#debug").checked, overlayEnabled: e.target.checked });
    });

    // health
    try {
      const res = await browser.tabs.sendMessage(tab.id, { type:"HEALTH_PING" });
      $("#health").textContent = res?.ok ? "OK" : "No response";
    } catch {
      $("#health").textContent = "No response";
    }
  }

  init();
})();
