// ── State ──
const SK='minis_bookkeeping_v5',BK='minis_budget_v3',AK='minis_accounts_v2',BGK='minis_bg_v1',IK='minis_invest_v1';
let cm=new Date().toISOString().slice(0,7),ct='expense',cv='tx',eid=null,sq='';
const DA=['微信','银行卡','应急金','规划金','花呗'];
const CATS=['餐饮','购物','医疗','交通','固定支出','其他'];
const INC_CATS=['工资/月薪','工资/奖金','理财/基金收益','理财/股息','理财/利息','报销/工作报销','红包/转账','兼职/外快','退款','其他'];
const CC={'餐饮':'#c0392b','购物':'#b8943e','交通':'#5b9eb5','固定支出':'#8b7aaa','医疗':'#d4735a','工资':'#3c7a44','理财':'#b8860b','报销':'#5b9eb5','红包':'#e67e22','兼职':'#8e44ad','退款':'#7f8c8d','其他':'#8899a6'};
function cc(c){return CC[(c||'其他').split('/')[0]]||'#'+Math.floor(Math.abs(hash(c))*16777215).toString(16)}
function hash(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0}return h}
const CK='minis_cat_v1';
function gc(type){return safeRead(CK+'_'+type,[])}
function sc(type,d){safeWrite(()=>localStorage.setItem(CK+'_'+type,JSON.stringify(d)))}
let cid=Date.now();function uid(){cid++;return cid.toString(36)+Math.random().toString(36).slice(2,6)}
function atx(){return safeRead(SK,[])}

// ══════════════════════════════════════════════════════════════
// 数据安全网（2026-10-08）
// 为什么需要：CI/测试只能保证"代码逻辑没变"，保证不了"你的账本没被写坏"。
// 代码回滚 git checkout 就完事；数据被覆盖是不可逆的。
// 这一层是唯一能兜住"改 A 破坏 B 把用户流水写没了"的手段。
// ══════════════════════════════════════════════════════════════
const SCHEMA_VERSION = 2;            // 数据格式版本号：改数据结构的每次都要 +1
const SNAP_PREFIX    = 'minis_snap_';
const SNAP_KEEP      = 7;            // 保留最近 7 份快照
const VK_SUFFIX      = '_v';         // 存各 key 的 schemaVersion

// 受保护的数据 key（用户真正的资产：流水/预算/账户/理财）
function protectedKeys(){ return [SK,BK,AK,IK,CK+'_expense',CK+'_income']; }

// ── ① 写前快照：任何一次写入前，先把【当前状态】存一份 ──
// 返回 true=确实存了快照，false=没有可存的东西（首次写入）
function snapshotBeforeWrite(){
  try{
    const dump={}; let has=false;
    protectedKeys().forEach(k=>{ const v=localStorage.getItem(k); if(v!=null){dump[k]=v;has=true} });
    // 首次写入：没有旧数据可丢 → 不拍快照。
    // ★ 关键：必须显式返回 false，让 safeWrite 不要把这个"空操作"当成
    //   "已经拍过了"而锁上 800ms —— 否则紧接着的第二笔写入（真正的第一次可回退点）
    //   会被 __snapOpen 挡掉，导致用户永远没有快照可用。
    if(!has) return false;
    const ts=Date.now();
    localStorage.setItem(SNAP_PREFIX+ts, JSON.stringify({ts:ts,schemaVersion:SCHEMA_VERSION,data:dump}));
    // 只留最近 SNAP_KEEP 份，别把 localStorage 撑爆
    const all=Object.keys(localStorage).filter(k=>k.indexOf(SNAP_PREFIX)===0).sort();
    while(all.length>SNAP_KEEP) localStorage.removeItem(all.shift());
    return true;
  }catch(e){ return false; }   // 快照失败绝不能阻塞正常写入
}
// 同一次"用户操作"内的连写只拍一张（否则 7 份快照全是同一状态）
let __snapOpen=false, __snapTimer=null;
function safeWrite(fn){
  // 只有【本次真的拍下了快照】才锁窗口。
  // 首次写入没有旧数据 → snapshotBeforeWrite 返回 false → 不锁，
  // 这样紧接着的第二笔仍然能拍到快照（否则用户永远没得回退）。
  const took = snapshotBeforeWrite();
  if(took){
    __snapOpen = true;
    if(__snapTimer) clearTimeout(__snapTimer);
    __snapTimer=setTimeout(()=>{__snapOpen=false},800);   // 800ms 内的连写算一次操作
  }
  // 注意：不做"未拍也锁"的处理 —— 未拍说明本来就没数据可丢，不该挡住下一次
  try{ return fn(); }catch(e){ ts('保存失败：'+e.message); throw e; }
}

// ── ② 安全读取：解析失败绝不清空重来（那才是真正的数据事故）──
//    改为：把坏数据隔离到 _CORRUPT_<ts>，返回 fallback，并立即可见地提示用户
function safeRead(key,fallback){
  const raw=localStorage.getItem(key);
  if(raw==null) return fallback;
  try{
    const v=JSON.parse(raw);
    if(v==null) return fallback;
    return v;
  }catch(e){
    // 隔离坏数据（不删！），让用户还有机会找回
    try{ localStorage.setItem(key+'_CORRUPT_'+Date.now(), raw); }catch(_){}
    try{ ts('⚠ 本地数据读取异常，已隔离保存。请到「更多 → 备份/恢复」找回，不要重新记账！'); }catch(_){}
    return fallback;
  }
}

