/* 解析器 v2 测试 —— 用例全部来自 blue-whale-keeper 的真机踩坑记录 */
const P = require('/var/minis/shared/bookkeeping/js/parser_v2.js');

let pass = 0, fail = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    fails.push({ name, msg: e.message });
  }
}
function eq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((label || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a));
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || '断言失败'); }

// ════════ 1. 金额锚点：对方踩过的坑 ════════

t('[48条] 不能被当成 48 元', () => {
  const r = P.parseNoticeV2({
    title: '[48条]微信支付', text: '微信支付：已支付¥4.85', app: '微信'
  });
  ok(r.length === 1, '应解析出 1 笔，实际 ' + r.length);
  eq(r[0].amount, 4.85, '金额');
});

t('微信只认 ¥，抓第一个 ¥ 后的数', () => {
  const r = P.parseNoticeV2({ title: '微信支付', text: '已支付¥32.50', app: '微信' });
  eq(r[0].amount, 32.50);
});

t('支付宝认「元」，不被句尾红包带偏', () => {
  const r = P.parseNoticeV2({
    title: '支付宝', text: '你有一笔0.08元的支出，领1元红包', app: '支付宝'
  });
  eq(r[0].amount, 0.08, '应取第一个「数字+元」');
});

t('银行认「人民币」而非卡号', () => {
  const r = P.parseNoticeV2({
    title: '工商银行', text: '您尾号1234的账户收入人民币8,500.00元，余额9,000.00元', app: '工商银行'
  });
  eq(r.length, 1);
  eq(r[0].amount, 8500);
  eq(r[0].type, 'income');
});

t('千分位正确解析', () => {
  const r = P.parseNoticeV2({
    title: '银行', text: '收入人民币12,345.67元', app: '银行'
  });
  eq(r[0].amount, 12345.67);
});

t('余额类金额被排除', () => {
  const r = P.parseNoticeV2({
    title: '余额提醒', text: '账户余额 ¥1000.00', app: '微信'
  });
  eq(r.length, 0, '余额不该被当成交易');
});

t('电商认「实付」而非订单总额', () => {
  const r = P.parseNoticeV2({
    title: '淘宝', text: '订单金额¥299.00 红包抵扣¥20.00 实付¥279.00 支付成功', app: '淘宝'
  });
  eq(r[0].amount, 279.00, '应取实付金额');
});

// ════════ 2. 方向判断：转账/红包 ════════

t('「转账给张三」= 支出', () => {
  const d = P.detectDirection('微信支付：转账给张三 ¥100.00', 'WECHAT');
  eq(d, 'expense');
});

t('「张三向我转账」= 收入', () => {
  const d = P.detectDirection('张三向我转账 ¥100.00', 'WECHAT');
  eq(d, 'income');
});

t('收到红包 = 收入', () => {
  eq(P.detectDirection('收到张三的红包 ¥8.88', 'WECHAT'), 'income');
});

t('发出红包 = 支出', () => {
  eq(P.detectDirection('你向张三发出红包 ¥8.88', 'WECHAT'), 'expense');
});

t('「支付宝 | 20.00元」判不出方向应放弃', () => {
  // 品牌名里藏着「支付」，洗掉后无方向词 → null（不瞎猜）
  eq(P.detectDirection('支付宝 20.00元', 'ALIPAY'), null);
});

t('未来时态不进账', () => {
  eq(P.detectDirection('将于明日扣款 ¥30.00', 'WECHAT'), null);
});

t('收支词打架时放弃', () => {
  eq(P.detectDirection('已支付 ¥30.00，退款到账', 'WECHAT'), null);
});

// ════════ 3. 银行：只收收入 ════════

t('银行支出降级为待确认（不丢弃，避免漏掉自动续费）', () => {
  const r = P.parseNoticeV2({
    title: '招商银行', text: '您账户15:30支出人民币32.00元', app: '招商银行'
  });
  eq(r.length, 1, '应收下但标待确认');
  eq(r[0].needConfirm, true, '银行支出必须待确认');
  eq(r[0].amount, 32.00);
});

