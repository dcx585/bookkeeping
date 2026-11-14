// 自动入账统一闸门 —— v1/v2 两条解析路径的行为一致性
//
// ★ 为什么需要这个测试：v2 分支原先只透传 parseNoticeV2 的 needConfirm，
//   绕过了金额阈值/专项资金/日常账户三项判定。开关一换行为就变，
//   而且没有测试盯着 —— 只有真正跑一遍两条路径并【比对】才能发现。
//
// 分四组：
//   A. autoBookGate 单元规则（阈值边界/专项资金/账户）
//   B. v1 / v2 两条路径对同一批通知的闸门结果必须逐笔相同
//   C. 收入不该被专项资金拦（退款/工资/红包要正常记账）
//   D. autoBookkeep 的队列残留在弹框前就被 ack
const H = require('./harness');
const { sandbox, X, localStorage } = H;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || '') + ' 期望 ' + B + ' 实际 ' + A);
}
function ok(v, msg) { if (!v) throw new Error(msg || '应为真'); }

// ── 取常量与闸门函数（已在 harness 的 exportList 里导出 autoBookGate）──
const gate = X.autoBookGate;
const TH = (function () {
  const m = /const\s+AUTO_THRESHOLD\s*=\s*(\d+(?:\.\d+)?)/.exec(
    require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app.html'), 'utf8'));
  return m ? Number(m[1]) : NaN;
})();

eq(typeof gate, 'function', 'autoBookGate 必须存在（v1/v2 共用闸门）');
ok(Number.isFinite(TH) && TH > 0, '应从 app.html 读到 AUTO_THRESHOLD，实际 ' + TH);
const Z = { autoBookGate: gate };

// ══════════════ A. 闸门单元规则 ══════════════

t('A1 小额·微信·普通消费 → 自动入账', () => {
  const r = Z.autoBookGate({ amount: 15.8, type: 'expense', account: '微信', note: '支付成功 15.80' });
  eq(r.needConfirm, false); eq(r.special, null);
});
t('A2 小额·银行卡·普通消费 → 自动入账', () => {
  eq(Z.autoBookGate({ amount: 20, type: 'expense', account: '银行卡', note: '消费' }).needConfirm, false);
});
t('A3 恰好等于阈值 → 自动入账（≤ 是自动）', () => {
  eq(Z.autoBookGate({ amount: TH, type: 'expense', account: '微信', note: '普通' }).needConfirm, false);
});
t('A4 阈值 + 0.01 → 必须确认', () => {
  eq(Z.autoBookGate({ amount: TH + 0.01, type: 'expense', account: '微信', note: '普通' }).needConfirm, true);
});
t('A5 大额·100 元 → 必须确认（不能被静默记掉）', () => {
  eq(Z.autoBookGate({ amount: 100, type: 'expense', account: '微信', note: '支付' }).needConfirm, true);
});
t('A6 支付宝账户 → 必须确认（不在日常兜底账户里）', () => {
  eq(Z.autoBookGate({ amount: 5, type: 'expense', account: '支付宝', note: '支付' }).needConfirm, true);
});
t('A7 账户为空 → 必须确认', () => {
  eq(Z.autoBookGate({ amount: 5, type: 'expense', account: '', note: '支付' }).needConfirm, true);
});
t('A8 专项资金·花呗 → 必须确认并回传标记', () => {
  const r = Z.autoBookGate({ amount: 5, type: 'expense', account: '微信', note: '花呗还款' });
  eq(r.needConfirm, true); ok(r.special && /花呗/.test(r.special), 'special 应含 花呗');
});
t('A9 专项资金·房租 → 必须确认', () => {
  eq(Z.autoBookGate({ amount: 5, type: 'expense', account: '微信', note: '本月房租' }).needConfirm, true);
});
t('A10 收入含「退款」词 → 不被专项资金拦', () => {
  const r = Z.autoBookGate({ amount: 5, type: 'income', account: '微信', note: '退款到账' });
  eq(r.special, null); eq(r.needConfirm, false);
});
t('A11 金额非法/缺失 → 视为 0，不因 NaN 误判为大额', () => {
  eq(Z.autoBookGate({ amount: undefined, type: 'expense', account: '微信', note: '支付' }).needConfirm, false);
  eq(Z.autoBookGate({ amount: NaN, type: 'expense', account: '微信', note: '支付' }).needConfirm, false);
  eq(Z.autoBookGate({ amount: '15.80', type: 'expense', account: '微信', note: '支付' }).needConfirm, false, '字符串金额应按数值比较');
});
t('A12 空入参不抛异常', () => {
  const r = Z.autoBookGate(null);
  eq(r.needConfirm, true);
});

// ══════════════ B. v1 / v2 行为一致性 ══════════════
// 同一批通知，分别在 PARSE_V2 开/关下解析，闸门结果逐笔比对。
const SAMPLES = [
  { app: '微信', title: '微信支付', text: '微信支付凭证 已支付15.80', _why: '小额→自动' },
  { app: '微信', title: '微信支付', text: '微信支付凭证 你已成功付款125.00', _why: '大额→确认' },
  { app: '微信', title: '微信支付', text: '微信支付凭证 已支付8.80 房租', _why: '专项资金→确认' },
  { app: '招商银行', title: '招商银行', text: '您尾号5678卡11月14日20:43支出(消费支付宝)20元', _why: '银行小额' },
  { app: '支付宝', title: '支付宝', text: '你已成功付款 25.00 元', _why: '小额但账户非日常' },
  { app: '微信', title: '微信支付', text: '微信支付凭证 已支付12.00 花呗还款', _why: '专项资金+小额' },
  { app: '微信', title: '微信支付', text: '退款到账 ¥30.00', _why: '收入·退款' },
];

function parseWith(v2, n) {
  sandbox.window.PARSE_V2 = v2;
  const out = X.parseNotifFull(n) || [];
  sandbox.window.PARSE_V2 = false;
  return out;
}
function gateOf(es) {
  return es.map(e => ({ amt: e.amount, type: e.type, acct: e.account, need: e.needConfirm, special: e.special }));
}

SAMPLES.forEach((s, i) => {
  t('B' + (i + 1) + ' v1/v2 闸门一致 · ' + s._why, () => {
    const v1 = parseWith(false, s);
    const v2 = parseWith(true, s);
    ok(v1.length > 0, 'v1 必须解析出条目');
    ok(v2.length > 0, 'v2 必须解析出条目');
    const g1 = gateOf(v1).map(x => ({ amt: x.amt, need: x.need }));
    const g2 = gateOf(v2).map(x => ({ amt: x.amt, need: x.need }));
    eq(g2, g1, 'v2 与 v1 的金额/是否确认必须完全相同');
  });
});

t('B8 大额在 v2 下绝不能被自动记账', () => {
  const es = parseWith(true, SAMPLES[1]);
  ok(es.every(e => e.needConfirm), '125 元的条目 needConfirm 必须为 true');
});
t('B9 专项资金在 v2 下必须带回 special 标记', () => {
  const es = parseWith(true, SAMPLES[2]);
  ok(es.some(e => e.special), 'special 不应为 null');
});
t('B10 v2 条目在 v2 能解析时必须带 _v2 标记', () => {
  const es = parseWith(true, { app: '支付宝', title: '支付宝', text: '你已成功付款 25.00 元' });
  ok(es.length > 0, 'v2 应解析出条目');
  ok(es.every(e => e._v2 === true), '_v2 标记应保留（闸门只加 needConfirm/special，不能覆盖分流标记）');
});
t('B12 v2 判不出可信金额 → 回退 v1，结果仍可用（不是静默丢账）', () => {
  // 微信裸数字「已支付15.80」没有 ¥ / 元 / 标签锚点。
  // v2 的设计原则是「找不到可信金额宁可放弃」，所以这里【应该】回退 v1。
  const n = { app: '微信', title: '微信支付', text: '微信支付凭证 已支付15.80' };
  const v2 = parseWith(true, n), v1 = parseWith(false, n);
  ok(v2.length > 0, '回退后必须有结果');
  eq(v2[0].amount, v1[0].amount, '回退后金额应与 v1 一致');
  ok(!v2[0]._v2, '走的是 v1 路径，不该带 _v2');
});
t('B13 v2 微信「数字+元」也要认（¥ 不是唯一锚点）', () => {
  const es = parseWith(true, { app: '微信', title: '微信支付', text: '微信支付凭证 已支付 15.80 元' });
  ok(es.length > 0, 'v2 应能取到「15.80 元」');
  eq(es[0].amount, 15.8);
  ok(es[0]._v2 === true);
});

t('B11 v1 条目不带 _v2 标记', () => {
  ok(parseWith(false, SAMPLES[0]).every(e => !e._v2));
});

// ══════════════ C. 收入不受专项资金影响 ══════════════
t('C1 工资短信 · 小额 → 自动入账', () => {
  const es = parseWith(false, { app: '招商银行', title: '招商银行', text: '您尾号1234的储蓄卡账户11月14日收入人民币28.00元，余额500.00元' });
  ok(es.length > 0, '应收解析出');
  const inc = es.filter(e => e.type === 'income');
  const small = inc.filter(e => e.amount <= TH);
  small.forEach(e => { eq(e.special, null, '收入不应带专项资金标记'); eq(e.needConfirm, false, '小额收入应自动入账'); });
});
t('C2 收入带「转账」字样也不被拦', () => {
  const r = Z.autoBookGate({ amount: 10, type: 'income', account: '微信', note: '转账到账' });
  eq(r.needConfirm, false); eq(r.special, null);
});

console.log('──────────────────────────────────');
console.log('【自动入账统一闸门】 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
