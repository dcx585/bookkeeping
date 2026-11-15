// ── Budget settings ──
function openBudgetSettings(){
  const b=gb();
  const all=Object.keys(b);
  let h=all.map(cat=>{
    const cfg=b[cat]||{budget:0,recurring:false};
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px">
      <span style="width:60px;flex-shrink:0;color:var(--text);font-weight:500">${cat}</span>
      <input type="number" value="${cfg.budget||''}" placeholder="预算" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-width:0" data-cat="${cat}" data-field="budget">
      <label style="display:flex;align-items:center;gap:3px;font-size:12px;color:var(--text2);white-space:nowrap"><input type="checkbox" ${cfg.recurring?'checked':''} data-cat="${cat}" data-field="recurring"> 固定</label>
      <span onclick="deleteBudgetItem('${cat.replace(/'/g,"\\'")}')" style="color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0">×</span>
    </div>`;
  }).join('');
  h+=`<button class="quick-btn" onclick="addCustomBudget()" style="width:100%;margin-top:6px;font-size:13px">+ 自定义预算</button>`;
  document.getElementById('budgetSettingsList').innerHTML=h;
  document.getElementById('budgetSettingsModal').classList.add('show');
}
async function addCustomBudget(){
  const n=await promptBox('预算名称（如：教育、娱乐）','名称');if(!n||!n.trim())return;
  const a=parseFloat(await promptBox('预算金额','金额'));if(isNaN(a)||a<=0)return ts('请输入有效金额');
  const b=gb();const name=n.trim();
  if(b[name]){if(!await confirmBox('"'+name+'" 已存在，覆盖？'))return}
  b[name]={budget:a,recurring:false};sb(b);
  // Append to DOM directly — don't rebuild (would lose unsaved edits)
  const list=document.getElementById('budgetSettingsList');
  const addBtn=list.querySelector('button:last-child');
  const row=document.createElement('div');
  row.innerHTML=`<span style="width:60px;flex-shrink:0;color:var(--text);font-weight:500">${name}</span>
    <input type="number" value="${a}" placeholder="预算" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-width:0" data-cat="${name}" data-field="budget">
    <label style="display:flex;align-items:center;gap:3px;font-size:12px;color:var(--text2);white-space:nowrap"><input type="checkbox" data-cat="${name}" data-field="recurring"> 固定</label>
    <span onclick="deleteBudgetItem('${name.replace(/'/g,"\\'")}')" style="color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0">×</span>`;
  row.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px';
  list.insertBefore(row,addBtn);
  ts('已添加 '+name);
}
async function deleteBudgetItem(cat){
  if(!await confirmBox('删除 "'+cat+'" 预算？'))return;
  const b=gb();delete b[cat];sb(b);
  // Remove row from DOM instead of rebuilding
  const row=document.querySelector(`#budgetSettingsList input[data-cat="${cat.replace(/"/g,'&quot;')}"]`)?.parentElement;
  if(row)row.remove();
  ts('已删除');
}
function closeBudgetSettings(){document.getElementById('budgetSettingsModal').classList.remove('show')}
function saveBudgetSettings(){
  const b={};
  document.querySelectorAll('#budgetSettingsList input[data-field="budget"]').forEach(i=>{
    const cat=i.dataset.cat;b[cat]=b[cat]||{budget:0,recurring:false};
    b[cat].budget=parseFloat(i.value)||0;
  });
  document.querySelectorAll('#budgetSettingsList input[data-field="recurring"]').forEach(i=>{
    const cat=i.dataset.cat;b[cat]=b[cat]||{budget:0,recurring:false};
    b[cat].recurring=i.checked;
  });
  sb(b);closeBudgetSettings();ra();ts('预算已保存');
}

// ── Account management ──
function openAddAcct(){document.getElementById('newAcctName').value='';document.getElementById('newAcctBalance').value='';document.getElementById('addAcctModal').classList.add('show')}
function closeAddAcct(){document.getElementById('addAcctModal').classList.remove('show')}
function saveNewAcct(){
  const n=document.getElementById('newAcctName').value.trim(),bal=parseFloat(document.getElementById('newAcctBalance').value)||0;
  if(!n)return ts('请输入账户名');const a=ga();if(a.includes(n))return ts('账户已存在');
  a.push(n);sa(a);if(bal!==0){const d=atx();d.push({id:uid(),time:new Date().toISOString(),type:'income',amount:Math.abs(bal),note:'初始余额',account:n,category:''});stx(d)}
  closeAddAcct();ra();ts('已添加 '+n);
}
async function deleteAcct(n){if(!await confirmBox('删除 "'+n+'"？'))return;sa(ga().filter(a=>a!==n));ra();ts('已删除 '+n)}

// ── Search ──
function openSearch(){document.getElementById('searchBar').style.display='flex';document.getElementById('searchInput').focus()}
function closeSearch(){document.getElementById('searchBar').style.display='none';document.getElementById('searchInput').value='';sq='';rtx()}
function doSearch(){sq=document.getElementById('searchInput').value.toLowerCase();rtx()}

