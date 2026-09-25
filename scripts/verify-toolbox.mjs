// 用真实时间列验证 manualChart 链路
import { inferSchema, manualChart } from '../src/engine.js'
import { readFileSync } from 'node:fs'
const csv = readFileSync('E:/edata/data/tianchi_mum_baby_trade_history.csv', 'utf8')
const lines = csv.trim().split(/\r?\n/)
const headers = lines[0].split(',').map(s => s.trim())
const rows = lines.slice(1, 1000).map(l => {
  const a = l.split(',')
  const o = {}
  headers.forEach((h, i) => { o[h] = (a[i] ?? '').trim() })
  return o
})
const table = { columns: headers.map(h => ({ name: h })), rows }
const t = inferSchema(table)
const measure = t.columns.find(c => c.semantic === 'measure')
const time = t.columns.find(c => c.semantic === 'time')
const dim = t.columns.find(c => c.semantic === 'dimension' && c.cardinality >= 4)
console.log(`measure=${measure && measure.name}; time=${time && time.name}; dim=${dim && dim.name}`)

console.log('\n--- 4 种图表全部验证 ---')
const kinds = [
  { kind: 'trend',  spec: { kind: 'trend', measureCol: measure.name, granularity: 'auto', op: 'sum' } },
  { kind: 'topN',   spec: { kind: 'topN', dimCol: dim.name, measureCol: measure.name, op: 'sum', n: 5 } },
  { kind: 'momYoy', spec: { kind: 'momYoy', measureCol: measure.name, granularity: 'auto', op: 'sum' } },
  { kind: 'corr',   spec: { kind: 'corr' } },
]
for (const k of kinds) {
  const c = manualChart(table, k.spec)
  if (!c) { console.log(`  ${k.kind}: ❌`); continue }
  console.log(`  ${k.kind}: ✅ "${c.title}" type=${c.type}, caliber=${c.caliber.slice(0, 60)}...`)
}

// 工具箱 fix：用 schema 推导列分组
console.log('\n--- 工具箱列检测 ---')
console.log('  timeCols :', t.columns.filter(c => c.semantic === 'time').map(c => c.name))
console.log('  numericCols (semantic=measure):', t.columns.filter(c => c.semantic === 'measure').map(c => c.name))
console.log('  dimCandidates (semantic=dimension):', t.columns.filter(c => c.semantic === 'dimension').map(c => c.name))
