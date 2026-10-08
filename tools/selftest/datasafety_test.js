// 数据安全网测试：写前快照 / 坏数据隔离 / 迁移 / 恢复
const H=require('./harness.js');
const S=H.sandbox, X=H.X, ls=H.localStorage;
let pass=0,fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else{fail++;fails.push(n+(e?'  → '+e:''));console.log('❌ '+n+(e?'  → '+e:''));} }
function countCorrupt(){ let n=0; for(const k in H.store){ if(k.indexOf('_CORRUPT_')>=0) n++; } return n; }
function countSnaps(){ let n=0; for(const k in H.store){ if(k.indexOf('minis_snap_')===0) n++; } return n; }

const SK='minis_bookkeeping_v5';

console.log('--- S1 坏数据：不清空、不崩溃、隔离保存 ---');
// 先造一份好数据
ls.clear();
ls.setItem(SK,JSON.stringify([{id:'a',time:'2026-10-01T12:00:00',type:'expense',amount:10,account:'微信'}]));
// 让读到的 raw 是坏的（直接写坏）
ls.setItem(SK,'{这是个坏JSON');
const r1=X.safeRead ? X.safeRead(SK,[]) : (H.sandbox.safeRead?H.sandbox.safeRead(SK,[]):null);
ok('S1 坏数据不抛异常', true);
ok('S1 返回兜底值 []', Array.isArray(r1)&&r1.length===0, JSON.stringify(r1));
ok('S1 坏数据被隔离保留（有 _CORRUPT_ 副本）', countCorrupt()>=1, '副本数='+countCorrupt());
ok('S1 原始坏数据仍在（没被清空）', ls.getItem(SK)==='{这是个坏JSON', '实际='+ls.getItem(SK));

console.log('--- S2 正常数据：原样读出 ---');
ls.clear();
ls.setItem(SK,JSON.stringify([{id:'x',amount:5,time:'2026-10-01T12:00:00',type:'expense',account:'微信'}]));
const r2=(H.sandbox.safeRead||X.safeRead)(SK,[]);
ok('S2 正常数据正确读出', Array.isArray(r2)&&r2.length===1&&r2[0].id==='x', JSON.stringify(r2));
ok('S2 正常数据不产生隔离副本', countCorrupt()===0, '副本数='+countCorrupt());

console.log('--- S3 空数据：返回兜底，不报错 ---');
ls.clear();
const r3=(H.sandbox.safeRead||X.safeRead)(SK,[]);
ok('S3 无数据返回兜底', Array.isArray(r3)&&r3.length===0);

console.log('--- S4 迁移：纯函数、补 id ---');
if(H.sandbox.migrateTx){
  const old=[{time:'2026-01-01T12:00:00',amount:1},{time:'2026-01-01T12:00:00',amount:2}];
  const m=H.sandbox.migrateTx(old,1);
  ok('S4 迁移后每笔都有 id', m.every(t=>t.id), JSON.stringify(m.map(t=>t.id)));
  ok('S4 迁移后 id 不重复', new Set(m.map(t=>t.id)).size===m.length, JSON.stringify(m.map(t=>t.id)));
  ok('S4 迁移不改变金额', m[0].amount===1&&m[1].amount===2);
  ok('S4 迁移是纯函数（不改原数组）', !old[0].id, '原数组被改了');
} else { console.log('  (migrateTx 未导出，跳过)'); }

console.log('--- S5 快照：写前自动生成、最多 7 份 ---');
ls.clear();
if(H.sandbox.snapshotBeforeWrite){
  for(let i=0;i<10;i++){
    ls.setItem(SK,JSON.stringify([{id:'t'+i,amount:i,time:'2026-10-0'+((i%9)+1)+'T12:00:00',type:'expense',account:'微信'}]));
    H.sandbox.snapshotBeforeWrite();
  }
  ok('S5 快照数量不超过 7', countSnaps()<=7, '实际='+countSnaps());
  ok('S5 至少生成了快照', countSnaps()>=1, '实际='+countSnaps());
} else { console.log('  (snapshotBeforeWrite 未导出，跳过)'); }

console.log('--- S6 首次写入不拍快照，但第二笔必须拍（防"永远没快照"）---');
ls.clear();
if(H.sandbox.snapshotBeforeWrite){
  // 空库首次调用 → 返回 false（没有可丢的东西）
  const r1=H.sandbox.snapshotBeforeWrite();
  ok('S6 空库快照返回 false', r1===false, '实际 '+r1);
  ok('S6 空库不产生快照', countSnaps()===0, '实际 '+countSnaps());
  // 写入第一笔后调用 → 返回 true 且真的存了
  ls.setItem(SK,JSON.stringify([{id:'a',time:'2026-10-08T12:00:00',type:'expense',amount:1,account:'微信'}]));
  const r2=H.sandbox.snapshotBeforeWrite();
  ok('S6 有数据后快照返回 true', r2===true, '实际 '+r2);
  ok('S6 有数据后快照数量=1', countSnaps()===1, '实际 '+countSnaps());
}

console.log('--- S7 safeWrite：首次写入不该锁死后续快照 ---');
ls.clear();
if(H.sandbox.safeWrite && H.sandbox.listSnapshots){
  // 模拟：空库 → safeWrite 一次（快照应跳过，且【不应】把窗口锁上）
  H.sandbox.safeWrite(()=>ls.setItem(SK,JSON.stringify([{id:'1',time:'2026-10-08T12:00:00',type:'expense',amount:10,account:'微信'}])));
  // 紧接着第二次 safeWrite（不等 800ms）→ 这次有旧数据，必须拍到快照
  H.sandbox.safeWrite(()=>ls.setItem(SK,JSON.stringify([
    {id:'1',time:'2026-10-08T12:00:00',type:'expense',amount:10,account:'微信'},
    {id:'2',time:'2026-10-08T13:00:00',type:'expense',amount:20,account:'微信'}])));
  const n=countSnaps();
  ok('S7 第二次写入拍到了快照（没被窗口锁死）', n>=1, '快照数='+n);
}

console.log('\n════════════════════');
console.log('数据安全网 通过 '+pass+' / 失败 '+fail);
if(fails.length){ console.log('\n失败:'); fails.forEach(f=>console.log(' ✗ '+f)); }
process.exit(fail?1:0);
