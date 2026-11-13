// 记账App 自检 —— CSV / 账户对账 / 手续费 / 资产拆分
const H=require('./harness.js');
const {sandbox:S,X}=H;
let pass=0,fail=0; const fails=[];
function ok(name,cond,extra){
  if(cond){pass++;}
  else{fail++;fails.push(name+(extra?'  → '+extra:''));console.log('❌ '+name+(extra?'  → '+extra:''));}
}
function near(a,b){return Math.abs((Number(a)||0)-(Number(b)||0))<0.005}

/* ── A. 微信手续费 ── */
console.log('\n========== A. 微信提现手续费 0.1% ─=========');
{
  const F=X.wxFeeOf;
  if(typeof F!=='function'){ ok('wxFeeOf 已导出',false); }
  else{
    const cases=[[1000,1.00],[100,0.10],[50,0.10,'50×0.1%=0.05 但最低 0.10'],[0,0,'金额0不收费'],
                 [12345.67,12.35,'四舍五入到分'],[1,0.10],[200,0.20]];
    cases.forEach(([amt,exp,desc])=>{
      ok('wxFeeOf('+amt+')='+exp+(desc?' ('+desc+')':''), near(F(amt),exp), '实际 '+F(amt));
    });
  }
}

/* ── B. 账户对账：转账不计入收支 ── */
console.log('\n========== B. 账户对账 acctFlow ─=========');
{
  const F=X.acctFlow;
  if(typeof F!=='function'){ ok('acctFlow 已导出',false); }
  else{
    // 造一批干净数据
    X.stx([
      {id:'1',time:'2026-11-01T09:00:00',type:'income',amount:8000,note:'工资',account:'银行卡',category:'工资'},
      {id:'2',time:'2026-11-02T12:00:00',type:'expense',amount:88,note:'超市',account:'银行卡',category:'日用'},
      {id:'3',time:'2026-11-03T15:00:00',type:'transfer',amount:2000,note:'',from:'微信',to:'银行卡'},
      {id:'4',time:'2026-11-05T10:00:00',type:'transfer',amount:500,note:'',from:'银行卡',to:'微信'},
      {id:'5',time:'2026-11-08T09:00:00',type:'transfer',amount:1000,note:'',from:'银行卡',to:'零钱通',fee:1,feePayer:'from'},
    ]);
    const b=F('银行卡');
    ok('银行卡 收入合计=8000', near(b.inc,8000), '实际 '+b.inc);
    ok('银行卡 支出合计=88（转账不算支出）', near(b.exp,88), '实际 '+b.exp);
    ok('银行卡 转出=1500', near(b.tOut,1500), '实际 '+b.tOut);
    ok('银行卡 转入=2000', near(b.tIn,2000), '实际 '+b.tIn);
    ok('银行卡 手续费=1', near(b.feeSum,1), '实际 '+b.feeSum);
    ok('银行卡 余额=8000-88-1500-1+2000=8411', near(b.bal,8411), '实际 '+b.bal);

    const w=F('微信');
    ok('微信 支出=0（无消费）', near(w.exp,0), '实际 '+w.exp);
    ok('微信 转出=2000', near(w.tOut,2000), '实际 '+w.tOut);
    ok('微信 转入=500', near(w.tIn,500), '实际 '+w.tIn);
    ok('微信 余额=-1500', near(w.bal,-1500), '实际 '+w.bal);

    // 转账流水能标出「从哪到哪」
    const tr=b.rows.filter(r=>r.kind==='out'||r.kind==='in');
    ok('流水里有 3 笔转账', tr.length===3, '共 '+tr.length+' 条');
    const toLj=b.rows.find(r=>r.t.from==='银行卡'&&r.t.to==='零钱通');
    ok('转账记录了 from/to', !!toLj&&toLj.t.from==='银行卡'&&toLj.t.to==='零钱通');
    ok('该笔手续费归到付款方', !!toLj&&near(toLj.fee,1), toLj&&toLj.fee);
  }
}

/* ── C. CSV 导出包含转账字段 ── */
console.log('\n========== C. CSV 导出/导入 ─=========');
{
  const B=X.buildCSV;
  if(typeof B!=='function'){ ok('buildCSV 已导出',false); }
  else{
    const csv=B([
      {id:'a',time:'2026-11-01T12:00:00',type:'expense',amount:20,note:'午饭',account:'微信',category:'餐饮'},
      {id:'b',time:'2026-11-02T12:00:00',type:'transfer',amount:2000,note:'提现',from:'微信',to:'银行卡',fee:2,feePayer:'from'},
    ]);
    const lines=csv.replace(/^\ufeff/,'').split('\n');
    ok('表头含 转出/转入/手续费/付费方',
       /转出/.test(lines[0])&&/转入/.test(lines[0])&&/手续费/.test(lines[0])&&/付费方/.test(lines[0]), lines[0]);
    ok('转账类型写成「转账」', /转账/.test(lines[2]), lines[2]);
    ok('转账行含 from/to', /微信/.test(lines[2])&&/银行卡/.test(lines[2]), lines[2]);
    ok('转账行手续费=2', /2(\.00)?/.test(lines[2]), lines[2]);
    ok('普通支出仍写「支出」', /支出/.test(lines[1]), lines[1]);
  }
}

/* ── D. 资产拆分：现金 vs 理财 ── */
console.log('\n========== D. 现金/理财拆分 ─=========');
{
  // ga/gi 是账户与理财的读写
  if(typeof X.getCashBalances==='function'){
    X.stx([
      {id:'1',time:'2026-11-01T09:00:00',type:'income',amount:6874.5,note:'',account:'银行卡',category:'其他'},
      {id:'2',time:'2026-11-02T09:00:00',type:'income',amount:8000,note:'',account:'微信',category:'其他'},
    ]);
    const cb=X.getCashBalances();
    ok('现金账户汇总含银行卡+微信', near(cb['银行卡'],6874.5)&&near(cb['微信'],8000), JSON.stringify(cb));
  }else{
    ok('getCashBalances 已导出',false);
  }
}

console.log('\n§ 结果');
console.log('  通过 '+pass+' / 失败 '+fail);
if(fail){ console.log('\n失败项：'); fails.forEach(f=>console.log('  ✗ '+f)); process.exit(1); }