t('银行提现降级为待确认（自己账户转移）', () => {
  const r = P.parseNoticeV2({
    title: '银行', text: '提现人民币500.00元', app: '银行'
  });
  eq(r.length, 1);
  eq(r[0].needConfirm, true);
});

t('负数金额（人民币-35.50）能提取', () => {
  const r = P.parseNoticeV2({
    title: '尾号1234', text: '您账户1234于09月20日14:30网上支付人民币-35.50', app: ''
  });
  eq(r.length, 1, '应解析出 1 笔');
  eq(r[0].amount, 35.50, '负数应取绝对值');
});

t('工资到账被记录', () => {
  const r = P.parseNoticeV2({
    title: '银行', text: '代发工资收入人民币15,000.00元', app: '银行'
  });
  eq(r.length, 1);
  eq(r[0].type, 'income');
});

// ════════ 4. 商户名 ════════

t('从「商户：」提取商户名', () => {
  eq(P.extractMerchant('商户：瑞幸咖啡'), '瑞幸咖啡');
});

t('从「收款方：」提取', () => {
  eq(P.extractMerchant('收款方：沙县小吃'), '沙县小吃');
});

t('无商户名时返回空串', () => {
  eq(P.extractMerchant('已支付¥4.85'), '');
});

// ════════ 5. 来源识别 ════════

t('识别微信', () => eq(P.detectSource('已支付¥4.85', '微信'), 'WECHAT'));
t('识别支付宝', () => eq(P.detectSource('你有一笔支出', '支付宝'), 'ALIPAY'));
t('识别银行', () => eq(P.detectSource('收入人民币100元', '工商银行'), 'BANK'));
t('识别淘宝', () => eq(P.detectSource('支付成功', '淘宝'), 'TAOBAO'));

// ════════ 6. 诊断 ════════

t('诊断：微信无 ¥ 时说明原因', () => {
  const d = P.diagnoseNotice({ title: '微信', text: '你有一条新消息', app: '微信' });
  eq(d.ok, false);
  ok(d.reason.includes('¥'), '原因应提到 ¥，实际：' + d.reason);
});

t('诊断：银行支出说明去向', () => {
  const d = P.diagnoseNotice({ title: '银行', text: '支出人民币32.00元', app: '银行' });
  eq(d.ok, false);
  ok(d.reason.includes('重复'), '原因应提到重复，实际：' + d.reason);
});

t('诊断：正常微信通知 ok', () => {
  const d = P.diagnoseNotice({ title: '微信支付', text: '已支付¥4.85', app: '微信' });
  eq(d.ok, true);
});

// ════════ 7. 回归：确认不会误吞真实消费 ════════

t('同金额不同商户是两笔（供上层判重用）', () => {
  const a = P.parseNoticeV2({ title: '微信支付', text: '商户：瑞幸咖啡 已支付¥20.00', app: '微信' });
  const b = P.parseNoticeV2({ title: '微信支付', text: '商户：沙县小吃 已支付¥20.00', app: '微信' });
  ok(a[0].merchant !== b[0].merchant, '两笔商户名应不同');
});

t('商户名缺失时 confidence 降低', () => {
  const r = P.parseNoticeV2({ title: '微信支付', text: '已支付¥4.85', app: '微信' });
  eq(r[0].confidence, 0.6, '无商户应低置信');
});

t('有商户名时 confidence 高', () => {
  const r = P.parseNoticeV2({ title: '微信支付', text: '商户：瑞幸 已支付¥4.85', app: '微信' });
  eq(r[0].confidence, 0.9);
});

// ════════ 报告 ════════
console.log('解析器 v2 测试');
console.log('─'.repeat(50));
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fails.length) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f.name + '\n    ' + f.msg);
  process.exit(1);
} else {
  console.log('✅ 全部通过');
}
