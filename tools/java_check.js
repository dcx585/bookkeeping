// java_check.js —— 扫描仓库里的 Android 原生源码结构
//
// ★ 为什么需要它：2026-11-15 之前 Java 源码塞在 build-apk.yml 的 heredoc 里，
//   由 heredoc_check.js 顺带检查花括号配平。现在源码搬进仓库真实文件，
//   那个针对 heredoc 的检查就等于空转（找不到 heredoc → 直接通过）。
//   门禁不能因为「搬家」而静默失效，所以检查能力必须跟着搬过来。
//
// 检查内容：
//   1. Java：花括号配平、字符串/字符字面量闭合（构建时才炸的那类错误）
//   2. Java：package 声明与所在目录一致（错包名在 CI 里同样要到编译才报）
//   3. 构建配置：settings.gradle 必须含 include ':app'，app/build.gradle 必须有签名配置
//   4. 版本号必须是环境变量注入，不能留 __VC__ 这类占位符（被谁忘了替换就发错版本）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, checked = 0;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── 1. Java 结构 ──
const javaFiles = walk(path.join(ROOT, 'app/src/main/java'), []).filter(f => f.endsWith('.java'));
if (!javaFiles.length) {
  console.log('  ❌ 找不到任何 .java 源码（app/src/main/java 是空的？）');
  fail = 1;
}
for (const f of javaFiles) {
  checked++;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);

  // 花括号 / 字符串配平
  let d = 0, inS = false, esc = false, inC = false, iL = false, iB = false, ln = 1, msg = '';
  for (let k = 0; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (c === '\n') { ln++; iL = false; continue; }
    if (iL) continue;
    if (iB) { if (c === '*' && n === '/') { iB = false; k++; } continue; }
    if (inS) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === '"') inS = false; continue; }
    if (inC) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === "'") inC = false; continue; }
    if (c === '/' && n === '/') { iL = true; k++; continue; }
    if (c === '/' && n === '*') { iB = true; k++; continue; }
    if (c === '"') { inS = true; continue; }
    if (c === "'") { inC = true; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d < 0) { msg = '第 ' + ln + ' 行多出一个 }'; break; } }
  }
  if (!msg && d !== 0) msg = '花括号不配平，差 ' + d;
  if (!msg && (inS || inC)) msg = '有未闭合的字符串/字符字面量';
  if (msg) { console.log('  ❌ ' + rel + ' 结构错误: ' + msg); fail = 1; }

  // package 与目录一致
  const pm = /^\s*package\s+([\w.]+)\s*;/m.exec(src);
  if (!pm) { console.log('  ❌ ' + rel + ' 没有 package 声明'); fail = 1; }
  else {
    const expect = path.dirname(rel).split(path.sep).slice(-pm[1].split('.').length).join('.');
    if (expect !== pm[1]) {
      console.log('  ❌ ' + rel + ' 的 package ' + pm[1] + ' 与目录不符（应为 ' + expect + '）');
      fail = 1;
    }
  }
}
if (javaFiles.length) console.log('  ' + javaFiles.length + ' 个 .java 结构/包名检查完成');

// ── 2. 构建配置 ──
const need = [
  ['settings.gradle', /include\s*['"]:app['"]/],
  ['app/build.gradle', /compileSdk\s+34/],
  ['app/build.gradle', /signingConfigs\s*\{/],
  ['app/build.gradle', /System\.getenv\("VERSION_NAME"\)/],
  ['app/src/main/AndroidManifest.xml', /<manifest/],
];
for (const [rel, re] of need) {
  if (!re) continue;
  checked++;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log('  ❌ 缺少 ' + rel); fail = 1; continue; }
  const txt = fs.readFileSync(p, 'utf8');
  if (!re.test(txt)) { console.log('  ❌ ' + rel + ' 内容不符合预期（' + re + '）'); fail = 1; }
}

// ── 3. 不许留版本占位符 ──
const gradleTxt = fs.readFileSync(path.join(ROOT, 'app/build.gradle'), 'utf8');
if (/__VC__|__VERSION__/.test(gradleTxt)) {
  console.log('  ❌ app/build.gradle 里还留着 __VC__/__VERSION__ 占位符');
  console.log('     → 版本号必须由 VERSION_NAME/VERSION_CODE 环境变量注入');
  fail = 1;
}

if (!fail) console.log('  ✓ ' + checked + ' 项原生源码/构建配置检查通过');process.exit(fail ? 1 : 0);
