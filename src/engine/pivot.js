// 交互式看板：多维筛选、下钻值反查、数据透视表
import { isEmpty, toNum, genderLabel } from './_shared.js'

// 交互看板：多维 AND、同维多值 OR 的维度筛选
export function applyFilters(table, filters) {
  const rows = (table && table.rows) || []
  if (!filters || !filters.length) return table
  const out = rows.filter(r => filters.every(f => f.values && f.values.length ? f.values.includes(r[f.dim]) : true))
  return { columns: table.columns, rows: out }
}
// 下钻：图表标签（可能经 genderLabel 转义）还原为原始行值，确保筛选命中
export function matchDrillValue(table, dim, label) {
  const rows = (table && table.rows) || []
  const rawVals = new Set(rows.map(r => r[dim]).filter(v => v !== '' && v != null).map(v => String(v)))
  if (rawVals.has(String(label))) return String(label)
  for (const r of rawVals) { if (genderLabel(dim, r) === label) return r }
  for (const r of rawVals) { if (String(r).trim() === String(label).trim()) return r }
  return String(label)
}

// 数据透视表（pivot）：行列维度交叉聚合
export function pivot(table, { rowDim, colDim, measure, op = 'sum' } = {}) {
  const rows = (table && table.rows) || []
  if (!rowDim || !colDim || !measure) return null
  const MAX_CARD = 60 // 维度基数上限，防止交叉表爆炸
  const agg = (arr) => {
    if (op === 'count') return arr.length
    const vs = arr.map(r => toNum(r[measure])).filter(v => !isNaN(v))
    if (!vs.length) return null
    if (op === 'avg') return vs.reduce((a, b) => a + b, 0) / vs.length
    if (op === 'max') return Math.max(...vs)
    if (op === 'min') return Math.min(...vs)
    return vs.reduce((a, b) => a + b, 0)
  }
  const rSeen = new Set(), cSeen = new Set()
  const rKeys = [], cKeys = []
  rows.forEach(r => {
    const rk = r[rowDim], ck = r[colDim]
    if (isEmpty(rk) || isEmpty(ck)) return
    if (!rSeen.has(rk)) { rSeen.add(rk); rKeys.push(rk) }
    if (!cSeen.has(ck)) { cSeen.add(ck); cKeys.push(ck) }
  })
  if (!rKeys.length || !cKeys.length) return null
  const rTrunc = rKeys.length > MAX_CARD
  const cTrunc = cKeys.length > MAX_CARD
  const rUse = rTrunc ? rKeys.slice(0, MAX_CARD) : rKeys
  const cUse = cTrunc ? cKeys.slice(0, MAX_CARD) : cKeys
  const cell = {}
  rUse.forEach(rk => { cell[rk] = {}; cUse.forEach(ck => { cell[rk][ck] = [] }) })
  rows.forEach(r => {
    const rk = r[rowDim], ck = r[colDim]
    if (cell[rk] && ck in cell[rk]) cell[rk][ck].push(r)
  })
  const data = rUse.map(rk => {
    const row = [rk]
    cUse.forEach(ck => {
      const val = agg(cell[rk][ck])
      row.push(val == null ? '' : (Number.isInteger(val) ? val : +val.toFixed(2)))
    })
    return row
  })
  return {
    head: [`${rowDim} \\ ${colDim}`, ...cUse],
    rows: data,
    rowKeys: rUse, colKeys: cUse,
    truncated: rTrunc || cTrunc
  }
}
