// 在 node 里跑 app.html 的逻辑，用于静态+逻辑自检
const fs=require('fs');
const vm=require('vm');

// ── 1. 抽取 JS ──
const html=fs.readFileSync('/var/minis/shared/bookkeeping/tools/selftest/../../app.html','utf8');
const m=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/.exec(html);
let src=m[1];

// ── 2. 伪造 DOM / 浏览器环境 ──
const store={};
const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]},clear:()=>{for(const k in store)delete store[k]}};

const nodes={};
function mkNode(id){
  const n={
    id, style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}},
    _text:'', _html:'',
    get textContent(){return this._text}, set textContent(v){this._text=v},
    get innerHTML(){return this._html}, set innerHTML(v){this._html=v},
    value:'', onclick:null, children:[], parentNode:null,
    addEventListener(){}, removeEventListener(){}, appendChild(c){this.children.push(c);c.parentNode=this},
    insertBefore(c){this.children.push(c);c.parentNode=this;return c},
    querySelector(){return mkNode('q')}, querySelectorAll(){return []},
    getBoundingClientRect(){return {top:0,left:0,bottom:100,right:100,width:100,height:100}},
    getAttribute(){return null}, setAttribute(){}, focus(){}, blur(){}, click(){}
  };
  return n;
}
function getEl(id){ if(!nodes[id]) nodes[id]=mkNode(id); return nodes[id]; }

const document={
  getElementById:getEl,
  createElement:mkNode,
  querySelector:()=>mkNode('q'),
  querySelectorAll:()=>[],
  addEventListener(){}, removeEventListener(){},
  body:mkNode('body'), documentElement:mkNode('html'),
  visibilityState:'visible', hidden:false,
  cookie:''
};
const window={};
Object.assign(window,{document,localStorage,
  addEventListener(){}, removeEventListener(){},
  setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  requestAnimationFrame:cb=>0,
  location:{href:'',reload(){}},
  navigator:{userAgent:'node'},
  visualViewport:null,
  alert:()=>{}, confirm:()=>true, prompt:()=>'',
  console
});
window.window=window;
window.globalThis=window;

const sandbox={
  window, document, localStorage, console,
  alert:()=>{}, confirm:()=>true, prompt:()=>'',
  setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  requestAnimationFrame:cb=>0,
  navigator:{userAgent:'node'},
  location:{href:'',reload(){}},
  screen:{orientation:{addEventListener(){},type:'portrait-primary',lock(){return Promise.resolve()}}},
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Set, Map, isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, Error, Promise
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);

// 顶层 const/let 不会挂到 sandbox，用包一层返回的方式导出
const exportList=[
 'safeRead','safeWrite','snapshotBeforeWrite','listSnapshots','migrateTx','SCHEMA_VERSION','SNAP_PREFIX','restoreSnapshot',
 'parseNotifFull','findAmounts','isPaymentSegment','singleParse','looksLikePaymentText',
 'mergePool','isRechargeItem','isBankItem','isAlreadyBooked','getCashBalances','reconDerived',
 'entryKey','dismissKey','makeTx','uid','atx','ga','gi','updateInvPlanHint','stx'
];
let wrapped;
try{
  wrapped=src.replace(/<\/script>/g,'');
}catch(e){}
try{
  vm.runInContext(src+'\n;globalThis.__X={'+exportList.map(n=>n+':(typeof '+n+'!=="undefined"?'+n+':undefined)').join(',')+'};', sandbox, {filename:'app.js'});
}catch(e){
  console.log('!! 顶层执行报错:', e.message);
  const lines=e.stack.split('\n').slice(0,4).join('\n');
  console.log(lines);
}

const X=sandbox.__X||{};
module.exports={sandbox,X,localStorage,getEl,nodes,store};
if(require.main===module){
  console.log('导出成功的函数:', Object.keys(X).filter(k=>X[k]).join(', '));
  console.log('导出失败的/未定义的:', Object.keys(X).filter(k=>!X[k]).join(', ')||'(无)');
}
