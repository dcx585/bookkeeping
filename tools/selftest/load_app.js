// load_app.js —— 按 app.html 里的顺序，收集它所有的 JS（外链 + 内联）
//
// ★ 2026-11-15 拆分后：app.html 不再内联脚本，改成
//   <script src="js/01-splash.js"></script> … 共 15 个。
//   所有原本「抽 <script> 块」的地方都必须走这个函数，
//   否则会只拿到第一个空块，测试静默变成 0 项（假绿）。
//
// 返回：{ src, files }  —— src 是拼接后的完整源码，files 是加载顺序的文件名
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadApp(htmlPath) {
  const appPath = htmlPath || path.join(ROOT, 'app.html');
  const html = fs.readFileSync(appPath, 'utf8');
  const baseDir = path.dirname(appPath);
  const files = [];
  const chunks = [];

  const re = /<script(?:\s([^>]*))?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const sm = /\bsrc\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (sm) {
      const rel = sm[1];
      const p = path.resolve(baseDir, rel);
      if (!fs.existsSync(p)) {
        // 缺文件必须炸出来：否则测试会拿半套代码跑，看起来还是绿的
        throw new Error('app.html 引用了不存在的脚本：' + rel);
      }
      files.push(rel);
      chunks.push(fs.readFileSync(p, 'utf8'));
    } else {
      if (m[2].trim()) {
        files.push('(inline)');
        chunks.push(m[2]);
      }
    }
  }

  if (!chunks.length) throw new Error('app.html 里没有任何脚本，结构改坏了？');
  // 与浏览器一致：多个 classic script 共享全局词法环境，按顺序拼接即可等价复现
  return { src: chunks.join('\n;\n'), files };
}

module.exports = { loadApp, ROOT };
