// ── Background stored in IndexedDB (no size limit) ──
function bgDB(){return new Promise((r,j)=>{const q=indexedDB.open('minis_bg',1);q.onupgradeneeded=()=>q.result.createObjectStore('bg');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}
async function saveBg(img,fit,color,overlay){const d=await bgDB();const t=d.transaction('bg','readwrite');const s=t.objectStore('bg');s.put(img,'img');s.put(fit,'fit');s.put(color,'color');s.put(overlay,'overlay');return new Promise(r=>{t.oncomplete=r})}
async function loadBgData(){try{const d=await bgDB();const t=d.transaction('bg','readonly');const s=t.objectStore('bg');const img=s.get('img'),fit=s.get('fit'),color=s.get('color'),overlay=s.get('overlay');return new Promise(r=>{let i=null,f='cover',c='',o=20;img.onsuccess=()=>{i=img.result};fit.onsuccess=()=>{f=fit.result||'cover'};color.onsuccess=()=>{c=color.result||''};overlay.onsuccess=()=>{o=overlay.result!=null?overlay.result:20};t.oncomplete=()=>r({img:i,fit:f,color:c,overlay:o})})}catch(e){return {img:null,fit:'cover',color:'',overlay:20}}}
async function delBg(){try{const d=await bgDB();const t=d.transaction('bg','readwrite');t.objectStore('bg').clear();return new Promise(r=>{t.oncomplete=r})}catch(e){}}
function applyBgLayer(img,fit,color,overlay){
  const r=document.documentElement;
  r.style.setProperty('--bg-img',img?`url(${img})`:'none');
  r.style.setProperty('--bg-size',fit||'cover');
  r.style.setProperty('--bg-color',color||'transparent');
  r.style.setProperty('--bg-overlay',`rgba(255,255,255,${(overlay??20)/100})`);
}
let pbg=null;
function openBgModal(){
  pbg=null;
  loadBgData().then(d=>{
    document.getElementById('bgFit').value=d.fit||'cover';
    const colorC=document.getElementById('bgColor');
    const colorT=document.getElementById('bgColorHex');
    colorC.value=d.color||'#f8f6f2';
    colorT.value=d.color||'#f8f6f2';
    document.getElementById('bgOverlay').value=d.overlay??20;
    document.getElementById('bgOverlayVal').textContent=(d.overlay??20)+'%';
    pbg=d.img||null;
    previewBg();
    document.getElementById('bgModal').classList.add('show');
  });
}
function closeBgModal(){document.getElementById('bgModal').classList.remove('show')}
function previewBg(){
  const img=pbg,fit=document.getElementById('bgFit').value,color=document.getElementById('bgColor').value,ov=parseInt(document.getElementById('bgOverlay').value)||0;
  document.getElementById('bgOverlayVal').textContent=ov+'%';
  const p=document.getElementById('bgPreview');
  p.style.backgroundImage=img?`url(${img})`:'none';
  p.style.backgroundSize=fit;
  p.style.backgroundColor=color;
  p.style.backgroundPosition='center';
  p.style.backgroundRepeat='no-repeat';
  // Show overlay on preview
  p.style.boxShadow=ov>0?`inset 0 0 0 999px rgba(255,255,255,${ov/100})`:'none';
}
function handleBgUpload(i){
  const f=i.files[0];if(!f)return;
  if(f.size>50*1024*1024){ts('图片不能超过50MB');return;}
  const r=new FileReader();
  r.onload=function(){
    const img=new Image();
    img.onload=function(){
      const maxDim=1600;let w=img.width,h=img.height;
      // Scale down if either dimension exceeds maxDim
      if(w>h&&w>maxDim){h=Math.round(h*maxDim/w);w=maxDim}
      else if(h>maxDim){w=Math.round(w*maxDim/h);h=maxDim}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      pbg=c.toDataURL('image/jpeg',0.7);
      previewBg();
    };
    img.onerror=function(){ts('图片无法读取');};
    img.src=r.result;
  };
  r.onerror=function(){ts('文件读取失败');};
  r.readAsDataURL(f);
}
async function applyBg(){
  if(!pbg)return ts('请先选择图片');
  const fit=document.getElementById('bgFit').value,color=document.getElementById('bgColor').value,ov=parseInt(document.getElementById('bgOverlay').value)||0;
  try{await saveBg(pbg,fit,color,ov)}catch(e){return ts('保存失败，请重试')}
  applyBgLayer(pbg,fit,color,ov);closeBgModal();ts('已更新');
}
async function restoreBg(){
  pbg=null;
  await delBg();
  applyBgLayer(null,'cover','',20);
  document.getElementById('bgPreview').style.backgroundImage='none';
  document.getElementById('bgPreview').style.backgroundColor='var(--bg)';
  document.getElementById('bgFile').value='';
  ts('已恢复');
}
function backupData(){loadBgData().then(bg=>{const d={schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),tx:atx(),budget:gb(),accts:ga(),inv:gi(),cats:{expense:gc('expense'),income:gc('income')},bg:bg};const json=JSON.stringify(d);const fn='记账备份_'+new Date().toISOString().slice(0,10)+'.json';
  if(window.MinisBridge&&typeof window.MinisBridge.saveText==='function'){window.MinisBridge.saveText(fn,json);ts('已保存到 下载/'+fn)}
  else{const b=new Blob([json],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);ts('已下载完整备份')}})}
function restoreData(){const i=document.createElement('input');i.type='file';i.accept='.json';i.onchange=function(){const f=i.files[0];if(!f)return;const r=new FileReader();r.onload=async function(){try{const d=JSON.parse(r.result);
  // ★ 导入前先拍快照 —— 导入是最容易覆盖数据的操作
  snapshotBeforeWrite();
  // 版本兼容：来自更新版本的备份先拒绝；来自旧版本的先迁移
  if(d.schemaVersion>SCHEMA_VERSION){ts('备份来自更新的版本，请先升级 App');return}
  const dtx=migrateTx(d.tx||[],d.schemaVersion||1);
  if(d.tx){const cur=atx(),ids=new Set(cur.map(t=>t.id));let added=0;dtx.forEach(t=>{if(!ids.has(t.id)){cur.push(t);ids.add(t.id);added++}});stx(cur)}if(d.budget)sb(d.budget);if(d.accts)sa(d.accts);if(d.inv)si(d.inv);if(d.cats&&d.cats.expense)sc('expense',d.cats.expense);if(d.cats&&d.cats.income)sc('income',d.cats.income);if(d.bg&&d.bg.img){await saveBg(d.bg.img,d.bg.fit||'cover',d.bg.color||'',d.bg.overlay??20)}else await delBg();location.reload()}catch(e){ts('无效备份')}};r.readAsText(f)};i.click()}
function importCSV(){
  const i=document.createElement('input');i.type='file';i.accept='.csv,.txt';
  i.onchange=function(){
    const f=i.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=function(){
      try{
        let raw=r.result;if(raw.charCodeAt(0)===0xFEFF)raw=raw.slice(1);
        // 容错：若导入的是JSON备份（以{开头），自动切换为恢复备份逻辑
        if(raw.trim().charAt(0)==='{'){
          const d=JSON.parse(raw);
          if(d.tx){const cur=atx(),ids=new Set(cur.map(t=>t.id));let add=0;d.tx.forEach(t=>{if(!ids.has(t.id)){cur.push(t);ids.add(t.id);add++}});stx(cur)}
          if(d.budget)sb(d.budget);
          if(d.accts)sa(d.accts);
          if(d.inv)si(d.inv);
          if(d.cats&&d.cats.expense)sc('expense',d.cats.expense);
          if(d.cats&&d.cats.income)sc('income',d.cats.income);
          if(d.bg&&d.bg.img){saveBg(d.bg.img,d.bg.fit||'cover',d.bg.color||'',d.bg.overlay??20)}
          ra();location.reload();return;
        }
        // 拆分区块：交易主体 + 账户元数据（若有）
        let body=raw, cashAcc=null, invAcc=null;
        const cmark=raw.indexOf('#CASH_ACCOUNTS#');
        if(cmark>=0){
          body=raw.slice(0,cmark);
          // 解析现金账户
          const imark=raw.indexOf('#INVEST_ACCOUNTS#');
          const cashSeg=raw.slice(cmark,imark>=0?imark:raw.length);
          cashAcc=cashSeg.split('\n')[1].split(',').map(s=>s.trim()).filter(Boolean);
          if(imark>=0){
            const invSeg=raw.slice(imark);
            invAcc=invSeg.split('\n').slice(1).map(l=>l.trim()).filter(Boolean)
              .map(l=>{const p=l.split(',');return {name:p[0],amount:parseFloat(p[1])||0,month:p[2]||'',ours:(p[3]||'false')==='true'}});
          }
        }
        const lines=body.replace(/\r/g,'').split('\n').filter(l=>l.trim());
        if(lines.length<2)return ts('文件为空');
        const d=atx(),ids=new Set(d.map(t=>t.id));let added=0,skipped=0,tfNoAcct=0;
        // ★ 转账修复：旧版这里写的是 c[1].includes('收入')?'income':'expense'，
        //   于是「转账」被当成支出记进去（金额虚增、账户余额全错）。
        //   v2 起识别转账并恢复 from/to/手续费。
        lines.slice(1).forEach(l=>{
          if(l.startsWith('#'))return;
          const c=parseCSVLine(l);const amt=parseFloat(c[2]);
          const date=c[0]&&c[0].match(/^\d{4}-\d{2}-\d{2}/)?c[0]:'';
          if(!(c.length>=3&&date&&!isNaN(amt)&&amt>0)){skipped++;return}
          const rawType=(c[1]||'').trim();
          const isTransfer=/转账|transfer|转出|转入/i.test(rawType);
          if(isTransfer){
            // 转出/转入可能在 7、8 列（v2），也可能塞在 备注(4)/账户(5) 里（半新格式）
            let from=(c[6]||'').trim(), to=(c[7]||'').trim();
            if(!from||!to){
              // 逐列单独匹配，绝不跨列拼接（否则「微信→银行卡」+备注「提现」会变成「银行卡提现」）
              for(const f of [c[4],c[3],c[5]]){
                const m=String(f||'').trim().match(/^([^\s,，→\-]{1,20})\s*(?:→|->|到|至)\s*([^\s,，→\-]{1,20})$/);
                if(m){from=from||m[1];to=to||m[2];break}
              }
            }
            const fee=parseFloat(c[8]);
            const rec={id:uid(),time:date+'T12:00:00',type:'transfer',amount:amt,
                       note:c[3]||'',from:from||'',to:to||''};
            if(!isNaN(fee)&&fee>0){rec.fee=fee;rec.feePayer=(c[9]||'from').trim()==='to'?'to':'from'}
            d.push(rec);
            if(!rec.from||!rec.to)tfNoAcct++;   // 记下来，导完提示用户手工补
            added++;
          }else{
            d.push({id:uid(),time:date+'T12:00:00',type:rawType.includes('收入')?'income':'expense',
                    amount:amt,note:c[3]||'',account:c[4]||'',category:c[5]||''});
            added++;
          }
        });
        stx(d);
        // 同步账户结构（合并：新增缺失的，不覆盖已有金额）
        if(cashAcc){
          let cur=ga();
          cashAcc.forEach(a=>{if(!cur.includes(a))cur.push(a)});
          sa(cur);
        }
        if(invAcc&&invAcc.length){
          let cur=gi();
          invAcc.forEach(a=>{
            const x=cur.find(y=>y.name===a.name);
            if(x){x.amount=a.amount||x.amount;x.month=a.month||x.month;x.ours=a.ours===false?false:x.ours}
            else cur.push(a);
          });
          si(cur);
        }
        ra();
        if(tfNoAcct>0){
          ts('导入 '+added+' 条；其中 '+tfNoAcct+' 笔转账缺转出/转入账户，请点开补上');
        }else{
          ts(added?'导入 '+added+' 条'+(skipped?'，跳过 '+skipped+' 行':''):'未导入：请确认格式为 日期,类型,金额,备注,账户,分类,转出,转入,手续费,付费方');
        }
      }catch(e){ts('格式错误')}
    };
    r.readAsText(f);
  };
  i.click()
}
function parseCSVLine(line){const r=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(inQ){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++}else inQ=false}else cur+=ch}else{if(ch===','){r.push(cur.trim());cur=''}else if(ch==='"')inQ=true;else cur+=ch}}r.push(cur.trim());return r}
/* ══ CSV 结构 v2（2026-11-13）══
   日期,类型,金额,备注,账户,分类,转出,转入,手续费,付费方
   - 支出/收入：只用前 6 列，后 4 列留空
   - 转账：类型写「转账」，账户/分类留空，转出/转入/手续费/付费方填
   读取时兼容旧 6 列格式（转账信息缺失的旧记录仍按支出/收入处理——那部分信息当年就没存）。 */
