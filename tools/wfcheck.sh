#!/bin/sh
# ─────────────────────────────────────────────────────────────
# wfcheck.sh —— GitHub Actions workflow 完整性门禁
#
# 防的是本项目真实踩过的坑：build-apk.yml 用 heredoc 内嵌 Java/XML 源码，
# 一旦某行顶格写（缩进 0），它在 YAML 里就跳出了 run: 块 → 整个 workflow
# 变成【非法 YAML】→ GitHub 直接拒绝加载 → 你以后每次 push 都静默不构建，
# 连失败通知都没有。排查成本极高（"为什么 APK 一直是旧版本"）。
#
# 用法: sh tools/wfcheck.sh [workflow.yml ...]    默认检查 .github/workflows/*
# 退出码: 0 通过 / 1 有问题
# ─────────────────────────────────────────────────────────────
set -u
FAIL=0
FILES="$*"
if [ -z "$FILES" ]; then FILES=$(ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null); fi
if [ -z "$FILES" ]; then echo "没找到 workflow 文件"; exit 1; fi

for WF in $FILES; do
  echo "── $WF ──"

  # ① YAML 可解析性（最关键：不可解析 = GitHub 根本不加载）
  if python3 -c 'import yaml' 2>/dev/null; then
    if python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' "$WF" 2>/tmp/wferr; then
      echo "  ✓ YAML 可解析"
    else
      echo "  ❌ YAML 解析失败 → GitHub 会忽略整个 workflow（无任何通知）"
      sed 's/^/     /' /tmp/wferr | head -6
      FAIL=1
    fi
  else
    echo "  ⚠ 未安装 PyYAML，跳过解析检查（apk add py3-yaml）"
  fi

  # ② heredoc 缩进 + Java 结构（见 tools/heredoc_check.js）
  node "$(dirname "$0")/heredoc_check.js" "$WF" || FAIL=1
  echo ""
done

if [ $FAIL -eq 0 ]; then echo "✅ workflow 检查通过"; else echo "❌ workflow 有问题，别提交"; fi
exit $FAIL
