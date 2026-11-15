// ── Panel ──
const panel=document.getElementById('panel'),panelBody=document.getElementById('panelBody');
let po=false,sY=0,sP=0,sw=false;
function op(){panel.style.transition='transform .4s cubic-bezier(.22,1,.36,1)';panel.style.transform='translateY(0)';panel.classList.add('open');po=true;document.getElementById('fab').style.opacity='1'}
function cp(){panel.style.transition='transform .4s cubic-bezier(.22,1,.36,1)';panel.style.transform='translateY(calc(100% - 72px))';panel.classList.remove('open');po=false}
document.addEventListener('touchstart',function(e){if(po)return;sY=e.touches[0].clientY;sP=panel.getBoundingClientRect().top;sw=true;panel.style.transition='none'},{passive:true});
document.addEventListener('touchmove',function(e){if(!sw||po)return;const dy=e.touches[0].clientY-sY;if(dy>0){sw=false;return}e.preventDefault();const t=Math.max(50,Math.min(window.innerHeight-72,sP+dy));panel.style.transform=`translateY(${t-50}px)`},{passive:false});
document.addEventListener('touchend',function(e){if(!sw||po)return;sw=false;const dy=(e.changedTouches[0]?e.changedTouches[0].clientY:sY)-sY;if(dy<-15||panel.getBoundingClientRect().top<window.innerHeight*.7)op();else cp()});
panel.addEventListener('touchstart',function(e){if(!po||e.target.closest('button,input'))return;if(panelBody.scrollTop>1)return;sY=e.touches[0].clientY;sP=panel.getBoundingClientRect().top;sw=true;panel.style.transition='none'},{passive:true});
panel.addEventListener('touchmove',function(e){if(!sw||!po)return;const dy=e.touches[0].clientY-sY;if(dy<0){sw=false;return}e.preventDefault();const t=Math.max(50,Math.min(window.innerHeight-72,sP+dy));panel.style.transform=`translateY(${t-50}px)`},{passive:false});
panel.addEventListener('touchend',function(e){if(!sw||!po)return;sw=false;const dy=(e.changedTouches[0]?e.changedTouches[0].clientY:sY)-sY;if(dy>15||panel.getBoundingClientRect().top>window.innerHeight*.35)cp();else op()});

// ── Render ──
function ra(){rtx();rss();rac();rml()}
function rml(){document.getElementById('monthLabel').textContent=fm(cm)}
function fm(m){const[y,mo]=m.split('-');return y+'年'+parseInt(mo)+'月'}
function pm(){const[y,m]=cm.split('-').map(Number);cm=m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;ra()}
function nm(){const[y,m]=cm.split('-').map(Number);cm=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;ra()}

