#!/bin/sh
# ─────────────────────────────────────────────────────────────
# jbcheck.sh —— JSON 数组文本完整性检查（只依赖 python3 自带 json 模块）
#
# 为什么需要它：数据/队列文件是「一行一行手工拼字符串」写出去的
# （Java 端 queueAppend / JS 端 st(...)）。任何一次改动忘了加转义，
# 都会写出残缺 JSON → 第二天 App 读不到 → 用户数据看起来"丢了"。
# json.loads 是这个链路上唯一诚实的守门人。
#
# 用法:
#   sh tools/jbcheck.sh <file.json> [...]      检查指定文件
#   sh tools/jbcheck.sh --self                  自检工具本身（meta-test）
# 退出码: 0 = 全部合法 / 1 = 有文件损坏（可直接用于 CI 门禁）
# ─────────────────────────────────────────────────────────────
set -u

PY='
import json, sys, io

def check(path):
    try:
        raw = io.open(path, encoding="utf-8").read()
    except Exception as e:
        return ("READ_FAIL", str(e))
    if raw.strip() == "":
        return ("EMPTY", "文件长度为 0 或全空白（写入中途被杀？）")
    try:
        v = json.loads(raw)
    except Exception as e:
        return ("BROKEN", "%s" % e)
    if isinstance(v, list):
        for i, item in enumerate(v):
            if not isinstance(item, dict):
                return ("BAD_ITEM", "第 %d 个元素不是对象: %r" % (i, type(item).__name__))
            if "id" in item and not str(item.get("id") or "").strip():
                return ("BAD_ITEM", "第 %d 个元素 id 为空字符串（会永远 ack 不掉）" % i)
    return ("OK", "" if not isinstance(v, list) else "%d 条" % len(v))

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("用法: jbcheck.sh <file.json> [...]"); sys.exit(2)
    bad = 0
    for p in args:
        st, msg = check(p)
        if st == "OK":
            print("  OK   %s  %s" % (p, msg))
        else:
            bad += 1
            print("  FAIL %s  [%s] %s" % (p, st, msg))
    sys.exit(1 if bad else 0)
'

if [ "${1:-}" = "--self" ]; then
  # meta-test：用一批已知好/坏的样本验证"检查器本身"是有效的
  # 防的是：有人把 jbcheck 改成永远返回 0（"为了让它过"），门禁就变成摆设
  T=$(mktemp -d)
  printf '[{"id":"a","text":"ok"}]'            > "$T/good1.json"
  printf '[]'                                   > "$T/good2.json"
  printf '[{"id":"a"},{"id":"b"}]'              > "$T/good3.json"
  printf '[{"id":"a","text":"[充值]"}'          > "$T/bad_unclosed.json"   # 少一个 ]
  printf '[{"id":"a"},]'                        > "$T/bad_trailing.json"   # 尾随逗号
  printf ''                                     > "$T/bad_empty.json"
  printf '[{"id":"a","t":"未转义"引号"}]'        > "$T/bad_quote.json"
  printf '[{"id":""}]'                          > "$T/bad_id.json"
  ok=0; ng=0
  for f in good1 good2 good3; do
    if python3 -c "$PY" "$T/$f.json" >/dev/null 2>&1; then ok=$((ok+1)); else ng=$((ng+1)); echo "  ❌ 自检失败：好样本 $f 被判为坏"; fi
  done
  for f in bad_unclosed bad_trailing bad_empty bad_quote bad_id; do
    if python3 -c "$PY" "$T/$f.json" >/dev/null 2>&1; then ng=$((ng+1)); echo "  ❌ 自检失败：坏样本 $f 被判为好（门禁形同虚设）"; else ok=$((ok+1)); fi
  done
  rm -rf "$T"
  echo "  jbcheck 自检: 正确 $ok / 错误 $ng"
  [ "$ng" -eq 0 ] || exit 1
  exit 0
fi

FAIL=0
for f in "$@"; do
  if python3 -c "$PY" "$f"; then :; else FAIL=1; fi
done
exit $FAIL
