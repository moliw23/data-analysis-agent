# -*- coding: utf-8 -*-
"""一次性修复脚本：把 engine/export.js 生成的独立 HTML 报告的内联样式接入 design-tokens 令牌。
报告是独立产物（离线可看），无法引用 CSS 变量，故在生成时刻解析令牌注入具体色值。
含一处漏网的紫底残留 #FAF9FC。用后即弃（本机 safe-delete 拦截删除，故留在 scripts/ 备查）。"""
import io, re

P = r"E:/workbuddyapp/数据分析agent/data-analysis-agent/src/engine/export.js"
s = io.open(P, encoding="utf-8").read()

HELPER = '''
// 令牌解析：报告 HTML 是独立产物，无法引用应用的 CSS 变量，
// 因此在生成时刻从 design-tokens.css 解析具体色值（与界面同源）。
// fallback 仅作非浏览器环境（单测/node）兜底，不是颜色来源。
function TK(name, fallback) {
  try {
    if (typeof document !== 'undefined' && window.getComputedStyle) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      if (v) return v
    }
  } catch { /* node 环境走 fallback */ }
  return fallback
}
'''

anchor = "import { fmt } from './_shared.js'"
assert anchor in s, "未找到插入锚点"
s = s.replace(anchor, anchor + HELPER, 1)

def T(tok, fb):
    return "${TK('%s', '%s')}" % (tok, fb)

pairs = [
    ('color:#27272A', 'color:' + T('--fg', '#27272A')),
    # 漏网的紫色残留：报告页面底色此前是 #FAF9FC（带紫调），统一到令牌 --bg
    ('background:#FAF9FC', 'background:' + T('--bg', '#FAFAF9')),
    ('color:#71717A', 'color:' + T('--muted', '#71717A')),
    ('background:#F4F4F2', 'background:' + T('--n-100', '#F4F4F2')),
    ('border:1px solid #E7E5E2', 'border:1px solid ' + T('--border', '#E7E5E2')),
    ('color:#15795B', 'color:' + T('--accent', '#15795B')),
    ('background:#15795B', 'background:' + T('--accent', '#15795B')),
    ('border:3px solid #15795B', 'border:3px solid ' + T('--accent', '#15795B')),
    ('.sev-high{background:#C0564B}', '.sev-high{background:' + T('--danger', '#B23A31') + '}'),
    ('.sev-medium{background:#C98A2B}', '.sev-medium{background:' + T('--warn', '#96631A') + '}'),
    ('.sev-info{background:#9AA0A6}', '.sev-info{background:' + T('--n-400', '#A6A39C') + '}'),
    ('tbody tr:nth-child(even) td{background:#FAFAF9}', 'tbody tr:nth-child(even) td{background:' + T('--accent-wash', 'transparent') + '}'),
]

counts = []
for old, new in pairs:
    n = s.count(old)
    counts.append((old[:46], n))
    s = s.replace(old, new)

io.open(P, "w", encoding="utf-8", newline="\n").write(s)

print("替换统计：")
for k, n in counts:
    print("  %2d x %s" % (n, k))
left = re.findall(r"#(?:FAF9FC|71717A|E7E5E2|F4F4F2|C0564B|C98A2B|9AA0A6|27272A|15795B|FAFAF9)", s)
print("剩余旧色字面量：", len(left), left[:12])
