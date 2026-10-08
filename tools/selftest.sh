#!/bin/sh
# 记账App 一键自检 —— 改完代码务必跑一遍
# 用法：sh tools/selftest.sh
cd "$(dirname "$0")/selftest" || exit 1
echo "════════════════════════════════════"
echo " 记账App 自检（$(date '+%Y-%m-%d %H:%M')）"
echo "════════════════════════════════════"
FAIL=0
if command -v node >/dev/null 2>&1; then
  node selftest.js || FAIL=1
else
  echo "⚠ 未安装 node，跳过 JS 逻辑测试"
fi
if command -v javac >/dev/null 2>&1; then
  echo ""
  echo "【队列 JSON 解析（Java 配平扫描）】"
  javac -d /tmp/jotest JOTest.java 2>/dev/null && java -cp /tmp/jotest JOTest || FAIL=1
else
  echo "⚠ 未安装 JDK，跳过 Java 测试"
fi
echo ""
[ $FAIL -eq 0 ] && echo "✅ 全部通过" || echo "❌ 有失败项，别提交"
exit $FAIL
