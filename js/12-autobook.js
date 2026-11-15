/* ============ 自动记账总开关（2026-11-07） ============
   用户的底线：「这一次再搞不定就取消自动记账」。
   所以给一个干净的总开关：关掉 = 不读通知、不轮询、不弹框、不自动写入，
   回到纯手动记账，别的功能一个都不受影响。 */
var AUTO_ON_KEY = 'bk_auto_on';
function autoEnabled() { try { return localStorage.getItem(AUTO_ON_KEY) !== '0'; } catch (e) { return true; } }
function keepAliveState() {
  try { return JSON.parse(window.MinisBridge.keepAliveStatus()).on === true; } catch (e) { return false; }
}
function paintSwitch(el, on) {
  if (!el) return;
  el.textContent = on ? '开' : '关';
  el.style.background = on ? 'var(--accent)' : '';
  el.style.color = on ? '#fff' : '';
  el.style.borderColor = on ? 'var(--accent)' : '';
}
function openAutoPanel() {
  renderAutoPanel();
  document.getElementById('autoModal').classList.add('show');
  /* ★ 2026-11-07：授权了但服务断开 = 现在收到的通知不会被记账。
     打开面板就自动踢一次重连，然后连查 3 次（系统绑回来要 1-2 秒）。 */
  syncListener(3);
}

/* 重连 + 复查。没连上就再来一次，最多试 n 轮 */
function syncListener(n) {
  var bridge = window.MinisBridge;
  if (!bridge || !autoEnabled()) return;
  var tries = 0;
  window.__syncTried = 0;
  function step() {
    tries++;
    var st = null;
    try {
      st = JSON.parse(typeof bridge.reconnectListener === 'function' ? bridge.reconnectListener() : bridge.notifStatus());
    } catch (e) {}
    if (!st || st.connected) { window.__syncTried = 0; renderAutoPanel(); return; }
    if (tries > n) { window.__syncTried = tries - 1; renderAutoPanel(); return; }
    setTimeout(step, 900);
  }
  step();
}
function renderAutoPanel() {
  var sum = document.getElementById('autoSummary');
  if (!sum) return;
  paintSwitch(document.getElementById('autoSw'), autoEnabled());
  var ka = false;
  try { ka = keepAliveState(); } catch (e) {}
  paintSwitch(document.getElementById('kaSw'), ka);

  var lines = [];
  if (!autoEnabled()) {
    lines.push('<b style="color:#b4513c">自动记账已关闭</b> —— 不读通知、不弹框、不自动写入。想恢复点上面的开关。');
  } else {
    var st0 = null;
    try { st0 = JSON.parse(window.MinisBridge.notifStatus()); } catch (e) {}
    var kaRun = st0 ? st0.ka : null;
    lines.push('监听：' + (ka ? (kaRun === false ? '常驻开关开着，服务没跑' : '常驻中') : '未常驻') +
               ' · 待处理 ' + (window.__autoLastCount || 0) + ' 条');
    try {
      var st = st0 || JSON.parse(window.MinisBridge.notifStatus());
      lines.push('系统授权：' + (st.granted ? '<b style="color:#2e7d32">已授权</b>' : '<b style="color:#b4513c">未授权</b>') +
                 ' · 监听服务：' + (st.connected ? '<b style="color:#2e7d32">已连接</b>' : '<b style="color:#b4513c">断开了</b>') +
                 ' · 队列 ' + (st.queue || 0) + ' 条');
      if (st.granted && !st.connected) {
        lines.push('<b style="color:#b4513c">现在收到的通知不会被记账</b> —— 系统允许监听，但服务这个瞬间没接上。');
        lines.push(window.__syncTried ? ('已自动重连 ' + window.__syncTried + ' 次，还是没连上 —— 点下面的「重新连接」再试，或去系统设置把「账」的通知使用权<b>关掉再打开</b>一次（国产 ROM 常把服务冻住但设置项仍显示已授权）。')
                                       : '正在自动重连，等一两秒…');
        if (window.__syncTried) lines.push('如果重开权限后仍然「断开」，说明这台手机的 ROM 不允许后台绑定，自动记账只能在你打开 App 时工作。');
      } else if (st.granted && st.connected) {
        lines.push('服务已连接 —— 收到支付通知会自动记。');
      }
      if (ka && st && st.ka === false) {
        lines.push('⚠ 常驻服务没在跑（被系统清了）。点「重新连接」会把它拉起来；也建议加电池白名单。');
      }
    } catch (e) { lines.push('拿不到系统状态（不在 App 里？）'); }
  }
  sum.innerHTML = lines.join('<br>');

  var u = [];
  try { u = JSON.parse(localStorage.getItem('bk_auto_unparsed') || '[]'); } catch (e) {}
  var box = document.getElementById('autoUnparsed');
  if (box) {
    box.innerHTML = u.length
      ? '最近没认出金额的 ' + u.length + ' 条（原文，下次对症用）：<br>' +
        u.slice(-3).reverse().map(function (x) { return '· ' + String(x).slice(0, 60); }).join('<br>')
      : '';
  }
}
function toggleAutoOn() {
  var on = !autoEnabled();
  try { localStorage.setItem(AUTO_ON_KEY, on ? '1' : '0'); } catch (e) {}
  if (on) { try { window.MinisBridge.keepAliveSet(true); } catch (e) {} autoBookkeep(); }
  else {
    autoQueue = []; pendingAutoCount = 0;
    /* 关掉时把队列清空 —— 否则过几天再打开，7 天内的通知会一股脑全灌进来 */
    (async function () {
      try {
        var q = await readPendingQueue();
        var ids = (q || []).map(function (n) { return n.id; }).filter(Boolean);
        if (ids.length) ackPending(ids);
      } catch (e) {}
    })();
  }
  renderAutoPanel();
  toast(on ? '自动记账已打开' : '自动记账已关闭，之后只走手动记账');
}
function toggleKeepAlive() {
  var on = !keepAliveState();
  try { localStorage.setItem('bk_ka_choice', '1'); } catch (e) {}
  try { window.MinisBridge.keepAliveSet(on); } catch (e) {}
  setTimeout(renderAutoPanel, 200);
  toast(on ? '已常驻后台' : '已取消常驻');
}
function askBatteryWaiver() {
  try { window.MinisBridge.askBatteryWhitelist(); } catch (e) { toast('这条要装到手机上才有效'); }
}

