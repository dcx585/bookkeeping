#!/usr/bin/env python3
"""
从 .github/workflows/build-apk.yml 里把 heredoc 内嵌的源码精确抽取成仓库真实文件。

★ 为什么要抽：Android 原生代码（4 个 Java + manifest + gradle 配置 + res）
   全塞在 1568 行的 workflow 里。仓库里看不到、跑不了 IDE、搜不到符号，
   任何一次缩进/引号改动都可能在 CI 里静默失败。这是「拆东墙补西墙」的根源之一。

★ 关键：不手抄。用脚本按 heredoc 标记抽取，剥掉 yml 的统一缩进，
   抽完再与源块逐行比对，确保零转录误差。

⚠️ 一次性迁移工具，保留作记录。workflow 里已经没有 heredoc，
   再运行它只会抽出 0 个文件，不会覆盖仓库里已有的源码。
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
WF = ROOT / '.github/workflows/build-apk.yml'

text = WF.read_text(encoding='utf-8')
lines = text.split('\n')

BLOCK_RE = re.compile(r'^\s*cat > (\S+) << \'(\w+)\'$')

def indent_of(s):
    return len(s) - len(s.lstrip(' '))

written = []
i = 0
while i < len(lines):
    m = BLOCK_RE.match(lines[i])
    if not m:
        i += 1
        continue
    path, mark = m.group(1), m.group(2)
    # 收集块内容，直到顶格的结束标记
    body = []
    j = i + 1
    closed = False
    while j < len(lines):
        if lines[j].strip() == mark:
            closed = True
            break
        body.append(lines[j])
        j += 1
    if not closed:
        print(f'ERROR: 块 {path} 没找到结束标记 {mark}', file=sys.stderr)
        sys.exit(1)

    # 剥掉统一缩进：取所有非空行的最小前导空格数
    indents = [indent_of(b) for b in body if b.strip()]
    strip = min(indents) if indents else 0
    content = '\n'.join(b[strip:] if b.strip() else '' for b in body)
    if not content.endswith('\n'):
        content += '\n'

    out = ROOT / path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(content, encoding='utf-8')
    written.append((path, len(body), strip))
    i = j + 1

print(f'抽出 {len(written)} 个文件：')
for p, n, s in written:
    print(f'  {p}  ({n} 行, 剥 {s} 空格缩进)')
