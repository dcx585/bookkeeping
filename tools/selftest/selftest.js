// 全量自检 v2 —— 汇总所有测试，输出最终报告
const {execSync}=require('child_process');
console.log('\n');
console.log('╔══════════════════════════════════════════════╗');
console.log('║        记账App 代码自检 —— 最终报告          ║');
console.log('╚══════════════════════════════════════════════╝');
const runs=[
 ['逻辑测试（解析/合并/对账/分期/边界）','logic_test.js'],
 ['回归测试（本轮修复的3个bug + 防误吞）','regress.js'],
];
let totalPass=0,totalFail=0;
runs.forEach(([name,f])=>{
  let out='';
  try{ out=execSync('node '+f,{encoding:'utf8'}); }catch(e){ out=(e.stdout||'')+(e.stderr||''); }
  const m=/(?:通过|回归 通过)\s*(\d+)\s*\/\s*失败\s*(\d+)/.exec(out);
  const p=m?+m[1]:0, fl=m?+m[2]:0;
  totalPass+=p; totalFail+=fl;
  console.log('\n【'+name+'】 通过 '+p+' / 失败 '+fl);
});
console.log('\n──────────────────────────────────────────────');
console.log('合计：通过 '+totalPass+'  ·  失败 '+totalFail);
console.log('──────────────────────────────────────────────');
process.exit(totalFail?1:0);
