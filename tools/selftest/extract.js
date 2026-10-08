// 从 app.html 抽出 <script> 主体，生成可在 node 里跑的沙箱
const fs=require('fs');
const p=process.argv[2]||'/var/minis/shared/bookkeeping/app.html';
const html=fs.readFileSync(p,'utf8');
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m,chunks=[];
while((m=re.exec(html))) chunks.push(m[1]);
fs.writeFileSync('/var/minis/workspace/bkcheck/scripts.js',chunks.join('\n;\n'));
console.log('通过 <script> 块数:',chunks.length);
console.log('抽出的 JS 字符数:',chunks.join('\n').length);
