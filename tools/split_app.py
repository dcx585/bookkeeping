#!/usr/bin/env python3
"""
把 app.html 里的两块 <script> 切成真实的 js 文件。

★ 设计原则：**只按物理位置切，不重排任何代码**。
   切出来的文件按原顺序用 <script src> 加载，执行顺序与原来完全一致
   （classic script 共享同一个全局词法环境，跨文件的 const/let 一样可见）。
   这样拆分本身不引入任何语义变化，出了问题一定是「切错位置」，不是「重组逻辑」。

★ 已有的 js/parser_v2.js 和 js/ai-parse.js 本来就在仓库里，
   app.html 里的那两块是它们的内联副本，直接换成 <script src>，不再内联。

用法: python3 tools/split_app.py            # 执行拆分
      python3 tools/split_app.py --dry-run  # 只打印切点
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'app.html'
JS = ROOT / 'js'

# 切点：(锚点行, 输出文件名)。必须严格按文件中出现的先后顺序。
CUTS = [
    ('// ── Splash ──',                                    '01-splash.js'),
    ('// ── State ──',                                     '02-state.js'),
    ('// ── Investment accounts ──',                       '03-invest.js'),
    ('// ── Panel ──',                                     '04-render.js'),
    ('// ── Transaction CRUD ──',                          '05-tx.js'),
    ('// ── Budget settings ──',                           '06-ui.js'),
    ('// ── Background stored in IndexedDB (no size limit) ──', '07-bg.js'),
    ('// ── 剪贴板导入 ──',                                 '08-import.js'),
    ('// ── 自动记账模块 ──',                               '09-autobook.js'),
    ('// ── 解析引擎开关与诊断面板（手写，勿放进 V2 自动生成块）──', '10-v2-ui.js'),
    # ── 下面是 v2 自动块，整块换成 <script src="js/parser_v2.js"> ──
    ('// ===== [V2-PARSER-BEGIN] auto-generated, do not edit =====', None),
    ('// ===== [V2-PARSER-END] =====', None),
    ('function parseNotifFull(n){',                        '11-parser-v1.js'),
    ('/* ============ 自动记账总开关（2026-11-07） ============', '12-autobook.js'),
    ('// ── Init ──',                                      '13-init.js'),
]

def main():
    html = APP.read_text(encoding='utf-8')

    m = re.search(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>', html)
    if not m:
        print('ERROR: 找不到第一个 <script> 块', file=sys.stderr)
        sys.exit(1)
    block1, b1_start, b1_end = m.group(1), m.start(), m.end()

    # 定位所有切点在块内的位置（按顺序，且必须严格递增）
    positions = []
    cursor = 0
    for anchor, name in CUTS:
        idx = block1.find(anchor, cursor)
        if idx < 0:
            print(f'ERROR: 锚点找不到（或在上一锚点之前）：{anchor}', file=sys.stderr)
            sys.exit(1)
        positions.append((idx, anchor, name))
        cursor = idx + len(anchor)

    if block1[:positions[0][0]].strip():
        print('WARN: 块开头有内容不属于任何分片，会被并入第一个文件', file=sys.stderr)

    # 校验每个切点必须落在行首
    for idx, anchor, name in positions:
        if idx > 0 and block1[idx - 1] != '\n':
            print(f'ERROR: 切点不在行首：{anchor}', file=sys.stderr)
            sys.exit(1)

    if '--dry-run' in sys.argv:
        total = len(block1)
        for k, (idx, anchor, name) in enumerate(positions):
            end = positions[k + 1][0] if k + 1 < len(positions) else total
            print(f'  {name or "(V2 块→parser_v2.js)":22s} {idx:6d}..{end:6d}  {end-idx:6d} 字符  ← {anchor[:36]}')
        print(f'  块总长 {total}')
        return

    pieces = []
    for k, (idx, anchor, name) in enumerate(positions):
        end = positions[k + 1][0] if k + 1 < len(positions) else len(block1)
        pieces.append((name, block1[idx:end]))

    # ── 写文件 ──
    written = []
    for name, body in pieces:
        if name is None:
            continue   # v2 块丢弃（改成引用已有 js/parser_v2.js）
        body = body.strip('\n') + '\n'
        (JS / name).write_text(body, encoding='utf-8')
        written.append((name, len(body)))

    # ── 重建 script 标签 ──
    order = [
        '01-splash.js', '02-state.js', '03-invest.js', '04-render.js',
        '05-tx.js', '06-ui.js', '07-bg.js', '08-import.js', '09-autobook.js',
        '10-v2-ui.js', 'parser_v2.js',
        '11-parser-v1.js', '12-autobook.js', '13-init.js',
    ]
    tags = '\n'.join(f'<script src="js/{f}"></script>' for f in order)
    html = html[:b1_start] + tags + html[b1_end:]

    # ── 第二块（AI 解析）→ 引用已有 js/ai-parse.js ──
    # ★ 不能用 re.search 找第一个 <script>：切完之后第一条就是 <script src="js/01-splash.js">。
    #   要遍历所有块，找含 AI-PARSE-BEGIN 的那个。
    replaced2 = False
    for m2 in re.finditer(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>', html):
        if 'AI-PARSE-BEGIN' in m2.group(1):
            html = html[:m2.start()] + '<script src="js/ai-parse.js"></script>' + html[m2.end():]
            replaced2 = True
            break
    if not replaced2:
        print('WARN: 没找到 AI 解析块，未替换', file=sys.stderr)

    APP.write_text(html, encoding='utf-8')

    print(f'已生成 {len(written)} 个 js 文件：')
    for n, sz in written:
        print(f'  js/{n:22s} {sz:7d} 字符')
    print(f'app.html 从 {len(m.group(1)) + 2 * 0:6d} 字符脚本块 → {len(tags)} 字符标签')

if __name__ == '__main__':
    main()
