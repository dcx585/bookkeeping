function parseNotifFull(n){
/* [V2-HOOK] */
  // ★ v2 分流：开关打开时走新解析器，关掉走旧逻辑
  if (window.PARSE_V2 && typeof parseNoticeV2 === 'function') {
    try {
      const v2items = parseNoticeV2(n);
      if (v2items.length) {
        const t0 = n.time || Date.now();
        return v2items.map(b => Object.assign({}, b, {
          src: n.app || '',
          time: b.time || t0,
          finger: payFingerprint(b.note || '', b.account, b.amount, b.time || t0),
          _v2: true,
        }, autoBookGate(b)));
      }
    } catch (e) { console.warn('[v2] 解析失败，回退旧逻辑', e); }
  }
  // 返回数组：一条通知可能合了多笔支付（安卓把2-3条合并成一条），所以输出多笔
  const time = n.time||Date.now();
  const raw=(n.title||'')+' '+(n.text||'')+' '+(n.app||'');
  // 多笔解析
  const items = parseNotifMulti(n);
  return items.map((b,i)=>{
    // 专项资金判定针对"每一笔自身"的文本，且只针对支出(收入如退款/工资/红包应正常记账，账户不敏感)
    const finger = payFingerprint(b.note||raw, b.account, b.amount, time+i*1000);
    return Object.assign({}, b,{
      src:n.app||'', time:time, finger:finger
    }, autoBookGate(b));
  });
}

