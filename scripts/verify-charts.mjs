import { manualChart } from '../src/engine.js'

// 构造示例：多月份 × 多地区 × 销售额
const months = ['2024-01','2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08']
const regions = ['广东','北京','上海','四川','浙江']
const rows = []
months.forEach(m => regions.forEach(r => {
  rows.push({ month: m, region: r, sales: Math.round(50 + Math.random()*200) })
}))

const table = { columns: [{name:'month'},{name:'region'},{name:'sales'}], rows }

const cases = [
  { name: 'map', spec: { kind: 'map', regionCol: 'region', measureCol: 'sales', op: 'sum' } },
  { name: 'forecast', spec: { kind: 'forecast', timeCol: 'month', measureCol: 'sales', granularity: 'month', op: 'sum', horizon: 3, method: 'linear' } },
  { name: 'anomaly', spec: { kind: 'anomaly', timeCol: 'month', measureCol: 'sales', granularity: 'month', op: 'sum', k: 3, method: 'zscore' } },
]

let ok = true
for (const c of cases) {
  try {
    const chart = manualChart(table, c.spec)
    if (!chart || !chart.option) { console.log(`[${c.name}] FAIL: 返回空`); ok = false; continue }
    if (c.name === 'map') {
      const o = chart.option
      if (o._map !== 'china' || !Array.isArray(o.data) || !o.data.length) { console.log(`[${c.name}] FAIL: 结构错误`, JSON.stringify(o).slice(0,120)); ok = false; continue }
      console.log(`[${c.name}] OK 地区数=${o.data.length} max=${o.max}`)
    } else {
      if (!chart.option.series || !chart.option.series.length) { console.log(`[${c.name}] FAIL: 无 series`); ok = false; continue }
      console.log(`[${c.name}] OK series=${chart.option.series.length} title="${chart.title}"`)
    }
  } catch (e) { console.log(`[${c.name}] THROW: ${e.message}`); ok = false }
}
console.log(ok ? 'CHARTS VERIFY: PASS' : 'CHARTS VERIFY: FAIL')
process.exit(ok ? 0 : 1)
