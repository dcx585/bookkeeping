// 回归测试：专打今天修掉的 2 个 bug + 原有行为不许退化
const H=require('./harness.js');
const X=H.X;
let pass=0,fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++;fails.push(n+(e?'  → '+e:''));console.log('❌ '+n+(e?'  → '+e:''));} }
const t0=Date.now();
function mk(o){return Object.assign({type:'expense',category:'话费',account:'',_src:'sms'},o)}
function merged(a,b){ const r=X.mergePool([a,b]); return r.length===1?r[0].amount:(r.length+'条:'+r.map(x=>x.amount).join('+')); }

console.log('--- R1 面额/实付 必须合并为实付（正序+逆序）---');
const scenarios=[
 ['标准',            mk({amount:100,note:'您已成功充值100.00元',_boxKey:'a',_time:t0}), mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'b',_time:t0+60000})],
 ['充值带银行卡',    mk({amount:100,note:'您已成功充值100.00元',account:'银行卡',_boxKey:'a',_time:t0}), mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'b',_time:t0+60000})],
 ['银行措辞弱',      mk({amount:100,note:'已成功充值100.00元',_boxKey:'a',_time:t0}), mk({amount:96,note:'您9月19日支出96.00元',_boxKey:'b',_time:t0+60000})],
 ['银行渠道充值',    mk({amount:100,note:'尾号2374卡充值话费100.00元',account:'银行卡',_boxKey:'a',_time:t0}), mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'b',_time:t0+60000})],
 ['小折扣99→96',     mk({amount:99,note:'已成功充值99.00元',_boxKey:'a',_time:t0}), mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'b',_time:t0+60000})],
 ['缴费200实付190',  mk({amount:200,note:'缴费成功200.00元',_boxKey:'a',_time:t0}), mk({amount:190,note:'尾号1234卡支出190.00元',account:'银行卡',_boxKey:'b',_time:t0+60000})],
];
scenarios.forEach(([n,a,b])=>{
  const f=merged(a,b), r=merged(b,a);
  ok('R1 「'+n+'」无论顺序都合并为实付', f===96||f===190, '正序='+f+' 逆序='+r);
});

console.log('--- R2 不该合并的绝不许合并（防误吞）---');
const x1=mk({amount:100,note:'已成功充值100.00元',_boxKey:'a',_time:t0});
const x2=mk({amount:30,note:'尾号2374卡支出30.00元',account:'银行卡',_boxKey:'b',_time:t0+60000});
ok('R2 实付仅30%（<50%）不合并', X.mergePool([x1,x2]).length===2, JSON.stringify(X.mergePool([x1,x2]).map(x=>x.amount)));
const y1=mk({amount:20,note:'午饭',account:'微信',_boxKey:'c',_time:t0});
const y2=mk({amount:20,note:'奶茶',account:'微信',_boxKey:'d',_time:t0+30*3600*1000});
ok('R2 相隔30h的同额消费不合并', X.mergePool([y1,y2]).length===2, JSON.stringify(X.mergePool([y1,y2]).map(x=>x.amount)));
const w1=mk({amount:100,note:'充值100元',_boxKey:'e',_time:t0});
const w2=mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'f',_time:t0+20*60*1000});
ok('R2 相隔20分钟（>10min窗）不合并', X.mergePool([w1,w2]).length===2, JSON.stringify(X.mergePool([w1,w2]).map(x=>x.amount)));
const v1=mk({amount:100,note:'充值',_boxKey:'g',_time:t0});
ok('R2 单独一笔充值必须保留（不能被吞）', X.mergePool([v1]).length===1 && X.mergePool([v1])[0].amount===100);

console.log('--- R3 同额同源仍要合并（原有能力不退化）---');
const z1=mk({amount:20,note:'银行A',account:'银行卡',_boxKey:'h',_time:t0});
const z2=mk({amount:20,note:'银行B',account:'银行卡',_boxKey:'i',_time:t0+60000});
ok('R3 同额10分钟内合并', X.mergePool([z1,z2]).length===1, JSON.stringify(X.mergePool([z1,z2]).map(x=>x.amount)));

console.log('--- R4 识别函数互斥性（新不变式）---');
const samples=[['已成功充值100.00元',''],['尾号2374卡充值话费100.00元','银行卡'],['尾号2374卡支出96.00元','银行卡'],['您9月19日支出96.00元',''],['缴费成功200元',''],['您已成功付款25.00元','微信']];
samples.forEach(([n,a])=>{
  const e=mk({amount:100,note:n,account:a});
  ok('R4 互斥「'+n.slice(0,14)+'」', !(X.isRechargeItem(e)&&X.isBankItem(e)), '两者同时为真');
});

console.log('--- R5 isAlreadyBooked 不再因缺时间而误吞 ---');
H.localStorage.clear();
H.localStorage.setItem('minis_bookkeeping_v5',JSON.stringify([{id:'1',time:'2026-10-01T12:00:00',type:'expense',amount:96,account:'',category:'其他'}]));
const noT=mk({amount:96,note:'充值96元',_boxKey:'z'});
ok('R5 无时间戳的历史同额不再被误判已入账', X.isAlreadyBooked(noT)===false, '返回 '+X.isAlreadyBooked(noT));
const withT=mk({amount:96,note:'充值96元',_boxKey:'z2',_time:new Date('2026-10-01T12:05:00').getTime()});
ok('R5 时间相近的历史同额仍判为已入账', X.isAlreadyBooked(withT)===true, '返回 '+X.isAlreadyBooked(withT));

console.log('--- R6 额度/授信类通知不得记成账（2026-10-08 修）---');
const quotaSamples=[
 '【支付宝】您的花呗额度已提升至5000元',
 '您的花呗额度已提升至5000元',
 '【花呗】您的额度已提升至5000元',
 '【招商银行】您的信用卡额度已提升至50000元',
 '【某行】您信用卡可用额度50000元',
 '您的借呗额度已更新为10000元',
 '您当前可用额度2000元',
 '花呗提额成功，额度3000元',
 '您的临时额度已生效，额度为5000元',
 '您的分期额度已调整为20000元',
];
quotaSamples.forEach(t=>{
  const pay=X.looksLikePaymentText(t);
  const r=X.parseNotifFull({title:'',text:t,app:'',time:Date.now()});
  ok('R6 剔除额度类「'+t.slice(0,20)+'」', !(pay&&r.length), '被判为支付并解析出 '+(r.length?r[0].amount:''));
});
console.log('--- R7 真实还款/消费不得被误杀 ---');
[
 ['已还款5000元',5000],
 ['花呗还款成功5000元',5000],
 ['您已成功还款2000.00元',2000],
 ['花呗消费100元',100],
].forEach(([t,exp])=>{
  const r=X.parseNotifFull({title:'',text:t,app:'',time:Date.now()});
  ok('R7 识别「'+t+'」=¥'+exp, r.length>0&&Math.abs(r[0].amount-exp)<0.005, r.length?('得到 '+r[0].amount):'未解析');
});

console.log('\n════════════════════════');
console.log('回归 通过 '+pass+' / 失败 '+fail);
if(fails.length){ console.log('\n失败:'); fails.forEach(f=>console.log(' ✗ '+f)); }
process.exit(fail?1:0);
