// ── 剪贴板导入 ──
async function importFromClipboard(){
  let text='';
  try{
    if(window.MinisBridge && typeof window.MinisBridge.readClipboard==='function'){
      text = window.MinisBridge.readClipboard() || '';
    }else{
      text = await navigator.clipboard.readText();
    }
    if(!text) return ts('剪贴板为空');
    const items=JSON.parse(text);
    if(!Array.isArray(items)||!items.length)return ts('剪贴板无有效导入数据');
    const cur=atx(),ids=new Set(cur.map(t=>t.id)),today=new Date().toISOString().slice(0,10);
    let added=0;
    items.forEach(t=>{
      const id='imp_'+Date.now()+'_'+added;
      if(!ids.has(id)){cur.push({id,time:today+'T12:00:00',type:t.type,amount:t.amount,note:t.note||'',account:t.account||'',category:t.category||'其他'});added++}
    });
    if(!added)return ts('没有新数据');
    stx(cur);ra();ts('已导入 '+added+' 条');
  }catch(e){ts('剪贴板内容不是有效的导入数据')}
}

// ── 通知导入 ──
let impTx=[];
function openImportNotify(){
  impTx=[];document.getElementById('importNotifyStatus').style.display='block';
  document.getElementById('importNotifyStatus').textContent='扫描中…';
  document.getElementById('importNotifyList').innerHTML='';
  document.getElementById('importConfirmBtn').style.display='none';
  document.getElementById('importNotifyModal').classList.add('show');
  refreshImpStatus();
  doImportScan();   // 打开即扫描：避免看到上次遗留的旧结果，误判成"又坏了"
}
function closeImportNotify(){document.getElementById('importNotifyModal').classList.remove('show')}

