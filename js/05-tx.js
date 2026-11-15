// ── Transaction CRUD ──
/* 记账时刻：记今天 → 用当前时钟；补记过去某天 → 只留日期（12:00:00 当"不知道几点"的哨兵） */
function txClock(dateStr){
  const n=new Date();
  const t=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
  if(dateStr!==t) return '12:00:00';
  return [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
}
function openTxModal(id,pretype){
  eid=id||null;const t=id?atx().find(x=>x.id===id):null;
  document.getElementById('txModalTitle').textContent=id?'编辑':'记一笔';
  document.getElementById('txDate').value=id&&t?t.time.slice(0,10):new Date().toISOString().slice(0,10);
  document.getElementById('txAmount').value=id&&t?t.amount:'';
  document.getElementById('txNote').value=id&&t?t.note||'':'';
  const pt=pretype||(t?t.type:'expense');
  st2(pt,document.querySelector(`.type-btn.${pt==='transfer'?'tfr':pt==='expense'?'exp':'inc'}`)||document.querySelector('.type-btn'));
  document.getElementById('txAcctBtn').textContent='账户';document.getElementById('txAcctBtn').classList.remove('selected');
  document.getElementById('txCatBtn').textContent='分类';document.getElementById('txCatBtn').classList.remove('selected');
  document.getElementById('txFromBtn').textContent='转出';document.getElementById('txToBtn').textContent='转入';
  if(pt==='transfer'){document.getElementById('txCatRow').style.display='none';document.getElementById('txTransferRow').style.display='flex';document.getElementById('txFeeRow').style.display='flex';if(t){document.getElementById('txFromBtn').textContent=t.from||'转出';document.getElementById('txToBtn').textContent=t.to||'转入';document.getElementById('txFee').value=t.fee||'';document.getElementById('txFeePayer').value=t.feePayer||'from'}}
  else{document.getElementById('txCatRow').style.display='flex';document.getElementById('txTransferRow').style.display='none';if(t){document.getElementById('txAcctBtn').textContent=t.account||'账户';document.getElementById('txAcctBtn').classList.add('selected');document.getElementById('txCatBtn').textContent=t.category||'分类';document.getElementById('txCatBtn').classList.add('selected')}}
  document.getElementById('txSubmit').textContent=id?'保存':pt==='transfer'?'确认转账':'确认'+(pt==='expense'?'支出':'收入');
  if(pt==='transfer'){const ai=document.getElementById('txAmount');if(ai&&!ai._wxHooked){ai._wxHooked=1;ai.addEventListener('input',autoWxFee)}autoWxFee()}
  document.getElementById('txModal').classList.add('show');
}
/* ============ 还款（2026-11-07） ============
   用户：「花呗还款现在都是转账，太麻烦，能不能直接还款多少、选账户、完事」。
   本质就是一笔 transfer（来源账户 → 花呗），但把两次选择压成一步：
   金额默认填欠款全额，来源账户点一下就选。 */
var REPAY_TARGET = '花呗';
var repayFromAcct = '';

function debtOf(acct) {
  var b = getCashBalances()[acct] || 0;
  return b < 0 ? Math.round(-b * 100) / 100 : 0;   // 负数余额 = 欠款
}

function openRepay() {
  repayFromAcct = '';
  var debt = debtOf(REPAY_TARGET);
  var bal = getCashBalances()[REPAY_TARGET] || 0;
  var el = document.getElementById('repayDebt');
  if (debt > 0) {
    el.innerHTML = REPAY_TARGET + ' 当前欠款 <b style="color:var(--red);font-size:15px">¥' + debt.toFixed(2) + '</b>';
  } else {
    el.innerHTML = REPAY_TARGET + ' 当前余额 ¥' + bal.toFixed(2) + '，没有欠款（仍可先记一笔还款，余额会变成正数）';
  }
  document.getElementById('repayAmount').value = debt > 0 ? debt.toFixed(2) : '';
  /* 来源账户：所有现金账户里除去被还的那个 */
  var box = document.getElementById('repayFrom');
  var opts = ga().filter(function (a) { return a !== REPAY_TARGET && a.indexOf('(理财)') < 0; });
  box.innerHTML = opts.map(function (a) {
    var v = getCashBalances()[a] || 0;
    return '<button class="picker-trigger" data-acct="' + a + '" onclick="pickRepayFrom(\'' + a + '\',this)" style="flex:0 0 auto;font-size:13px">'
      + a + '<span style="color:var(--text3);font-size:11px"> ¥' + v.toFixed(0) + '</span></button>';
  }).join('') || '<span style="font-size:12px;color:var(--text3)">没有可用账户</span>';
  document.getElementById('repayModal').classList.add('show');
}

function pickRepayFrom(a, btn) {
  repayFromAcct = a;
  document.querySelectorAll('#repayFrom .picker-trigger').forEach(function (b) { b.classList.remove('selected'); });
  if (btn) btn.classList.add('selected');
}

function repayAll() {
  var debt = debtOf(REPAY_TARGET);
  document.getElementById('repayAmount').value = debt > 0 ? debt.toFixed(2) : '';
}

function closeRepay() { document.getElementById('repayModal').classList.remove('show'); }

function saveRepay() {
  var a = parseFloat(document.getElementById('repayAmount').value);
  if (!a || a <= 0) return ts('请输入还款金额');
  if (!repayFromAcct) return ts('请选择从哪个账户还');
  var d = new Date();
  var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  var data = atx();
  data.push({
    id: uid(), time: ds + 'T' + txClock(ds), createdAt: Date.now(),
    type: 'transfer', amount: a, from: repayFromAcct, to: REPAY_TARGET,
    note: REPAY_TARGET + '还款'
  });
  stx(data);
  applyInvDelta(repayFromAcct, -a);
  applyInvDelta(REPAY_TARGET, a);
  closeRepay(); ra();
  var left = debtOf(REPAY_TARGET);
  ts(left > 0 ? ('已还 ¥' + a.toFixed(2) + '，还欠 ¥' + left.toFixed(2)) : ('已还 ¥' + a.toFixed(2) + '，' + REPAY_TARGET + '已结清'));
}

function closeTxModal(){document.getElementById('txModal').classList.remove('show');eid=null}
function saveTx(){
  const a=parseFloat(document.getElementById('txAmount').value),n=document.getElementById('txNote').value.trim(),d=document.getElementById('txDate').value;
  if(!a||a<=0)return ts('请输入金额');if(!d)return ts('请选择日期');
  const data=atx();const entry={id:eid||uid(),time:d+'T'+txClock(d),type:ct,amount:a,note:n};
  /* createdAt：同一天同一秒记两笔时用来定先后（新的在上面） */
  if(!eid) entry.createdAt=Date.now();
  else { const old0=data.find(t=>t.id===eid); if(old0&&old0.createdAt) entry.createdAt=old0.createdAt; }
  if(ct==='transfer'){entry.from=document.getElementById('txFromBtn').textContent;entry.to=document.getElementById('txToBtn').textContent;if(entry.from==='转出'||entry.to==='转入')return ts('请选择账户');if(entry.from===entry.to)return ts('不能转到同一账户');const fee=parseFloat(document.getElementById('txFee').value)||0;if(fee>0){entry.fee=fee;entry.feePayer=document.getElementById('txFeePayer').value}else{delete entry.fee;delete entry.feePayer}}
  else{entry.account=document.getElementById('txAcctBtn').textContent;entry.category=document.getElementById('txCatBtn').textContent;if(entry.account==='账户')entry.account='';if(entry.category==='分类')entry.category=''}
  // 针对已有交易(编辑)先回滚理财金额
  if(eid){const old=data.find(t=>t.id===eid);if(old&&old.type==='transfer'){applyInvDelta(old.from,-old.amount);applyInvDelta(old.to,old.amount)}}
  // ★ 分期：支出可分 N 期，自动分摊到往后各月（花呗/信用卡分期的正确记法）
  //    总额不变，只是把"当月一次性"摊成每月一笔，流水标注（分期 n/N）
  let periods=1;
  try{ periods=parseInt((document.getElementById('txInstallment')||{}).value,10)||1; }catch(e){ periods=1; }
  if(ct==='expense' && !eid && periods>1){
    const gid=uid();
    const base=Math.floor(a*100/periods)/100;          // 每期金额（分位取整）
    const ymd=d.split('-').map(Number);
    let acc=0;
    for(let i=0;i<periods;i++){
      let amt;
      if(i===periods-1){ amt=Math.round((a-acc)*100)/100; }   // 末期吸收尾差，保证总额准确
      else { amt=base; acc+=base; }
      const dt=new Date(ymd[0],(ymd[1]-1)+i,ymd[2]);          // 逐月顺延
      const ds=dt.toISOString().slice(0,10);
      data.push({id:uid(),time:ds+'T12:00:00',type:'expense',amount:amt,
                 note:(n?n+' ':'')+'（分期 '+(i+1)+'/'+periods+'）',
                 account:entry.account,category:entry.category,
                 instGroup:gid,instIdx:i+1,instTotal:periods});
    }
    stx(data);closeTxModal();ra();
    ts('已分 '+periods+' 期，每月 ¥'+base.toFixed(2)+'（共 ¥'+a.toFixed(2)+'）');
    return;
  }
  if(eid){const i=data.findIndex(t=>t.id===eid);if(i>=0)Object.assign(data[i],entry)}else data.push(entry);
  stx(data);
  // 转账涉及理财账户 → 联动更新理财账户余额
  if(ct==='transfer'){applyInvDelta(entry.from,-entry.amount);applyInvDelta(entry.to,entry.amount)}
  closeTxModal();ra();
}
// 理财账户余额联动：name 是账户显示名(可能带 "(理财)")，delta 为本次增减(负=减)
function applyInvDelta(name,delta,note){
  if(!name||!delta)return;
  const base=name.replace(/\s*\(理财\)\s*$/,'');
  const inv=gi();const idx=inv.findIndex(x=>x.name===base);
  if(idx<0)return;   // 不是理财账户，跳过
  invSetAmount(base, (+inv[idx].amount||0)+delta, note||'转账');
}
function editTx(id){openTxModal(id)}
async function delTx(id){
  const old=atx().find(t=>t.id===id);
  const desc=old?('¥'+(old.amount!=null?Number(old.amount).toFixed(2):'?')+' · '+(old.type==='income'?'收入':(old.type==='transfer'?'转账':'支出'))+(old.category?' · '+old.category:'')+(old.note?' · '+old.note:'')):'';
  if(!await confirmBox('删除这笔流水？\n'+desc+'\n（删除后无法恢复）'))return;
  if(old&&old.type==='transfer'){applyInvDelta(old.from,old.amount);applyInvDelta(old.to,-old.amount)}
  stx(atx().filter(t=>t.id!==id));ra();ts('已删除');
}
function st2(type,btn){ct=type;document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const isT=type==='transfer';document.getElementById('txCatRow').style.display=isT?'none':'flex';document.getElementById('txTransferRow').style.display=isT?'flex':'none';document.getElementById('txFeeRow').style.display=isT?'flex':'none';document.getElementById('txInstRow').style.display=(type==='expense')?'flex':'none';document.getElementById('txSubmit').textContent=isT?'确认转账':type==='expense'?'确认支出':'确认收入';document.getElementById('txCatBtn').textContent='分类';document.getElementById('txCatBtn').classList.remove('selected')}

// ── Picker ──
let pT='',pS='';
function openPicker(type,sub){pT=type;pS=sub||'';
  // 转账模式(from/to) 显示 现金+理财 账户，支持现金↔理财/理财↔理财互转
  let ops=type==='account'?(pS==='from'||pS==='to'?ga().concat(gi().filter(a=>a.ours!==false).map(a=>a.name+' (理财)')):ga()):ct==='income'?INC_CATS:CATS;
  if(type==='category'){
    ops=ops.filter(o=>!gc('hidden_'+ct).includes(o));
    ops=ops.concat(gc(ct));
    // Auto-include recurring budget categories not in base list (e.g. 生活费)
    const extra=Object.entries(gb()).filter(([c,cfg])=>cfg.recurring&&!ops.includes(c)).map(([c])=>c);
    ops=ops.concat(extra);
  }
  const cur=sub==='from'?document.getElementById('txFromBtn').textContent:sub==='to'?document.getElementById('txToBtn').textContent:type==='account'?document.getElementById('txAcctBtn').textContent:document.getElementById('txCatBtn').textContent;
  document.getElementById('pickerTitle').textContent=type==='account'?'选择账户':'选择分类';
  let h=ops.map(o=>{
    const isCust=type==='category'&&gc(ct).includes(o);
    const isRecur=type==='category'&&(gb()[o]||{}).recurring;
    // 账户模式：显示当前余额
    const balNum = type==='account' ? getAcctBalance(o) : 0;
    const balHtml = type==='account' ? `<span style="margin-left:auto;margin-right:8px;font-size:13px;color:${balNum<0?'var(--danger,red)':'var(--text2)'}">¥${Math.abs(balNum).toFixed(2)}</span>` : '';
    return `<div class="picker-row"><div onclick="sp('${o.replace(/'/g,"\\'")}')" style="display:flex;align-items:center;flex:1">${type==='category'?'<div class="pick-dot" style="background:'+cc(o)+'"></div>':''}<span>${o}</span>${balHtml}${isRecur?'<span style="font-size:10px;margin-left:4px;color:var(--gold)">固定</span>':''}${o===cur?'<span class="pick-check">✓</span>':''}</div>${type==='category'?`<span onclick="toggleCatRecurring('${o.replace(/'/g,"\\'")}')" style="font-size:${isRecur?'14':'16'}px;padding:0 6px;cursor:pointer;color:${isRecur?'var(--gold)':'var(--text3)'}">${isRecur?'⭐':'☆'}</span><span onclick="deleteCatItem('${o.replace(/'/g,"\\'")}')" style="font-size:18px;padding:0 4px;cursor:pointer;color:var(--text3)">×</span>`:''}</div>`;
  }).join('');
  if(type==='category'){
    const hid=gc('hidden_'+ct);
    if(hid.length)h+=`<div class="picker-row" onclick="resetHiddenCats()" style="justify-content:center;color:var(--text2);font-size:13px">已隐藏 ${hid.length} 个，点此恢复</div>`;
    h+=`<div class="picker-row" onclick="addCustomCat()" style="color:var(--accent);font-weight:500"><span>+ 自定义</span></div>`;
  }
  document.getElementById('pickerList').innerHTML=h;document.getElementById('pickerModal').classList.add('show')}
