// 数据清洗：缺失值填充 / 去首尾空白 / 去重 / 异常值处理（均为纯函数，不改原表）
import { isEmpty, isNumeric, toNum } from './_shared.js'

// 返回新行数组副本（清洗类函数均不改原表）
function copyRows(rows) { return rows.map(r => ({ ...r })) }

// 缺失值填充：数值列支持 mean/median/mode/const；非数值列自动回退 mode 或 const
export function cleanFillMissing(rows, colMap, { strategy = 'mean', constValue } = {}) {
  const cols = colMap == null ? [] : (Array.isArray(colMap) ? colMap : [colMap])
  const out = copyRows(rows)
  const stats = []
  for (const col of cols) {
    const missIdx = []
    rows.forEach((r, i) => { if (isEmpty(r[col])) missIdx.push(i) })
    const filled = missIdx.length
    if (!filled) { stats.push({ col, filled: 0 }); continue }
    const nonEmpty = rows.map(r => r[col]).filter(v => !isEmpty(v))
    const numeric = nonEmpty.length > 0 && nonEmpty.every(isNumeric)
    const strat = (numeric || strategy === 'mode' || strategy === 'const') ? strategy : 'mode'
    let fillValue = constValue == null ? '' : constValue
    if (strat === 'mean') {
      const nums = nonEmpty.map(toNum)
      fillValue = String(nums.reduce((a, b) => a + b, 0) / nums.length)
    } else if (strat === 'median') {
      const nums = nonEmpty.map(toNum).sort((a, b) => a - b)
      const mid = Math.floor(nums.length / 2)
      fillValue = String(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2)
    } else if (strat === 'mode') {
      if (nonEmpty.length) {
        const freq = {}
        nonEmpty.forEach(v => { const k = String(v); freq[k] = (freq[k] || 0) + 1 })
        let best = null, bestN = 0
        for (const k of Object.keys(freq)) { if (freq[k] > bestN) { bestN = freq[k]; best = k } }
        fillValue = best
      }
    }
    missIdx.forEach(i => { out[i][col] = String(fillValue) })
    stats.push({ col, filled })
  }
  return { rows: out, stats }
}

// 去首尾空白：cols 缺省 = 全部字符串列（本系统解析后所有值均为字符串，即全部列）
export function cleanTrim(rows, cols = null) {
  const allCols = []
  rows.forEach(r => { Object.keys(r).forEach(k => { if (!allCols.includes(k)) allCols.push(k) }) })
  const targets = cols && cols.length ? cols : allCols
  const out = copyRows(rows)
  const stats = []
  for (const col of targets) {
    let trimmed = 0
    out.forEach(r => {
      const v = r[col]
      if (typeof v === 'string') {
        const t = v.trim()
        if (t !== v) { r[col] = t; trimmed++ }
      }
    })
    stats.push({ col, trimmed })
  }
  return { rows: out, stats }
}

// 去重：cols 缺省 = 全列完全重复（保留首次出现）；指定 cols 时按这些列判重
export function cleanDedupe(rows, cols = null) {
  const keyCols = cols && cols.length ? cols : Object.keys(rows[0] || {})
  const seen = new Set()
  const out = []
  let dupsRemoved = 0
  for (const r of rows) {
    const key = JSON.stringify(keyCols.map(c => r[c]))
    if (seen.has(key)) { dupsRemoved++; continue }
    seen.add(key)
    out.push({ ...r })
  }
  return { rows: out, stats: { dupsRemoved, keyCols } }
}

// 异常值处理：IQR（Q1/Q3 分位与 qualityCheck 完全同口径）/3sigma；dropRow=删行，mask=值置 ''
export function cleanOutliers(rows, col, { method = 'IQR', action = 'dropRow' } = {}) {
  const nums = rows.map(r => toNum(r[col])).filter(v => !isNaN(v))
  const badValues = new Set()
  if (nums.length >= 4) {
    const sorted = [...nums].sort((a, b) => a - b)
    if (method === '3sigma') {
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
      const sd = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length)
      sorted.forEach(v => { if (Math.abs(v - mean) > 3 * sd) badValues.add(v) })
    } else {
      const q1 = sorted[Math.floor(sorted.length * 0.25)]
      const q3 = sorted[Math.floor(sorted.length * 0.75)]
      const iqr = q3 - q1
      sorted.forEach(v => { if (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) badValues.add(v) })
    }
  }
  const out = []
  let count = 0
  for (const r of rows) {
    const v = toNum(r[col])
    const isBad = !isNaN(v) && badValues.has(v)
    if (isBad) count++
    if (isBad && action === 'dropRow') continue
    const nr = { ...r }
    if (isBad && action === 'mask') nr[col] = ''
    out.push(nr)
  }
  return { rows: out, stats: { col, count, method } }
}
