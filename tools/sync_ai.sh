#!/bin/sh
# ─────────────────────────────────────────────────────────────
# sync_ai.sh —— 把 js/ai-parse.js 内联进 app.html
#
# 为什么需要这个：app.html 是单文件 App（子资源缓存有问题，
# 必须全部内联）。但开发时改 js/ 下的源文件更方便。
#
# 用法：
#   sh tools/sync_ai.sh          把 js/ai-parse.js 同步进 app.html
#   sh tools/sync_ai.sh --check  只检查是否同步，不写入（CI 用）
# ─────────────────────────────────────────────────────────────
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

CHECK="${1:-}"
if [ "$CHECK" = "--check" ]; then
  export AI_SYNC_MODE=check
else
  export AI_SYNC_MODE=write
fi

node tools/_sync_ai.js