async function toggleCatRecurring(cat){
  const b=gb();b[cat]=b[cat]||{budget:0,recurring:false};
  if(!b[cat].recurring){
    const r=await promptBox('固定金额（如话费 110）','金额',b[cat].budget||'');
    const a=parseFloat(r);
    if(!r||isNaN(a)||a<=0)return ts('请输入有效金额');
    b[cat].budget=a;
    b[cat].recurring=true;
  }else{
    b[cat].recurring=false;
  }
  sb(b);ra();openPicker(pT,pS);
}
async function deleteCatItem(cat){
  if(!await confirmBox('隐藏 "'+cat+'" 分类？\n（之后可在列表底部恢复）'))return;
  const hid=gc('hidden_'+ct);if(!hid.includes(cat)){hid.push(cat);sc('hidden_'+ct,hid)}
  const cust=gc(ct).filter(c=>c!==cat);sc(ct,cust);
  openPicker(pT,pS);
}
function resetHiddenCats(){sc('hidden_'+ct,[]);openPicker(pT,pS)}
async function addCustomCat(){
  const n=await promptBox('自定义分类名称','名称');
  if(!n||!n.trim())return;
  const name=n.trim(),list=gc(ct);if(!list.includes(name)){list.push(name);sc(ct,list)}
  sp(name);
}
function sp(v){if(pT==='account'){if(pS==='from'){document.getElementById('txFromBtn').textContent=v;autoWxFee()}else if(pS==='to'){document.getElementById('txToBtn').textContent=v;autoWxFee()}else{document.getElementById('txAcctBtn').textContent=v;document.getElementById('txAcctBtn').classList.add('selected')}}else{document.getElementById('txCatBtn').textContent=v;document.getElementById('txCatBtn').classList.add('selected');
  const b=gb();if(b[v]&&b[v].recurring&&b[v].budget){document.getElementById('txAmount').value=b[v].budget;document.getElementById('txNote').value='固定·'+v}}
  closePicker()
}
function closePicker(){document.getElementById('pickerModal').classList.remove('show')}