// ── 多笔解析：一条通知拆出多笔独立交易（针对"多条支付合并成一条通知"）──
function findAmounts(s){
  const out=[];
  // ★ 修（2026-10-08）：原来"动词+数字"要求数字【紧跟】动词，但微信/支付宝常见
  //   「支付成功 32.50」「付款成功32.50」「已成功付款25.00」——
  //   动词后面跟的是"成功/已"这类词，数字被隔开，且数字又没带 ¥ 或 元，
  //   于是完全抠不出金额 → 通知被判为非支付丢弃（"微信不显示"的又一条成因）。
  //   修法：动词与数字之间允许插入少量限定词（成功/已/了/：/空格等），最多 4 个字。
  //   另加「支付凭证」——微信支付凭证卡片的固定标题，后面跟的就是金额。
  const re=/([¥￥]\s?\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?\s?元)|[-－]\s?\d+(?:\.\d{1,2})?|(?:(?:支付|付款|消费|转账)凭证|扣款|消费|付款|支付|支出|退款|退回|收入|收款|到账|存入|转入|买入|卖出|花费|花出|缴|充值|还款|应还|优惠后)[成功已到账了的]*\s?[：:，,]?\s?[¥￥]?\s?\d+(?:\.\d{1,2})?/g;
  let m;
  while((m=re.exec(s))){
    const amtMatch=m[0].match(/\d+(?:\.\d{1,2})?/);
    const amt=amtMatch?parseFloat(amtMatch[0]):null;
    if(amt==null) continue;
    // 排除"余额/剩余/结余/账户余额"等字段后的金额——它描述账户余额，不是交易金额
    const before=s.slice(Math.max(0,m.index-5),m.index);
    if(/余额|剩余|结余/.test(before)) continue;
    out.push({amt, pos:m.index, len:m[0].length});
  }
  return out;
}
function isPaymentSegment(seg){
  // 若不含任何支付动作词且无¥/￥符号，视为非支付段落
  return /消费|付款|支付|支出|扣款|退款|退回|收入|收款|到账|存入|转入|花费|花出|购入|买了|充值|缴费|还款|转账|买入|卖出|实付|优惠/.test(seg)||/[¥￥]/.test(seg);
}
function splitByAmount(s){
  const amounts=findAmounts(s);
  if(!amounts.length) return [s];
  const segs=[];
  for(let i=0;i<amounts.length;i++){
    const start=amounts[i].pos;
    const end=i+1<amounts.length?amounts[i+1].pos:s.length;
    segs.push(s.slice(start,end));
  }
  return segs;
}
function singleParse(seg,parentAcc){
  const f=findAmounts(seg);
  if(!f.length) return null;
  const amt=isFinite(f[0].amt)&&f[0].amt>0?f[0].amt:null;
  if(amt==null) return null;
  const s=seg;
  // 排除"提醒类"非实际消费(余额不足/欠费/请及时缴费/应缴) —— 这些是催缴/提示, 不是已发生的支出
  const remind=/余额不足|余额提醒|欠费|请及时|温馨提醒|温馨提示|现提醒|应缴|应还|至少|不足，|不足,.+/;
  const donePay=/已支付|已扣款|已消费|支出成功|成功支付|已完成|已成功|已完成支付|扣款成功|支付成功|入账成功|已缴费|已充值|已转入|已退回|已收款|交易成功|消费成功|已支出/;
  if(remind.test(s) && !donePay.test(s)) return null;
  let type='expense';
  const income=/收入|入账|收款|到账|存入|退回|退款|转入|红包|工资|收益/.test(s);
  const expense=/支出|消费|付款|支付|已支出|扣款|转出|缴费|还款/.test(s);
  if(/退款|退回|退货|取消/.test(s)) type='income';
  else if(income && !/支出|消费|付款|转出/.test(s)) type='income';
  let category='其他';
  if(/餐饮|吃饭|美团|饿了么|餐厅|外卖|超市|便利店|买菜|零食|奶茶|咖啡/.test(s)) category='餐饮';
  else if(/淘宝|天猫|京东|拼多多|购物|商城|消费|购买/.test(s)) category='购物';
  else if(/话费|流量|充值|移动|联通|电信/.test(s)) category='话费';
  else if(/地铁|公交|打车|滴滴|车票|加油|停车|高速|铁路|航空/.test(s)) category='交通';
  else if(/还款|信用卡|花呗|借呗|白条/.test(s)) category='还款';
  // ★ 2026-11-15：账户判定改用 detectSource，别再自己写一套正则。
  //   原来「支付宝」排在最前 → 银行短信「支出(消费支付宝)20元」被判成支付宝账户，
  //   而用户的账户列表里只有「微信/银行卡」→ 账记上了但余额不算进任何账户。
  //   与 v2 共用同一个来源判定，两条路径才可能真正一致。
  let account='';
  const srcAcc = (typeof detectSource === 'function') ? detectSource(s, '') : 'OTHER';
  if(srcAcc==='WECHAT') account='微信';
  else if(srcAcc==='ALIPAY') account='支付宝';
  else if(srcAcc==='BANK') account='银行卡';
  else if(srcAcc==='TAOBAO'||srcAcc==='JD'||srcAcc==='PDD') account='支付宝';
  if(!account) account=parentAcc||'';
  if(!isPaymentSegment(s)) return null;
  return {amount:amt,type:type,category:category,account:account,
          note:s.replace(/^(微信支付|支付宝|银联|招行|[A-Za-z0-9_]+)?\s*/,'').slice(0,40)};
}
function parseNotifMulti(n){
  const raw=(n.title||'')+' '+(n.text||'')+' '+(n.app||'');
  let parentAcc='';
  if(/支付宝/.test(raw)) parentAcc='支付宝';
  else if(/微信|财付通/.test(raw)) parentAcc='微信';
  else if(/银行卡|银行|招商|工商|建设|农业|中国银行/.test(raw)) parentAcc='银行卡';
  const appRe=n.app?new RegExp(n.app.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'):null;
  let parts=raw.split(/[\n\r；;。！]+/).map(p=>p.trim()).filter(Boolean);
  let segments=[];
  for(const p of parts){
    const amts=findAmounts(p);
    if(amts.length>1) segments=segments.concat(splitByAmount(p));
    else segments.push(p);
  }
  const results=[];
  for(const seg of segments){
    let clean=seg;
    if(appRe) clean=clean.replace(appRe,'');
    clean=clean.trim();
    const r=singleParse(clean,parentAcc);
    if(r) results.push(r);
  }
  return results;
}

async function readPendingQueue(){
  let raw='[]';
  try{
    if(window.MinisBridge && typeof window.MinisBridge.readPendingTx==='function'){
      raw = window.MinisBridge.readPendingTx() || '[]';
    } else if(window.MinisBridge && typeof window.MinisBridge.readImportedTx==='function'){
      if(typeof window.MinisBridge.triggerScan==='function') window.MinisBridge.triggerScan();
      await new Promise(r=>setTimeout(r,500));
      raw = window.MinisBridge.readImportedTx() || '[]';
    } else {
      const x=new XMLHttpRequest();
      x.open('GET','./imported_tx.json',false);x.send();
      if(x.status===200) raw=x.responseText;
    }
  }catch(e){ raw='[]'; }
  let arr=[]; try{ arr=JSON.parse(raw); }catch(e){ arr=[]; }
  return Array.isArray(arr)?arr:[];
}
function ackPending(ids){
  if(!ids||!ids.length) return;
  if(window.MinisBridge && typeof window.MinisBridge.ackPendingTx==='function'){
    try{ window.MinisBridge.ackPendingTx(JSON.stringify(ids)); }catch(e){}
  }
}

// 是否已在账本中：查【全账本】，不设时间窗。
// （旧版只查最近7天 → 8~30天前已记过的会被当成新的又冒出来，这是"记了又回来"的根因之一）
// 匹配规则：
//   ref:xxx  → 流水号/单号精确匹配（最可靠）
//   amt:账户:金额:窗口 → 账户+金额相同，且时间在 ±5 分钟内（不用"桶相等"，避免跨 5 分钟边界的漏判）
// 这笔是否已经入账（比 txFingerExists 更全面）：
//  ① 指纹完全相同（同一条通知/短信）
//  ② 金额+账户相同且时间相近（同一天的同一笔，不同来源）
//  ③ ★面额 vs 实付：本条是"充值100"，账本里已有"银行扣96"（或反过来）→ 认定同一笔，避免重复记账
//     （只比指纹会漏掉：银行通知先自动记了96，之后充值短信又冒出100 → 记成196）
function isAlreadyBooked(e){
  if(!e) return false;
  if(e.finger && txFingerExists(e.finger, e._smsDate||e._time)) return true;
  const amt=Number(e.amount);
  if(!(amt>0)) return false;
  const t=Number(e._smsDate||e._time||0);
  const all=atx();
  // ★ 修：原来「时间不可比 → 放宽为 true」会让【任何同额的历史记录】都被当成已入账，
  //   从而静默吞掉一笔真实的新消费。改为：时间缺失时不"放宽"，只保留同额判定
  //   （同额本身已是较强信号，但不该由"缺时间"额外放大）。
  const near=rt=>{
    if(!t||!rt) return false;                      // 时间不可比 → 不认定"相近"，避免误吞
    if(Math.abs(rt-t)<=10*60*1000) return true;
    try{ return new Date(rt).toISOString().slice(0,10)===new Date(t).toISOString().slice(0,10); }catch(x){ return false; }
  };
  for(let i=0;i<all.length;i++){
    const r=all[i];
    if((r.type||'expense')!==(e.type||'expense')) continue;
    const rt=new Date(r.time).getTime();
    const ramt=Number(r.amount);
    if(Math.abs(ramt-amt)<0.005 && near(rt)) return true;                       // ② 同额同源
    // ③ ★面额 vs 实付（与 mergePool 保持同一套【对称且互斥】的判据，
    //    避免两边规则不一致导致"框里去重了、入账时又重记"）
    const eR=isRechargeItem(e), eB=isBankItem(e);
    const rR=isRechargeItem(r), rB=isBankItem(r);
    if(eR&&!eB && rB&&!rR && ramt<=amt && ramt>=amt*0.5 && near(rt)) return true;   // 本=面额, 账本=实付
    if(eB&&!eR && rR&&!rB && amt<=ramt && amt>=ramt*0.5 && near(rt)) return true;   // 本=实付, 账本=面额
  }
  return false;
}
function txFingerExists(finger, when){
  if(!finger) return false;
  const all=atx();
  if(finger.slice(0,4)==='ref:'){
    for(let i=0;i<all.length;i++){
      const t=all[i];
      if(t.finger===finger) return true;
      const tms=new Date(t.time).getTime();
      if(!isNaN(tms) && payFingerprint(t.note||'', t.account, t.amount, tms)===finger) return true;
    }
    return false;
  }
  const p=String(finger).split(':');
  if(p[0]!=='amt') return false;
  const acc=p[1], amt=parseFloat(p[2]), win=parseInt(p[3],10);
  if(isNaN(amt)) return false;
  let center=Number(when)||0;
  if(!center && !isNaN(win)) center=win*DEDUP_WINDOW + DEDUP_WINDOW/2;
  for(let i=0;i<all.length;i++){
    const t=all[i];
    if(Math.abs(Number(t.amount)-amt)>0.005) continue;
    if((t.account||'?')!==acc) continue;
    if(!center) return true;
    const tms=new Date(t.time).getTime();
    if(isNaN(tms)) continue;
    if(Math.abs(tms-center)<=DEDUP_WINDOW) return true;
  }
  return false;
}

function makeTx(e,overrides){
  const amt=isFinite(overrides&&overrides.amount!=null?overrides.amount:e.amount)?(overrides&&overrides.amount!=null?overrides.amount:e.amount):0;
  return Object.assign({
    id:uid(), time:new Date(e.time).toISOString(), type:e.type,
    amount:amt, note:e.note||'', account:e.account||'', category:e.category||'其他', finger:e.finger
  }, overrides||{});
}

let autoQueue=[], autoIdx=-1, pendingAutoCount=0, autoRunning=false;