function csvTxType(t){
  return t.type==='transfer'?'转账':t.type==='income'?'收入':'支出';
}
function csvRow(t){
  const base=[t.time.slice(0,10),csvTxType(t),Number(t.amount||0).toFixed(2),t.note||'',
              t.type==='transfer'?'':(t.account||''),t.type==='transfer'?'':(t.category||'')];
  if(t.type!=='transfer')return base.join(',');
  const from=t.from||'',to=t.to||'',fee=Number(t.fee||0),fp=t.feePayer||'from';
  return base.concat([from,to,fee>0?fee.toFixed(2):'',fee>0?(fp==='to'?'to':'from'):'']).join(',');
}
function csvHeader(){return '日期,类型,金额,备注,账户,分类,转出,转入,手续费,付费方'}
function buildCSV(tx){
  const rows=tx.map(csvRow);
  const accLines='#CASH_ACCOUNTS#\n'+ga().join(',')+'\n#INVEST_ACCOUNTS#\n'
    +gi().map(a=>[a.name,a.amount||0,a.month||'',a.ours!==false?'true':'false'].join(',')).join('\n');
  return '\ufeff'+[csvHeader(),...rows,accLines].join('\n');
}
function exportCSV(){
  const tx=atx();if(!tx.length)return ts('无数据');
  const csv=buildCSV(tx);
  const fn='记账_'+cm+'.csv';
  if(window.MinisBridge && typeof window.MinisBridge.saveText==='function'){
    window.MinisBridge.saveText(fn,csv);ts('已保存到 下载/'+fn);
  }else{
    const b=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);ts('已导出（含账户结构）')
  }
}
function openExportCSV(){
  const min=atx().reduce((a,t)=>{const d=t.time.slice(0,10);return!a||d<a?d:a},'');
  document.getElementById('exportStart').value=cm+'-01';
  document.getElementById('exportEnd').value=new Date().toISOString().slice(0,10);
  document.getElementById('exportCSVModal').classList.add('show');
}
function closeExportCSV(){document.getElementById('exportCSVModal').classList.remove('show')}
function exportCSVRange(){
  const s=document.getElementById('exportStart').value,e=document.getElementById('exportEnd').value;
  if(!s||!e)return ts('请选择起止日期');
  const tx=atx().filter(t=>t.time.slice(0,10)>=s&&t.time.slice(0,10)<=e);
  if(!tx.length)return ts('该时间段无数据');
  const csv=buildCSV(tx);
  const fn=`记账_${s}_${e}.csv`;
  window.MinisBridge && typeof window.MinisBridge.saveText==='function'
    ? (window.MinisBridge.saveText(fn,csv),ts(`已保存到 下载/${fn}`))
    : (()=>{const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href)})();
  closeExportCSV();
}
function ts(m){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),2000)}
// 自绘确认弹窗：返回Promise<boolean>
function confirmBox(msg){
  return new Promise(res=>{
    const modal=document.getElementById('confirmModal');
    document.getElementById('confirmMsg').textContent=msg;
    modal.classList.add('show');
    const ok=document.getElementById('confirmOk'),cancel=document.getElementById('confirmCancel');
    function done(v){modal.classList.remove('show');ok.onclick=cancel.onclick=null;res(v)}
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
    modal.onclick=function(e){if(e.target===modal)done(false)};
  });
}
// 自绘输入弹窗：返回Promise<string|null>（null=取消）
function promptBox(title,placeholder,defaultValue){
  return new Promise(res=>{
    const modal=document.getElementById('promptModal');
    document.getElementById('promptTitle').textContent=title;
    const input=document.getElementById('promptInput');
    input.value=defaultValue||'';input.placeholder=placeholder||'';
    modal.classList.add('show');
    const ok=document.getElementById('promptOk'),cancel=document.getElementById('promptCancel');
    function done(v){modal.classList.remove('show');ok.onclick=cancel.onclick=null;res(v)}
    ok.onclick=()=>done(input.value);
    cancel.onclick=()=>done(null);
    modal.onclick=function(e){if(e.target===modal)done(null)};
    setTimeout(()=>input.focus(),80);
  });
}