/* ══ 微信提现手续费自动算 ══
   微信零钱提现到银行卡按 0.1% 收，最低 ¥0.10。
   只在「转出账户」是微信时才自动填 —— 微信自己的零钱互转、扫码付款都不收费。
   填进去的值用户随时可以手改覆盖。 */
function isWxAcct(name){return /微信/.test(String(name||''))}
/* 纯函数：微信提现手续费 = 金额 × 0.1%，最低 ¥0.10，四舍五入到分 */
function wxFeeOf(amount){
  const amt=Number(amount)||0;
  if(amt<=0)return 0;
  return Math.max(Math.round(amt*0.001*100)/100, 0.10);
}
function autoWxFee(){
  const amtIn=document.getElementById('txAmount');
  const feeIn=document.getElementById('txFee');
  if(!amtIn||!feeIn)return;
  const amt=parseFloat(amtIn.value)||0;
  const from=(document.getElementById('txFromBtn')||{}).textContent||'';
  const to=(document.getElementById('txToBtn')||{}).textContent||'';
  // 只有「微信 → 别处」才收费；微信→微信、别人→微信 都不收
  if(!isWxAcct(from)||isWxAcct(to)||amt<=0)return;
  const fee=wxFeeOf(amt);
  feeIn.value=fee.toFixed(2);
  feeIn.dataset.auto='1';   // 标记：手改时清掉，避免反复覆盖用户输入
}
