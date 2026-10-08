#!/bin/sh
# ═════════════════════════════════════════════════════════════
# check.sh —— 记账App 唯一入口 · 提交/CI 共用的一键回归门禁
#
#   本地:  sh tools/check.sh          （pre-commit 会自动调用）
#   强制:  FORCE=1 sh tools/check.sh  （人为要提交半成品时才用）
#   CI  :  GitHub Actions 直接跑这一条，与本地完全一致
#
# 设计原则：所有检查都必须【可失败】(exit 非0)，否则门禁是摆设。
# 每一层防的东西不一样，见各步注释。
# ═════════════════════════════════════════════════════════════
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
FAIL=0
note(){ printf '\n\033[1m── %s ──\033[0m\n' "$1"; }

note "1/7 workflow YAML 完整性（heredoc 顶格行 → GitHub 静默不构建）"
sh tools/wfcheck.sh || FAIL=1

note "2/7 app.html 内联 JS 抽取 + 语法"
node -e '
const fs=require("fs");
const html=fs.readFileSync("app.html","utf8");
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m,chunks=[];
while((m=re.exec(html))) chunks.push(m[1]);
if(!chunks.length){console.error("❌ app.html 里没有 <script>，结构改坏了？");process.exit(1);}
fs.writeFileSync("/tmp/scripts.js",chunks.join("\n;\n"));
console.log("  script 块 "+chunks.length+" 个 / "+chunks.join("").length+" 字符");
' || FAIL=1
node --check /tmp/scripts.js && echo "  ✓ 内联 JS 语法正确" || { echo "  ❌ app.html 内联 JS 语法错误"; FAIL=1; }

note "3/7 逻辑 + 回归 + 金标准快照测试"
( cd tools/selftest && node selftest.js ) || FAIL=1
( cd tools/selftest && node golden_test.js ) || FAIL=1

note "4/7 Java 结构（heredoc 抽出的源码，花括号/字符串/方法名）"
node tools/heredoc_check.js .github/workflows/build-apk.yml || FAIL=1
( cd tools/selftest && javac -d /tmp/jotest JOTest.java 2>/dev/null && java -cp /tmp/jotest JOTest ) \
  || { echo "  ❌ JOTest（JSON 配平扫描）失败"; FAIL=1; }

note "5/7 跨文件接口契约（Java 改名 → 网页静默失效）"
node -e '
const fs=require("fs");
const y=fs.readFileSync(".github/workflows/build-apk.yml","utf8");
const re=/cat > (\S+) << .JAVA.\r?\n([\s\S]*?)\r?\n[ \t]*JAVA(?=\r?\n)/g;
let m;while((m=re.exec(y))){ if(/MainActivity\.java$/.test(m[1])){
  let b=m[2].split(/\r?\n/);
  const inds=b.filter(l=>l.trim()).map(l=>l.match(/^ */)[0].length);
  fs.writeFileSync("/tmp/MA.java", b.map(l=>l.slice(Math.min(...inds))).join("\n"));
}}' || FAIL=1
node tools/contract_check.js app.html /tmp/MA.java || FAIL=1
node tools/parse_parity.js app.html .github/workflows/build-apk.yml || FAIL=1

note "6/7 菜单/按钮指纹（golden）—— 改了 A 弄坏 B 的按钮"
COMPARE=1 sh tools/menu_snapshot.sh --dump || FAIL=1

note "7/7 数据完整性工具自检 + 真实数据文件"
sh tools/jbcheck.sh --self || FAIL=1
for f in imported_tx.json import_backup.json manifest.json; do
  [ -f "$f" ] && { sh tools/jbcheck.sh "$f" || FAIL=1; }
done

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ 全部通过，可以提交"
else
  echo "❌ 有失败项 —— 先去修，别用 --no-verify 绕（那等于把门拆了）"
fi
exit $FAIL
