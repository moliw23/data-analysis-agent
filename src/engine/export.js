// 报告导出（独立 HTML，含 ECharts CDN + 内联 SVG 图标，可离线查看）与数据导出（CSV / Excel）
import { fmt } from './_shared.js'

// 从 lucide-react v0.400.0 提取的 SVG path 数据
const ICON_SVG = {
  summary: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  rank: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  dist: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  share: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  cross: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
  quality: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  data: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  insights: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  charts: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>'
}

function iconSvg(name, size = 16) {
  const inner = ICON_SVG[name] || ICON_SVG.summary
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

// HTML 转义：防止数据/LLM 输出中的 < > & " ' 破坏报告结构或被注入脚本（存储型 XSS 防护）
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 懒加载内嵌 echarts 源码（仅导出 HTML 报告时加载，不计入首屏）
let _echartsSrc = null
async function getEchartsSource() {
  if (_echartsSrc == null) {
    const m = await import('echarts/dist/echarts.min.js?raw')
    _echartsSrc = m.default
  }
  return _echartsSrc
}

export async function exportReportHTML(table, analysis, quality) {
  const echartsSource = await getEchartsSource()
  const { charts, insights } = analysis
  const dataSample = table.rows.slice(0, 8).map(r => `<tr>${table.columns.map(c => `<td title="${esc(r[c.name])}">${esc(r[c.name])}</td>`).join('')}</tr>`).join('')
  const head = table.columns.map(c => `<th title="${esc(c.name)}">${esc(c.name)}</th>`).join('')
  const insightHTML = insights.map(i => `<li class="insight-item">${iconSvg(i.icon || 'summary')}<div><b>${esc(i.text)}</b><br><span class="cal">${esc(i.caliber || '')}</span></div></li>`).join('')
  const issuesHTML = quality.issues.length
    ? quality.issues.map(it => `<li class="issue-item"><span class="sev sev-${esc(it.severity)}"></span><div><b>${esc(it.col)} · ${esc(it.type)}</b><br>${esc(it.detail)}<br><span class="fix">建议：${esc(it.suggestion)}</span></div></li>`).join('')
    : '<li class="muted">未检出明显问题，数据质量良好。</li>'
  const chartDivs = charts.map((c, i) => `<div class="chart" id="chart${i}"></div>`).join('')
  const chartJS = `var _charts=[];` + charts.map((c, i) => `_charts.push(echarts.init(document.getElementById('chart${i}')));_charts[_charts.length-1].setOption(${JSON.stringify(c.option)});`).join('\n') + `\nwindow.addEventListener('resize',function(){_charts.forEach(function(c){try{c.resize()}catch(e){}})});`
  const sampleNote = analysis.sampled && analysis.sampled.enabled
    ? `<div class="sample-note">注：原数据共 ${fmt(analysis.sampled.total)} 行，本次分析按等距抽样采用其中 ${fmt(analysis.sampled.used)} 行（采样口径：${fmt(analysis.sampled.used)}/${fmt(analysis.sampled.total)} 行）。以下所有图表、结论与占比均基于抽样样本。</div>`
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>数据分析报告</title>
<script>${echartsSource}</script>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#2A2733;max-width:880px;margin:0 auto;padding:24px;background:#FAF9FC}
h1{font-size:22px;margin:0 0 4px} .sub{color:#6B6577;font-size:13px;margin-bottom:20px}
.sample-note{background:#F7F5FB;border:1px solid #E8E5F0;border-radius:8px;padding:8px 12px;font-size:12px;color:#6B6577;margin:-8px 0 16px}
.card{background:#fff;border:1px solid #E8E5F0;border-radius:16px;padding:16px;margin:12px 0}
h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:6px} h2 svg{color:#8B7EC8}
ul{padding-left:18px} li{margin:8px 0;font-size:14px} .cal{color:#6B6577;font-size:12px}
.insight-item{display:flex;gap:8px;align-items:flex-start} .insight-item svg{color:#8B7EC8;flex-shrink:0;margin-top:2px}
.issue-item{display:flex;gap:8px;align-items:flex-start} .issue-item .sev{width:8px;min-width:8px;min-height:20px;border-radius:9999px;margin-top:6px}
.sev-high{background:#C0564B} .sev-medium{background:#C98A2B} .sev-low{background:#8B7EC8} .sev-info{background:#9AA0A6}
.fix{color:#8B7EC8;font-size:12px} .muted{color:#6B6577}
.chart{height:280px;margin:8px 0} table{border-collapse:collapse;width:100%;font-size:12px}
.preview-table-wrap{overflow-x:auto;max-width:100%;border:1px solid #E8E5F0;border-radius:6px}
.preview-table-wrap table{table-layout:auto;min-width:100%;white-space:nowrap}
.preview-table-wrap th,.preview-table-wrap td{border:1px solid #E8E5F0;padding:4px 8px;text-align:left;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.preview-table-wrap th{background:#F5F2FB;font-weight:600;position:sticky;top:0;z-index:1}
.preview-table-wrap tbody tr:nth-child(even) td{background:#FBF9FF}
.score{display:inline-block;width:48px;height:48px;border-radius:50%;border:3px solid #8B7EC8;color:#8B7EC8;font-weight:700;text-align:center;line-height:42px}</style></head>
<body>
<h1>数据分析报告</h1><div class="sub">生成时间：${new Date().toLocaleString('zh-CN')} ｜ 数据 ${table.rows.length} 行 × ${table.columns.length} 列 ｜ 保真模式：真实计算（Mock 引擎）</div>
${sampleNote}
<div class="card"><h2>${iconSvg('quality')} 数据质量</h2><span class="score">${quality.score}</span><p class="sub">检出问题 ${quality.issues.length} 项。建议核查异常点后再据此决策。</p><ul>${issuesHTML}</ul></div>
<div class="card"><h2>${iconSvg('insights')} 分析结论与建议</h2><ul>${insightHTML}</ul></div>
<div class="card"><h2>${iconSvg('charts')} 图表</h2>${chartDivs}</div>
<div class="card"><h2>${iconSvg('data')} 数据预览（前 8 行）</h2><div class="preview-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${dataSample}</tbody></table></div></div>
<script>${chartJS}</script>
</body></html>`
}

// 触发浏览器下载（content 可为 Blob 或字符串）
function downloadBlob(content, fileName, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

// 单个 CSV 单元格转义（含逗号/引号/换行时用双引号包裹）
function csvCell(v) {
  const s = v == null ? '' : String(v)
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// 导出为 CSV（UTF-8 BOM，Excel 直接打开中文不乱码）
export function exportTableCSV(table, fileName = 'data') {
  if (!table || !table.columns || !table.rows) return
  const head = table.columns.map(c => csvCell(c.name)).join(',')
  const lines = table.rows.map(r => table.columns.map(c => csvCell(r[c.name])).join(','))
  const csv = '﻿' + [head, ...lines].join('\r\n')
  downloadBlob(csv, `${fileName}.csv`, 'text/csv;charset=utf-8')
}

// 导出为 Excel（xlsx 按需动态导入，不计入首屏体积）
export async function exportTableXLSX(table, fileName = 'data') {
  if (!table || !table.columns || !table.rows) return
  const XLSX = await import('xlsx')
  const aoa = [
    table.columns.map(c => c.name),
    ...table.rows.map(r => table.columns.map(c => {
      const v = r[c.name]
      if (v == null || v === '') return ''
      if (typeof v === 'number') return v
      const n = Number(v)
      // 形似数字但非 ID/码值（短数字）才转数值，避免订单号等被科学计数
      return (String(v).length <= 15 && !/[^0-9.]/.test(v) && Number.isFinite(n)) ? n : String(v)
    }))
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'data')
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}
