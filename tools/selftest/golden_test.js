// ═════════════════════════════════════════════════════════════
// golden_test.js —— 金标准 / 快照回归测试（零依赖版）
//
// 核心思想（characterization test，特性测试）：
//   不去定义"什么是对的"，而是【把当前的实际行为录下来当基准】。
//   将来任何改动让录下来的输出变了，测试就红。
//   典型用法：
//     1) 首次（或行为确实该更新时）:  UPDATE_GOLDEN=1 node golden_test.js
//     2) 平时/CI               :  node golden_test.js
//
// 与普通单元测试的区别：
//   单元测试  = "我断言 parse('充值100元') === 100"  ← 写你【以为】的规则
//   特性测试  = "parse('充值100元') 现在返回 100，录下来，不许随便变"
//               ← 写它【实际】的行为，包含你没意识到的怪癖
//   所以特性测试能在你"以为自己在改进"时抓住副作用；单元测试抓不到
//   你没写断言的路径。两者都要，特性测试是"改 A 破 B"的主力。
//
// 为什么这里要自己实现而不用 jest：
//   jest 快照依赖 node_modules（本仓库没有），且 jest 的快照存成 .snap
//   二进制样式，diff 不直观。这里用「人类可读的 JSON」+ git diff 当快照
//   数据库，一份 golden.json 就是全部历史，git 版本管理天然可用。
// ═════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const GOLDEN = path.join(HERE, 'golden.json');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const H = require('./harness.js');       // 复用已有的沙箱（伪造 DOM/localStorage）
const X = H.X;

// ── 固定时间基准：快照最怕"每次跑都不一样"（时间戳/随机数/DOM 顺序）──
//    凡是喂给被测函数的输入，时间必须是常量。
const T = 1759900000000;                 // 固定毫秒时间戳
const _now = Date.now;
Date.now = () => T;                      // 冻住 clock，防止 snapshot 漂移

function P(text, extra) {
  return Object.assign({ title: '', text: text, app: '', time: T }, extra || {});
}

// ═══ 录制区：每个条目 = 一组输入 → 一份输出指纹 ═══
const actual = {};

// ── 1. 金额解析：各银行/支付 App 的真实措辞（含易错边界）──
actual.parseAmount = [
  '尾号2374卡9月19日20:43支出(消费支付宝-杭州深度求索…)20元，余额169.10元',
  '您尾号1234的储蓄卡账户9月20日14时30分收入人民币100.00元，余额500.00元',
  '微信支付：已支付¥15.80',
  '【云闪付】您尾号3344的银行卡消费12.50元',
  '您账户1234于09月20日14:30网上支付人民币-35.50',
  '您尾号2374卡充值话费100.00元',
  '缴费成功200.00元',
  '您已成功充值100.00元',
].map(t => ({ in: t, out: X.parseNotifFull(P(t)).map(r => r.amount) }));

// ── 2. 非支付必须被剔除（验证码/营销/余额提醒混进来是最常见的"新污染"）──
actual.rejectNonPayment = [
  '【建设银行】验证码 123456，请勿告诉他人',
  '【淘宝】您的订单已发货',
  '您尾号1234卡余额169.10元',
  '微信支付：您有一笔待付款',
].map(t => ({ in: t, out: X.parseNotifFull(P(t)).length }));

// ── 3. 面额/实付合并矩阵（这就是"196 元"那个 bug 的现场）──
function mk(o) { return Object.assign({ type: 'expense', category: '话费', account: '', _src: 'sms', _time: T }, o); }
const mergeCases = [
  ['标准',           mk({ amount: 100, note: '您已成功充值100.00元', _boxKey: 'a' }), mk({ amount: 96, note: '尾号2374卡支出96.00元', account: '银行卡', _boxKey: 'b', _time: T + 60000 })],
  ['充值带银行卡',   mk({ amount: 100, note: '您已成功充值100.00元', account: '银行卡', _boxKey: 'c' }), mk({ amount: 96, note: '尾号2374卡支出96.00元', account: '银行卡', _boxKey: 'd', _time: T + 60000 })],
  ['银行措辞弱',     mk({ amount: 100, note: '已成功充值100.00元', _boxKey: 'e' }), mk({ amount: 96, note: '您9月19日支出96.00元', _boxKey: 'f', _time: T + 60000 })],
  ['小折扣99→96',    mk({ amount: 99, note: '已成功充值99.00元', _boxKey: 'g' }), mk({ amount: 96, note: '尾号2374卡支出96.00元', account: '银行卡', _boxKey: 'h', _time: T + 60000 })],
  ['折扣过大不合并', mk({ amount: 100, note: '已成功充值100.00元', _boxKey: 'i' }), mk({ amount: 30, note: '尾号2374卡支出30.00元', account: '银行卡', _boxKey: 'j', _time: T + 60000 })],
  ['超窗不合并',     mk({ amount: 100, note: '充值100元', _boxKey: 'k' }), mk({ amount: 96, note: '尾号2374卡支出96.00元', account: '银行卡', _boxKey: 'l', _time: T + 20 * 60 * 1000 })],
];
actual.mergePool = mergeCases.map(([n, a, b]) => ({
  in: n,
  正序: X.mergePool([a, b]).map(x => x.amount).join('+'),
  逆序: X.mergePool([b, a]).map(x => x.amount).join('+'),   // ★ 顺序无关性：逆序必须同结果
}));

