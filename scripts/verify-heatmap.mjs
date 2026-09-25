// 验证修复 - 大量列场景下的标签可读性
import { heatmapOption, correlation, inferSchema, manualChart } from '../src/engine.js'

// 合成含 7-10 个数值列的测试数据集
const cols = ['id', 'price', 'quantity', 'discount', 'freight', 'tax', 'cost', 'profit', 'score', 'visits']
const rows = []
for (let i = 0; i < 200; i++) {
  const r = { id: 1000 + i }
  r.price = Math.round(10 + Math.random() * 100 * 100) / 100
  r.quantity = Math.round(Math.random() * 10)
  r.discount = Math.round(Math.random() * 50) / 100
  r.freight = Math.round(Math.random() * 20 * 100) / 100
  r.tax = Math.round(Math.random() * 10 * 100) / 100
  r.cost = Math.round(50 + Math.random() * 200 * 100) / 100
  r.profit = Math.round(10 + Math.random() * 80 * 100) / 100
  r.score = Math.round(Math.random() * 100)
  r.visits = Math.round(Math.random() * 1000)
  rows.push(r)
}
const table = { columns: cols.map(n => ({ name: n })), rows }

console.log('--- 工具箱列检测 ---')
const t = inferSchema(table)
t.columns.forEach(c => console.log(`  ${c.name}: type=${c.type}, semantic=${c.semantic}`))

const cor = correlation(table)
console.log('\n--- correlation ---')
console.log('  columns:', cor.columns.join(', '))
console.log('  pairs sample:', cor.pairs.slice(0, 3))

const opt = heatmapOption(cor.matrix, cor.columns)
console.log('\n--- heatmapOption (n=' + cor.columns.length + ') ---')
console.log('  grid.bottom :', opt.grid.bottom, '(应为旋转后更大)')
console.log('  grid.left   :', opt.grid.left)
console.log('  x rotate    :', opt.xAxis.axisLabel.rotate, '°')
console.log('  x fontSize  :', opt.xAxis.axisLabel.fontSize)
console.log('  y fontSize  :', opt.yAxis.axisLabel.fontSize)
console.log('  itemHeight  :', opt.visualMap.itemHeight)
console.log('  label.show  :', opt.series[0].label.show)
console.log('  label.font  :', opt.series[0].label.fontSize)

const fail = []
if (opt.visualMap.itemHeight > 20) fail.push('itemHeight 太大会挤压主网格')
if (cor.columns.length > 6 && opt.xAxis.axisLabel.rotate === 0) fail.push('列数>6 应旋转 x 轴')
if (cor.columns.length > 6 && opt.grid.bottom < 80) fail.push('旋转后 bottom 不足')
if (fail.length) {
  console.error('\n❌ FAIL:', fail)
  process.exit(1)
}
console.log('\n✅ PASS: 热力图布局自适应通过')

// 验证 manualChart（修后工具箱触发链路）
console.log('\n--- manualChart 各 kind 链路 ---')
const kinds = ['trend', 'topN', 'momYoy', 'corr']
const measure = cor.columns[0]
for (const k of kinds) {
  let spec
  if (k === 'trend' || k === 'momYoy') {
    spec = { kind: k, measureCol: measure, granularity: 'auto', op: 'sum' }
  } else if (k === 'topN') {
    spec = { kind: k, dimCol: 'id', measureCol: measure, op: 'sum', n: 5 }
  } else {
    spec = { kind: 'corr' }
  }
  const chart = manualChart(table, spec)
  if (!chart) { console.log(`  ${k}: ❌ 返回 null`); continue }
  console.log(`  ${k}: ✅ ${chart.title} (type=${chart.type})`)
}