// ── ③ 恢复：一键回到最近一次快照 ──
function listSnapshots(){
  return Object.keys(localStorage).filter(k=>k.indexOf(SNAP_PREFIX)===0)
    .map(k=>({key:k,ts:Number(k.slice(SNAP_PREFIX.length))}))
    .filter(x=>x.ts>0).sort((a,b)=>b.ts-a.ts);
}
function openSnapshots(){
  const snaps=listSnapshots();
  const el=document.getElementById('snapList');
  const cur=(()=>{ try{ const a=atx(); return Array.isArray(a)?a.length:0; }catch(e){ return 0; } })();
  let html='<div style="font-size:12px;color:var(--text2);padding:6px 0;border-bottom:1px solid var(--border)">当前账本：<b>'+cur+' 笔</b></div>';
  if(!snaps.length){
    html+='<div style="font-size:13px;color:var(--text2);padding:12px 0">还没有快照。记一次账就会自动生成第一份。</div>';
  }else{
    snaps.forEach(function(s){
      const rec=safeRead(s.key,null);
      let n='?';
      try{ if(rec&&rec.data&&rec.data[SK]) n=JSON.parse(rec.data[SK]).length; }catch(e){}
      html+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">'
        +'<span style="flex:1;font-size:13px">'+new Date(s.ts).toLocaleString()+'</span>'
        +'<span style="font-size:12px;color:var(--text2)">'+n+' 笔</span>'
        +'<button onclick="restoreSnapshot(\''+s.ts+'\')" style="background:none;border:1px solid var(--border);border-radius:6px;font-size:12px;padding:3px 8px;cursor:pointer;color:var(--accent)">恢复</button>'
        +'</div>';
    });
  }
  el.innerHTML=html;
  document.getElementById('snapModal').classList.add('show');
}
function restoreSnapshot(tsv){
  const rec=safeRead(SNAP_PREFIX+tsv,null);
  if(!rec||!rec.data){ try{ts('快照已损坏')}catch(e){alert('快照已损坏')} return; }
  const when=new Date(rec.ts).toLocaleString();
  if(!confirm('恢复到 '+when+' 的状态？\\n（当前数据会先另存一份）')) return;
  snapshotBeforeWrite();
  Object.keys(rec.data).forEach(function(k){ localStorage.setItem(k,rec.data[k]); });
  try{ts('已恢复到 '+when)}catch(e){}
  location.reload();
}

function restoreLatestSnapshot(){
  const snaps=listSnapshots();
  if(!snaps.length){ ts('还没有快照可用'); return false; }
  const rec=safeRead(snaps[0].key,null);
  if(!rec||!rec.data){ ts('快照已损坏'); return false; }
  const when=new Date(rec.ts).toLocaleString();
  if(!confirm('恢复到 '+when+' 的状态？\n（当前数据会先另存一份快照）')) return false;
  snapshotBeforeWrite();                 // 覆盖前再存一次，避免"恢复错了回不来"
  Object.keys(rec.data).forEach(k=>localStorage.setItem(k,rec.data[k]));
  ts('已恢复到 '+when);
  location.reload();
  return true;
}

// ── ④ 迁移（纯函数，不碰 localStorage，便于测试）──
function migrateTx(arr,fromV){
  let out=arr;
  if(fromV<2){
    // v1→v2：补齐 id（旧数据没 id 会导致去重/删除失效）
    const seen=new Set();
    out=out.map((t,i)=>{
      let id=t.id||('m'+(t.time||'')+'_'+i);
      if(seen.has(id)) id=id+'_'+i;
      seen.add(id);
      return Object.assign({},t,{id:id});
    });
  }
  return out;
}

function stx(d){safeWrite(()=>localStorage.setItem(SK,JSON.stringify(d)))}
function gb(){return safeRead(BK,{})}
function sb(d){safeWrite(()=>localStorage.setItem(BK,JSON.stringify(d)))}
function ga(){return safeRead(AK,DA)}
function sa(d){safeWrite(()=>localStorage.setItem(AK,JSON.stringify(d)))}
/* ★ 2026-11-07 用户：流水要「最新的在最上面」。
   旧代码同一天的记录 time 全是 T12:00:00（只存了日期没存时刻），排序时全部相等
   → 稳定排序保持插入顺序 → 刚记的那笔反而掉到最下面。
   现在：① 新记录存真实时刻 + createdAt ② 排序用 createdAt / 数组下标兜底
   ③ 老的 T12:00:00 是「不知道几点」，按日期排序不受影响。 */
function txOrder(list){
  const pos={};
  atx().forEach((t,i)=>{pos[t.id]=i});
  return list.slice().sort((a,b)=>{
    const c=b.time.localeCompare(a.time);
    if(c)return c;
    const ca=(b.createdAt||0)-(a.createdAt||0);
    if(ca)return ca;
    return (pos[b.id]||0)-(pos[a.id]||0);      // 同一时刻：后记的排前面
  });
}
function mtx(){return txOrder(atx().filter(t=>t.time.slice(0,7)===cm))}