// ── 诊断：把"为什么没抓到"摊开给用户看 ──
let __impRaw={notif:[],sms:[],nNotif:0,nSms:0,nRecent:0,nPay:0,lastScan:''};
// 读服务留下的运行证据（key=value 文本），重启不丢，无法被"猜"掩盖
function readEvidence(){
  const ev={};
  try{
    if(window.MinisBridge && typeof window.MinisBridge.notifEvidence==='function'){
      const s=window.MinisBridge.notifEvidence()||'';
      s.split('\n').forEach(line=>{
        const i=line.indexOf('=');
        if(i>0) ev[line.slice(0,i)]=line.slice(i+1);
      });
    }
  }catch(e){}
  return ev;
}
function agoText(ts){
  const t=Number(ts||0); if(!t) return '从未';
  const s=Math.floor((Date.now()-t)/1000);
  if(s<60) return s+'秒前';
  if(s<3600) return Math.floor(s/60)+'分钟前';
  if(s<86400) return Math.floor(s/3600)+'小时前';
  return Math.floor(s/86400)+'天前';
}
function impStatusText(){
  const parts=[];
  let granted=null;
  try{
    if(window.MinisBridge && typeof window.MinisBridge.notifStatus==='function'){
      const o=JSON.parse(window.MinisBridge.notifStatus()||'{}');
      granted=o.granted;
      parts.push('通知权 '+(o.granted?'已开':'未开'));
      parts.push('队列 '+o.queue+'条');
    }
  }catch(e){}
  const ev=readEvidence();
  const seen=(Number(ev.notifPay||0)+Number(ev.notifNonPay||0));
  let a11yTxt='';
  try{
    if(window.MinisBridge && typeof window.MinisBridge.a11yStatus==='function'){
      a11yTxt='无障碍 '+(JSON.parse(window.MinisBridge.a11yStatus()||'{}').enabled?'已开':'未开')+'（收 '+Number(ev.a11yEvents||0)+'）';
    }
  }catch(e){}
  if(ev.lastNotifTs){
    parts.push('收到通知 '+seen+'条(支付类'+Number(ev.notifPay||0)+')·最近'+agoText(ev.lastNotifTs));
  } else {
    parts.push('收到通知 0条');
  }
  parts.push('服务连过 '+Number(ev.connectCount||0)+'次');
  if(a11yTxt) parts.push(a11yTxt);
  if(ev.lastScanTs) parts.push('扫通知栏 '+Number(ev.lastScanActive||0)+'条');
  parts.push('短信 '+__impRaw.nSms+'条');
  return parts.join(' · ');
}
function refreshImpStatus(){
  const el=document.getElementById('impStatusLine');
  if(el) el.textContent=impStatusText();
  const hint=document.getElementById('impConnHint');
  if(!hint) return;
  let granted=null;
  try{
    if(window.MinisBridge && typeof window.MinisBridge.notifStatus==='function'){
      granted=JSON.parse(window.MinisBridge.notifStatus()||'{}').granted;
    }
  }catch(e){}
  // 无障碍通道（第二条抓取通道）
  let a11yOn=null;
  try{
    if(window.MinisBridge && typeof window.MinisBridge.a11yStatus==='function'){
      a11yOn=!!JSON.parse(window.MinisBridge.a11yStatus()||'{}').enabled;
    }
  }catch(e){}
  const ev=readEvidence();
  const a11yN=Number(ev.a11yEvents||0), a11yPay=Number(ev.a11yPay||0);
  let need=false, msg='';
  const connCnt=Number(ev.connectCount||0);
  // ★ 无障碍通道优先提示：通知监听在你手机上反复失效（实测"连接4次、最近6天前，主动扫描84次全0"），
  //   无障碍走另一条系统通道，是更可靠的方案。
  if(a11yOn===false){
    need=true;
    msg='【建议开启无障碍】通知监听这条通道在你手机上会反复被系统掐断。\n'
       +'开启「无障碍」后走另一条通道，能稳定读到微信/银行支付通知：\n'
       +'点下面「开启无障碍」→ 在列表里找到「记账」→ 打开开关。';
  } else if(a11yOn===true && a11yN===0){
    need=true;
    msg='无障碍已开启，但还没收到过通知。若此刻通知栏有通知，请下拉一下通知栏触发一次；\n'
       +'仍为 0 则说明两条通道都被系统限制，请给「记账」开「后台高耗电/自启动」。';
  } else if(granted===false){
    need=true;
    msg='「通知使用权」没开 → 收不到任何支付通知（短信库里没有的5G消息也收不到）。';
  } else if(connCnt===0){
    // 【最常见】权限给了，但系统从未绑定服务。
    // 原因1：清单 exported=false（v1.18前）→ 系统绑不上，本版已修
    // 原因2：装/更新后 Android 不会自动重新绑定 → 必须把通知使用权【关掉再打开】
    need=true;
    msg='系统从未绑定过通知服务（权限虽已开，但没连上）——这一条搞定就能收通知：\n'
       +'打开下面的「通知设置」→ 把「记账」的开关【关掉】→ 等 2 秒 →【再打开】，然后回到本页点「重连通知服务」。';
  } else if(ev.lastScanNull==='1'){
    need=true;
    msg='系统把通知服务解绑了（扫描通知栏返回 null）——点「重连通知服务」；无效就把通知使用权关掉再打开。';
  } else if(granted && !ev.lastNotifTs){
    need=true;
    msg='服务已连上但还没收到过任何通知。若明明有通知却一直为空，请给「记账」打开「后台高耗电」「允许自启动」。';
  } else if(granted && ev.lastNotifTs && (Date.now()-Number(ev.lastNotifTs))>2*3600*1000){
    // ★ 修（2026-10-08）：这一档原来【只看"超过2小时没收到通知"就报警】，
    //   但用户【没付款的时候本来就不会有支付通知】——
    //   结果晚上不买东西就一直误报"服务停摆了"，用户跑去改系统设置也没用
    //   （因为根本不是那个问题），点「重连」也不会消失（时间戳没更新）。
    //
    //   改为：必须【有实证】才报——判断依据是"主动扫描通知栏返回 0 条"，
    //   即：通知栏里明明有东西，而服务读不到 → 才是真的没绑上。
    //   单纯"2小时没动静"不再报警（那是正常作息，不是故障）。
    const scanNull = (ev.lastScanNull === '1');
    const scanZero = (ev.lastScanTs && Number(ev.lastScanActive) === 0);
    if (scanNull || scanZero) {
      need = true;
      msg = '服务可能已和系统断开（主动扫描通知栏读到 0 条，但通知栏里应该有通知）——\n'
          + '点「重连通知服务」；若无效，去「通知设置」把「记账」的开关【关掉 → 等5秒 → 再打开】。';
    }
  }
  hint.style.display=need?'block':'none';
  if(need){
    hint.innerHTML=msg+'<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">'
      +(a11yOn===false?'<button onclick="openA11y()" style="background:#2a9d5c;border:none;border-radius:6px;color:#fff;font-size:12px;padding:5px 10px">开启无障碍</button>':'')
      +'<button onclick="reconnectNotif()" style="background:#e55;border:none;border-radius:6px;color:#fff;font-size:12px;padding:5px 10px">重连通知服务</button>'
      +'<button onclick="openNotifCfg()" style="background:none;border:1px solid #e55;border-radius:6px;color:#e55;font-size:12px;padding:5px 10px">打开通知设置</button>'
      +'</div>';
  }
}
// 包装成具名函数（内联 onclick 里写 if(...) 会被按钮指纹门禁误判为函数名）
function openNotifCfg(){
  try{ if(window.MinisBridge && window.MinisBridge.openNotifSettings) window.MinisBridge.openNotifSettings(); }catch(e){}
}
function openA11y(){
  try{ if(window.MinisBridge && window.MinisBridge.openA11ySettings) window.MinisBridge.openA11ySettings(); }catch(e){}
}
function reconnectNotif(){
  /* 新的桥 reconnectListener = 主动 requestRebind + 顺带把常驻服务拉起来 */
  if(window.MinisBridge && typeof window.MinisBridge.reconnectListener==='function'){
    try{ window.MinisBridge.reconnectListener(); }catch(e){}
    try{ if(window.MinisBridge.keepAliveSet && autoEnabled()) window.MinisBridge.keepAliveSet(true); }catch(e){}
  } else if(window.MinisBridge && typeof window.MinisBridge.requestRebind==='function'){
    try{ window.MinisBridge.requestRebind(); }catch(e){}
  }
  // ★ 重连后立刻主动扫一次通知栏，并把结果写进证据，
  //   这样红框能【即时反映真实状态】，不会像以前那样"点了也不消失"。
  if(window.MinisBridge && typeof window.MinisBridge.triggerScan==='function'){
    try{ window.MinisBridge.triggerScan(); }catch(e){}
  }
  ts('已请求重连，2秒后自动重新检测…');
  setTimeout(()=>{ refreshImpStatus(); doImportScan(); syncListener(2); }, 2000);
}
function selfTestParse(){
  // 不用付钱就能验证：把常见的真实通知文本喂进解析链路，看能不能出金额
  const samples=[
    ['工行短信','尾号5678卡9月19日20:43支出(消费支付宝-某服务商人工智能基础技…)20元，余额386.20元'],
    ['工行(只有余额，应剔除)','【工商银行】您尾号5678卡，余额1823.44元'],
    ['微信支付','微信支付：已支付¥15.80'],
    ['支付宝','你已成功付款 25.00 元'],
    ['建行收入','您尾号1234的储蓄卡账户9月20日14时30分收入人民币92.00元，余额500.00元'],
    ['招行支出','您账户1234于09月20日14:30网上支付人民币-35.50'],
    ['农行消费','您尾号8899卡09月20日15:20消费人民币68.00元'],
    ['云闪付','【云闪付】您尾号3344的银行卡消费12.50元'],
    ['验证码(应剔除)','验证码123456，5分钟内有效，请勿泄露'],
    ['营销(应剔除)','【银行】办卡享好礼，额度5万元，回复TD退订'],
  ];
  let out='【解析自测】\n注意：这里只测"文本 → 金额"这一步；能不能收到，看上面服务证据。\n\n';
  let okN=0, badN=0;
  samples.forEach(function(s){
    const name=s[0], text=s[1];
    const isPay=looksLikePaymentText(text);
    let r=[];
    try{ r=parseNotifFull({title:'',text:text,app:'',time:Date.now()}); }catch(e){}
    // 预期：标「应剔除」的必须判为非支付；其余必须判为支付且解析出金额
    const expectPay = !/应剔除/.test(name);
    const good = expectPay ? (isPay && r.length>0) : !isPay;
    if(good) okN++; else badN++;
    out+=(good?'✅ ':'❌ ')+name+'：'+(isPay?'判为支付':'判为非支付')
       +' → '+(r.length?r.map(function(x){return '¥'+x.amount+' '+(x.type==='income'?'收入':'支出')+'/'+x.category;}).join('、'):'未解析出金额')+'\n';
  });
  out+='\n合计：✅ '+okN+' 项正常'+(badN?('，❌ '+badN+' 项有问题 —— 请把本屏截图发我'):'（全部正常）');
  const st=document.getElementById('importNotifyStatus');
  st.style.display='block';
  st.style.textAlign='left';st.textContent=out;
  document.getElementById('importNotifyList').innerHTML='';
  return out;
}
// ── 全量分析：把手机里所有短信/通知过一遍，看清到底卡在哪一步 ──
function analyzeAll(){
  const BR='\n────────────────\n';
  let out='【全量分析】把手机里所有短信都过一遍，看卡在哪一步\n';
  let sms=[];
  try{
    if(window.MinisBridge && typeof window.MinisBridge.readSms==='function'){
      sms=JSON.parse(window.MinisBridge.readSms()||'[]');
    }
  }catch(e){ sms=[]; }
  if(!Array.isArray(sms)) sms=[];
  const cut=Date.now()-IMP_TTL;
  const recent=sms.filter(s=>s.date&&s.date>=cut);
  let pay=0, parsed=0, noise=0;
  const payNoAmt=[], noiseTop=[];
  const noiseKind={验证码:0, 营销:0, 催缴:0, 物流:0, 通知类:0};
  recent.forEach(s=>{
    const b=(s.body||'').replace(/\s+/g,' ');
    if(looksLikePaymentText(b)){
      pay++;
      let r=[]; try{ r=parseNotifFull({title:'',text:b,app:s.address||'',time:s.date}); }catch(e){}
      if(r.length) parsed++;
      else if(payNoAmt.length<6) payNoAmt.push(b.slice(0,70));
    }else{
      noise++;
      if(/验证码|校验码|动态码|取件码/.test(b)) noiseKind.验证码++;
      else if(/退订|优惠|特惠|办卡|贷款|抽奖/.test(b)) noiseKind.营销++;
      else if(/余额不足|欠费|请及时|应缴|应还/.test(b)) noiseKind.催缴++;
      else if(/快递|包裹|派送|物流/.test(b)) noiseKind.物流++;
      else noiseKind.通知类++;
      if(noiseTop.length<3) noiseTop.push(b.slice(0,50));
    }
  });
  out+='短信：共 '+sms.length+' 条，近7天 '+recent.length+' 条\n';
  out+=' · 判为支付：'+pay+' 条，其中解析出金额 '+parsed+' 条\n';
  out+=' · 判为非支付：'+noise+' 条（验证码'+noiseKind.验证码+'/营销'+noiseKind.营销+'/催缴'+noiseKind.催缴+'/物流'+noiseKind.物流+'/其他通知'+noiseKind.通知类+'）\n';
  if(payNoAmt.length) out+='\n⚠ 判为支付、但解析不出金额（漏账源头，请发我）：\n · '+payNoAmt.join('\n · ')+'\n';
  if(noiseTop.length) out+='\n剔除样本（确认没误杀）：\n · '+noiseTop.join('\n · ')+'\n';

  out+=BR;
  // 通知：已入队=判为支付；再看被滤掉的样本，确认没误杀
  out+='通知：当前队列 '+Number(__impRaw.nNotif||0)+' 条（判为支付才入队）\n';
  if(__impRaw.notif && __impRaw.notif.length){
    out+=' · '+__impRaw.notif.join('\n · ')+'\n';
  }
  const ev=readEvidence();
  let any=false, fl=[];
  for(let i=1;i<=5;i++){
    const v=ev['filtered_'+i];
    if(v){ any=true; fl.push(v); }
  }
  if(any){
    out+='\n被滤掉的通知样本（若银行通知出现在这里=我误判了，请发我）：\n · '+fl.join('\n · ')+'\n';
  } else {
    out+='\n（暂无被滤掉的通知样本）\n';
  }
  const st=document.getElementById('importNotifyStatus');
  st.style.display='block';
  st.style.textAlign='left';st.textContent=out;
  document.getElementById('importNotifyList').innerHTML='';
  return out;
}
function showImpDiag(){
  const st=document.getElementById('importNotifyStatus');
  st.style.display='block';
  const ev=readEvidence();
  let s='';
  // 环境自检：系统眼里的"我"到底是什么样（判断"绑不上"是清单问题还是系统问题）
  try{
    if(window.MinisBridge && typeof window.MinisBridge.selfCheck==='function'){
      const c=JSON.parse(window.MinisBridge.selfCheck()||'{}');
      s+='【环境自检】\n';
      s+='  · 清单允许系统连接服务(exported)：'+(c.exported==='true'?'✅ 是':'❌ '+(c.exported==='false'?'否 —— 清单写错了，这是绑不上的原因':'读取失败('+c.exported+')'))+'\n';
      s+='  · 系统「通知使用权」列表含本应用：'+(c.inList?'✅ 是':'❌ 否 —— 需要去设置里打开')+'\n';
      s+='  · 系统记录的原始值：'+(c.raw?c.raw:'(空)')+'\n\n';
    }
  }catch(e){}
  s+='【服务运行证据】（这些是服务自己记的，重启不丢）\n';
  s+='收到通知：支付类 '+Number(ev.notifPay||0)+' 条 / 非支付 '+Number(ev.notifNonPay||0)+' 条\n';
  s+='最近一条：'+(ev.lastNotifTs?(agoText(ev.lastNotifTs)+'（'+(ev.lastNotifApp||'?')+'）'):'从未收到')+'\n';
  s+='服务连接：'+Number(ev.connectCount||0)+' 次，最近 '+(ev.lastConnectTs?agoText(ev.lastConnectTs):'无')+'\n';
  s+='被解绑：'+Number(ev.disconnectCount||0)+' 次，最近 '+(ev.lastDisconnectTs?agoText(ev.lastDisconnectTs):'无')+'\n';
  s+='扫描通知栏：'+Number(ev.scanCount||0)+' 次，最近一次看到 '+Number(ev.lastScanActive||0)+' 条通知';
  s+= (ev.lastScanNull==='1') ? '  ⚠返回null=服务未被系统绑定\n' : '\n';
  if(ev.lastTriggerErr) s+='触发扫描报错：'+ev.lastTriggerErr+'\n';
  s+='\n'+impStatusText();
  s+='\n\n【本轮队列 '+__impRaw.nNotif+' 条】';
  s+= __impRaw.notif.length ? ('\n'+__impRaw.notif.join('\n'))
                            : '\n(空)';
  s+='\n\n【短信共 '+__impRaw.nSms+' 条，近7天 '+__impRaw.nRecent+' 条，原文样本】';
  s+= __impRaw.sms.length ? ('\n'+__impRaw.sms.join('\n'))
                          : '\n(空 —— 未授权读取短信，或短信库为空)';
  st.style.textAlign='left';st.textContent=s;
}

