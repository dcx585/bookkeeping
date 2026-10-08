#!/bin/sh
# 安装 git hooks（无 node_modules、无 husky 依赖）
# 用法: sh tools/install_hooks.sh
set -u
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "不在 git 仓库里"; exit 1; }
cd "$ROOT" || exit 1

# 关键：用 core.hooksPath 指向仓库内的 tools/hooks 目录。
#   好处1：hook 脚本进版本库 → 换台机器/换个人 clone 也有同样的门禁
#   好处2：不需要 node_modules、不需要 husky、不需要 npm install
#   好处3：hook 的修改能被 git diff 看到，不会被悄悄改掉
chmod +x tools/hooks/pre-commit tools/hooks/pre-push tools/check.sh tools/*.sh 2>/dev/null
git config core.hooksPath tools/hooks

echo "已安装：core.hooksPath = tools/hooks"
echo "  .git/hooks/ 里的旧 hook 会被忽略（这是 git 的语义，不是 bug）"
echo ""
echo "验证:"
echo "  sh tools/check.sh                        # 手动跑一遍"
echo "  git commit --allow-empty -m 'test gate'  # 应看到 hook 触发"
echo ""
echo "绕过方式（都要人工承担后果）:"
echo "  git commit --no-verify / git push --no-verify"
echo "  FORCE=1 git commit -m '...'              # 打印失败项但不拦"
echo ""
echo "卸载: git config --unset core.hooksPath"