// ── Calculator ──
let ce='';const cd=()=>document.getElementById('calcDisplay');
function cs(i,p){i.removeAttribute('readonly');i.setSelectionRange(p,p);i.setAttribute('readonly','')}
function calcInput(v){
  const i=cd();
  if(v==='C'){i.value='';ce='';return}
  const s=i.selectionStart,e=i.selectionEnd;let cur=i.value;
  if(cur==='0'&&s===e&&v!=='.')cur='';
  const nv=cur.slice(0,s)+v+cur.slice(e);i.value=nv;ce=nv;
  cs(i,s+v.length);
}
function calcBackspace(){
  const i=cd(),s=i.selectionStart,e=i.selectionEnd;
  if(s===0&&e===0)return;
  if(s!==e){const nv=i.value.slice(0,s)+i.value.slice(e);i.value=nv;cs(i,s);ce=i.value}
  else{const nv=i.value.slice(0,s-1)+i.value.slice(s);i.value=nv;cs(i,s-1);ce=i.value}
}
let bsTimer=null;
function startBackspace(){calcBackspace();bsTimer=setInterval(calcBackspace,80)}
function stopBackspace(){clearInterval(bsTimer)}
function calcInsertAmount(amt){
  const i=cd(),s=i.selectionStart,e=i.selectionEnd;let cur=i.value;
  if(cur==='0'&&s===e)cur='';
  const nv=cur.slice(0,s)+amt.toFixed(2)+cur.slice(e);i.value=nv;ce=nv;
  cs(i,s+String(amt.toFixed(2)).length);
}
function calcEval(){
  const i=cd();
  try{let e=i.value.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');const r=Function('"use strict";return ('+e+')')();const v=Number(r.toFixed(10)).toString();i.value=v;ce=v}catch(e){i.value='错误';ce='';setTimeout(()=>{i.value='';ce=''},1000)}
}
function openCalc(){
  const am={};atx().forEach(t=>{if(t.type==='transfer'){const fee=t.fee||0,fp=t.feePayer||'from';am[t.from]=(am[t.from]||0)-t.amount-(fp==='from'?fee:0);am[t.to]=(am[t.to]||0)+t.amount-(fp==='to'?fee:0)}else if(t.account)am[t.account]=(am[t.account]||0)+(t.type==='income'?t.amount:-t.amount)});
  document.getElementById('calcAccts').innerHTML=ga().map(a=>{const v=am[a]||0;return`<button onclick="calcInsertAmount(${v.toFixed(2)})">${a} ¥${v.toFixed(2)}</button>`}).join('');
  ce='';cd().value='';document.getElementById('calcModal').classList.add('show');
}
function closeCalc(){document.getElementById('calcModal').classList.remove('show');ce='';cd().value=''}

// ── 股息率弹窗 ──
function openDividend(){closeCalc();document.getElementById('divPrice').value='';document.getElementById('divAmount').value='';document.getElementById('divResult').textContent='';document.getElementById('dividendModal').classList.add('show')}
function closeDividend(){document.getElementById('dividendModal').classList.remove('show')}
function calcDivYield(){
  const p=parseFloat(document.getElementById('divPrice').value);
  if(isNaN(p)||p<=0)return ts('请输入有效股价');
  const d=parseFloat(document.getElementById('divAmount').value);
  if(isNaN(d)||d<=0)return ts('请输入有效股息');
  const r=(d/p*100).toFixed(2);
  document.getElementById('divResult').textContent='股息率 '+r+'%';
  closeDividend();
  openCalc();ce=r;cd().value=r+'%';
}

function calcTransfer(){closeCalc();openTxModal(null,'transfer')}

// ── More / BG / Backup ──
function openMore(){document.getElementById('moreModal').classList.add('show')}
function closeMore(){document.getElementById('moreModal').classList.remove('show')}

// 折叠区开关（更多菜单里收低频功能用）
function exFold(head,bodyId){
  const b=document.getElementById(bodyId);
  if(!b) return;
  const on=b.classList.toggle('show');
  head.classList.toggle('open',on);
}

// ── FAB 长按快捷：单击=记一笔（内联 onclick 负责），长按=导入通知 ──
// 注意：单击【不再】由这里处理，交给元素的 onclick，保证最可靠。
// 这里只负责"长按"这一件事，并在长按时阻止随后的 click 触发。
(function bindFab(){
  function init(){
    const fab=document.getElementById('fab');
    const hint=document.getElementById('fabHint');
    if(!fab||fab.__bound) return; fab.__bound=true;
    let timer=null, held=false, startX=0, startY=0, moved=false;
    const HOLD=450;                       // 长按阈值(ms)
    function reset(){
      if(timer){clearTimeout(timer);timer=null}
      fab.classList.remove('holding');
      if(hint) hint.classList.remove('show');
    }
    function down(e){
      const p=(e.touches&&e.touches[0])||e;
      startX=p.clientX||0; startY=p.clientY||0;
      held=false; moved=false;
      timer=setTimeout(()=>{ held=true; fab.classList.add('holding'); if(hint) hint.classList.add('show'); },HOLD);
    }
    function move(e){
      const p=(e.touches&&e.touches[0])||e;
      if(Math.abs((p.clientX||0)-startX)>12||Math.abs((p.clientY||0)-startY)>12){ moved=true; reset(); }
    }
    function up(e){
      const wasHeld=held;
      reset();
      if(wasHeld){
        // 长按成功 → 进导入，并吃掉这次 click（防止顺带又开"记一笔"）
        if(e&&e.cancelable) e.preventDefault();
        held=false; moved=false;
        fab.__eatingClick=true;
        setTimeout(()=>{ fab.__eatingClick=false; },600);
        try{ openImportNotify(); }catch(err){ ts('打开失败'); }
      }
    }
    fab.addEventListener('touchstart',down,{passive:true});
    fab.addEventListener('touchmove',move,{passive:true});
    fab.addEventListener('touchend',up);
    fab.addEventListener('touchcancel',reset);
    fab.addEventListener('mousedown',down);
    fab.addEventListener('mousemove',move);
    fab.addEventListener('mouseup',up);
    fab.addEventListener('mouseleave',reset);
    // 长按后吞掉随后的 click
    fab.addEventListener('click',function(e){ if(fab.__eatingClick){ e.stopImmediatePropagation(); e.preventDefault(); } },true);
    fab.addEventListener('contextmenu',ev=>ev.preventDefault());
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