// ── 待处理框 Payment Inbox ──────────────────────────────
// 完整规则（面向长期，不只看眼前）：
//   ① 只放【纯支付信息】：非支付的通知/短信，扫描时判掉 → 从源删除 + 持久标记 → 永不再出现
//   ② 【已记账的】直接从源里删掉（全账本判重，无时间窗）
//   ③ 没记账的 → 进本框，等用户确认入账
//   ④ 手动清除的 → 留在框里灰显，7 天内可点「恢复」；满 7 天自动消失
//   ⑤ 所有「已处理」记录写在应用私有目录(原生 state)，清缓存/重装都不丢
const IMP_SKIP_KEY='minis_import_skip_v1';   // 旧键，仅兼容读取
const IMP_TTL=7*24*3600*1000;                // 7 天窗口：滞留框 + 已处理记录共用
const BOX_DISMISS_KEY='box_dismissed';       // 原生状态名：已清除区
const BOX_HANDLED_KEY='box_handled';         // 原生状态名：已处理集合

// ---- 原生状态读写（不可用时退回 localStorage，浏览器预览也能跑）----
function stateRead(name){
  try{
    if(window.MinisBridge && typeof window.MinisBridge.readState==='function'){
      const s=window.MinisBridge.readState(name);
      if(s){ const v=JSON.parse(s); if(v!=null) return v; }
    }
  }catch(e){}
  try{ const v=JSON.parse(localStorage.getItem('minis_state_'+name)||'null'); if(v!=null) return v; }catch(e){}
  return null;
}
function stateWrite(name,obj){
  const s=JSON.stringify(obj);
  try{ if(window.MinisBridge && typeof window.MinisBridge.writeState==='function') window.MinisBridge.writeState(name,s); }catch(e){}
  try{ localStorage.setItem('minis_state_'+name,s); }catch(e){}
}

