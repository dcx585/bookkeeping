#!/bin/sh
# 扫描通知栏，解析支付信息，输出 JSON 到 shared 目录
# Minis 调用: ./import_scan.sh
# 输出: /var/minis/shared/bookkeeping/imported_tx.json

OUTFILE="/var/minis/shared/bookkeeping/imported_tx.json"
SCRIPT_DIR="/var/minis/shared/bookkeeping"

# 1. 扫通知
RAW=$(timeout 10 android-notification list --max 50 2>/dev/null)
if [ -z "$RAW" ]; then
    echo '{"error":"no notifications or timeout"}' > "$OUTFILE"
    echo '{"error":"no notifications"}'
    exit 1
fi

# 2. 解析
echo "$RAW" | python3 "$SCRIPT_DIR/import_parser.py" > "$OUTFILE"
cat "$OUTFILE"
