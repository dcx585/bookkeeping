// 记账App 自检 —— 逻辑测试
const H=require('./harness.js');
const {sandbox:S,X}=H;
let pass=0,fail=0; const fails=[];
function ok(name,cond,extra){
  if(cond){pass++;}
  else{fail++;fails.push(name+(extra?'  → '+extra:''));console.log('❌ '+name+(extra?'  → '+extra:''));}
}
function P(text,extra){ return Object.assign({title:'',text:text,app:'',time:Date.now()},extra||{}); }

console.log('\n========== A. 金额解析 ==========');
{
  const cases=[
    ['尾号2374卡9月19日20:43支出(消费支付宝-杭州深度求索人工智能基础技…)20元，余额169.10元',20,'余额169.10 不能被当金额'],
    ['您尾号1234的储蓄卡账户9月20日14时30分收入人民币100.00元，余额500.00元',100,'收入100'],
    ['您账户1234于09月20日14:30网上支付人民币-35.50',35.5,'负数金额取绝对值'],
    ['微信支付：已支付¥15.80',15.8,'¥符号'],
    ['你已成功付款 25.00 元',25,'元字'],
    ['【云闪付】您尾号3344的银行卡消费12.50元',12.5,'云闪付'],
    ['您尾号8899卡09月20日15:20消费人民币68.00元',68,'农行'],
  ];
  cases.forEach(([t,exp,desc])=>{
    const r=X.parseNotifFull(P(t));
    const got=r.length?r[0].amount:null;
    ok('解析「'+desc+'」='+exp, Math.abs((got||-1)-exp)<0.005, '实际 '+got+'  原文:'+t.slice(0,40));
  });
}

console.log('\n========== B. 非支付必须剔除 ==========');
{
  const cases=[
    ['验证码123456，5分钟内有效，请勿泄露','验证码'],
    ['【银行】办卡享好礼，额度5万元，回复TD退订','营销'],
    ['【工商银行】您尾号2374卡，余额1823.44元','纯余额提醒'],
    ['您的话费余额不足，请及时充值，避免停机','催缴(无已完成词)'],
    ['【顺丰】您的包裹已派送，取件码1234','物流'],
    ['【某行】您本月账单应还5000.00元，请于25日前还款','催缴账单'],
  ];
  cases.forEach(([t,desc])=>{
    const isPay=X.looksLikePaymentText(t);
    const r=X.parseNotifFull(P(t));
    ok('剔除「'+desc+'」', !isPay && r.length===0, 'isPay='+isPay+' 解析出'+r.length+'条');
  });
}

console.log('\n========== C. 面额 vs 实付（充值100实付96）==========');
{
  // 场景：运营商短信(面额100) + 银行短信(实付96)
  const notice={title:'',text:'您已成功充值100.00元，感谢使用',app:'',time:Date.now(),_boxKey:'n1',_time:Date.now()};
  const bank  ={title:'',text:'尾号2374卡9月19日20:43支出96.00元，余额100.00元',app:'',time:Date.now(),_boxKey:'n2',_time:Date.now()+1000};
  const pn=X.parseNotifFull(notice), pb=X.parseNotifFull(bank);
  ok('运营商短信解析出面额100', pn.length>0 && pn[0].amount===100, JSON.stringify(pn));
  ok('银行短信解析出实付96', pb.length>0 && pb[0].amount===96, JSON.stringify(pb));
  if(pn.length&&pb.length){
    const e1=Object.assign({},pn[0],{_boxKey:'n1',_time:notice.time,_src:'sms'});
    const e2=Object.assign({},pb[0],{_boxKey:'n2',_time:bank.time,_src:'sms'});
    const merged=X.mergePool([e1,e2]);
    ok('★ 面额+实付 合并成 1 条（不是196）', merged.length===1, '合并后 '+merged.length+' 条: '+JSON.stringify(merged.map(x=>x.amount)));
    if(merged.length===1) ok('★ 合并后保留实付96', Math.abs(merged[0].amount-96)<0.005, '实际 '+merged[0].amount);
  }
}

console.log('\n========== D. 真实重复（同额）必须合并 ==========');
{
  const t=Date.now();
  const a={amount:20,type:'expense',category:'其他',account:'支付宝',note:'银行短信',_boxKey:'a',_time:t,_src:'sms'};
  const b={amount:20,type:'expense',category:'其他',account:'支付宝',note:'银行App推送',_boxKey:'b',_time:t+60000,_src:'notice'};
  const merged=X.mergePool([a,b]);
  ok('同额10分钟内合并成1条', merged.length===1, '得到 '+merged.length);
  // 不相干的同额消费不能合并
  const c={amount:20,type:'expense',category:'餐饮',account:'微信',note:'午饭',_boxKey:'c',_time:t,_src:'sms'};
  const d={amount:20,type:'expense',category:'餐饮',account:'微信',note:'买奶茶',_boxKey:'d',_time:t+30*3600*1000,_src:'sms'};
  ok('相隔30小时的同额消费不合并', X.mergePool([c,d]).length===2, '得到 '+X.mergePool([c,d]).length);
}

