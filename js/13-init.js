// ── Init ──
// Keyboard-aware sheet positioning
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
    const kb=window.innerHeight-window.visualViewport.height;
    document.querySelectorAll('.sheet').forEach(s=>s.style.setProperty('--kb',Math.max(0,kb)+'px'));
  });
}
(async function(){
  // Migrate from localStorage to IndexedDB (one-time)
  const old=localStorage.getItem('minis_bg_v1');
  if(old){try{await saveBg(old,localStorage.getItem('minis_bg_fit')||'cover','');localStorage.removeItem('minis_bg_v1');localStorage.removeItem('minis_bg_fit')}catch(e){}}
  const d=await loadBgData();if(d.img){applyBgLayer(d.img,d.fit,d.color,d.overlay)}
})();
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',function(e){if(e.target===this){m.classList.remove('show');eid=null}}));
ra();
// 自动记账：页面存活期间持续主动轮询 + 多种事件触发，不依赖单一时机点。
// 这是解决"打开app也不自动"的核心 — 只要页面活着，就定期检查队列并处理。
(function(){
  const bridgeOK = ()=> window.MinisBridge && (typeof window.MinisBridge.readPendingTx==='function'||typeof window.MinisBridge.readImportedTx==='function');
  /* 首次进来：自动记账是开着的，就顺手把常驻也打开（用户明确关过的不动） */
  try{
    if(bridgeOK() && autoEnabled() && !localStorage.getItem('bk_ka_choice')){
      window.MinisBridge.keepAliveSet(true); localStorage.setItem('bk_ka_choice','1');
    }
  }catch(e){}
  // 1) 页面加载后立即尝试（等 bridge 就绪，最长重试10次×300ms）
  (function tryImmediate(){
    if(bridgeOK()){ autoBookkeep(); }
    else if(!window.__abInit){ window.__abInit=0; const t=setInterval(()=>{ window.__abInit++; if(bridgeOK()||window.__abInit>10){ clearInterval(t); if(bridgeOK()) autoBookkeep(); } },300); }
  })();
  // 2) 页面可见时每 5 秒轮询处理新通知（fingerprint 判重 + autoRunning 锁防重复）
  let pollTimer=null;
  function startPoll(){ if(pollTimer) return; pollTimer=setInterval(()=>{
    if(document.visibilityState!=='visible') return;
    autoBookkeep();
    // 每 30 秒主动抓一次通知栏：服务被系统冻结时，靠这个补漏
    // （被动接收失效的机型，只要打开着 app 就还能抓到当前通知）
    __scanTick++;
    if(__scanTick%6===0 && window.MinisBridge && typeof window.MinisBridge.triggerScan==='function'){
      try{ window.MinisBridge.triggerScan(); }catch(e){}
    }
  },5000); }
  let __scanTick=0;
  function stopPoll(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }
  if(document.visibilityState==='visible') startPoll();
  // 3) visibilitychange / focus 事件：切回前台立即处理 + 检查通知服务是否掉线
  let __lastRebind=0;
  function ensureNotifAlive(){
    try{
      if(!window.MinisBridge) return;
      // 用【证据】判断，不再用进程重启就误报的静态标志：
      //   - 明确未被绑定(lastScanNull=1)，或
      //   - 解绑次数 > 连接次数（说明解绑后没连回来）
      const ev=readEvidence();
      let granted=false;
      if(typeof window.MinisBridge.notifStatus==='function'){
        granted=!!JSON.parse(window.MinisBridge.notifStatus()||'{}').granted;
      }
      const unbound = (ev.lastScanNull==='1');
      const dangling = Number(ev.disconnectCount||0) > Number(ev.connectCount||0);
      const now=Date.now();
      if(granted && (unbound||dangling) && (now-__lastRebind>30000)
         && typeof window.MinisBridge.requestRebind==='function'){
        __lastRebind=now;
        window.MinisBridge.requestRebind();
      }
    }catch(e){}
  }
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && bridgeOK()){ startPoll(); ensureNotifAlive(); autoBookkeep(); } });
  window.addEventListener('focus',()=>{ if(bridgeOK()){ ensureNotifAlive(); autoBookkeep(); } });
})();
/* 全屏：2026-11-07 用户要求删掉（做成 APK 之后由原生控制，这个按钮没用）。
   lockOrientation 留着 —— 它管的是「别横过来」和「回到前台重新锁竖屏」。 */
// Lock to portrait; re-lock on orientation change (handles screen off/on)
function lockOrientation(){
  // APK 环境下全屏由原生桥控制，不再用 requestFullscreen（会黑屏）
  const hasBridge = window.MinisBridge && typeof window.MinisBridge.setFullscreen==='function';
  if(!hasBridge && !document.fullscreenElement){document.documentElement.requestFullscreen().catch(()=>{})}
  try{screen.orientation.lock('portrait').catch(()=>{})}catch(e){}
}
screen.orientation.addEventListener('change',()=>{lockOrientation()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&screen.orientation.type!=='portrait-primary'){lockOrientation()}});
// Register service worker
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js')}
