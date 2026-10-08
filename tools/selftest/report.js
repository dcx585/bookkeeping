// 记账App 自检报告 —— 完整测试（含高危场景）
const H=require('./harness.js');
const X=H.X;
let bug=[], risky=[], good=[];
function B(t,d){bug.push([t,d])}
function R(t,d){risky.push([t,d])}
function G(t){good.push(t)}

const t0=Date.now();
function mk(o){return Object.assign({type:'expense',category:'话费',account:'',_src:'sms'},o)}

// ── BUG-1 面额/实付配对失败 → 196 重复记账（用户亲历的那个） ──
{
  const a=mk({amount:100,note:'您已成功充值100.00元',account:'银行卡',_boxKey:'a',_time:t0});
  const b=mk({amount:96,note:'尾号2374卡支出96.00元',account:'银行卡',_boxKey:'b',_time:t0+60000});
  const m1=X.mergePool([a,b]);
  const c=mk({amount:100,note:'已成功充值100.00元',account:'',_boxKey:'c',_time:t0});
  const d=mk({amount:96,note:'您9月19日支出96.00元',account:'',_boxKey:'d',_time:t0+60000});
  const m2=X.mergePool([c,d]);
  if(m1.length!==1 || m2.length!==1){
    B('BUG-1 面额/实付识别失败导致重复记账',
      '充值短信带"银行卡"时 isRechargeItem=false；银行短信措辞弱时 isBankItem=false → 配不上对 → 记成 196。'
      +' 复现：场景A=' + JSON.stringify(m1.map(x=>x.amount)) + '，场景B=' + JSON.stringify(m2.map(x=>x.amount))
      +'。根因：mergePool 的排序把银行项排前才碰巧合并（探针已证：去掉 sort 就变 [100]），'
      +'这是【运气】不是【保证】。');
  } else G('面额/实付配对在标准场景下工作');
}

// ── BUG-2 服务端队列正则解析遇 {} 断裂 ──
{
  const re=/\{[^\{\}]*\}/g;
  const bad='[{"id":"b1","nkey":"n1","text":"【建行】客户{张}消费96元"},{"id":"b2","nkey":"n2","text":"充值100元"}]';
  let arr=[],m; while((m=re.exec(bad))) arr.push(m[0]);
  const withId=arr.filter(o=>/"id":"([^"]+)"/.test(o));
  if(withId.length!==2){
    B('BUG-2 通知队列用正则提取JSON，正文含花括号即断裂',
      'NotificationReaderService.queueAck 用 Pattern "\\\\{[^\\\\{\\\\}]*\\\\}" 提取对象；'
      +'通知正文含 { 或 } 时该条被切成碎片、丢失 id → 永远 ack 不掉 → 队列残留、待处理框反复出现同一笔。'
      +' 实测：2 条队列只提取出 ' + withId.length + ' 条可用对象。');
  } else G('队列正则提取稳定');
}

// ── BUG-3 dead code：parseNotif 已删但可能残留调用 ──
{
  let defined=false;
  try{ defined = typeof X.parseNotif!=='undefined' && X.parseNotif!==undefined; }catch(e){}
  if(!defined) R('旧函数 parseNotif 已被 parseNotifFull 取代，确认无残留调用');
}

// ── 其他检查 ──
{
  // 时间不可比时 isAlreadyBooked 放宽 → 可能误判已入账
  H.localStorage.clear();
  H.localStorage.setItem('minis_bookkeeping_v5',JSON.stringify([
    {id:'1',time:'2026-10-01T12:00:00',type:'expense',amount:96,account:'',category:'其他'}
  ]));
  const noTime=mk({amount:96,note:'充值96元',account:'',_boxKey:'z'});
  if(X.isAlreadyBooked(noTime)) {
    R('isAlreadyBooked 在无时间戳时"放宽为匹配"（near() 返回 true）',
      '同一金额的历史记录会被当成"已入账"→ 新发生的同额消费可能被静默吞掉。');
  }
}

// ── 输出 ──
console.log('\n══════════ 记账App 自检结果 ══════════\n');
console.log('🔴 确认的 Bug（' + bug.length + '）');
bug.forEach(([t,d],i)=>{ console.log('\n  ' + (i+1) + '. ' + t); console.log('     ' + d); });
console.log('\n🟡 风险点（' + risky.length + '）');
risky.forEach(([t,d],i)=>{ console.log('\n  ' + (i+1) + '. ' + t); console.log('     ' + d); });
console.log('\n🟢 通过（' + good.length + '）');
good.forEach(t=>console.log('  ✓ ' + t));
console.log('\n═══════════════════════════════════');
