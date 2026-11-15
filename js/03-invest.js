// ── Investment accounts ──
const DI=[{name:'场内-我的',amount:0,month:'',ours:true},{name:'场外-我的',amount:0,month:'',ours:true},{name:'场外-别人的',amount:0,month:'',ours:false}];
function gi(){return safeRead(IK,DI)}
function si(d){safeWrite(()=>localStorage.setItem(IK,JSON.stringify(d)))}
let invEditName='';
function openInvEdit(name){
  invEditName=name;const a=gi().find(x=>x.name===name);
  document.getElementById('invEditTitle').textContent=name;
  document.getElementById('invEditAmount').value=a?a.amount:'';
  // ★ 场外账户：提示"填总数、系统自动减规划金"，并实时显示纯理财
  try{
    const isOut=/场外/.test(name)&&(!a||a.ours!==false);
    let box=document.getElementById('invPlanHint');
    if(!box){
      const inp=document.getElementById('invEditAmount');
      box=document.createElement('div');
      box.id='invPlanHint';
      box.style.cssText='font-size:12px;color:var(--text2);margin-top:6px;line-height:1.6';
      inp.parentNode.insertBefore(box, inp.nextSibling);
      inp.addEventListener('input',updateInvPlanHint);
    }
    box.style.display=isOut?'block':'none';
    updateInvPlanHint();
  }catch(e){}
  // 历史记录
  const hp=document.getElementById('invHistory');
  const his=(a&&a.his)||[];
  if(!his.length){hp.innerHTML='<div style="font-size:12px;color:var(--text3)">暂无变更记录</div>'}
  else{
    hp.innerHTML='<div style="font-size:13px;color:var(--text2);margin-bottom:6px;font-weight:600">变更历史 ('+his.length+')</div>'+his.map(h=>{
      const sign=h.delta>=0?'+':'−';
      return `<div style="font-size:12px;padding:8px 0;border-bottom:1px solid var(--border);line-height:1.6"><span style="color:var(--text3)">${h.t||''}</span><div style="color:var(--text)">${h.note||'更新'}：¥${(h.old||0).toFixed(2)} ${sign} ¥${Math.abs(h.delta).toFixed(2)} = <b style="color:var(--accent)">¥${(h.new||0).toFixed(2)}</b></div></div>`
    }).join('');
  }
  document.getElementById('invEditModal').classList.add('show');
}
function closeInvEdit(){document.getElementById('invEditModal').classList.remove('show');invEditName=''}
// 场外理财：填"理财通里看到的总数"，系统自动减去规划金 → 纯理财
function updateInvPlanHint(){
  const box=document.getElementById('invPlanHint');
  if(!box||box.style.display==='none') return;
  const plan=(getCashBalances()['规划金']||0);
  const v=parseFloat((document.getElementById('invEditAmount')||{}).value);
  if(!(plan>0)){ box.innerHTML='（还没有「规划金」余额；每月转账记进「规划金」账户后，这里会自动减）'; return; }
  const pure=isNaN(v)?null:(v-plan);
  box.innerHTML='填<b>理财通里看到的总数</b>即可，系统自动减：<br>'
    +'总数 '+(isNaN(v)?'—':('¥'+v.toFixed(2)))+' − 规划金 ¥'+plan.toFixed(2)
    +' = <b style="color:var(--accent)">'+(pure==null?'—':('¥'+pure.toFixed(2)))+'</b>（纯理财）';
}
function saveInvEdit(){
  const v=parseFloat(document.getElementById('invEditAmount').value);
  if(isNaN(v))return ts('请输入有效金额');
  invSetAmount(invEditName, v, '手动更新');
  closeInvEdit();rac();ts(invEditName+' 已更新');
}
// 理财账户金额变更 + 记录历史：a.his = [{t,old,delta,new,note}]
function invSetAmount(name,newVal,note,ours){
  const d=gi(),a=d.find(x=>x.name===name);
  const old=(a?+a.amount:0)||0;
  newVal=+newVal||0;
  const hisItem={t:new Date().toISOString().slice(0,16).replace('T',' '),old:old,delta:newVal-old,new:newVal,note:note||''};
  if(a){
    if(newVal!==old){a.his=a.his||[];a.his.unshift(hisItem);a.his=a.his.slice(0,50)}
    a.amount=newVal;a.month=new Date().toISOString().slice(0,7);
  }else{
    d.push({name:name,amount:newVal,month:new Date().toISOString().slice(0,7),ours:ours!==false,his:[hisItem]});
  }
  si(d);
}
async function deleteInv(name){
  if(!await confirmBox('删除理财账户 "'+name+'"？\n（该账户的历史金额将不再计入总资产）'))return;
  si(gi().filter(a=>a.name!==name));
  rac();ts('已删除 '+name);
}
function openAddInv(){document.getElementById('newInvName').value='';document.getElementById('newInvAmount').value='';document.getElementById('newInvOurs').checked=true;document.getElementById('addInvModal').classList.add('show')}
function closeAddInv(){document.getElementById('addInvModal').classList.remove('show')}
function saveNewInv(){
  const n=(document.getElementById('newInvName').value||'').trim();if(!n)return ts('请输入账户名称');
  const d=gi();if(d.find(a=>a.name===n))return ts('账户已存在');
  const v=parseFloat(document.getElementById('newInvAmount').value);
  invSetAmount(n,isNaN(v)?0:v,'新增',document.getElementById('newInvOurs').checked);
  closeAddInv();rac();ts('已添加理财账户 '+n);
}

// ── Init budgets ──
// Migrate old subcategory budgets → top-level
(()=>{const b=gb(),keys=Object.keys(b);if(keys.length>0&&keys[0].includes('/')){const g={};keys.forEach(k=>{const t=k.split('/')[0];if(!g[t])g[t]={budget:b[k].budget||0,recurring:false};g[t].recurring=g[t].recurring||b[k].recurring});sb(g)}})();
(()=>{if(!localStorage.getItem(BK)){const d={};['餐饮','购物','交通','固定支出','医疗'].forEach(c=>{d[c]={budget:c==='餐饮'?800:c==='购物'?400:c==='交通'?200:c==='固定支出'?600:500,recurring:false}});sb(d)}})();
(()=>{if(!localStorage.getItem(AK))sa(DA)})();
(()=>{if(!localStorage.getItem(IK))si(DI)})();
