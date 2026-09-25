// 报告导出：PDF（iframe 打印）+ Word（HTML-to-.doc，图表转 PNG dataURL）
// echarts 改为按需动态导入，避免与首屏图表库重复打包

// 从 lucide-react v0.400.0 提取的 SVG path（与 engine.js 保持一致）
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
  charts: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
}

// SVG 字符串 → PNG dataURL（Word 等不支持 SVG 的场景用）
function svgToPngDataURL(svgString, size = 32, color = '#8B7EC8') {
  return new Promise((resolve, reject) => {
    // 替换 stroke 颜色为传入色
    const svg = svgString.replace(/stroke="[^"]*"/g, `stroke="${color}"`)
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      try { resolve(canvas.toDataURL('image/png')) } catch (e) { reject(e) }
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

// 离屏渲染图表 → PNG dataURL 列表
export async function chartsToPNGs(charts, width = 720, height = 340) {
  const mod = await import('echarts')
  const echarts = mod.default || mod
  const out = []
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;`
  document.body.appendChild(host)
  try {
    charts.slice(0, 6).forEach(c => {
      const el = document.createElement('div')
      el.style.cssText = `width:${width}px;height:${height}px;`
      host.appendChild(el)
      const inst = echarts.init(el)
      inst.setOption(c.option)
      out.push({ title: c.title, insight: c.insight, caliber: c.caliber, png: inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' }) })
      inst.dispose()
      host.removeChild(el)
    })
  } finally {
    document.body.removeChild(host)
  }
  return out
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// 严重程度 → 小色点 PNG（Word 用，模仿原 HTML 中的彩色圆点）
function sevColor(sev) { return sev === 'high' ? '#C0564B' : sev === 'medium' ? '#C98A2B' : sev === 'info' ? '#9AA0A6' : '#8B7EC8' }
function sevLabel(sev) { return sev === 'high' ? '高' : sev === 'medium' ? '中' : sev === 'info' ? '提示' : '低' }
function dotDataURL(color, size = 10) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const ctx = c.getContext('2d'); ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); ctx.fill()
  return c.toDataURL('image/png')
}

// 把图标转成 PNG map（Word 不可靠渲染 SVG，必须转）
async function buildIconPNGs() {
  const out = {}
  for (const [name, path] of Object.entries(ICON_SVG)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8B7EC8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
    try { out[name] = await svgToPngDataURL(svg, 32) }
    catch { out[name] = '' }
  }
  return out
}

// 导出 Word (.doc)：Word HTML 命名空间 + PNG 图片 + 表格（图表、图标、严重程度色点均为 PNG，确保 Word/WPS 显示）
export async function exportWord(table, analysis, quality, fileName) {
  const pngs = await chartsToPNGs(analysis.charts)
  const iconPng = await buildIconPNGs()
  const insightHtml = analysis.insights.map(i => {
    const iconSrc = iconPng[i.icon] || iconPng.summary || ''
    return `<p style="margin:6pt 0;display:flex;align-items:flex-start;gap:4pt">
      ${iconSrc ? `<img src="${iconSrc}" width="14" height="14" style="flex-shrink:0;margin-top:3pt"/>` : ''}
      <span><b>${esc(i.text)}</b><br><span style="color:#6B6577;font-size:9pt">${esc(i.caliber || '')}</span></span>
    </p>`
  }).join('')
  const issueHtml = quality.issues.length
    ? quality.issues.map(i => {
        const dot = dotDataURL(sevColor(i.severity))
        return `<p style="margin:4pt 0;display:flex;align-items:flex-start;gap:4pt">
          <img src="${dot}" width="6" height="14" style="flex-shrink:0;margin-top:2pt"/>
          <span>[${esc(sevLabel(i.severity))}] <b>${esc(i.col)}</b> · ${esc(i.type)} — ${esc(i.detail)}</span>
        </p>`
      }).join('')
    : '<p>未检出明显数据质量问题。</p>'
  const chartHtml = pngs.map(p => `
    <div style="margin:10pt 0">
      <p style="font-weight:bold;margin:0 0 4pt">${esc(p.title)}</p>
      <img src="${p.png}" width="640" />
      ${p.insight ? `<p style="font-size:10pt;margin:4pt 0">${esc(p.insight)}</p>` : ''}
      ${p.caliber ? `<p style="color:#6B6577;font-size:9pt;margin:2pt 0">${esc(p.caliber)}</p>` : ''}
    </div>`).join('')
  const head = table.columns.map(c => `<th style="border:1px solid #E8E5F0;padding:4pt 6pt;background:#F3F1F8">${esc(c.name)}</th>`).join('')
  const sample = table.rows.slice(0, 8).map(r => `<tr>${table.columns.map(c => `<td style="border:1px solid #E8E5F0;padding:4pt 6pt">${esc(r[c.name])}</td>`).join('')}</tr>`).join('')
  const sampleNote = analysis.sampled && analysis.sampled.enabled
    ? `<p style="color:#C0564B;font-size:9pt;margin:2pt 0 6pt">注：原数据共 ${Number(analysis.sampled.total).toLocaleString('zh-CN')} 行，本次分析按等距抽样采用其中 ${Number(analysis.sampled.used).toLocaleString('zh-CN')} 行，以下图表与结论均基于抽样样本。</p>`
    : ''

  // 章节图标
  const icQuality = iconPng.quality || ''
  const icInsights = iconPng.insights || ''
  const icCharts = iconPng.charts || ''
  const icData = iconPng.data || ''

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>数据分析报告</title>
<style>body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:10.5pt;color:#2A2733} h1{font-size:16pt} h2{font-size:13pt;border-bottom:1px solid #E8E5F0;padding-bottom:3pt}</style>
</head><body>
<h1>数据分析报告</h1>
<p style="color:#6B6577;font-size:9pt">生成时间 ${new Date().toLocaleString('zh-CN')} ｜ 数据 ${table.rows.length} 行 × ${table.columns.length} 列</p>
${sampleNote}
<h2>${icQuality ? `<img src="${icQuality}" width="16" height="16" style="vertical-align:-3pt;margin-right:4pt"/>` : ''}数据质量</h2>
<p>综合评分：<b>${quality.score} / 100</b>，检出问题 ${quality.issues.length} 项。</p>
${issueHtml}
<h2>${icInsights ? `<img src="${icInsights}" width="16" height="16" style="vertical-align:-3pt;margin-right:4pt"/>` : ''}分析结论与建议</h2>
${insightHtml}
<h2>${icCharts ? `<img src="${icCharts}" width="16" height="16" style="vertical-align:-3pt;margin-right:4pt"/>` : ''}图表</h2>
${chartHtml}
<h2>${icData ? `<img src="${icData}" width="16" height="16" style="vertical-align:-3pt;margin-right:4pt"/>` : ''}数据预览（前 8 行）</h2>
<table style="border-collapse:collapse;font-size:9pt"><thead><tr>${head}</tr></thead><tbody>${sample}</tbody></table>
</body></html>`

  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName || '数据分析报告'}.doc`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

// 导出 PDF：等 iframe 内图表渲染完成后调起打印
export function exportPDF(iframeRef) {
  const delay = 600
  setTimeout(() => {
    try {
      const win = iframeRef.current && iframeRef.current.contentWindow
      if (win) { win.focus(); win.print() }
      else window.print()
    } catch { window.print() }
  }, delay)
}

// 导出 PPTX：纯前端生成可编辑幻灯片（文本框 + 表格 + 图表图片）。pptxgenjs 动态加载，不进首屏。
// 复用 chartsToPNGs 把图表离屏渲染为 PNG；所有文字/数字与界面、Word 完全一致（同源 analysis）。
export async function exportPPTX(analysis, table, quality, fileName) {
  const pptxgen = (await import('pptxgenjs')).default
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 × 7.5 in
  pptx.author = '数据分析 Agent'
  pptx.company = '数据分析 Agent'
  pptx.title = fileName || '数据分析报告'
  const A = '8B7EC8'   // 主色（不带 #）
  const DARK = '2A2733' // 正文
  const MUT = '6B6577'  // 次要
  const BADC = 'C0564B' // 告警

  // 封面
  const cover = pptx.addSlide()
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.5, w: 1.3, h: 0.09, fill: { color: A } })
  cover.addText('数据分析报告', { x: 0.6, y: 2.75, w: 12, h: 1.1, fontSize: 40, bold: true, color: DARK })
  cover.addText(`${table.rows.length} 行 × ${table.columns.length} 列 | 生成时间 ${new Date().toLocaleString('zh-CN')}`, { x: 0.6, y: 3.95, w: 12, h: 0.5, fontSize: 14, color: MUT })
  if (analysis.sampled && analysis.sampled.enabled) {
    cover.addText(`（原数据 ${Number(analysis.sampled.total).toLocaleString('zh-CN')} 行，按等距抽样采用 ${Number(analysis.sampled.used).toLocaleString('zh-CN')} 行）`, { x: 0.6, y: 4.4, w: 12, h: 0.4, fontSize: 12, color: BADC })
  }

  // 数据质量
  const q = pptx.addSlide()
  q.addText('数据质量', { x: 0.6, y: 0.5, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK })
  q.addText(`综合评分 ${quality.score} / 100 检出问题 ${quality.issues.length} 项`, { x: 0.6, y: 1.25, w: 12, h: 0.5, fontSize: 16, color: MUT })
  const qIssues = quality.issues.length
    ? quality.issues.map(i => `[${i.severity || 'info'}] ${i.col} · ${i.type} — ${i.detail}`)
    : ['未检出明显数据质量问题。']
  q.addText(qIssues.map(t => ({ text: t, options: { color: DARK, fontSize: 13 } })), { x: 0.6, y: 1.95, w: 12, h: 4.5, bullet: true, lineSpacingMultiple: 1.25 })

  // 分析结论与建议
  if (analysis.insights && analysis.insights.length) {
    const s = pptx.addSlide()
    s.addText('分析结论与建议', { x: 0.6, y: 0.5, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK })
    s.addText(
      analysis.insights.map(i => ({ text: i.text + (i.caliber ? `\n（口径：${i.caliber}）` : ''), options: { color: DARK, fontSize: 14 } })),
      { x: 0.6, y: 1.3, w: 12, h: 5.4, bullet: { code: '2022' }, lineSpacingMultiple: 1.25 }
    )
  }

  // 图表（复用离屏渲染 PNG，取前 6 张）
  const pngs = await chartsToPNGs(analysis.charts)
  pngs.forEach(p => {
    const s = pptx.addSlide()
    s.addText(p.title || '图表', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 20, bold: true, color: DARK })
    s.addImage({ data: p.png, x: 1.0, y: 1.2, w: 11.3, h: 5.0 })
    const note = [p.insight, p.caliber].filter(Boolean).join(' | ')
    if (note) s.addText(note, { x: 1.0, y: 6.35, w: 11.3, h: 0.5, fontSize: 11, color: MUT })
  })

  // 数据预览（前 8 行）
  const pv = pptx.addSlide()
  pv.addText('数据预览（前 8 行）', { x: 0.6, y: 0.5, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK })
  const headRow = table.columns.map(c => ({ text: String(c.name), options: { bold: true, fill: { color: 'F3F1F8' }, color: DARK, fontSize: 11, align: 'left' } }))
  const bodyRows = table.rows.slice(0, 8).map(r => table.columns.map(c => ({ text: String(r[c.name] ?? ''), options: { color: DARK, fontSize: 10 } })))
  pv.addTable([headRow, ...bodyRows], { x: 0.6, y: 1.3, w: 12, border: { type: 'solid', color: 'E8E5F0', pt: 0.5 }, fontFace: 'Microsoft YaHei', valign: 'middle' })

  await pptx.writeFile({ fileName: `${fileName || '数据分析报告'}.pptx` })
}