async function autoBookkeep(){
  if(!autoEnabled()) return;
  if(autoRunning) return; autoRunning=true;
  try{
  const q=await readPendingQueue();
  const tx=atx();
  let autoN=0, confirmItems=[], autoAck=[], staleAck=[], autoLog=[];
  const seen=new Set();
  for(const n of q){
    const nid=n.id||('q_'+Date.now()+'_'+Math.random().toString(36).slice(2,6));
    // ★ 2026-11-15：单条通知解析失败不能让整批丢账。
    //   原来 parseNotifFull 一抛异常，循环中断 → 后面 stx/appendAutoLog 都不执行，
    //   但 tx.push 已经在内存里发生过 → 用户以为记了、账本里却没有。
    let es=[];
    try{ es=parseNotifFull(n); }catch(err){ console.warn('[auto] 解析异常，跳过这条', n, err); es=[]; }
    if(!es.length){
      /* ★ 2026-11-07：这条已经过了原生过滤（说明长得像支付），却没认出金额。
         以前直接 ack 掉了 —— 等于钱花了、账没记、还查不出来是谁。
         现在照旧 ack（不重复弹），但把原文留一份，在「自动记账」面板里能看到。 */
      try{
        var _u=JSON.parse(localStorage.getItem('bk_auto_unparsed')||'[]');
        var _t=((n.pkg||'')+' | '+(n.title||'')+' | '+(n.text||'')).replace(/\s+/g,' ').trim();
        if(_t && _u.indexOf(_t)<0){ _u.push(_t); if(_u.length>20) _u=_u.slice(-20); localStorage.setItem('bk_auto_unparsed',JSON.stringify(_u)); }
      }catch(e){}
      autoAck.push(nid); continue;
    }
    let anyAuto=false, anyConfirm=false, anyFresh=false;
    for(const e of es){
      if(seen.has(e.finger)||isAlreadyBooked(e)){ anyAuto=true; continue; }
      seen.add(e.finger);
      if(!e.needConfirm){
        const nt = makeTx(e,{auto:true});
        tx.push(nt); autoN++; anyAuto=true; anyFresh=true;   // 打「自动」标记，便于在流水里辨认
        // 【关键】自动入账也必须留痕：否则用户打开框是空的，
        // 会误以为"根本没识别到"，而其实早就记进去了。
        // ★ 2026-11-15：同时记下这笔在账本里的 id —— 面板据此核对
        //   「日志说记了」和「账本真的有」是否一致，不再只凭日志自说自话。
        autoLog.push({ts:Date.now(), txId:nt.id, amount:e.amount, type:e.type,
                      note:e.note||'', account:e.account||'', category:e.category||'其他'});
      } else {
        confirmItems.push({pid:nid, entry:e}); anyConfirm=true; anyFresh=true;
      }
    }
    // ack原则：仅当该通知的所有子笔都不需要确认时才立即ack；
    // 有确认子笔的，等确认完成后由 confirm 函数统一 ack（finishAutoConfirms）
    // 已经记过账/已在待确认里的重复条目单独成一批先 ack：它们只是队列残留，
    // 先清掉才不会再弹；新处理的条目放后一批，便于日志/排查看清"这次到底 ack 了谁"。
    if(anyAuto && !anyConfirm && !anyFresh) staleAck.push(nid);
    else if(anyAuto && !anyConfirm) autoAck.push(nid);
    else if(!anyAuto && !anyConfirm && es.length) autoAck.push(nid);
  }
  stx(tx);
  window.__autoLastRun = Date.now();      // 自检用：最近一次跑自动记账是什么时候
  window.__autoLastCount = confirmItems.length;
  if(autoN>0){ ra(); pendingAutoCount+=autoN; appendAutoLog(autoLog); }
  if(confirmItems.length){
    autoQueue=confirmItems; autoIdx=0;
    setTimeout(()=>showAutoConfirm(),150);
  } else if(pendingAutoCount>0){
    setTimeout(()=>{
      const last=autoLog[autoLog.length-1];
      ts('已自动记 ¥'+(last?Number(last.amount).toFixed(2):'')+(last&&last.category?(' · '+last.category):'')
         +(pendingAutoCount>1?('（共 '+pendingAutoCount+' 笔）'):'')+' → 见「流水」页');
      pendingAutoCount=0;
    },400);
  }
  ackPending(staleAck);
  ackPending(autoAck);
  } finally { autoRunning=false; }
}

