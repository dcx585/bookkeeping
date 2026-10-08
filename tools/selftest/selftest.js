// 全量自检 v3 —— 汇总所有测试，输出最终报告
// ★ 关键设计：用【退出码】判定成败，不用解析 stdout 文本。
//   老版本靠正则抓 "通过 N / 失败 M"，结果是 golden_test 这种
//   "输出里没有那几个字"的测试会被静默算成 0/0（假绿 = 门禁失效）。
const { spawnSync } = require('child_process');
console.log('\n');
console.log('╔══════════════════════════════════════════════╗');
console.log('║        记账App 代码自检 —— 最终报告          ║');
console.log('╚══════════════════════════════════════════════╝');
const runs = [
  ['逻辑测试（解析/合并/对账/分期/边界）', 'logic_test.js'],
  ['回归测试（本轮修复的3个bug + 防误吞）', 'regress.js'],
  ['金标准快照（任何意外行为变化都会红）', 'golden_test.js'],
];

let failed = 0;
const rows = [];
for (const [name, f] of runs) {
  const r = spawnSync('node', [f], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const code = r.status === null ? 99 : r.status;

  // 有具体计数的就展示，没有的就靠退出码
  const m = /(?:通过|回归 通过)\s*(\d+)\s*\/\s*失败\s*(\d+)/.exec(out);
  let detail;
  if (m) {
    detail = '通过 ' + m[1] + ' / 失败 ' + m[2];
    if (+m[2] > 0) failed++;
  } else {
    detail = code === 0 ? '✓ 一致' : '✗ 有变化/失败';
  }
  if (code !== 0) {
    failed++;
    console.log('\n【' + name + '】 ❌ 失败（exit ' + code + '）');
    // 失败时把该测试的真实输出全打出来 —— 这是最有价值的信息
    out.split('\n').slice(0, 40).forEach(l => console.log('    ' + l));
  } else {
    console.log('\n【' + name + '】 ' + detail);
  }
  rows.push([name, detail, code]);
}

// ★ 元检查：测试套件本身是否还有牙
//   如果某个测试文件被改成永远 exit 0（"为了让 CI 过"），
//   这里的"故意注入失败"会抓不到 → 门禁已经变成装饰品。
const meta = require('fs').readFileSync('golden_test.js', 'utf8');
if (!/process\.exit\(1\)/.test(meta)) {
  console.log('\n❌ 元检查失败: golden_test.js 不再以 exit 1 报告不一致 → 门禁已失效');
  failed++;
}
if (!/existsSync|golden\.json/.test(meta)) {
  console.log('\n❌ 元检查失败: golden_test.js 不再读取 golden.json');
  failed++;
}

console.log('\n──────────────────────────────────────────────');
if (failed) {
  console.log('结果：❌ ' + failed + ' 项失败');
  console.log('──────────────────────────────────────────────');
  process.exit(1);
}
console.log('结果：✅ 全部通过');
console.log('──────────────────────────────────────────────');
process.exit(0);
