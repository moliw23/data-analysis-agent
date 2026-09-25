// 智能推荐：根据数据集特征（字段类型/语义/基数/分布）规则匹配最合适的图表类型
import { inferSchema, looksLikeId } from './schema.js'
import { isEmpty } from './_shared.js'

// 返回 [{ key, title, kind, spec, reason, weight }]，weight 大者排前
// 异常边界：表格无 rows 或无任何可用列时返回 []
export function recommendCharts(table, maxN = 8) {
  if (!table || !table.rows || !table.rows.length) return []
  const t = inferSchema(table)
  const sample = table.rows.slice(0, 500)
  const measures = t.columns.filter(c => c.semantic === 'measure')
  const dims = t.columns.filter(c => c.semantic === 'dimension')
  const times = t.columns.filter(c => c.semantic === 'time')
  const numericVars = t.columns.filter(c => c.type === 'number' && c.cardinality > 1 && !looksLikeId(c.name, sample.map(r => r[c.name]).filter(v => !isEmpty(v)), table.rows.length || 1))
  const recs = []
  const has = (cond, w = 1) => cond && w
  // 时间趋势：时间列 + 度量
  if (times.length && measures.length) {
    recs.push({ key: 'trend', title: '时间趋势', kind: 'trend', spec: { kind: 'trend', timeCol: times[0].name, measureCol: measures[0].name, granularity: 'auto', op: 'sum' }, reason: `检测到时间字段「${times[0].name}」与度量「${measures[0].name}」`, weight: has(true, 5) })
  }
  // Top N：分类维度（基数 2-30）+ 度量
  const d2 = dims.find(d => d.cardinality >= 2 && d.cardinality <= 30)
  if (d2 && measures.length) {
    recs.push({ key: 'topN', title: 'Top N', kind: 'topN', spec: { kind: 'topN', dimCol: d2.name, measureCol: measures[0].name, op: 'sum', n: 10 }, reason: `分类维度「${d2.name}」（${d2.cardinality} 类）+ 度量「${measures[0].name}」`, weight: 4 })
  }
  // 同环比：时间 + 度量
  if (times.length && measures.length) {
    recs.push({ key: 'momYoy', title: '同环比', kind: 'momYoy', spec: { kind: 'momYoy', timeCol: times[0].name, measureCol: measures[0].name, granularity: 'auto', op: 'sum' }, reason: '时间序列已识别，适合做同/环比分析', weight: 3 })
  }
  // 相关性：≥2 个数值列
  if (numericVars.length >= 2) {
    recs.push({ key: 'corr', title: '相关性分析', kind: 'corr', spec: { kind: 'corr' }, reason: `检测到 ${numericVars.length} 个数值列，可做两两相关分析`, weight: numericVars.length >= 3 ? 4 : 3 })
  }
  // 地图：地区字段（低基数、名称含「省/市/区/country/province/地区」等）
  const REGION_RE = /省|市|区|县|州|盟|地区|state|province|country|region|都市|首都|自治/i
  const region = dims.find(d => REGION_RE.test(d.name) && d.cardinality >= 2 && d.cardinality <= 40)
  if (region && measures.length) {
    recs.push({ key: 'map', title: '地图', kind: 'map', spec: { kind: 'map', regionCol: region.name, measureCol: measures[0].name, op: 'sum' }, reason: `检测到地区字段「${region.name}」`, weight: 4 })
  }
  // 列分析：低基数（≤20）分类列
  const d3 = dims.find(d => d.cardinality <= 20)
  if (d3) {
    recs.push({ key: 'column', title: '列分析', kind: 'column', spec: { kind: 'column', col: d3.name }, reason: `低基数列「${d3.name}」（${d3.cardinality} 类）适合分布/类型分析`, weight: 2 })
  }
  // 透视表：双维度（基数 2-8）
  const d4 = dims.find(d => d.cardinality >= 2 && d.cardinality <= 8)
  const d5 = dims.find(d => d !== d4 && d.cardinality >= 2 && d.cardinality <= 8)
  if (d4 && d5 && measures.length) {
    recs.push({ key: 'pivot', title: '透视表', kind: 'pivot', spec: { kind: 'pivot', rowDim: d4.name, colDim: d5.name, measureCol: measures[0].name, op: 'sum' }, reason: `双维度「${d4.name} × ${d5.name}」适合交叉透视`, weight: 3 })
  }
  // 预测：时间 + 度量
  if (times.length && measures.length) {
    recs.push({ key: 'forecast', title: '预测', kind: 'forecast', spec: { kind: 'forecast', timeCol: times[0].name, measureCol: measures[0].name, granularity: 'auto', op: 'sum', horizon: 6, method: 'linear' }, reason: '时间序列 + 度量 → 推荐预测下 6 个粒度', weight: 2 })
  }
  // 异常检测：时间 + 度量
  if (times.length && measures.length) {
    recs.push({ key: 'anomaly', title: '异常检测', kind: 'anomaly', spec: { kind: 'anomaly', timeCol: times[0].name, measureCol: measures[0].name, granularity: 'auto', op: 'sum', k: 3, method: 'zscore' }, reason: '时间序列可识别异常点（z-score）', weight: 2 })
  }
  // 按权重降序、去重（同一 kind 只保留第一个）
  const seen = new Set()
  const out = []
  recs.sort((a, b) => b.weight - a.weight).forEach(r => {
    if (seen.has(r.key)) return
    seen.add(r.key)
    out.push(r)
  })
  return out.slice(0, maxN)
}