function rtx(){
  const tx=mtx(),l=document.getElementById('txList');
  if(cv!=='tx'){l.style.display='none';return}
  l.style.display='block';
  let f=tx;if(sq)f=tx.filter(t=>(t.note||'').toLowerCase().includes(sq)||(t.category||'').toLowerCase().includes(sq)||(t.account||'').toLowerCase().includes(sq));
  // 计算每笔交易后该账户的余额(图二效果: 显示"这笔之后账户剩多少钱")
  // 先按账户、按时间正序累加该账户此时点的余额
  let balAt={};
  if(!sq){
    const all=txOrder(atx()).reverse();   // 正序算余额（同一时刻按记录先后）
    const accMap={};
    all.forEach(t=>{
      if(t.type==='transfer'){const fee=t.fee||0,fp=t.feePayer||'from';
        accMap[t.from]=(accMap[t.from]||0)-t.amount-(fp==='from'?fee:0);
        accMap[t.to]=(accMap[t.to]||0)+t.amount-(fp==='to'?fee:0);
        balAt[t.id]={from:accMap[t.from],to:accMap[t.to]};
      } else if(t.account){
        accMap[t.account]=(accMap[t.account]||0)+(t.type==='income'?t.amount:-t.amount);
        balAt[t.id]={acc:accMap[t.account]};
      }
    });
  }
  l.innerHTML=!f.length?(sq?'<div class="empty-state">没有匹配"'+sq+'"</div>':'<div class="empty-state">本月暂无记录<br>点 + 开始记账</div>'):f.map((t,i)=>{
    const isE=t.type==='expense',isI=t.type==='income',isT=t.type==='transfer';
    let sign=isE?'−':isI?'+':'⇄';const d=new Date(t.time);
    /* 有真实时刻就显示 HH:MM；老的 T12:00:00 表示"只记了日期"，不显示假时间 */
    const hasTime=!/T12:00:00/.test(t.time);
    const when=(d.getMonth()+1)+'/'+d.getDate()+(hasTime?' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):'');
    // 该笔后的余额
    let balHtml='';
    if(!sq&&(balAt[t.id])!==undefined){
      const b=balAt[t.id];
      if(isT){
        balHtml=`<div class="meta" style="color:var(--text3)">余额 ${t.from} ¥${(b.from||0).toFixed(2)} → ${t.to} ¥${(b.to||0).toFixed(2)}</div>`;
      } else {
        balHtml=`<div class="meta" style="color:var(--text3)">该账户余额 ¥${((b.acc!=null?b.acc:0)).toFixed(2)}</div>`;
      }
    }
    return `<div class="tx-item" style="animation-delay:${i*55}ms" onclick="editTx('${t.id}')">
      <div class="info"><div class="title">${t.note||(isT?'转账':isE?'支出':'收入')}${isT&&t.fee?`<span style="font-size:11px;color:var(--text3)"> 手续费 ¥${t.fee.toFixed(2)}(${t.feePayer==='to'?'转入方付':'转出方付'})</span>`:''}${t.auto?'<span class="auto-tag">自动</span>':''}${t.instGroup?`<span class="auto-tag" style="color:var(--gold)">分期${t.instIdx}/${t.instTotal}</span>`:''}</div><div class="meta">${when} · ${isT?t.from+' → '+t.to:[t.account,t.category].filter(Boolean).join(' · ')}</div>${balHtml}</div>
      <div class="amount ${isE?'exp':isI?'inc':''}" style="${isT?'color:var(--gold)':''}">${sign}¥${t.amount.toFixed(2)}</div>
      <div class="del-btn" onclick="event.stopPropagation();delTx('${t.id}')">×</div>
    </div>`;
  }).join('');
  const exp=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const inc=tx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const trx=tx.filter(t=>t.type==='transfer').reduce((s,t)=>s+t.amount,0);
  document.getElementById('totalExpense').textContent='¥'+exp.toFixed(2);
  document.getElementById('totalIncome').textContent='¥'+inc.toFixed(2);
  document.getElementById('balance').textContent='¥'+(inc-exp).toFixed(2);
}

function rss(){
  const sv=document.getElementById('statsView');
  if(cv!=='stats'){sv.classList.remove('show');return}
  sv.classList.add('show');
  const tx=mtx().filter(t=>t.type==='expense'),cs={};
  tx.forEach(t=>{const c=t.category||'其他';cs[c]=Math.round(((cs[c]||0)+t.amount)*100)/100});
  const es=Object.entries(cs).sort((a,b)=>b[1]-a[1]),tot=es.reduce((s,e)=>s+e[1],0);
  document.getElementById('catRows').innerHTML=!es.length?'<div class="empty-state" style="padding:24px 0">本月无支出</div>':es.map((e,i)=>`<div class="cat-wrapper"><div class="cat-row" style="animation-delay:${i*100}ms"><div class="cat-dot" style="background:${cc(e[0])}"></div><div class="cat-info"><div class="cat-name">${e[0]}</div></div><div class="cat-amount">¥${e[1].toFixed(2)}</div></div><div class="cat-bar-wrap"><div class="fill" style="width:${tot>0?(e[1]/tot*100).toFixed(1):0}%;background:${cc(e[0])}"></div></div></div>`).join('');

  // Budget vs actual
  const b=gb(),sp={};
  tx.forEach(t=>{const top=(t.category||'其他').split('/')[0];sp[top]=Math.round(((sp[top]||0)+t.amount)*100)/100});
  let bc='';
  Object.entries(b).forEach(([cat,cfg])=>{
    const top=cat.split('/')[0],spent=sp[top]||0,limit=cfg.budget||0;
    if(!limit)return;
    const diff=limit-spent,pct=Math.min(spent/limit*100,100);
    bc+=`<div class="budget-vs-row">
      <span class="bv-label">${cat}</span>
      <span class="bv-nums">¥${spent.toFixed(0)} / ¥${limit}</span>
      <span class="bv-diff ${diff<0?'over':'under'}">${diff<0?'−'+Math.abs(diff).toFixed(0):'剩'+diff.toFixed(0)}</span>
    </div>`;
  });
  document.getElementById('budgetCompare').innerHTML=bc||'<div class="empty-state" style="padding:16px 0;font-size:13px">暂无预算数据</div>';

  // Quick-add recurring
  const recurring=Object.entries(b).filter(([c,cfg])=>cfg.recurring);
  document.getElementById('quickAdd').innerHTML=recurring.length?recurring.map(([cat,cfg])=>`<button class="quick-btn" onclick="quickAddRecurring('${cat.replace(/'/g,"\\'")}',${cfg.budget||0})">${cat}</button>`).join(''):'<span style="font-size:12px;color:var(--text3)">在预算设置中标记固定支出</span>';
}

function quickAddRecurring(cat,amt){
  openTxModal();
  document.getElementById('txAmount').value=amt;
  document.getElementById('txNote').value='固定·'+cat;
  document.getElementById('txCatBtn').textContent=cat;
  document.getElementById('txCatBtn').classList.add('selected');
  document.getElementById('txSubmit').textContent='确认支出';
}

// 全局账户余额计算(现金账户)：供记账/转账/账户选择器显示实时余额
function getCashBalances(){
  const am={};atx().forEach(t=>{
    if(t.type==='transfer'){const fee=t.fee||0,fp=t.feePayer||'from';am[t.from]=(am[t.from]||0)-t.amount-(fp==='from'?fee:0);am[t.to]=(am[t.to]||0)+t.amount-(fp==='to'?fee:0)}
    else if(t.account)am[t.account]=(am[t.account]||0)+(t.type==='income'?t.amount:-t.amount);
  });
  return am;
}
function getAcctBalance(acct){
  if(!acct)return 0;
  const isInv=acct.endsWith('(理财)');
  if(isInv){const n=acct.replace(/\s*\(理财\)\s*$/,'');const a=gi().find(x=>x.name===n);return (a&&a.amount!=null)?a.amount:0}
  return (getCashBalances()[acct]||0);
}
function rac(){
  const sv=document.getElementById('acctsView');
  if(cv!=='accts'){sv.classList.remove('show');return}
  sv.classList.add('show');
  const am={};atx().forEach(t=>{
    if(t.type==='transfer'){const fee=t.fee||0,fp=t.feePayer||'from';am[t.from]=(am[t.from]||0)-t.amount-(fp==='from'?fee:0);am[t.to]=(am[t.to]||0)+t.amount-(fp==='to'?fee:0)}
    else if(t.account)am[t.account]=(am[t.account]||0)+(t.type==='income'?t.amount:-t.amount);
  });
  let cashTotal=0;
  document.getElementById('acctList').innerHTML=ga().map(a=>{
    const v=am[a]||0;cashTotal+=v;
    const an=a.replace(/'/g,"\\'");
    return `<div class="acct-item" onclick="openAcctDetail('${an}')" style="cursor:pointer">
      <span class="acct-name">${a}</span>
      <span style="font-size:11px;color:var(--text3);margin-left:auto;margin-right:6px">明细 ›</span>
      <span class="acct-val" style="color:${v<0?'var(--red)':'var(--green)'}">¥${v.toFixed(2)}</span>
      <span onclick="event.stopPropagation();deleteAcct('${an}')" style="color:var(--text3);margin-left:8px;cursor:pointer;font-size:14px;padding:0 4px">×</span>
    </div>`;
  }).join('');
  // Investment accounts
  const inv=gi();let invTotal=0;
  const planBal=(getCashBalances()['规划金']||0);   // 规划金余额（由流水自动算）
  document.getElementById('invList').innerHTML=inv.map(a=>{
    // ★ 场外"含规划金"：理财通里看到的总数包含了规划金，
    //   这里自动减掉规划金，显示【纯理财】——用户不必自己心算减法。
    const hasPlan=/场外/.test(a.name)&&a.ours!==false&&planBal>0;
    const pure=hasPlan?((a.amount||0)-planBal):(a.amount||0);
    if(a.ours!==false)invTotal+=(hasPlan?pure:(a.amount||0));   // 计入总资产时用纯理财，避免规划金重复计算
    const m=a.month?`<span style="font-size:11px;color:var(--text3);margin-left:4px">${a.month}</span>`:'<span style="font-size:11px;color:var(--gold);margin-left:4px">未更新</span>';
    const tag=a.ours===false?'<span style="font-size:10px;color:var(--text3);margin-left:4px;background:var(--bg);padding:1px 5px;border-radius:8px">不计入</span>':'';
    const sub=hasPlan?`<div style="font-size:11px;color:var(--text3);margin-top:2px">含规划金 ¥${(a.amount||0).toLocaleString()} − 规划金 ¥${planBal.toFixed(2)} = <b style="color:var(--accent)">纯理财 ¥${pure.toFixed(2)}</b></div>`:'';
    return `<div class="acct-item acct-col" onclick="openInvEdit('${a.name}')" style="cursor:pointer">
      <div style="display:flex;align-items:center;width:100%">
        <span class="acct-name">${a.name}${tag}${m}</span>
        <span class="acct-val" style="color:${pure>0?'var(--green)':'var(--text2)'}">¥${pure.toLocaleString()}</span>
        <span onclick="event.stopPropagation();deleteInv('${a.name.replace(/'/g,"\\'")}')" style="color:var(--text3);margin-left:8px;cursor:pointer;font-size:14px;padding:0 4px">×</span>
      </div>${sub}
    </div>`;
  }).join('');
  // Total row —— 总资产 + 两类拆分
  const grand=cashTotal+invTotal;
  const pct=(n)=>grand>0?((n/grand)*100).toFixed(0)+'%':'—';
  const fmt=(n)=>'¥'+Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('totalRow').innerHTML=
   `<div class="acct-item" style="font-weight:700;border-bottom:none">
      <span class="acct-name">总资产</span>
      <span class="acct-val" style="color:var(--accent);font-size:17px">${fmt(grand)}</span>
    </div>
    <div class="acct-item" style="padding-left:14px">
      <span class="acct-name" style="color:var(--text2);font-weight:400">　其中 · 现金账户</span>
      <span class="acct-val" style="color:var(--text2);font-size:14px;font-weight:500">${fmt(cashTotal)}
        <span style="font-size:11px;color:var(--text3);margin-left:4px">${pct(cashTotal)}</span></span>
    </div>
    <div class="acct-item" style="padding-left:14px;border-bottom:none">
      <span class="acct-name" style="color:var(--text2);font-weight:400">　其中 · 理财账户</span>
      <span class="acct-val" style="color:var(--text2);font-size:14px;font-weight:500">${fmt(invTotal)}
        <span style="font-size:11px;color:var(--text3);margin-left:4px">${pct(invTotal)}</span></span>
    </div>`;
}

/* ══ 账户对账 ══
   点账户看这个账户自己的账：收入多少、支出多少、转进多少、转出多少、手续费多少。
   转账单独一类，显示 从哪→到哪 + 金额 + 手续费，不计入收支（否则会重复算）。 */
function acctFlow(name){
  const rows=[];let inc=0,exp=0,tIn=0,tOut=0,feeSum=0;
  atx().forEach(t=>{
    if(t.type==='transfer'){
      const isFrom=t.from===name, isTo=t.to===name;
      if(!isFrom&&!isTo)return;
      const fee=Number(t.fee||0), fp=t.feePayer||'from';
      const feeOnMe=(isFrom&&fp==='from')||(isTo&&fp==='to');
      if(isFrom){tOut+=t.amount}                         // 转出本金
      if(isTo){tIn+=t.amount}                            // 转入本金
      if(feeOnMe)feeSum+=fee;                            // 我付的手续费
      rows.push({t,kind:isFrom?'out':'in',fee:feeOnMe?fee:0});
    }else if(t.account===name){
      if(t.type==='income'){inc+=t.amount}else{exp+=t.amount}
      rows.push({t,kind:t.type==='income'?'inc':'exp',fee:0});
    }
  });
  rows.sort((a,b)=>(b.t.time||'').localeCompare(a.t.time||''));
  const bal=inc-exp+tIn-tOut-feeSum;
  return {rows,inc,exp,tIn,tOut,feeSum,bal};
}
function openAcctDetail(name){
  const f=acctFlow(name);
  const y=(n)=>`¥${Number(n||0).toFixed(2)}`;
  const tag=(txt,color)=>`<span style="font-size:11px;padding:2px 7px;border-radius:6px;background:${color}22;color:${color}">${txt}</span>`;

  const stat=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">当前余额</div>
        <div style="font-size:17px;font-weight:700;color:${f.bal<0?'var(--red)':'var(--accent)'}">${y(f.bal)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">手续费合计</div>
        <div style="font-size:17px;font-weight:700;color:var(--gold)">${y(f.feeSum)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">支出合计</div>
        <div style="font-size:15px;font-weight:600;color:var(--red)">${y(f.exp)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">收入合计</div>
        <div style="font-size:15px;font-weight:600;color:var(--green)">${y(f.inc)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">转出（不含手续费）</div>
        <div style="font-size:15px;font-weight:600;color:var(--text2)">${y(f.tOut)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:10px">
        <div style="font-size:11px;color:var(--text3)">转入</div>
        <div style="font-size:15px;font-weight:600;color:var(--text2)">${y(f.tIn)}</div>
      </div>
    </div>`;

  const list=f.rows.length?f.rows.map(({t,kind,fee})=>{
    const d=new Date(t.time);
    const hasTime=!/T12:00:00/.test(t.time);
    const when=(d.getMonth()+1)+'/'+d.getDate()+(hasTime?' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):'');
    let title,sub,amt,color,sign;
    if(t.type==='transfer'){
      if(kind==='out'){
        title=`转出 → ${t.to||'?'}`; sign='−'; color='var(--gold)';
        amt=y(t.amount);
        sub=`${when}`+(fee>0?` · 手续费 ${y(fee)}（我付）`:'');
      }else{
        title=`${t.from||'?'} 转入`; sign='+'; color='var(--gold)';
        amt=y(t.amount);
        sub=`${when}`+(fee>0?` · 手续费 ${y(fee)}（我付）`:'');
      }
    }else if(kind==='inc'){
      title=t.note||'收入'; sign='+'; color='var(--green)';
      amt=y(t.amount); sub=`${when}`+(t.category?` · ${t.category}`:'');
    }else{
      title=t.note||'支出'; sign='−'; color='var(--red)';
      amt=y(t.amount); sub=`${when}`+(t.category?` · ${t.category}`:'');
    }
    return `<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border)" onclick="closeAcctDetail();editTx('${t.id}')">
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${sub}</div>
      </div>
      <div style="font-size:14px;font-weight:600;color:${color};white-space:nowrap">${sign}${amt}</div>
    </div>`;
  }).join(''):'<div style="text-align:center;color:var(--text3);font-size:13px;padding:24px 0">这个账户还没有流水</div>';

  const old=document.getElementById('acctDetailModal');
  if(old)old.remove();
  const m=document.createElement('div');
  m.className='modal show';m.id='acctDetailModal';
  m.innerHTML=`<div class="sheet" style="max-height:86vh;overflow:auto">
    <h3 style="display:flex;align-items:center;gap:8px">${name}${tag(f.rows.length+' 笔','var(--text2)')}</h3>
    ${stat}
    <div style="font-size:12px;color:var(--text2);margin:4px 0 2px">流水明细（转账不计入收支）</div>
    <div style="margin-bottom:12px">${list}</div>
    <button class="cancel-btn" onclick="closeAcctDetail()">关闭</button>
  </div>`;
  m.onclick=(e)=>{if(e.target===m)closeAcctDetail()};
  document.body.appendChild(m);
}
function closeAcctDetail(){const m=document.getElementById('acctDetailModal');if(m)m.remove()}

/* ══ 单账户余额矫正 ══
   漏记一笔，账面和真实就对不上。这里填一次真实余额，
   差额自动补成一笔「余额矫正」记录，账面立刻对齐。
   正差 = 有收入漏记；负差 = 有支出漏记。 */
function switchView(v){cv=v;document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));document.querySelector(`.tab-btn:nth-child(${v==='tx'?1:v==='stats'?2:3})`).classList.add('active');document.getElementById('txList').style.display=v==='tx'?'block':'none';document.getElementById('statsView').classList.toggle('show',v==='stats');document.getElementById('acctsView').classList.toggle('show',v==='accts');document.getElementById('fab').style.display=v==='tx'?'block':'none';if(v==='stats')rss();if(v==='accts')rac()}