// ── 自动入账日志：让"已经自动记好的账"必须露面 ──
// 背景：小额支付(≤AUTO_THRESHOLD且账户匹配)会自动入账、不进待处理框。
// 用户只看框 → 以为"没识别到"，其实早记进去了。这里保留最近 50 条供查看。
const AUTO_LOG_KEY='auto_log';
function loadAutoLog(){
  let arr=stateRead(AUTO_LOG_KEY); if(!Array.isArray(arr)) arr=[];
  return arr;
}
function appendAutoLog(items){
  if(!items||!items.length) return;
  let arr=loadAutoLog();
  arr=arr.concat(items);
  if(arr.length>50) arr=arr.slice(arr.length-50);
  stateWrite(AUTO_LOG_KEY,arr);
}
function clearAutoLog(){ stateWrite(AUTO_LOG_KEY,[]); }

function openAutoModal(){document.getElementById('autoConfirmModal').classList.add('show')}
function closeAutoModal(){document.getElementById('autoConfirmModal').classList.remove('show')}
function showAutoConfirm(){
  const it=autoQueue[autoIdx];
  if(!it){ closeAutoModal(); if(pendingAutoCount>0){ts('自动记账完成，剩 '+pendingAutoCount+' 条自动入账');pendingAutoCount=0;} return; }
  const e=it.entry;
  document.getElementById('autoAcType').textContent=e.type==='income'?'收入':'支出';
  document.getElementById('autoAcAmt').value=e.amount.toFixed(2);
  document.getElementById('autoAcNote').value=e.note||'';
  const accSel=document.getElementById('autoAcAcct');
  const accOpts=ga().map(a=>`<option value="${a}" ${a===e.account?'selected':''}>${a}</option>`)
              .concat(gi().filter(a=>a.ours!==false).map(a=>`<option value="${a.name}">${a.name}</option>`));
  accSel.innerHTML='<option value="">选择账户…</option>'+accOpts.join('');
  const cSel=document.getElementById('autoAcCat');
  cSel.innerHTML='<option value="">选择分类…</option>'+CATS.map(c=>`<option value="${c}" ${c===e.category?'selected':''}>${c}</option>`).join('');
  document.getElementById('autoAcRel').textContent=(e.src||'支付通知')+(e.special&&e.special!=='/^$/'?' ｜ '+e.special:'');
  document.getElementById('autoAcHint').textContent = !e.account
    ? '(建议选 微信 或 银行卡 — 日常小额默认从这两处扣)'
    : (e.amount>AUTO_THRESHOLD?'金额超过 ¥'+AUTO_THRESHOLD+'，请确认账户':'检测到专项资金，请确认账户');
  openAutoModal();
}
let autoHandledPids=new Set();
function finishAutoConfirms(){
  if(autoHandledPids.size){ ackPending([...autoHandledPids]); autoHandledPids=new Set(); }
}
function autoConfirmSkip(){
  const it=autoQueue[autoIdx];
  if(it) autoHandledPids.add(it.pid);
  autoIdx++;
  if(autoIdx<autoQueue.length) showAutoConfirm();
  else { closeAutoModal(); autoQueue=[]; finishAutoConfirms(); ts('已跳过待确认项'); }
}
function autoConfirmSave(){
  const it=autoQueue[autoIdx]; if(!it) return;
  const e=it.entry;
  const amt=parseFloat(document.getElementById('autoAcAmt').value);
  const acct=document.getElementById('autoAcAcct').value;
  const cat=document.getElementById('autoAcCat').value;
  const note=(document.getElementById('autoAcNote').value||'').trim();
  if(!(!isNaN(amt)&&amt>0&&acct)) return ts('请填写金额并选择账户');
  const tx=atx();
  tx.push(makeTx(e,{amount:amt,account:acct,category:cat||'其他',note:note}));
  stx(tx);ra();
  autoHandledPids.add(it.pid);
  autoIdx++;
  if(autoIdx<autoQueue.length) showAutoConfirm(); else { closeAutoModal(); autoQueue=[]; finishAutoConfirms(); ts('已入账待确认项'); }
}
