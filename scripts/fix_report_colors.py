# -*- coding: utf-8 -*-
"""一次性修复脚本：把 reportExport.js 的旧硬编码色改为导出时刻解析 design-tokens 令牌。
用后即弃（本机 safe-delete 拦截删除，故留在 scripts/ 下备查，不影响构建）。"""
import io, re, sys

P = r"E:/workbuddyapp/数据分析agent/data-analysis-agent/src/reportExport.js"
s = io.open(P, encoding="utf-8").read()

def T(tok, fb):
    return "${tok('%s', '%s')}" % (tok, fb)

pairs = [
    # sevColor：严重度 → 令牌
    ("return sev === 'high' ? '#C0564B' : sev === 'medium' ? '#C98A2B' : sev === 'info' ? '#9AA0A6' : '#15795B'",
     "const T = RT(); return sev === 'high' ? T.danger : sev === 'medium' ? T.warn : sev === 'info' ? T.n400 : T.accent"),
    # 图标 SVG 描边
    ('stroke="#15795B" stroke-width="2"',
     'stroke="' + T('--accent-600', '#15795B') + '" stroke-width="2"'),
    # 口径/次要文字
    ('color:#71717A;font-size:9pt', 'color:' + T('--muted', '#71717A') + ';font-size:9pt'),
    # 表格边框与表头底
    ('border:1px solid #E7E5E2;padding:4pt 6pt;background:#F4F4F2',
     'border:1px solid ' + T('--border', '#E7E5E2') + ';padding:4pt 6pt;background:' + T('--n-100', '#F4F4F2')),
    ('border:1px solid #E7E5E2;padding:4pt 6pt',
     'border:1px solid ' + T('--border', '#E7E5E2') + ';padding:4pt 6pt'),
    # 抽样警示
    ('color:#C0564B;font-size:9pt', 'color:' + T('--danger', '#B23A31') + ';font-size:9pt'),
    # 报告正文样式块
    ('font-size:10.5pt;color:#27272A', 'font-size:10.5pt;color:' + T('--fg', '#27272A')),
    ('border-bottom:1px solid #E7E5E2', 'border-bottom:1px solid ' + T('--border', '#E7E5E2')),
    # PPTX 主色（旧版紫色残留 —— 报告与应用配色不一致的根因）
    ("const A = '8B7EC8'   // 主色（不带 #）",
     "const A = RT().accent.replace('#', '')   // 主色（导出时刻解析令牌）"),
    ("const DARK = '2A2733' // 正文",
     "const DARK = RT().fg.replace('#', '')      // 正文"),
    ("const MUT = '6B6577'  // 次要",
     "const MUT = RT().muted.replace('#', '')    // 次要"),
    ("const BADC = 'C0564B' // 告警",
     "const BADC = RT().danger.replace('#', '')  // 告警"),
]

before = s
counts = []
for old, new in pairs:
    n = s.count(old)
    counts.append((old[:48], n))
    s = s.replace(old, new)

io.open(P, "w", encoding="utf-8", newline="\n").write(s)

print("替换统计：")
for k, n in counts:
    print("  %2d x %s" % (n, k))

left = re.findall(r"#(?:71717A|E7E5E2|F4F4F2|C0564B|C98A2B|9AA0A6|27272A|8B7EC8|2A2733|6B6577|15795B)", s)
print("剩余旧色字面量：", len(left), left[:10])
print("文件字节数：", len(before), "->", len(s))
