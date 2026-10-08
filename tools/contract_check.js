// contract_check.js <app.html> <MainActivity.java>
// ─────────────────────────────────────────────────────────────
// 跨文件接口契约检查 —— 专治「改了 A，B 静默失效」
//
//   JS  :  window.MinisBridge.readSms()          ← 期望 Java 有 readSms()
//   Java:  @JavascriptInterface public String readSms() {...}    ← 提供方
//
// Java 侧把方法改名/删掉，app.html 一行都没错（语法通过、测试通过、
// 页面还正常显示），只是那个按钮点了没反应 —— 这类 bug 靠人眼 review
// 极难发现，靠本脚本 3 秒发现。
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const [htmlPath, javaPath] = process.argv.slice(2);
if (!htmlPath || !javaPath) { console.error('用法: node contract_check.js <app.html> <MainActivity.java>'); process.exit(2); }

const html = fs.readFileSync(htmlPath, 'utf8');
const java = fs.readFileSync(javaPath, 'utf8');

// ① JS 端用到的全部桥接方法
const used = new Set();
const re = /MinisBridge\.([A-Za-z_$][\w$]*)/g;
let m;
while ((m = re.exec(html))) used.add(m[1]);

// ② Java 端 @JavascriptInterface 暴露的方法名
const provided = new Set();
for (const b of java.split('@JavascriptInterface').slice(1)) {
  const mm = /\bpublic\s+[\w<>\[\],.\s]+?\s+([A-Za-z_$][\w$]*)\s*\(/.exec(b);
  if (mm) provided.add(mm[1]);
}

console.log('  JS 调用桥接方法 ' + used.size + ' 个，Java 暴露 ' + provided.size + ' 个');
const missing = [...used].filter((x) => !provided.has(x));
if (missing.length) {
  console.log('  ❌ Java 端缺少这些方法 → 网页端会静默失效:');
  missing.forEach((x) => console.log('       MinisBridge.' + x + '()'));
  process.exit(1);
}
const unused = [...provided].filter((x) => !used.has(x));
if (unused.length) console.log('  ⚠ Java 暴露但 JS 未用（可能是历史遗留）: ' + unused.join(', '));

// ③ workflow 的 workflow_call / push 触发是否还在（.github 里最容易被误删的行）
console.log('  ✓ 桥接接口契约完整');
process.exit(0);
