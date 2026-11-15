#!/usr/bin/env python3
"""
把 js/parser_v2.js 内联进 app.html，实现「v2 解析开关」。

⚠️⚠️ 2026-11-15 起【已退役，不要运行】⚠️⚠️
    app.html 已经拆分：脚本全部在 js/*.js，用 <script src> 加载，
    parser_v2.js 本身就是被直接引用的独立文件，不再需要内联。
    本脚本若再运行，会把 v2 代码块重新插进 app.html，破坏拆分结构。

    保留本文件是为了记录历史约束（下面那些坑仍然成立，只是现在不适用了）：
    - v2 代码块是整块替换的，块内不能放手写代码
    - 生成器里的钩子内容必须与 app.html 同步，不能只判断「标记在不在」

设计原则：
- 不删除任何原有代码，旧 parseNotifFull 完整保留 → 随时可回滚
- 通过全局开关 PARSE_V2 分流，默认关闭
- 幂等：重复运行不会重复插入（靠标记注释判断）
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).parent.parent  # tools/ 的上一级才是项目根
APP = ROOT / 'app.html'
V2 = ROOT / 'js' / 'parser_v2.js'

print('ERROR: inline_parser_v2.py 已退役 —— app.html 已拆分，v2 解析器由 '
      '<script src="js/parser_v2.js"> 直接加载，不要再内联。', file=sys.stderr)
sys.exit(2)

MARK_BEGIN = '// ===== [V2-PARSER-BEGIN] auto-generated, do not edit ====='
MARK_END = '// ===== [V2-PARSER-END] ====='
HOOK_MARK = '/* [V2-HOOK] */'

html = APP.read_text(encoding='utf-8')

# ---------- 0. 守卫：旧块里不许有「不是 js/parser_v2.js 定义的函数」 ----------
# ★ 2026-11-15 事故：setParseV2 / openParserDiag / runParserDiag 三个手写函数
#   曾放在 [V2-PARSER-BEGIN]…[V2-PARSER-END] 之间。整块替换时被一起删掉，
#   结果是「解析诊断」变死按钮、默认引擎静默退回 v1，而门禁当时只看语法。
#   现在：手写代码一律放块外；这里再兜一层——块内出现生成器不认识的函数就拒绝执行。
_src_all = V2.read_text(encoding='utf-8')
m_old = re.search(re.escape(MARK_BEGIN) + r'[\s\S]*?' + re.escape(MARK_END), html)
if m_old:
    gen_fns = set(re.findall(r'^\s*function\s+(\w+)', _src_all, re.M))
    old_fns = set(re.findall(r'^\s*function\s+(\w+)', m_old.group(0), re.M))
    intruders = sorted(old_fns - gen_fns)
    if intruders:
        print('ERROR: v2 自动生成块里有手写函数，整块替换会把它们删掉：', file=sys.stderr)
        for f in intruders:
            print('   · ' + f, file=sys.stderr)
        print('   → 请把这些函数移到 [V2-PARSER-END] 之后，然后再跑。', file=sys.stderr)
        sys.exit(1)

# ---------- 1. 清理旧的 v2 注入块（幂等） ----------
html = re.sub(
    re.escape(MARK_BEGIN) + r'[\s\S]*?' + re.escape(MARK_END) + r'\n?',
    '', html
)

# ---------- 2. 读取并清理 v2 源码 ----------
src = V2.read_text(encoding='utf-8')
src = re.sub(r'// -{5,} 导出 -{5,}[\s\S]*$', '', src).strip()

# 去掉模块导出（内联后不需要）
block = f"""
{MARK_BEGIN}
// 解析器 v2 —— 按来源锚点提取金额
// ★ 来源与条款：思路借鉴自 blue-whale-keeper（蓝色大肥鱼管家，
//   https://github.com/a2244921700-code/blue-whale-keeper）。
//   其许可为 MIT + 附加「禁止原样转售」，明确允许衍生开发自由定价/闭源/收费。
//   本项目只借鉴思路，代码为独立 JavaScript 实现，未复制其源码。
//   完整声明见仓库根目录 NOTICE.md。
// 开关：window.PARSE_V2 决定走 v2 还是 v1。
// ★ 开关的初始化、切换函数、诊断面板都在本块【之外】（[V2-PARSER-END] 之后），
//   因为本块会被整块替换 —— 放进来的手写代码会被删掉。
{src}
{MARK_END}
"""

# ---------- 3. 找插入点：parseNotifFull 定义之前 ----------
anchor = 'function parseNotifFull(n){'
if anchor not in html:
    print('ERROR: 找不到 parseNotifFull 锚点', file=sys.stderr)
    sys.exit(1)

if MARK_BEGIN not in html:
    idx = html.index(anchor)
    html = html[:idx] + block.strip() + '\n' + html[idx:]

# ---------- 4. 在 parseNotifFull 里加分流钩子 ----------
hook_code = f"""{HOOK_MARK}
  // ★ v2 分流：开关打开时走新解析器，关掉走旧逻辑
  if (window.PARSE_V2 && typeof parseNoticeV2 === 'function') {{
    try {{
      const v2items = parseNoticeV2(n);
      if (v2items.length) {{
        const t0 = n.time || Date.now();
        return v2items.map(b => Object.assign({{}}, b, {{
          src: n.app || '',
          time: b.time || t0,
          finger: payFingerprint(b.note || '', b.account, b.amount, b.time || t0),
          _v2: true,
        }}, autoBookGate(b)));
      }}
    }} catch (e) {{ console.warn('[v2] 解析失败，回退旧逻辑', e); }}
  }}
"""

if HOOK_MARK in html:
    # ★ 幂等时也要【刷新】钩子内容：只判断"标记在不在"会导致
    #   生成器里的 hook 改了、app.html 里还是旧的，两边永久不同步。
    html = re.sub(
        re.escape(HOOK_MARK) + r'[\s\S]*?(?=\n  // 返回数组：一条通知可能合了多笔支付)',
        hook_code.rstrip(), html, count=1)
else:
    html = html.replace(anchor, anchor + '\n' + hook_code, 1)

APP.write_text(html, encoding='utf-8')
print(f'OK: app.html 已更新 ({len(html)} chars)')
print(f'   v2 代码块: {"已注入" if MARK_BEGIN in html else "失败"}')
print(f'   分流钩子: {"已注入" if HOOK_MARK in html else "失败"}')
print(f'   默认开关: 由 [V2-PARSER-END] 之后的手写段决定（默认开启，可持久保存关闭）')