// ---- 已处理集合：非支付 / 已记账 / 已清除的条目，永不再进框 ----
let HANDLED=null, HANDLED_ARR=[];
function loadHandled(){
  if(HANDLED) return HANDLED;
  const cut=Date.now()-IMP_TTL;
  let arr=stateRead(BOX_HANDLED_KEY); if(!Array.isArray(arr)) arr=[];
  arr=arr.filter(x=>x&&x.k&&x.ts>=cut);
  // 一次性迁移：旧版本把"忽略"存在 localStorage(IMP_SKIP_KEY)，整合进本集合，保住用户先前的忽略意图
  try{
    const legacy=JSON.parse(localStorage.getItem(IMP_SKIP_KEY)||'[]');
    if(Array.isArray(legacy)&&legacy.length){
      const have=new Set(arr.map(x=>x.k));
      let moved=0;
      legacy.forEach(k=>{ if(k&&!have.has('n:'+k)&&!have.has(k)){ arr.push({k:k,ts:Date.now()}); moved++; } });
      if(moved) stateWrite(BOX_HANDLED_KEY,arr);
      localStorage.removeItem(IMP_SKIP_KEY);
      console.log('[记账] 已迁移旧忽略记录', moved, '条');
    }
  }catch(e){}
  HANDLED_ARR=arr; HANDLED=new Set(arr.map(x=>x.k));
  return HANDLED;
}
function markHandled(keys){
  if(!keys||!keys.length) return;
  const h=loadHandled(); const now=Date.now();
  keys.forEach(k=>{ if(!k||h.has(k))return; h.add(k); HANDLED_ARR.push({k:k,ts:now}); });
  stateWrite(BOX_HANDLED_KEY,HANDLED_ARR);
}
function unmarkHandled(key){
  const h=loadHandled(); if(!h.has(key)) return;
  h.delete(key); HANDLED_ARR=HANDLED_ARR.filter(x=>x.k!==key);
  stateWrite(BOX_HANDLED_KEY,HANDLED_ARR);
}
function clearHandled(){ HANDLED=new Set(); HANDLED_ARR=[]; stateWrite(BOX_HANDLED_KEY,[]); }

// ---- 已清除区（灰显留存 7 天，可恢复）----
// 稳定去重键：不依赖 _boxKey/finger（旧版本存的记录没有这些字段，会导致同一笔堆成好几条）
function dismissKey(t){
  if(!t) return '';
  const k=entryKey(t);
  if(k) return k;
  const d=new Date(t._smsDate||t._time||0);
  const day=isNaN(d.getTime())?'?':d.toISOString().slice(0,10);
  return [t._src||'', Number(t.amount||0).toFixed(2), (t.note||'').replace(/\s+/g,'').slice(0,24), day].join('|');
}
// 已清除区：同一笔只保留一条（原来重复清除会堆积成 4 条一模一样的）
function loadDismissed(){
  const cut=Date.now()-IMP_TTL;
  let arr=stateRead(BOX_DISMISS_KEY); if(!Array.isArray(arr)) arr=[];
  const seen={}, kept=[];
  for(const d of arr){
    if(!d||!d.t||!(d.ts>=cut)) continue;
    const k=dismissKey(d.t);
    if(k&&seen[k]) continue;
    if(k) seen[k]=1;
    kept.push(d);
  }
  if(kept.length!==arr.length) stateWrite(BOX_DISMISS_KEY,kept);
  return kept;
}
// 加进「已清除」：同一笔已在则不再重复添加
function addDismissed(t){
  const dis=loadDismissed();
  const k=dismissKey(t);
  if(k && dis.some(d=>dismissKey(d.t)===k)) return dis;
  dis.push({ts:Date.now(),t:t});
  saveDismissed(dis);
  return dis;
}
function saveDismissed(arr){ stateWrite(BOX_DISMISS_KEY,arr); }

// 彻底删除：从「已清除」移除 + 记入已处理集合 → 永不再出现（也不可恢复）
function purgeDismissed(i){
  const dis=loadDismissed(); const d=dis[i]; if(!d) return;
  const k=entryKey(d.t)||d.t.finger||'';
  dis.splice(i,1); saveDismissed(dis);
  if(k) markHandled([k]);
  renderImpList(); ts('已彻底删除');
}
async function purgeAllDismissed(){
  const dis=loadDismissed();
  if(!dis.length) return ts('已清除区是空的');
  if(!await confirmBox('彻底删除「已清除」里全部 '+dis.length+' 条？\n删除后不再出现，也无法恢复。')) return;
  const keys=dis.map(d=>entryKey(d.t)||d.t.finger||'').filter(Boolean);
  if(keys.length) markHandled(keys);
  saveDismissed([]);
  renderImpList(); ts('已彻底删除 '+dis.length+' 条');
}

// ---- 条目标识（持久、内容相关；不用时间戳，避免重号）----
function notifKey(n){ return n&&n.nkey?('n:'+n.nkey):(n&&n.id?('nid:'+n.id):''); }
function smsKey(s){
  const body=(s&&s.body)||''; let h=0;
  for(let i=0;i<body.length;i++) h=(h*31+body.charCodeAt(i))|0;
  return 's:'+((s&&s.address)||'')+':'+((s&&s.date)||0)+':'+(h>>>0).toString(16);
}
function entryKey(t){ return (t&&t._boxKey)||''; }

