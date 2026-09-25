import { pivot, columnProfile, inferSchema, manualChart } from '../src/engine.js'

const rows = []
for (let i = 0; i < 240; i++) {
  rows.push({
    region: ['North', 'South', 'East', 'West'][i % 4],
    cat: ['A', 'B', 'C'][i % 3],
    amount: (i * 7 % 100) + 1,
    age: 20 + (i % 50),
    day: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`
  })
}
const table = { columns: [{ name: 'region' }, { name: 'cat' }, { name: 'amount' }, { name: 'age' }, { name: 'day' }], rows }

console.log('=== schema ===')
console.log(inferSchema(table).columns.map(c => `${c.name}:${c.type}/${c.semantic}`).join('  '))

console.log('\n=== pivot: region × cat, sum(amount) ===')
const p = pivot(table, { rowDim: 'region', colDim: 'cat', measure: 'amount', op: 'sum' })
console.log('head:', p.head)
console.log('rows:', JSON.stringify(p.rows))

// 独立校验 North×A
const northA = rows.filter(r => r.region === 'North' && r.cat === 'A').reduce((s, r) => s + r.amount, 0)
const cellNA = p.rows.find(r => r[0] === 'North')[p.head.indexOf('A')]
console.log(`独立校验 North×A = ${northA}，引擎结果 = ${cellNA}，${northA === cellNA ? '✅一致' : '❌不一致'}`)

console.log('\n=== columnProfile(amount) 数值列 ===')
const prof = columnProfile(table, 'amount')
console.log('count/unique/missing:', prof.count, prof.unique, prof.missing)
console.log('stats:', { min: prof.stats.min, max: prof.stats.max, mean: +prof.stats.mean.toFixed(2), median: prof.stats.median })
console.log('hist bins:', prof.hist.bins, 'bins和=', prof.hist.bins.reduce((a, b) => a + b, 0))

console.log('\n=== columnProfile(region) 类别列 ===')
const pc = columnProfile(table, 'region')
console.log('topValues:', pc.topValues.map(t => `${t.value}:${t.count}(${t.pct.toFixed(1)}%)`).join('  '))

console.log('\n=== manualChart pivot ===')
const ch1 = manualChart(table, { kind: 'pivot', rowDim: 'region', colDim: 'cat', measureCol: 'amount', op: 'sum' })
console.log('type:', ch1.type, '| table.head:', ch1.table.head, '| rows:', ch1.table.rows.length)

console.log('\n=== manualChart column(amount) ===')
const ch2 = manualChart(table, { kind: 'column', col: 'amount' })
console.log('type:', ch2.type, '| hasTable:', !!ch2.table, '| hasOption(直方图):', !!ch2.option)

console.log('\n=== manualChart column(region) ===')
const ch3 = manualChart(table, { kind: 'column', col: 'region' })
console.log('type:', ch3.type, '| topRows:', ch3.table.rows.length)

console.log('\nALL DONE')
