// 相关性：数值列两两皮尔逊系数（成对删除缺失）+ 热力图 option
import { inferSchema, looksLikeId } from './schema.js'
import { isEmpty, toNum } from './_shared.js'

// 皮尔逊相关系数（成对向量）
function pearson(a, b) {
  const n = a.length
  if (n < 2) return 0
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb }
  const den = Math.sqrt(da * db)
  return den ? num / den : 0
}

// 相关性：数值列两两皮尔逊系数，成对删除缺失。cols 缺省=全部数值类型列（type=number 且非 ID），>20 截断前 20 列
export function correlation(table, cols) {
  const t = inferSchema(table)
  const allRows = (table && table.rows) || []
  // 排除无方差常量列（cardinality<=1）：常量无法计算有意义的相关，纳入只会产生退化的 0/NaN 矩阵
  let numCols = t.columns.filter(c => c.type === 'number' && !looksLikeId(c.name, allRows.map(r => r[c.name]).filter(v => !isEmpty(v)), allRows.length || 1) && c.cardinality > 1)
  if (cols && cols.length) numCols = numCols.filter(c => cols.includes(c.name))
  let truncated = false
  if (numCols.length > 20) { numCols = numCols.slice(0, 20); truncated = true }
  // 多表关联后同源列去重：quantity / quantity_2 / quantity_3 等视为同一含义（joinTables 加 _N 后缀避免覆盖）
  // 否则相关性矩阵会出现「自相关（恒=1 或 NaN）」无意义格子，且 -1.1 等异常值可能来自大量缺失对的小样本计算
  const norm = n => String(n).replace(/_\d+$/, '')
  const seenNorm = new Set()
  const deduped = []
  const sameOrigin = []
  for (const c of numCols) {
    const k = norm(c.name)
    if (seenNorm.has(k)) { sameOrigin.push(c.name); continue }
    seenNorm.add(k)
    deduped.push(c)
  }
  numCols = deduped
  const names = numCols.map(c => c.name)
  const n = names.length
  const matrix = Array.from({ length: n }, () => Array(n).fill(0))
  const pairs = []
  const rows = (table && table.rows) || []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { matrix[i][j] = 1; continue }
      const A = [], B = []
      for (const r of rows) {
        const a = toNum(r[names[i]]), b = toNum(r[names[j]])
        if (!isNaN(a) && !isNaN(b)) { A.push(a); B.push(b) }
      }
      const r = pearson(A, B)
      matrix[i][j] = Math.round(r * 1000) / 1000
      if (i < j) pairs.push({ a: names[i], b: names[j], r: matrix[i][j] })
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
  return { matrix, columns: names, pairs, truncated, sameOrigin }
}

// 相关性热力图 option（ECharts heatmap）
// 列数过多（>6）时旋转 x 轴标签避免重叠；visualMap 高度调小给热力图留足空间
export function heatmapOption(matrix, columns) {
  const data = []
  for (let i = 0; i < columns.length; i++)
    for (let j = 0; j < columns.length; j++)
      data.push([j, i, matrix[i][j]])
  const n = columns.length
  // 列越多 → x 轴标签倾斜、字号越小、网格留白加大
  const rotate = n > 8 ? 50 : n > 5 ? 35 : 0
  const xFontSize = n > 10 ? 9 : n > 6 ? 10 : 11
  const yFontSize = n > 10 ? 9 : 10
  const leftPad = Math.min(160, Math.max(72, Math.max(...columns.map(c => String(c).length)) * 7))
  const bottomPad = rotate ? 84 + (n > 10 ? 16 : 0) : 60
  return {
    tooltip: { position: 'top', formatter: p => `${columns[p.data[1]]} × ${columns[p.data[0]]}: ${p.data[2]}` },
    grid: { left: leftPad, right: 20, top: 18, bottom: bottomPad, containLabel: false },
    xAxis: {
      type: 'category', data: columns, splitArea: { show: true },
      axisLabel: {
        color: '#6B6577', fontSize: xFontSize, rotate, interval: 0,
        hideOverlap: false,
        formatter: v => {
          // 超长列名截断，避免倾斜后仍占满
          const s = String(v)
          return s.length > 10 ? s.slice(0, 9) + '…' : s
        }
      },
      axisLine: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'category', data: columns, splitArea: { show: true },
      axisLabel: {
        color: '#6B6577', fontSize: yFontSize, interval: 0,
        formatter: v => {
          const s = String(v)
          return s.length > 12 ? s.slice(0, 11) + '…' : s
        }
      },
      axisLine: { show: false }, axisTick: { show: false }
    },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal',
      left: 'center', bottom: 6,
      itemWidth: 12, itemHeight: 12,  // horizontal：itemHeight 是色块厚度（px），旧值 120/140 太厚挤压网格
      inRange: { color: ['#6B6577', '#E9E5F4', '#8B7EC8'] },
      textStyle: { color: '#6B6577', fontSize: 11 }
    },
    series: [{
      type: 'heatmap', data,
      label: {
        show: n <= 8,
        color: '#2A2733', fontSize: n > 6 ? 9 : 10,
        formatter: p => (Math.abs(p.data[2]) >= 0.99 ? '' : (p.data[2] >= 0 ? '+' : '') + p.data[2].toFixed(2))
      },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(42,39,51,.25)' } }
    }]
  }
}