function impRowHtml(t,i){
  const src=t._src==='sms'?'短信':'通知';
  const when=t._smsDate?new Date(t._smsDate):(t._time?new Date(t._time):null);
  const meta=`${src}${when?' · '+when.toLocaleString():''}`;
  if(t._manual){
    // 像支付但解析不出金额 → 给输入框手填，而不是丢掉
    return `<div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:8px;font-size:14px">
      <input type="checkbox" checked data-idx="${i}" style="width:18px;height:18px">
      <span style="flex:1">
        <input type="number" step="0.01" inputmode="decimal" placeholder="金额" data-manual="${i}"
          style="width:88px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font-size:14px">
        <span style="font-size:12px;color:var(--text2)"> ✎ 没解析出金额，请手填</span><br>
        <span style="font-size:12px;color:var(--text2)">${meta} · ${(t.note||'').replace(/</g,'&lt;')}</span>
      </span>
      <button onclick="delImpItem(${i})" style="background:none;border:none;color:#e55;font-size:18px;padding:0 6px;cursor:pointer" title="清除(7天内可恢复)">×</button>
    </div>`;
  }
  return `<div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:8px;font-size:14px">
      <input type="checkbox" checked data-idx="${i}" style="width:18px;height:18px">
      <span style="flex:1"><b>¥${Number(t.amount).toFixed(2)}</b> ${t.type==='income'?'收入':'支出'} · ${t.category}${t.account?' · '+t.account:''}<br><span style="font-size:12px;color:var(--text2)">${meta} · ${(t.note||'').replace(/</g,'&lt;')}</span></span>
      <button onclick="delImpItem(${i})" style="background:none;border:none;color:#e55;font-size:18px;padding:0 6px;cursor:pointer" title="清除(7天内可恢复)">×</button>
    </div>`;
}
function renderImpList(){
  const list=document.getElementById('importNotifyList');
  const st=document.getElementById('importNotifyStatus');
  const cb=document.getElementById('importConfirmBtn');
  const dis=loadDismissed();
  const alog=loadAutoLog();
  let html='';
  if(impTx.length) html+=impTx.map((t,i)=>impRowHtml(t,i)).join('');
  // ── 已自动入账（必须显眼：否则用户以为"没识别到"）──
  if(alog.length){
    const recent=alog.slice().reverse().slice(0,12);
    html+=`<div style="margin-top:12px;padding-top:8px;border-top:1px dashed var(--border);display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-size:12px;color:#2a9d5c">✅ 已自动入账 ${alog.length} 笔（已在流水，无需确认）</span>
        <button onclick="clearAutoLog();renderImpList()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:11px;padding:3px 8px;cursor:pointer">清空</button>
      </div>`
      + recent.map(a=>`<div style="display:flex;padding:5px 0;gap:8px;font-size:12px;color:var(--text2)">
          <span style="width:64px;text-align:right;font-weight:600;color:var(--text)">¥${Number(a.amount).toFixed(2)}</span>
          <span style="flex:1">${a.type==='income'?'收入':'支出'} · ${a.category||''}${a.account?' · '+a.account:''}<br><span style="opacity:.75">${(a.note||'').replace(/</g,'&lt;')}</span></span>
          <span style="opacity:.6;white-space:nowrap">${new Date(a.ts).toLocaleTimeString().slice(0,5)}</span>
        </div>`).join('');
  }
  if(dis.length){
    html+=`<div style="margin-top:12px;padding-top:8px;border-top:1px dashed var(--border);display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-size:12px;color:var(--text2)">已清除（灰显留存 7 天，可恢复）</span>
        <button onclick="purgeAllDismissed()" style="background:none;border:1px solid var(--border);border-radius:6px;color:#e55;font-size:11px;padding:3px 8px;cursor:pointer">全部删除</button>
      </div>`
      + dis.map((d,i)=>`<div style="display:flex;align-items:center;padding:6px 0;gap:8px;font-size:12px;color:var(--text2);opacity:.6">
          <span style="flex:1;text-decoration:line-through">¥${Number(d.t.amount).toFixed(2)} · ${(d.t.note||'').replace(/</g,'&lt;')}</span>
          <button onclick="undelImpItem(${i})" style="background:none;border:none;color:var(--accent);font-size:12px;padding:0 4px;cursor:pointer">恢复</button>
          <button onclick="purgeDismissed(${i})" style="background:none;border:none;color:#e55;font-size:12px;padding:0 4px;cursor:pointer" title="彻底删除，不再出现">删</button>
        </div>`).join('');
  }
  list.innerHTML=html;
  if(impTx.length){ st.style.display='none'; cb.style.display='block'; }
  else{
    st.style.display='block'; cb.style.display='none';
    if(dis.length){st.style.textAlign='center';st.textContent='框中暂无待入账支付信息（下方为已清除留存）。'}
    else if(alog.length){st.style.textAlign='center';st.textContent='框中暂无待确认的支付（下方是已自动入账的记录）。'}
    else st.textContent = window.__impDiag||'未发现支付信息。请保留银行/微信/支付宝的支付通知或短信后重新扫描。';
  }
}
function undelImpItem(i){
  const dis=loadDismissed(); const d=dis[i]; if(!d) return;
  dis.splice(i,1); saveDismissed(dis);
  unmarkHandled(entryKey(d.t));     // 撤销「已处理」标记 → 允许它回到框中
  impTx.push(d.t); renderImpList(); ts('已恢复');
}
// ── 智能配对去重 ────────────────────────────────────────
// ① 同一 key（同一条通知/短信）→ 去重
// ② 金额完全相同 + 同类型 + 10分钟内 → 视为重复（银行短信 + 银行App推送）
// ③ ★【面额 vs 实付】充值/缴费短信写的是面额(如充100)，银行短信写的是实付(如扣96)：
//    同一时间窗内两者是【同一笔交易】，必须合并成一条，金额取【实付】。
//    否则会出现「充100 + 扣96 = 196，实际只花96」的重复记账。
function isRechargeItem(e){
  const acc=(e&&e.account)||'';
  const note=(e&&e.note)||'';
  // ★ 修：原来「账户是银行卡 → 直接 return false」会把
  //   "银行短信里写的充值"排除掉（如「尾号5678卡充值话费100元」），
  //   导致 充100/扣96 配不上对 → 记成 196。
  //   正确判据应看【文本说的是不是"充值/缴费"这件事】，而不是账户叫什么都不看。
  //   只有"这明显是银行扣款流水"时才不算面额。
  const isRechargeWord=/充值|缴费|话费|电费|水费|燃气费|充话费/.test(note);
  if(!isRechargeWord) return false;
  // ★ 关键：必须与 isBankItem 互斥。
  //   若本条已被判定为"银行扣款实付"（含扣款/消费/支出，且不含成功充值），就不是面额侧。
  if(/扣款|消费|支出|付款/.test(note) && !/成功充值|已充值|充值成功|缴费成功|已缴费/.test(note)) return false;
  if(/银行卡|储蓄卡|信用卡|借记卡/.test(acc)) {
    // 银行渠道发的"成功充值"通知 → 仍是面额侧
    return true;
  }
  return true;
}
function isBankItem(e){
  const acc=(e&&e.account)||'';
  const note=(e&&e.note)||'';
  // ★ 第一个判据：先排除"面额侧"（充值/缴费通知），保证与 isRechargeItem 互斥。
  //   否则「尾号5678卡充值话费100元」会被同时判成 bank 和 recharge → 配不成"一面一实付"。
  if(/充值|缴费|话费|电费|水费|燃气费|充话费/.test(note)
     && !/扣款|消费|支出|付款/.test(note)) return false;
  if(/银行卡|储蓄卡|信用卡|借记卡/.test(acc)) return true;
  // ★ 银行短信常常不写"银行"二字，只写「尾号5678卡消费88.00元」——
  //   靠关键词"银行"会漏判，导致 充100/扣96 无法配对 → 重复记账。
  if(/尾号\s?\d{3,6}/.test(note)) return true;      // 尾号5678卡
  if(/卡号\s?\d/.test(note)) return true;           // 卡号****1234
  if(/人民币/.test(note)) return true;              // 银行特有措辞
  if(/(储蓄|信用|借记)卡/.test(note)) return true;
  // ★ 修：银行短信也可能写得很"素"，没有尾号/卡号/银行名：
  //   如「您9月19日支出88.00元」「您账户于14:30网上支付35.50」。
  //   这类只靠"银行专有词"识别不出来 → 与充值短信配不上对 → 196。
  //   改为：出现"实付类动词 + 金额"，且不含充值/缴费意图 → 视为银行（实付）侧。
  if(/扣款|支出|消费|支付|付款|取现|转出|代扣/.test(note)) return true;
  return false;
}
function mergePool(pool){
  // 排序：已记账优先（避免重复入账），其次银行实付优先（金额更准——合并时保留的是先入 out 的那条），
  //       再按时间倒序。注意：配对判据已做成【对称】的（见下），不再依赖排序碰运气。
  pool.sort((a,b)=>{
    const r=(b._recorded?1:0)-(a._recorded?1:0); if(r) return r;
    const bk=(isBankItem(b)?1:0)-(isBankItem(a)?1:0); if(bk) return bk;
    return (b._smsDate||b._time||0)-(a._smsDate||a._time||0);
  });
  const out=[], seenK=new Set();
  const WINDOW=10*60*1000;
  for(const e of pool){
    const k=entryKey(e)||e.finger;
    if(k&&seenK.has(k)) continue;                 // ① 同 key
    if(e._manual){ if(k)seenK.add(k); out.push(e); continue; }
    const t=e._smsDate||e._time||0;
    const amt=Number(e.amount);
    let dup=false;
    for(const o of out){
      if(o._manual) continue;
      if((o.type||'expense')!==(e.type||'expense')) continue;
      const ot=o._smsDate||o._time||0;
      if(t&&ot&&Math.abs(ot-t)>WINDOW) continue;
      const oamt=Number(o.amount);
      if(Math.abs(oamt-amt)<0.005){ dup=true; break; }            // ② 金额相同
      // ③ ★面额 vs 实付 —— 必须【对称判断】：
      //    原来写成两条方向各判一次，只要任一侧的 isBankItem/isRechargeItem 判错，
      //    配对就失败 → 记成 196（用户亲历的 bug）。而且原来只有"银行在前"才碰巧合并，
      //    本质是靠上面的 sort 兜底，不是判据本身成立。
      //    现在改为：无论谁先谁后，只要【一个是面额侧、一个是实付侧】且实付在面额 50%~100% 之间 → 同一笔。
      const eR=X_isRecharge(e), eB=X_isBank(e);
      const oR=X_isRecharge(o), oB=X_isBank(o);
      const eFace=(eR&&!eB), eReal=(eB&&!eR);
      const oFace=(oR&&!oB), oReal=(oB&&!oR);
      if(eFace&&oReal && amt>=oamt && oamt>=amt*0.5){ dup=true; break; }   // 本=面额, 已在=实付
      if(eReal&&oFace && oamt>=amt && amt>=oamt*0.5){ dup=true; break; }   // 本=实付, 已在=面额
    }
    if(dup) continue;
    if(k) seenK.add(k);
    out.push(e);
  }
  return out;
}
// 内部别名，便于配对处写得短（真正的实现在上面）
function X_isRecharge(e){ return isRechargeItem(e); }
function X_isBank(e){ return isBankItem(e); }
async function doImportScan(){
  const st=document.getElementById('importNotifyStatus');
  st.style.display='block'; st.style.textAlign='center'; st.textContent='扫描中...';
  document.getElementById('importConfirmBtn').style.display='none';
  impTx=[]; window.__impDiag='';
  try{
    const now=Date.now(), cut=now-IMP_TTL;
    const handled=loadHandled();
    const killNotif=[], pool=[];   // pool: 全部解析出的支付条目(含已记账, 用于配对去重)
    let nNotif=0, nSms=0, nDrop=0, nDup=0, nManual=0, nRecentSms=0, nPaySms=0, smsRecent=[];

    // ── ① 原生通知队列 ──
    let notifRaw=[];
    try{
      let raw=null;
      if(window.MinisBridge && typeof window.MinisBridge.readImportedTx==='function'){
        if(typeof window.MinisBridge.triggerScan==='function') window.MinisBridge.triggerScan();
        await new Promise(r=>setTimeout(r,600));
        raw=window.MinisBridge.readImportedTx();
      }else{
        const x=new XMLHttpRequest(); x.open('GET','./imported_tx.json',false); x.send();
        if(x.status===200) raw=x.responseText;
      }
      notifRaw=JSON.parse(raw||'[]'); if(!Array.isArray(notifRaw)) notifRaw=[];
    }catch(e){ notifRaw=[]; }
    nNotif=notifRaw.length;

    for(const n of notifRaw){
      const key=notifKey(n); if(!key) continue;
      // 超出 7 天 / 已处理过 → 从源删除
      if((n.time && n.time<cut) || handled.has(key)){ if(n.id) killNotif.push(n.id); nDrop++; continue; }
      const parsed=parseNotifFull(n);
      if(!parsed.length){
        // 先用「纯支付」判定分两种：
        if(!looksLikePaymentText((n.title||'')+' '+(n.text||''))){
          // ① 确认不是支付信息 → 从源删除（不写永久集合：万一判定规则误伤，下次扫描还能重判）
          if(n.id) killNotif.push(n.id);
          nDrop++; continue;
        }
        // ② 像支付但解析不出金额 =【解析局限】，不能当非支付删掉。
        //    静默删除会让用户以为"又漏了" → 改为进框，由用户手填金额。
        pool.push({amount:null,_manual:true,type:'expense',category:'其他',account:'',
                   note:((n.title||'')+' '+(n.text||'')).trim().slice(0,80),
                   _rawId:n.id,_rawNkey:n.nkey,_src:'notice',_time:n.time,_boxKey:key,_recorded:false});
        nManual++;
        continue;
      }
      parsed.forEach(p=>{
        const e=Object.assign({},p,{_rawId:n.id,_rawNkey:n.nkey,_src:'notice',_time:n.time,_boxKey:key});
        e._recorded=isAlreadyBooked(e);   // 已记账标记（含面额/实付跨来源判断）
        pool.push(e);
      });
    }

    // ── ② 短信收件箱 ──
    if(window.MinisBridge && typeof window.MinisBridge.readSms==='function'){
      let smsArr=[];
      try{ smsArr=JSON.parse(window.MinisBridge.readSms()||'[]'); }catch(e){ smsArr=[]; }
      if(!Array.isArray(smsArr)) smsArr=[];
      nSms=smsArr.length;
      smsRecent=smsArr.filter(s=>s.date && s.date>=cut);
      nRecentSms=smsRecent.length;
      nPaySms=smsRecent.filter(s=>looksLikePaymentText(s.body||'')).length;
      for(const s of smsRecent){
        const key=smsKey(s);
        if(handled.has(key)) continue;
        if(!s.date || s.date<cut) continue;                       // 超窗：不处理也不标记
        if(!looksLikePaymentText(s.body||'')){ nDrop++; continue; } // 非支付 → 不进框（不写永久集合，规则改动后可重判）
        const parsed=parseNotifFull({title:'',text:s.body||'',app:s.address||'',time:s.date});
        if(!parsed.length){
          // 看着像支付却解析不出金额 → 进框手填，绝不静默丢弃
          pool.push({amount:null,_manual:true,type:'expense',category:'其他',account:'',
                     note:(s.body||'').slice(0,80),
                     _rawId:'',_rawNkey:key,_src:'sms',_smsAddress:s.address,_smsDate:s.date,_boxKey:key,_recorded:false});
          nManual++;
          continue;
        }
        parsed.forEach(p=>{
          const e=Object.assign({},p,{_rawId:'',_rawNkey:key,_src:'sms',_smsAddress:s.address,_smsDate:s.date,_boxKey:key});
          e._recorded=isAlreadyBooked(e);
          pool.push(e);
        });
      }
    }

    // ── ③ 智能配对去重（见 mergePool：含「面额 vs 实付」合并，防充100+扣96=196）──
    const merged=mergePool(pool);
    const nMerge=pool.length-merged.length;

    // ── ④ 源清理：通知里已无待入账条目的 → 从原生队列删除 ──
    const usedKeys={};
    merged.forEach(e=>{ if(e._src==='notice'&&!e._recorded) usedKeys[e._boxKey]=1; });
    for(const n of notifRaw){
      const key=notifKey(n); if(!key||usedKeys[key]) continue;
      if(n.id && killNotif.indexOf(n.id)<0) killNotif.push(n.id);
      markHandled([key]);
    }

    // ── ⑤ 入框：只留未记账的 ──
    nDup=merged.filter(e=>e._recorded).length;
    impTx=merged.filter(e=>!e._recorded).map(e=>{ const c=Object.assign({},e); delete c._recorded; return c; });
    impTx.sort((a,b)=>(b._smsDate||b._time||0)-(a._smsDate||a._time||0));

    // ── ⑥ 诊断留档（供「诊断」按钮展示，一眼看出为什么没抓到）──
    __impRaw={
      nNotif:nNotif, nSms:nSms, nRecent:nRecentSms, nPay:nPaySms,
      lastScan:new Date().toTimeString().slice(0,8),
      notif:notifRaw.slice(0,3).map(n=>(n.app||'')+'／'+(n.title||'')+'／'+(n.text||'').slice(0,60)),
      sms:smsRecent.slice(0,3).map(s=>(s.address||'')+' · '+new Date(s.date||0).toLocaleString()+' · '+(s.body||'').slice(0,60))
    };
    refreshImpStatus();

    // ── ④ 从源里真正删除 ──
    if(killNotif.length) ackPending(killNotif);

    // ── ⑤ 诊断 ──
    window.__impDiag='本轮：通知 '+nNotif+' 条 / 短信 '+nSms+' 条 → 待入账 '+impTx.length+' 条'
      +'（自动剔除：非支付 '+nDrop+' 条，已记账 '+nDup+' 条，合并重复 '+nMerge+' 条）';
    if(!impTx.length){
      // 有已清除留存 / 有自动入账记录 → 正常渲染，而不是显示"未发现支付信息"
      if(loadDismissed().length || loadAutoLog().length){ renderImpList(); return; }
      if(window.MinisBridge && typeof window.MinisBridge.hasNotifAccess==='function'){
        let ok=true; try{ ok=window.MinisBridge.hasNotifAccess(); }catch(e){}
        if(!ok){
          st.style.display='block';
          st.textContent='未开启「通知使用权」，读不到支付通知（短信仍可读）。';
          document.getElementById('importNotifyList').innerHTML='<button class="submit" onclick="openNotifCfg()">打开设置授权</button>';
          return;
        }
      }
      st.style.display='block';
      let why='';
      try{
        const ev=readEvidence();
        let granted=null;
        if(window.MinisBridge && typeof window.MinisBridge.notifStatus==='function'){
          granted=JSON.parse(window.MinisBridge.notifStatus()||'{}').granted;
        }
        if(granted===false) why='\n⚠ 通知使用权未开 → 支付通知收不到（5G消息类银行通知也不在短信库里）。';
        else if(Number(ev.connectCount||0)===0) why='\n⚠ 系统从未绑定过通知服务（权限虽已开却没连上）→ 打开「通知设置」，把「记账」的开关【关掉再打开】，回来点「重连通知服务」。';
        else if(ev.lastScanNull==='1') why='\n⚠ 服务未被系统绑定（扫描通知栏返回空）→ 点上面「重连通知服务」。';
        else if(!ev.lastNotifTs) why='\n⚠ 服务已连上但从未收到通知。若确实有支付通知，请在系统设置给「记账」开「后台高耗电/自启动」。';
      }catch(e){}
      st.style.textAlign='left';st.textContent=window.__impDiag+why+'\n没有可入账的支付信息。保留支付通知/短信后重新扫描。';
      document.getElementById('importNotifyList').innerHTML='';
      return;
    }
    renderImpList();
  }catch(e){
    st.style.display='block';
    st.textContent='扫描失败：'+e.message;
  }
}
// 清除某条：从原生队列真正删除(不再占位) + 进「已清除」区(7天内可恢复)
function delImpItem(i){
  const t=impTx[i]; if(!t) return;
  delImpItemConfirm(i,t);
}
async function delImpItemConfirm(i,t){
  const desc='¥'+(t.amount!=null?Number(t.amount).toFixed(2):'?')+' · '+(t.type==='income'?'收入':'支出')+(t.category?' · '+t.category:'')+(t.note?' · '+t.note:'');
  if(!await confirmBox('清除这条？7天内可恢复\n'+desc))return;
  const key=entryKey(t);
  // ① 从源里真正删除：通知 → ack 原生队列；短信/通用 → 持久标记「已处理」
  if(t._src==='notice'&&t._rawId) ackPending([t._rawId]);
  if(key) markHandled([key]);
  // ③ 移到「已清除」区，灰显留存 7 天，可恢复（同 key 不重复堆积）
  addDismissed(t);
  impTx.splice(i,1);
  renderImpList();
  ts('已清除，7天内可恢复');
}
function doImportConfirm(){
  const checked=document.querySelectorAll('#importNotifyList input:checked');
  if(!checked.length)return ts('请至少选择一条');
  const tx=atx();
  const ackIds=[], handledKeys=[];
  let skipped=0, added=0;
  checked.forEach(cb=>{
    const i=parseInt(cb.dataset.idx,10);
    const t=impTx[i];
    if(!t) return;
    let amt=t.amount;
    if(t._manual){
      // 手填金额：没填或非法 → 跳过（不写入脏数据）
      const inp=document.querySelector('#importNotifyList input[data-manual="'+i+'"]');
      amt=inp?parseFloat(inp.value):NaN;
      if(isNaN(amt)||amt<=0){ skipped++; return; }
    }
    if(!(amt>0)){ skipped++; return; }
    // 记账日期：短信按短信日期，通知按通知时间，都没有才用今天
    const d=new Date(t._smsDate||t._time||Date.now());
    const ok=!isNaN(d.getTime());
    const ds=ok?d.toISOString().slice(0,10):new Date().toISOString().slice(0,10);
    const hh=ok?d.toTimeString().slice(0,8):'12:00:00';
    tx.push({id:uid(),time:ds+'T'+hh,type:t.type,amount:amt,note:t.note||'',
             account:t.account||'',category:t.category||'其他',
             finger:t.finger||payFingerprint(t.note||'',t.account||'',amt,d.getTime())});
    if(t._src==='notice'&&t._rawId) ackIds.push(t._rawId);
    const k=entryKey(t); if(k) handledKeys.push(k);
    added++;
  });
  if(!added){
    if(skipped) return ts('手填金额后再确认（'+skipped+' 条缺金额）');
    return ts('没有可入账的条目');
  }
  stx(tx);closeImportNotify();ra();
  ts('已入账 '+added+' 条'+(skipped?('，'+skipped+' 条因缺金额跳过'):''));
  // 关键：记完就从源里删掉 + 持久标记 → 以后不再出现（不靠 localStorage，清缓存也不丢）
  if(ackIds.length) ackPending(ackIds);
  if(handledKeys.length) markHandled(handledKeys);
  doImportScan(); // 刷新，已入账的立即消失
}

