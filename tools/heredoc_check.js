// heredoc_check.js <workflow.yml>
// 检查 GitHub Actions workflow 里内嵌 heredoc 的两类致命问题：
//   1. 内容行顶格（缩进 <= cat 行）→ 逃出 run: 块 → 整个 YAML 变非法 → workflow 静默不执行
//   2. 抽出的 .java 源码花括号不配平 / 有未闭合字符串 → 构建时才炸，本地看不见
const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('用法: node heredoc_check.js <workflow.yml>'); process.exit(2); }
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

let fail = 0, nh = 0;
//   <indent>cat > <path> << 'TAG'
const CAT = /^([ \t]*)cat > (\S+) << ['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*$/;

for (let i = 0; i < lines.length; i++) {
  const m = CAT.exec(lines[i]);
  if (!m) continue;
  nh++;
  const blockIndent = m[1].length;
  const file = m[2], tag = m[3];
  // YAML 块标量的缩进以【第一条非空内容行】为准（不要求内容比 cat 行更深）
  const CONTENT_INDENT = lines[i + 1] !== undefined && lines[i + 1].trim() !== ''
    ? lines[i + 1].match(/^[ \t]*/)[0].length
    : blockIndent + 1;

  let end = -1;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (new RegExp('^[ \\t]*' + tag + '[ \\t]*$').test(lines[j])) { end = j; break; }
    body.push([j + 1, lines[j]]);
  }
  if (end < 0) { console.log('  ❌ ' + file + ' 的 heredoc 没有结束标记 ' + tag); fail = 1; continue; }

  // ── 检查 1：非空内容行缩进必须 >= CONTENT_INDENT ──
  //   低于它 → 该行在 YAML 里跳出块标量 → 整个 workflow 变成非法 YAML
  //   → GitHub 拒绝加载 → 静默不构建（比构建失败更危险：没有任何通知）
  const escaped = body.filter(([, l]) => l.trim() !== '' && l.match(/^[ \t]*/)[0].length < CONTENT_INDENT);
  if (escaped.length) {
    console.log('  ❌ ' + file + '：' + escaped.length + ' 行缩进<' + CONTENT_INDENT + '，会跳出 run: 块');
    escaped.slice(0, 5).forEach(([ln, l]) => console.log('       第' + ln + '行: ' + JSON.stringify(l.slice(0, 72))));
    console.log('       → workflow 变成非法 YAML，GitHub 直接拒绝加载（不会有失败通知）');
    fail = 1;
  }

  // ── 检查 2：Java 源码结构 ──
  if (!/\.java$/.test(file)) continue;
  const inds = body.filter(([, l]) => l.trim()).map(([, l]) => l.match(/^[ \t]*/)[0].length);
  const ind = inds.length ? Math.min.apply(null, inds) : 0;
  const src = body.map(([, l]) => l.slice(ind)).join('\n');

  let d = 0, inS = false, esc = false, inC = false, iL = false, iB = false, ln2 = 1, msg = '';
  for (let k = 0; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (c === '\n') { ln2++; iL = false; continue; }
    if (iL) continue;
    if (iB) { if (c === '*' && n === '/') { iB = false; k++; } continue; }
    if (inS) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === '"') inS = false; continue; }
    if (inC) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === "'") inC = false; continue; }
    if (c === '/' && n === '/') { iL = true; k++; continue; }
    if (c === '/' && n === '*') { iB = true; k++; continue; }
    if (c === '"') { inS = true; continue; }
    if (c === "'") { inC = true; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d < 0) { msg = '第' + ln2 + '行多出一个 }'; break; } }
  }
  if (!msg && d !== 0) msg = '花括号不配平，差 ' + d;
  if (!msg && (inS || inC)) msg = '有未闭合的字符串/字符字面量';
  if (msg) { console.log('  ❌ ' + file + ' 结构错误: ' + msg); fail = 1; }
}

if (nh === 0) console.log('  ⚠ 没有找到 heredoc');
else if (!fail) console.log('  ✓ ' + nh + ' 个 heredoc 缩进/结构检查通过');
process.exit(fail ? 1 : 0);