// ── 4. 识别函数互斥性（isRechargeItem × isBankItem 不得同时为真）──
actual.mutualExclusive = [
  ['已成功充值100.00元', ''],
  ['尾号2374卡充值话费100.00元', '银行卡'],
  ['尾号2374卡支出96.00元', '银行卡'],
  ['您9月19日支出96.00元', ''],
  ['缴费成功200元', ''],
  ['您已成功付款25.00元', '微信'],
].map(([n, a]) => ({
  in: n,
  互斥: !(X.isRechargeItem(mk({ amount: 100, note: n, account: a })) && X.isBankItem(mk({ amount: 100, note: n, account: a }))),
}));

// ── 5. 幂等性/去重：同一条通知重复喂进去，绝不能变两条 ──
{
  H.localStorage.clear();
  const one = P('微信支付：已支付¥15.80');
  const first = X.parseNotifFull(one).length;
  const again = X.parseNotifFull(one).length;
  actual.duplicateFeed = { 第一次: first, 第二次: again, 幂等: first === again };
}

// ── 6. 空/畸形输入不得抛异常（历史上"数据一坏整个页面白屏"）──
actual.robustness = [
  null, '', '   ', '{}', '[]', 'NaN', '金额：元', '￥', '1e999',
].map(v => {
  let ok = true, n = -1;
  try { n = X.parseNotifFull(P(v == null ? '' : String(v))).length; }
  catch (e) { ok = false; }
  return { in: String(v), 不抛异常: ok, 条数: n };
});

// ═══ 比对区 ═══
Date.now = _now;   // 恢复真实 clock

const cur = JSON.stringify(actual, null, 1) + '\n';

if (UPDATE || !fs.existsSync(GOLDEN)) {
  fs.writeFileSync(GOLDEN, cur);
  const n = Object.keys(actual).length;
  console.log((UPDATE ? '已更新' : '首次生成 ') + '金标准: ' + GOLDEN + '（' + n + ' 组）');
  console.log('提示: 审一遍 tools/golden.json 再提交，它就是"当前行为的合同"');
  process.exit(0);
}

const old = fs.readFileSync(GOLDEN, 'utf8');
if (old === cur) {
  console.log('✓ 金标准一致 —— 行为没有发生任何意外变化');
  process.exit(0);
}

// ── 不一致：输出人类可读的 diff。这是最有信息量的地方 ──
console.log('❌ 金标准不一致 —— 有行为被改变了：\n');
const a = JSON.parse(old), b = actual;
const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
let diffs = 0;
for (const k of keys) {
  const sa = JSON.stringify(a[k]), sb = JSON.stringify(b[k]);
  if (sa === sb) continue;
  diffs++;
  console.log('  ● ' + k);
  const la = JSON.stringify(a[k], null, 1).split('\n');
  const lb = JSON.stringify(b[k], null, 1).split('\n');
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) {
      if (la[i] !== undefined) console.log('      - ' + la[i]);
      if (lb[i] !== undefined) console.log('      + ' + lb[i]);
    }
  }
}
console.log('\n  共 ' + diffs + ' 组行为发生变化。');
console.log('  ⇒ 如果这是【故意的改进】：确认无副作用后跑');
console.log('       UPDATE_GOLDEN=1 node tools/selftest/golden_test.js');
console.log('       然后把 git diff tools/selftest/golden.json 当成 code review 逐行看。');
console.log('  ⇒ 如果这是【意外的副作用】：你刚刚抓到了一个「改 A 弄坏 B」。');
process.exit(1);
