#!/bin/sh
# ===== 记账通知导入：一键流程 =====
# 用法: bash import_notify.sh
# 流程: 扫通知 → 解析 → 注入到 GitHub Pages 记账 APP

set -e
BOOK="/var/minis/shared/bookkeeping"
TXF="$BOOK/imported_tx.json"
PARSER="$BOOK/import_parser.py"

echo "🔍 扫描通知栏..."
RAW=$(timeout 12 android-notification list --max 50 2>/dev/null)
if [ -z "$RAW" ]; then
    echo "❌ 通知扫描超时或失败"
    exit 1
fi

echo "📝 解析支付信息..."
echo "$RAW" | python3 "$PARSER" > "$TXF"

COUNT=$(python3 -c "import json; print(len(json.load(open('$TXF'))))")
if [ "$COUNT" -eq 0 ]; then
    echo "😴 没有新的支付通知"
    exit 0
fi

echo "📲 找到 $COUNT 条支付记录，注入记账 APP..."
python3 -c "
import json, os
with open('$TXF') as f:
    items = json.load(f)
# Save for APP to read
with open('$TXF', 'w') as f:
    json.dump(items, f, ensure_ascii=False)
print('✅ 导入数据已就绪，打开记账 APP → 更多 → 导入通知 → 扫描')
"
