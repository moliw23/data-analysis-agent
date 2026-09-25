// 语义层：字段类型/语义推断、质量诊断、列级分布统计
import {
  ID_NAME_PATTERN, CODE_NAME_PATTERN, OPTIONAL_COL,
  uniq, isEmpty, isNumeric, isDate, toNum, fmt, std, avg,
} from './_shared.js'

// 检测一列是否像 ID：字段名命中模式，或所有值都是长数字串且几乎唯一
export function looksLikeId(colName, nonEmpty, total) {
  if (ID_NAME_PATTERN.test(colName)) return true
  if (!nonEmpty.length) return false
  const card = uniq(nonEmpty).length
  const longDigitRatio = nonEmpty.filter(v => {
    if (isDate(v)) return false // 日期字符串（含 YYYYMMDD 紧凑格式）不是 ID
    const s = String(v).replace(/[^\d]/g, '')
    return s.length >= 8 && /^\d+$/.test(s)
  }).length / nonEmpty.length
  // 长数字串 + 高基数 → 几乎肯定是 ID（手机号11位、身份证15/18位、订单号…）
  return longDigitRatio > 0.85 && card / total > 0.9
}

// 语义层：根据字段名模式 + 取值特征推断类型与语义（measure / dimension / time / text）
export function inferSchema(table) {
  const { columns, rows } = table
  const typed = columns.map(col => {
    const vals = rows.map(r => r[col.name])
    const nonEmpty = vals.filter(v => !isEmpty(v))
    const total = nonEmpty.length || 1
    const numRatio = nonEmpty.filter(isNumeric).length / total
    const dateRatio = nonEmpty.filter(isDate).length / total
    let type = 'text', semantic = 'text'
    if (looksLikeId(col.name, nonEmpty, total)) {
      // ID/编号/手机号/证件号类字段：类型仍记为 number 以便展示，但语义上是 dimension，绝不参与求和
      type = numRatio > 0.8 ? 'number' : 'text'
      semantic = 'dimension'
    } else if (dateRatio > 0.6) { type = 'date'; semantic = 'time' }
    else if (numRatio > 0.8) {
      type = 'number'
      semantic = 'measure'
      const card = uniq(nonEmpty).length
      // 码值/类别型数字不是度量：字段名命中类目编码模式，或低基数整数标志位（0/1/2、性别码等）
      if (CODE_NAME_PATTERN.test(col.name) || (card >= 2 && card <= 6 && nonEmpty.every(v => Number.isInteger(toNum(v))))) {
        semantic = 'dimension'
      }
    }
    else {
      const card = uniq(nonEmpty).length
      if (card <= Math.max(2, Math.floor(rows.length * 0.5)) && card <= 30) semantic = 'dimension'
    }
    return { ...col, type, semantic, missing: vals.filter(isEmpty).length, cardinality: uniq(nonEmpty).length }
  })
  return { ...table, columns: typed }
}

// 条件字段检测：某列是否只在另一低基数字段取特定值时才填写
// 例：「已就业_就业去向」仅当 就业状态=已就业 时有值；「未就业_就业意向地」仅当 就业状态=有意向 时有值
// 这类结构性缺失（互斥宽表导出的正常形态）不应扣分
function findFillRule(rows, colName, columns) {
  const mask = rows.map(r => !isEmpty(r[colName]))
  const filled = mask.filter(Boolean).length
  if (filled < 2) return null
  for (const d of columns) {
    if (d.name === colName) continue
    const dvals = rows.map(r => r[d.name])
    const uniqD = uniq(dvals.filter(v => !isEmpty(v)))
    if (uniqD.length < 2 || uniqD.length > 8) continue
    for (const dv of uniqD) {
      const g = dvals.map(v => v === dv)
      const gSize = g.filter(Boolean).length
      if (gSize < 2 || gSize >= rows.length) continue
      let inF = 0, outF = 0
      for (let i = 0; i < rows.length; i++) { if (mask[i]) { if (g[i]) inF++; else outF++ } }
      // 组内基本都填、组外基本都不填 → 填充规则成立
      if (inF / gSize >= 0.85 && outF / (rows.length - gSize) <= 0.15) {
        return { dim: d.name, value: dv }
      }
    }
  }
  return null
}

