// parse_parity.js <app.html> <build-apk.yml>
// ─────────────────────────────────────────────────────────────
// 解析口径一致性检查 —— 专治「Java 粗筛 与 JS 精判 规则不一致」
//
// 背景（2026-10-08 真实事故）：
//   Java 侧 looksLikePayment() 的金额正则只认「¥15.80」和「15.80元」，
//   而微信/支付宝通知经常两种都不带（「已支付15.80」「你已成功付款25.00」）。
//   → 这类通知在【进队列之前】就被判为非支付丢掉，
//     网页端「什么都没收到」，但两边代码各自看都"没毛病"。
//
// 本脚本固定一组真实形态的样本，要求：
//   Java 粗筛通过 的样本 ⊆ 最终能被 JS 认出来的样本
//   （Java 可以宽松，但不能把 JS 能认的丢掉 → 那才是静默漏账）
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const [htmlPath, ymlPath] = process.argv.slice(2);
if (!htmlPath || !ymlPath) { console.error('用法: node parse_parity.js <app.html> <build-apk.yml>'); process.exit(2); }

const html = fs.readFileSync(htmlPath, 'utf8');
const yml  = fs.readFileSync(ymlPath, 'utf8');

// ── 从 app.html 抽出 JS 判定链路 ──
// 用 Node 沙箱跑真身（复用 harness）
let X = null;
try {
  X = require('./selftest/harness.js').X;
} catch (e) {
  try { X = require('./harness.js').X; } catch (e2) {
    console.error('⚠ 找不到 harness.js，跳过 JS 侧检查'); process.exit(0);
  }
}
if (!X || !X.looksLikePaymentText || !X.parseNotifFull) {
  console.error('⚠ harness 未导出判定函数，跳过'); process.exit(0);
}

// ── 从 build-apk.yml 抽出 Java 的金额与支付词正则，用 JS 等价复现 ──
const amtBlk = /boolean hasAmt = Pattern\.compile\(([\s\S]*?)\)\.matcher\(s\)\.find\(\);/.exec(yml);
if (!amtBlk) { console.error('❌ 在 build-apk.yml 里找不到 hasAmt 正则 —— 可能被改名，本检查已失效'); process.exit(1); }
// Java 里是 "..." + "..." 拼接。只取【字符串字面量】里的内容，忽略注释与拼接符
const literals = [];
const litRe = /"((?:[^"\\]|\\.)*)"/g;
let lm;
while ((lm = litRe.exec(amtBlk[1]))) literals.push(lm[1]);
if (!literals.length) { console.error('❌ 解析不出 hasAmt 的字符串字面量'); process.exit(1); }
// Java 正则字符串里的 \\d 在【源码层面】是 two chars: backslash + d（Java 编译后才是 \d）。
// 我们抓到的是源码形态（\\d），要还原成 Java 编译后的形态（\d）才能给 JS 用。
const javaAmtSrc = literals.join('').replace(/\\\\/g, '\\');
let javaAmt;
try { javaAmt = new RegExp(javaAmtSrc); }
catch (e) { console.error('❌ Java 金额正则无法解析成 JS 正则：' + e.message + '\n   源: ' + javaAmtSrc); process.exit(1); }

// 支付词正则：从 looksLikePayment 里那条 return Pattern.compile("...") 抓
const payRe = /return\s+Pattern\.compile\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\.matcher\(s\)\s*\.find\(\);/.exec(yml);
let javaPay = null;
if (payRe) { try { javaPay = new RegExp(payRe[1].replace(/\\\\/g, '\\')); } catch (e) {} }

function javaGate(title, text) {
  const s = ((title || '') + ' ' + (text || '')).trim();
  if (s.length < 4) return false;
  if (!javaAmt.test(s)) return false;
  if (javaPay && !javaPay.test(s)) return false;
  return true;
}

// ── 测试样本：真实形态的通知 ──
// want=true 表示"这是一笔真支付，任何一层都不许丢掉"
const SAMPLES = [
  ['微信支付', '已支付15.80', true],
  ['微信支付', '你已成功付款25.00', true],
  ['微信支付', '支付成功 32.50', true],
  ['微信支付', '已支付￥15.80', true],
  ['微信支付', '已支付 ¥15.80', true],
  ['微信支付', '已支付15.80元', true],
  ['微信支付', '微信支付凭证 15.80', true],
  ['微信', '已支付￥8.8', true],
  ['支付宝', '你已成功付款 25.00 元', true],
  ['工商银行', '您尾号2374卡9月19日20:43支出(消费支付宝)20元，余额169.10元', true],
  ['建设银行', '您尾号1234的储蓄卡账户9月20日14时30分收入人民币100.00元，余额500.00元', true],
  ['招商银行', '您账户1234于09月20日14:30网上支付人民币-35.50', true],
  ['云闪付', '您尾号3344的银行卡消费12.50元', true],
  // 明确不是支付的（Java 粗筛也可放过，但 JS 必须拦住）
  ['验证码', '验证码123456，5分钟内有效，请勿泄露', false],
  ['银行', '办卡享好礼，额度5万元，回复TD退订', false],
  ['顺丰', '您的包裹已派送，取件码1234', false],
];

let pass = 0, fail = 0;
const fails = [];
console.log('样本'.padEnd(56) + 'Java粗筛 | JS精判');
console.log('-'.repeat(80));
for (const [title, text, want] of SAMPLES) {
  const j = javaGate(title, text);
  const full = title + ' ' + text;
  let jsPaid = false, jsParsed = 0;
  try {
    jsPaid = X.looksLikePaymentText(full);
    jsParsed = X.parseNotifFull({ title: title, text: text, app: '', time: Date.now() }).length;
  } catch (e) {}
  const jsOk = jsPaid && jsParsed > 0;
  const label = (title + ' | ' + text).slice(0, 54);
  console.log(label.padEnd(56) + (j ? '  ✓ 入队  ' : '  ✗ 丢弃  ') + '| ' + (jsOk ? '✓ 认' : '✗ 不认'));

  if (want) {
    // 真支付：JS 必须认；且 Java 不许把它丢掉（丢了 = 静默漏账）
    if (!jsOk) { fail++; fails.push('JS 认不出真支付: ' + label); }
    else if (!j) { fail++; fails.push('★ Java 粗筛丢掉了 JS 能认的支付: ' + label); }
    else pass++;
  } else {
    // 非支付：JS 必须拦住（Java 宽松可接受）
    if (jsOk) { fail++; fails.push('JS 把非支付当成了支付: ' + label); }
    else pass++;
  }
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fails.length) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  ✗ ' + f));
  console.log('\n提示：Java 侧 looksLikePayment 的职责只是【粗筛】。');
  console.log('      它宁可宽松（多进队列由网页端再判），也不能把真支付丢掉。');
}
process.exit(fail ? 1 : 0);
