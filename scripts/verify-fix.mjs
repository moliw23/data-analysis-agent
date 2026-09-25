// 验证修复：heatmapOption 渲染参数 + 工具箱列检测
import { heatmapOption, inferSchema, looksLikeId, correlation } from '../src/engine.js'

// 工具函数：载入 trade_history 数据前 100 行
import { readFileSync } from 'node:fs'
const csv = readFileSync(process.argv[2] || 'E:/edata/data/tianchi_mum_baby_trade_history.csv', 'utf8')
const lines = csv.trim().split(/\r?\n/)
const headers = lines[0].split(',').map(s => s.trim())
const rows = lines.slice(1, 200).map(l => {
  const arr = l.split(',')
  const o = {}
  headers.forEach((h, i) => { o[h] = (arr[i] ?? '').trim() })
  return o
})
const table = { columns: headers.map(h => ({ name: h })), rows }

console.log('--- 原始 columns ---')
console.log(headers)

// 1. 验证 schema 推断（修复工具箱用）
const typed = inferSchema(table)
console.log('\n--- typed schema ---')
typed.columns.forEach(c => console.log(`${c.name}: type=${c.type}, semantic=${c.semantic}, card=${c.cardinality}`))

// 2. 模拟 toolbox 用 schema 检测 numericCols（修复后逻辑）
const measures = typed.columns.filter(c => c.semantic === 'measure').map(c => c.name)
const dimensions = typed.columns.filter(c => c.semantic === 'dimension').map(c => c.name)
const times = typed.columns.filter(c => c.semantic === 'time').map(c => c.name)
console.log('\n--- toolbox 列分组 ---')
console.log('timeCols :', times)
console.log('numericCols (measures):', measures)
console.log('dimCandidates (dimensions):', dimensions)

// 3. 验证 heatmapOption 关键参数（修复视觉挤压）
const cor = correlation(table)
console.log('\n--- correlation ---')
console.log('columns:', cor.columns)
console.log('matrix sample:', cor.matrix[0].slice(0, 3))
const opt = heatmapOption(cor.matrix, cor.columns)
console.log('\n--- heatmapOption 关键参数 ---')
console.log('grid:', opt.grid)
console.log('visualMap.itemHeight :', opt.visualMap.itemHeight, '(修复前=120, 现应=12)')
console.log('visualMap.itemWidth  :', opt.visualMap.itemWidth)
console.log('visualMap.bottom     :', opt.visualMap.bottom)
console.log('xAxis.rotate         :', opt.xAxis.axisLabel.rotate)
console.log('xAxis.fontSize       :', opt.xAxis.axisLabel.fontSize)
console.log('yAxis.fontSize       :', opt.yAxis.axisLabel.fontSize)
console.log('series[0].label.show :', opt.series[0].label.show)
console.log('series[0].label.font :', opt.series[0].label.fontSize)

// 4. 简易断言
const fail = []
if (opt.visualMap.itemHeight !== 12) fail.push('visualMap.itemHeight should be 12')
if (opt.visualMap.itemHeight > 20) fail.push('visualMap.itemHeight too large (will crush grid)')
if (measures.length === 0) fail.push('no measures detected — toolbox 趋势/TopN 无法工作')
if (fail.length) {
  console.error('\n❌ FAIL:', fail)
  process.exit(1)
}
console.log('\n✅ PASS: 所有修复项验证通过')
