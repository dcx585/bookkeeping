#!/usr/bin/env node
/* 静态检查：app.html 里所有内联事件（onclick/oninput/onchange…）引用的函数，
   必须在脚本里有定义。抓的是「改了 A 弄坏 B」里最隐蔽的一种：
   删掉/改名一个函数，但 onclick="fn(...)" 还留着 —— 页面不报错，
   点那一下才炸，而且往往只炸某个入口。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'app.html');
const html = fs.readFileSync(HTML, 'utf8');

// ── 1. 收集内联事件里调用的函数名 ──
const EVENT_ATTR = /\bon(?:click|input|change|submit|keyup|keydown|blur|focus|load)\s*=\s*"([^"]*)"/g;
// 也处理反引号模板里的 onclick（JS 里拼 HTML 的情况）
const EVENT_ATTR_TPL = /\bon(?:click|input|change)\s*=\s*[`"]([\s\S]*?)[`"]/g;

const callNames = new Set();
const IDENT_CALL = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;

function scanAttr(s){
  let m;
  IDENT_CALL.lastIndex = 0;
  while ((m = IDENT_CALL.exec(s))){
    const name = m[1];
    // 排除 JS 关键字和内建
    if (/^(if|for|while|return|typeof|new|function|switch|catch|delete|void|this|true|false|null|undefined|Math|Number|String|Boolean|Array|Object|JSON|Date|parseInt|parseFloat|isNaN|encodeURIComponent|decodeURIComponent|setTimeout|clearTimeout|confirm|alert|prompt|escape|unescape|atob|btoa)$/.test(name)) continue;
    callNames.add(name);
  }
}

let m;
while ((m = EVENT_ATTR.exec(html))) scanAttr(m[1]);

// ── 2. 收集脚本里定义的函数 ──
const scripts = [];
const SCRIPT_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let sm;
while ((sm = SCRIPT_RE.exec(html))) scripts.push(sm[1]);

const defined = new Set();
for (const src of scripts){
  // function foo(...)
  let d;
  const RE_FN = /\bfunction\s+([A-Za-z_$][\w$]*)/g;
  while ((d = RE_FN.exec(src))) defined.add(d[1]);
  // var foo = function / const foo = (...) => / let foo = async
  const RE_ASSIGN = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
  while ((d = RE_ASSIGN.exec(src))) defined.add(d[1]);
  // window.foo = ...
  const RE_WIN = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((d = RE_WIN.exec(src))) defined.add(d[1]);
}

// ── 3. 比对 ──
const missing = [...callNames].filter(n => !defined.has(n)).sort();

if (missing.length){
  console.log('✗ 有 ' + missing.length + ' 个内联事件引用的函数不存在：');
  // 给出每处所在的标签，方便定位
  for (const name of missing){
    const re = new RegExp('on(?:click|input|change)[^>]*?\\b' + name.replace(/\$/g,'\\$') + '\\s*\\(', 'g');
    const hit = re.exec(html);
    let where = '';
    if (hit){
      const before = html.slice(0, hit.index);
      where = ' 行 ' + (before.split('\n').length);
    }
    console.log('   · ' + name + where);
  }
  console.log('\n这些按钮/输入框点下去会静默失效（不报错，只是没反应）。');
  process.exit(1);
}

console.log('✓ 内联事件引用的 ' + callNames.size + ' 个函数全部有定义');
process.exit(0);
