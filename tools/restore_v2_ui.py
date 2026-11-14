#!/usr/bin/env python3
"""把「解析引擎开关 + 诊断面板」这段手写代码插到 [V2-PARSER-END] 之后。

★ 2026-11-15 事故：inline_parser_v2.py 用正则整块替换
   [V2-PARSER-BEGIN] … [V2-PARSER-END] 之间的内容。而 setParseV2 /
   openParserDiag / runParserDiag 这三个手写函数原本就放在这个区间里，
   于是每次重新内联都被一起删掉：
     · 「更多 → 解析诊断」按钮变死按钮（onclick 指向不存在的函数）
     · 默认引擎开关那段初始化丢失 → PARSE_V2 退回 false，静默切回 v1
   修法：手写代码一律放到块外（MARK_END 之后），生成器只管自己的块。
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'app.html'
SRC = pathlib.Path('/tmp/v2ui.js')
MARK_END = '// ===== [V2-PARSER-END] ====='
GUARD = '// ── 解析引擎开关与诊断面板（手写，勿放进 V2 自动生成块）──'

html = APP.read_text(encoding='utf-8')
code = SRC.read_text(encoding='utf-8').rstrip('\n')

if GUARD in html:
    print('已存在，跳过')
    sys.exit(0)

if MARK_END not in html:
    print('ERROR: 找不到 V2-PARSER-END', file=sys.stderr)
    sys.exit(1)

ins = '\n' + GUARD + '\n' + code + '\n'
idx = html.index(MARK_END) + len(MARK_END)
html = html[:idx] + ins + html[idx:]
APP.write_text(html, encoding='utf-8')
print('已插入 %d 行（位置：V2-PARSER-END 之后）' % len(code.split('\n')))
