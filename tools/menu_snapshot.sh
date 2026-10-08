#!/bin/sh
# ─────────────────────────────────────────────────────────────
# menu_snapshot.sh —— 「改了 A 会不会弄坏 B」的菜单级断言
#
# 子命令（用 COMPARE=1 做 goldendiff 式比对）：
#   sh tools/menu_snapshot.sh --dump           打印当前菜单结构指纹
#   sh tools/menu_snapshot.sh --write          把当前指纹写入 tools/menu.golden
#   COMPARE=1 sh tools/menu_snapshot.sh --dump 与 golden 比对，不一致则 exit 1
#
# 防的是最典型的一类回归：为了让某个按钮工作去动 DOM，结果把别的
# 按钮的 onclick 换掉 / 改成拼错的函数名 / 删掉某个 id → 页面不报错，
# 但那个功能永久点不动了（编译器、语法检查、单测都看不见）。
# ─────────────────────────────────────────────────────────────
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GOLDEN="$ROOT/tools/menu.golden"
HTML="$ROOT/app.html"

DUMP=$(node -e '
const fs=require("fs");
const h=fs.readFileSync(process.argv[1],"utf8");
// 抽出所有 <button> 的 (关键 class, 触发函数名)，按出现顺序
const out=[];
const re=/<button\b([^>]*)>([\s\S]{0,60}?)<\/button>/g;
let m;
while((m=re.exec(h))){
  const attrs=m[1];
  const cls=(/class="([^"]*)"/.exec(attrs)||[,""])[1].split(/\s+/)[0]||"-";
  const ev=["onclick","onchange","oninput"].map(e=>{
    const r=new RegExp(e+"=\"([^\"]*)\"").exec(attrs); return r?r[1]:"";
  }).filter(Boolean).join(";");
  // 只保留函数名（去掉参数里的文案，否则一改文案就误报）
  const fn=(ev.match(/[A-Za-z_$][\w$]*\s*\(/)||["-"+"()"])[0].replace(/\s*\($/,"");
  out.push(fn);
}
console.log(out.join("\n"));
' "$HTML")

count=$(printf '%s\n' "$DUMP" | grep -c . || true)

if [ "${1:-}" = "--write" ]; then
  printf '%s\n' "$DUMP" > "$GOLDEN"
  echo "已写入 $GOLDEN（$count 个按钮）"
  exit 0
fi

if [ "${COMPARE:-0}" = "1" ]; then
  if [ ! -f "$GOLDEN" ]; then echo "⚠ 没有 $GOLDEN，先跑 --write"; exit 0; fi
  if printf '%s\n' "$DUMP" > /tmp/menu.now && diff -u "$GOLDEN" /tmp/menu.now > /tmp/menu.diff; then
    echo "  ✓ 菜单/按钮指纹未变（$count 个）"
    exit 0
  else
    echo "  ❌ 菜单/按钮指纹变了（golden diff）:"
    sed 's/^/     /' /tmp/menu.diff | head -40
    echo "     → 若这是有意的，审一遍再跑: sh tools/menu_snapshot.sh --write"
    exit 1
  fi
fi

printf '%s\n' "$DUMP"
echo "（共 $count 个按钮）"
