#!/usr/bin/env python3
"""
把 js/parser_v2.js 内联进 app.html，实现「v2 解析开关」。

设计原则：
- 不删除任何原有代码，旧 parseNotifFull 完整保留 → 随时可回滚
- 通过全局开关 PARSE_V2 分流，默认关闭
- 幂等：重复运行不会重复插入（靠标记注释判断）
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).parent.parent  # tools/ 的上一级才是项目根
APP = ROOT / 'app.html'
V2 = ROOT / 'js' / 'parser_v2.js'

MARK_BEGIN = '// ===== [V2-PARSER-BEGIN] auto-generated, do not edit ====='
MARK_END = '// ===== [V2-PARSER-END] ====='
HOOK_MARK = '/* [V2-HOOK] */'

html = APP.read_text(encoding='utf-8')

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
// 解析器 v2 —— 按来源锚点提取金额（借鉴 blue-whale-keeper 的踩坑经验）
// 开关：window.PARSE_V2 = true 时启用。关掉即回到旧逻辑（旧代码完整保留）
window.PARSE_V2 = window.PARSE_V2 || false;
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
          special: null,
          needConfirm: !!b.needConfirm,
          _v2: true,
        }}));
      }}
    }} catch (e) {{ console.warn('[v2] 解析失败，回退旧逻辑', e); }}
  }}
"""

if HOOK_MARK not in html:
    html = html.replace(anchor, anchor + '\n' + hook_code, 1)

APP.write_text(html, encoding='utf-8')
print(f'OK: app.html 已更新 ({len(html)} chars)')
print(f'   v2 代码块: {"已注入" if MARK_BEGIN in html else "失败"}')
print(f'   分流钩子: {"已注入" if HOOK_MARK in html else "失败"}')
print(f'   默认开关: window.PARSE_V2 = false（需手动开启）')