console.log('\n========== E. 规划金 账户联动 ==========');
{
  const S_BOOK='minis_bookkeeping_v5';
  H.localStorage.clear();
  const today='2026-10-08T12:00:00';
  H.localStorage.setItem(S_BOOK,JSON.stringify([
    {id:'1',time:today,type:'income',amount:5000,account:'银行卡',category:'工资/月薪'},
    {id:'2',time:today,type:'transfer',amount:2400,from:'银行卡',to:'规划金'},
  ]));
  const bal=X.getCashBalances();
  ok('规划金账户余额=2400', Math.abs((bal['规划金']||0)-2400)<0.005, '实际 '+(bal['规划金']||0));
  ok('银行卡余额=2600', Math.abs((bal['银行卡']||0)-2600)<0.005, '实际 '+(bal['银行卡']||0));

  // 场外理财含规划金 → 纯理财
  H.localStorage.setItem('minis_invest_v1',JSON.stringify([
    {name:'场外-我',amount:8000,ours:true},
    {name:'场内-券商',amount:3000,ours:true},
  ]));
  const inv=X.gi();
  ok('理财账户读取正常', inv.length===2);
}

console.log('\n========== F. 对账 reconDerived ==========');
{
  H.localStorage.clear();
  H.localStorage.setItem('minis_bookkeeping_v5',JSON.stringify([
    {id:'1',time:'2026-10-01T12:00:00',type:'income',amount:1000,account:'微信',category:'其他'},
    {id:'2',time:'2026-10-02T12:00:00',type:'expense',amount:120,account:'微信',category:'餐饮'},
    {id:'3',time:'2026-10-03T12:00:00',type:'transfer',amount:200,from:'微信',to:'银行卡'},
  ]));
  const d=X.reconDerived();
  ok('微信账面 = 1000-120-200 = 680', Math.abs((d['微信']||0)-680)<0.005, '实际 '+(d['微信']||0));
  ok('银行卡账面 = 200', Math.abs((d['银行卡']||0)-200)<0.005, '实际 '+(d['银行卡']||0));
}

console.log('\n========== G. 分期总额守恒 ==========');
{
  H.localStorage.clear();
  // 直接模拟 saveTx 的分期算法（复刻逻辑）
  function split(a,periods){
    const base=Math.floor(a*100/periods)/100; let acc=0, out=[];
    for(let i=0;i<periods;i++){
      let amt; if(i===periods-1) amt=Math.round((a-acc)*100)/100; else {amt=base;acc+=base;}
      out.push(amt);
    }
    return out;
  }
  [[100,3],[100,7],[99.99,3],[1000,12],[0.03,2],[1,3]].forEach(([a,n])=>{
    const parts=split(a,n);
    const sum=parts.reduce((x,y)=>x+y,0);
    ok('分期 '+a+'÷'+n+' 总额守恒', Math.abs(sum-a)<0.005, '各期 '+parts.join('+')+'='+sum);
    ok('分期 '+a+'÷'+n+' 每期非负', parts.every(p=>p>=0), parts.join(','));
  });
}

console.log('\n========== H. 边界/异常输入不能崩 ==========');
{
  const weird=['', ' ', '。。。', '余额', '100', '¥', '¥¥¥', '支出', 'null', 'undefined', '😀💰100元😀'];
  let crashed=0;
  weird.forEach(t=>{
    try{ X.parseNotifFull(P(t)); X.looksLikePaymentText(t); X.findAmounts(t); }
    catch(e){ crashed++; console.log('  崩溃于「'+t+'」: '+e.message); }
  });
  ok('异常输入不崩溃', crashed===0, crashed+' 个输入导致异常');

  // 极大/极小数
  try{
    const r=X.parseNotifFull(P('消费999999999999.99元'));
    ok('超大金额不崩', true, r.length?('解析为 '+r[0].amount):'未解析');
  }catch(e){ ok('超大金额不崩',false,e.message); }
}

console.log('\n========== I. 收盘统计 ==========');
console.log('通过 '+pass+' / 失败 '+fail+' / 合计 '+(pass+fail));
if(fails.length){ console.log('\n失败清单:'); fails.forEach(f=>console.log('  ✗ '+f)); }
process.exit(fail?1:0);
