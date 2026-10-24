/* v2 开关对比测试 —— 验证开关关闭时行为不变，开启时走新解析器 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app.html'), 'utf8');
const src = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/.exec(html)[1];

function loadWith(parseV2) {
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  };
  const mkNode = () => ({
    id: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _text: '', _html: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = v; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    value: '', onclick: null, children: [], parentNode: null,
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; },
    insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
    querySelector: () => mkNode(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 100, right: 100, width: 100, height: 100 }),
    getAttribute: () => null, setAttribute() {}, focus() {}, blur() {}, click() {},
  });
  const document = {
    getElementById: () => mkNode(), createElement: mkNode,
    querySelector: () => mkNode(), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    body: mkNode(), documentElement: mkNode(),
    visibilityState: 'visible', hidden: false, cookie: '',
  };
  const window = {
    document, localStorage, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    location: { href: '', reload() {} }, navigator: { userAgent: 'node' },
    alert: () => {}, confirm: () => true, prompt: () => '', console,
    PARSE_V2: parseV2,
  };
  window.window = window; window.globalThis = window;
  const sandbox = {
    window, document, localStorage, console,
    alert: () => {}, confirm: () => true, prompt: () => '',
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, navigator: { userAgent: 'node' },
    location: { href: '', reload() {} },
    screen: { orientation: { addEventListener() {}, type: 'portrait-primary', lock: () => Promise.resolve() } },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Set, Map,
    isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, Error, Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    src + '\n;globalThis.__X={parseNotifFull:(typeof parseNotifFull!=="undefined"?parseNotifFull:undefined),parseNoticeV2:(typeof parseNoticeV2!=="undefined"?parseNoticeV2:undefined)};',
    sandbox, { filename: 'app.js' }
  );
  return sandbox.__X;
}

let pass = 0, fail = 0; const fails = [];
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; fails.push({ name, msg: e.message }); }
}
function eq(a, b, l) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a));
}
function ok(c, l) { if (!c) throw new Error(l || '断言失败'); }

const OFF = loadWith(false);
const ON = loadWith(true);

// ═════ 1. 开关关闭：v2 函数存在但不生效 ═════
t('关闭时 parseNoticeV2 已注入但不会被调用', () => {
  ok(typeof OFF.parseNoticeV2 === 'function', 'v2 函数应已注入');
  ok(typeof OFF.parseNotifFull === 'function', '旧函数应存在');
});

// ═════ 2. 开关开启：走新解析器 ═════
const CASES = [
  { n: { title: '[48条]微信支付', text: '微信支付：已支付¥4.85', app: '微信' }, amount: 4.85, desc: '[48条]不误抓' },
  { n: { title: '微信支付', text: '已支付¥32.50', app: '微信' }, amount: 32.50, desc: '微信基本' },
  { n: { title: '支付宝', text: '你有一笔0.08元的支出，领1元红包', app: '支付宝' }, amount: 0.08, desc: '支付宝红包陷阱' },
  { n: { title: '银行', text: '您尾号1234的账户收入人民币8,500.00元', app: '银行' }, amount: 8500, desc: '银行千分位' },
];

for (const c of CASES) {
  t('开启后正确解析：' + c.desc, () => {
    const r = ON.parseNotifFull(c.n);
    ok(r.length >= 1, '应解析出至少 1 笔，实际 ' + r.length);
    eq(r[0].amount, c.amount, '金额');
    eq(r[0]._v2, true, '应标记 _v2');
  });
}

t('开启后微信带商户名能提取', () => {
  const r = ON.parseNotifFull({ title: '微信支付', text: '商户：瑞幸咖啡 已支付¥20.00', app: '微信' });
  ok(r.length >= 1);
  eq(r[0].merchant, '瑞幸咖啡');
});

t('开启后返回对象带 finger 字段（判重需要）', () => {
  const r = ON.parseNotifFull({ title: '微信支付', text: '已支付¥4.85', app: '微信' });
  ok(r.length >= 1);
  ok(r[0].finger !== undefined && r[0].finger !== null, 'finger 应存在');
});

t('开启后 needConfirm 字段透传', () => {
  const r = ON.parseNotifFull({ title: '银行', text: '您账户15:30支出人民币32.00元', app: '银行' });
  ok(r.length >= 1, '银行支出应被收下');
  eq(r[0].needConfirm, true, '银行支出应标 needConfirm');
});

// ═════ 3. 关闭时旧逻辑照常工作 ═════
t('关闭时旧逻辑仍能解析微信通知', () => {
  const r = OFF.parseNotifFull({ title: '微信支付', text: '已支付¥15.80', app: '微信' });
  ok(r.length >= 1, '旧逻辑应解析出 1 笔，实际 ' + r.length);
  eq(r[0].amount, 15.8);
});

t('关闭时旧逻辑不标 _v2', () => {
  const r = OFF.parseNotifFull({ title: '微信支付', text: '已支付¥15.80', app: '微信' });
  ok(r.length >= 1);
  ok(!r[0]._v2, '关闭时不应有 _v2 标记');
});

// ═════ 4. 安全性：畸形输入不抛异常 ═════
t('v2 解析畸形输入时不向外抛异常', () => {
  const weird = { title: null, text: undefined, app: null, time: 0 };
  let threw = false;
  try { ON.parseNotifFull(weird); } catch (e) { threw = true; }
  ok(!threw, '不应向外抛异常');
});

// ═════ 报告 ═════
console.log('v2 开关对比测试');
console.log('─'.repeat(50));
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fails.length) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f.name + '\n    ' + f.msg);
  process.exit(1);
} else {
  console.log('✅ 全部通过');
}