// ── 余额对账 ──────────────────────────────────────────
// 用途：漏记会让账面余额和真实余额对不上。填一次真实余额，系统直接算出差额。
// 差额 = 真实 - 账面。若差 -20，说明有 20 元支出漏记了。
function reconDerived(){
  const bal={};
  atx().forEach(t=>{
    if(t.type==='transfer'){
      bal[t.from]=(bal[t.from]||0)-t.amount;
      bal[t.to]=(bal[t.to]||0)+t.amount;
      if(t.fee){ if(t.feePayer==='to') bal[t.to]=(bal[t.to]||0)-t.fee; else bal[t.from]=(bal[t.from]||0)-t.fee; }
    } else if(t.account){
      bal[t.account]=(bal[t.account]||0)+(t.type==='income'?t.amount:-t.amount);
    }
  });
  return bal;
}
function openRecon(){
  const accts=ga()||[];
  const invs=(gi()||[]).filter(x=>x.ours!==false);
  const der=reconDerived();
  let html='';
  if(!accts.length && !invs.length){
    html='<div style="color:var(--text2);font-size:13px;padding:12px 0">还没有账户。先在「账户」里添加。</div>';
  }
  accts.forEach(a=>{
    const d=Number(der[a]||0);
    html+=`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-size:14px">${a}</span>
        <span class="recon-book" data-book-label="${a}" style="font-size:12px;color:var(--text2)">账面 ¥${d.toFixed(2)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <span style="font-size:12px;color:var(--text2);flex:0 0 auto">真实余额</span>
        <input type="text" inputmode="decimal" data-recon="${a}" data-book="${d}"
          oninput="reconShow(this)" placeholder="填真实余额"
          style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-size:14px">
        <span class="recon-diff" data-for="${a}" style="font-size:12px;flex:0 0 auto;min-width:70px;text-align:right"></span>
        <button class="recon-fix" data-name="${a}" onclick="reconFix(this)" disabled>矫正</button>
      </div>
    </div>`;
  });
  invs.forEach(x=>{
    const amt=Number(x.amount)||0;
    html+=`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-size:14px">${x.name}</span>
        <span class="recon-book" data-book-label="${x.name}" style="font-size:12px;color:var(--text2)">理财 · 当前 ¥${amt.toFixed(2)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <span style="font-size:12px;color:var(--text2);flex:0 0 auto">真实余额</span>
        <input type="text" inputmode="decimal" data-recon="${x.name}" data-book="${amt}" data-inv="1"
          oninput="reconShow(this)" placeholder="填真实余额"
          style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-size:14px">
        <span class="recon-diff" data-for="${x.name}" style="font-size:12px;flex:0 0 auto;min-width:70px;text-align:right"></span>
        <button class="recon-fix" data-name="${x.name}" onclick="reconFix(this)" disabled>矫正</button>
      </div>
    </div>`;
  });
  document.getElementById('reconList').innerHTML=html;
  document.getElementById('reconModal').classList.add('show');
}
/* 纯函数：把「¥1,234.5」「1 234.5」这类手输金额洗成数字 */
function reconNum(v){
  const clean=String(v==null?'':v).replace(/[,，\s¥￥]/g,'');
  if(clean==='') return NaN;
  const n=parseFloat(clean);
  return isNaN(n)?NaN:n;
}
function reconShow(inp){
  const name=inp.getAttribute('data-recon');
  const book=Number(inp.getAttribute('data-book'))||0;
  const el=document.querySelector('.recon-diff[data-for="'+name+'"]');
  const btn=document.querySelector('.recon-fix[data-name="'+name+'"]');
  if(!el) return;
  const v=inp.value.trim();
  if(v===''){ el.textContent=''; if(btn)btn.disabled=true; return; }
  const real=reconNum(v);
  if(isNaN(real)){ el.textContent=''; if(btn)btn.disabled=true; return; }
  const diff=Math.round((real-book)*100)/100;
  if(Math.abs(diff)<0.005){ el.style.color='var(--green)'; el.textContent='✅ 对平'; if(btn)btn.disabled=true; }
  else if(diff<0){ el.style.color='#e55'; el.textContent='差 '+diff.toFixed(2)+'（漏记）'; if(btn)btn.disabled=false; }
  else { el.style.color='var(--gold)'; el.textContent='多 '+diff.toFixed(2); if(btn)btn.disabled=false; }
}
/* 按输入的真实余额把账面改过来：现金账户补一笔调整记录，理财账户直接改金额 */
function reconFix(btn){
  const name=btn.getAttribute('data-name');
  const inp=[...document.querySelectorAll('#reconList input[data-recon]')].find(i=>i.getAttribute('data-recon')===name);
  if(!inp) return;
  const real=reconNum(inp.value);
  if(isNaN(real)) return ts('先填真实余额');
  const book=Number(inp.getAttribute('data-book'))||0;
  const diff=Math.round((real-book)*100)/100;
  if(Math.abs(diff)<0.005) return ts('已经对平，不用矫正');
  const isInv=inp.getAttribute('data-inv')==='1';
  if(isInv){
    const arr=gi()||[];
    const it=arr.find(x=>x.name===name);
    if(!it) return ts('找不到这个理财账户');
    it.amount=real;
    si(arr); ra();
    ts('已矫正 '+name+' → ¥'+real.toFixed(2));
  }else{
    const tx=atx();
    tx.push({
      id:uid(),
      time:new Date().toISOString().slice(0,19),
      type:diff>0?'income':'expense',
      amount:Math.abs(diff),
      note:'余额矫正',
      account:name,
      category:'余额调整'
    });
    stx(tx); ra();
    ts('已矫正 '+name+' → ¥'+real.toFixed(2)+'（补'+(diff>0?'收入':'支出')+' ¥'+Math.abs(diff).toFixed(2)+'）');
  }
  /* 只更新这一行，不重渲染整个弹窗 —— 否则其他账户填了一半的值会丢 */
  inp.setAttribute('data-book', real);
  inp.value='';
  const diffEl=document.querySelector('.recon-diff[data-for="'+name+'"]');
  if(diffEl){ diffEl.style.color='var(--green)'; diffEl.textContent='✅ 已矫正'; }
  const bookEl=document.querySelector('.recon-book[data-book-label="'+name+'"]');
  if(bookEl){
    bookEl.textContent = isInv ? ('理财 · 当前 ¥'+real.toFixed(2)) : ('账面 ¥'+real.toFixed(2));
  }
  btn.disabled=true;
}