// 数据质量诊断：缺失/类型冲突/异常值/常量列/重复行，给出扣分与可读建议
export function qualityCheck(table) {
  const { columns, rows } = table
  const issues = []
  let penalty = 0
  columns.forEach(col => {
    const vals = rows.map(r => r[col.name])
    const total = vals.length || 1
    const miss = vals.filter(isEmpty).length
    if (miss > 0) {
      const rate = miss / total
      if (miss === total) {
        // 整列全空：列本身无分析价值，属数据导出/清洗丢失，中等提示而非重罚
        issues.push({ col: col.name, severity: 'medium', type: '整列缺失', detail: `该列 ${miss} 行全部为空，无法参与任何分析（可能是清洗/导出时丢失）`, suggestion: '若该列不重要可在分析中忽略' })
        penalty += Math.min(20, rate * 30)
      } else if (OPTIONAL_COL.test(col.name)) {
        issues.push({ col: col.name, severity: 'info', type: '可选字段', detail: `${miss} 行未填（${Math.round(rate * 100)}%），备注类字段允许留空，不计为质量问题`, suggestion: '无需处理' })
      } else if (rate > 0.2 && rows.length >= 4) {
        const rule = findFillRule(rows, col.name, columns)
        if (rule) {
          issues.push({ col: col.name, severity: 'info', type: '结构性缺失', detail: `${miss} 行为空（${Math.round(rate * 100)}%）——该列仅当「${rule.dim} = ${rule.value}」时填写，属互斥条件字段，数据本身完整`, suggestion: `无需处理，分析时会按「${rule.dim}」分组解读` })
        } else {
          issues.push({ col: col.name, severity: 'high', type: '缺失值', detail: `共 ${miss} 行缺失（${Math.round(rate * 100)}%）`, suggestion: '建议填充均值/中位数或剔除该行后再分析' })
          penalty += Math.min(40, rate * 60)
        }
      } else {
        issues.push({ col: col.name, severity: rate > 0.2 ? 'high' : 'medium', type: '缺失值', detail: `共 ${miss} 行缺失（${Math.round(rate * 100)}%）`, suggestion: '建议填充均值/中位数或剔除该行后再分析' })
        penalty += Math.min(40, rate * 60)
      }
    }
    if (col.type === 'number') {
      const nums = vals.filter(isNumeric).map(toNum)
      const bad = vals.filter(v => !isEmpty(v) && !isNumeric(v)).length
      if (bad > 0) { issues.push({ col: col.name, severity: 'high', type: '类型冲突', detail: `${bad} 个值非数值，无法参与计算`, suggestion: '清洗为数值或标记为异常' }); penalty += Math.min(50, (bad / total) * 80) }
      if (nums.length >= 4) {
        const sorted = [...nums].sort((a, b) => a - b)
        const q1 = sorted[Math.floor(sorted.length * 0.25)]
        const q3 = sorted[Math.floor(sorted.length * 0.75)]
        const iqr = q3 - q1
        const out = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length
        if (out > 0) { issues.push({ col: col.name, severity: out > nums.length * 0.1 ? 'medium' : 'low', type: '异常值', detail: `检出 ${out} 个可能的离群点（IQR 法）`, suggestion: '确认是否为录入错误或真实极值' }); penalty += Math.min(10, (out / nums.length) * 20) }
      }
      if (uniq(nums).length === 1) { issues.push({ col: col.name, severity: 'low', type: '常量列', detail: '该列所有值相同，无分析价值', suggestion: '可从分析中移除' }); penalty += 5 }
    }
  })
  // 重复行
  const seen = new Set(); let dups = 0
  rows.forEach(r => { const k = JSON.stringify(r); if (seen.has(k)) dups++; else seen.add(k) })
  if (dups > 0) { issues.push({ col: '整行', severity: dups > 1 ? 'medium' : 'low', type: '重复行', detail: `发现 ${dups} 行完全重复`, suggestion: '建议去重' }); penalty += Math.min(20, (dups / (rows.length || 1)) * 30) }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))
  return { score, issues }
}

// 列级分布/统计明细（数值列→min/max/均值/中位数/分位/标准差/直方图；分类型→Top 值占比）
export function columnProfile(table, col) {
  const rows = (table && table.rows) || []
  if (!col) return null
  const schema = inferSchema(table)
  const meta = schema.columns.find(c => c.name === col)
  if (!meta) return null
  const vals = rows.map(r => r[col])
  const n = vals.length
  const missing = vals.filter(v => isEmpty(v)).length
  const present = vals.filter(v => !isEmpty(v))
  const uniqSet = new Set(present.map(String))
  const prof = {
    name: col, type: meta.type, semantic: meta.semantic,
    count: n, missing, missingPct: n ? (missing / n * 100) : 0,
    unique: uniqSet.size, uniquePct: n ? (uniqSet.size / n * 100) : 0,
  }
  if (meta.type === 'number') {
    const nums = present.map(v => toNum(v)).filter(v => !isNaN(v))
    if (nums.length) {
      const sorted = [...nums].sort((a, b) => a - b)
      const q = p => sorted[Math.floor(p * (sorted.length - 1))]
      prof.stats = {
        min: sorted[0], max: sorted[sorted.length - 1],
        mean: avg(nums), median: q(0.5), q1: q(0.25), q3: q(0.75),
        std: std(nums)
      }
      const min = sorted[0], max = sorted[sorted.length - 1]
      const B = 10
      const step = (max - min) / B || 1
      const bins = Array(B).fill(0)
      nums.forEach(v => {
        let idx = Math.floor((v - min) / step)
        if (idx >= B) idx = B - 1
        if (idx < 0) idx = 0
        bins[idx]++
      })
      prof.hist = { min, max, step, bins, labels: bins.map((_, i) => fmt(min + step * i)) }
    }
  } else {
    const counter = {}
    present.forEach(v => { const s = String(v); counter[s] = (counter[s] || 0) + 1 })
    const top = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 12)
    prof.topValues = top.map(([value, count]) => ({ value, count, pct: (count / n * 100) }))
    if (meta.semantic === 'time') {
      const ts = present.map(v => new Date(v).getTime()).filter(t => !isNaN(t))
      if (ts.length) prof.timeRange = { min: new Date(Math.min(...ts)).toISOString().slice(0, 10), max: new Date(Math.max(...ts)).toISOString().slice(0, 10) }
    }
  }
  return prof
}
