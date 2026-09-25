import { timeSeries, forecast, detectAnomalies, mapOption, applyFilters, matchDrillValue, analyze } from '../src/engine.js'

// 构造 12 个月 × 2 地区 × 2 品类的销售数据
const months = ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']
const regions = ['广东','北京','浙江']
const rows = []
let seed = 100
for (const m of months) {
  for (const r of regions) {
    for (const c of ['A','B']) {
      seed += 37
      const v = 500 + (seed % 400) + (r === '广东' ? 800 : 0) + (c === 'A' ? 200 : 0)
      rows.push({ month: m, region: r, category: c, sales: v })
    }
  }
}
// 注入一个异常点
rows.push({ month: '2025-07', region: '北京', category: 'A', sales: 99999 })

const table = { columns: [{name:'month'},{name:'region'},{name:'category'},{name:'sales'}], rows }

// 1) 时间序列
const ts = timeSeries(table, 'month', 'sales', { granularity: 'month', op: 'sum' })
console.log('[timeSeries] 点数:', ts.length, '首末:', ts[0].bucket, ts[ts.length-1].bucket)

// 2) 预测
const fc = forecast(ts, { horizon: 3, method: 'linear' })
console.log('[forecast] R2=', fc.r2, 'MAPE=', fc.mape, 'trend=', fc.trend, '未来3期=', fc.forecast.map(f=>f.bucket+':'+Math.round(f.value)))

// 3) 异常检测
const an = detectAnomalies(ts, { k: 3, method: 'zscore' })
console.log('[anomaly] 异常数=', an.count, '中心=', Math.round(an.center), '区间=', Math.round(an.lower), '~', Math.round(an.upper))

// 4) 地图聚合
const mo = mapOption('region', 'sales', table, { op: 'sum' })
console.log('[map] 地区数=', mo.data.length, '示例=', mo.data.slice(0,3).map(d=>d.name+':'+Math.round(d.value)))

// 5) 筛选
const f = applyFilters(table, [{ dim: 'category', values: ['A'] }])
console.log('[filter] 总行数=', table.rows.length, '→ 筛选后=', f.rows.length)

// 6) 下钻值反查
const raw = matchDrillValue(table, 'category', 'A')
console.log('[matchDrill] A →', raw)

// 7) analyze 不报错且含图表
const a = analyze(table)
console.log('[analyze] 图表数=', a.charts.length, '洞察数=', a.insights.length, 'drillDim示例=', a.charts.find(c=>c.drillDim)?.drillDim)
console.log('ALL OK')
