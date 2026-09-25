// 时间序列聚合、同环比、预测、异常检测、地图聚合 及其 ECharts option 构造
import { pickGranularity, isEmpty, isDate, normDate, toNum, std, axisBase, ACCENT, groupAgg } from './_shared.js'

// 时间序列聚合：按时间列分桶（day/month/year），桶内按 op 聚合，返回升序 [{bucket, value}]
export function timeSeries(table, timeCol, measureCol, { granularity = 'auto', op = 'sum' } = {}) {
  const rows = (table && table.rows) || []
  const OP_SET = ['sum', 'avg', 'count', 'max', 'min']
  const op2 = OP_SET.includes(op) ? op : 'sum'
  const pts = []
  for (const r of rows) {
    const raw = r[timeCol]
    if (isEmpty(raw) || !isDate(raw)) continue
    const v = toNum(r[measureCol])
    if (isNaN(v)) continue
    const d = new Date(Date.parse(normDate(raw)))
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    pts.push({ ymd, v })
  }
  if (!pts.length) return []
  const gr = granularity === 'auto'
    ? pickGranularity(rows, timeCol)
    : (['day', 'month', 'year'].includes(granularity) ? granularity : 'day')
  const bucketOf = p => gr === 'day' ? p.ymd : gr === 'month' ? p.ymd.slice(0, 7) : p.ymd.slice(0, 4)
  const map = {}
  pts.forEach(p => { const k = bucketOf(p); (map[k] = map[k] || []).push(p.v) })
  return Object.entries(map).map(([bucket, vs]) => {
    let value
    if (op2 === 'avg') value = vs.reduce((a, b) => a + b, 0) / vs.length
    else if (op2 === 'count') value = vs.length
    else if (op2 === 'max') value = Math.max(...vs)
    else if (op2 === 'min') value = Math.min(...vs)
    else value = vs.reduce((a, b) => a + b, 0)
    return { bucket, value }
  }).sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))
}

// 同环比：基于聚合时间序列 [{bucket,value}]（升序），返回 [{bucket,value,momPct,yoyPct}]
// 环比 = 本期/上一期 - 1；同比 = 本期/去年同期 - 1（month 对齐前一年同月、day 对齐去年同日，用 Map 精确查 bucket 规避闰年/缺期；year 无同比）
// 缺上期/去年同期返回 null（UI 显示「—」）
export function momYoy(series, { granularity } = {}) {
  if (!series || series.length < 2) return []
  const gr = (granularity === 'day' || granularity === 'month' || granularity === 'year') ? granularity : 'month'
  const map = new Map(series.map(s => [s.bucket, s.value]))
  const round1 = v => (v == null ? null : Math.round(v * 10) / 10)
  const out = []
  for (let i = 0; i < series.length; i++) {
    const cur = series[i]
    const prev = series[i - 1]
    const momPct = prev && prev.value ? (cur.value / prev.value - 1) * 100 : null
    let yoyPct = null
    if (gr !== 'year') {
      const b = cur.bucket
      const yb = gr === 'month'
        ? `${(+b.slice(0, 4) - 1)}-${b.slice(5, 7)}`
        : `${(+b.slice(0, 4) - 1)}-${b.slice(5, 7)}-${b.slice(8, 10)}`
      if (map.has(yb)) { const yv = map.get(yb); if (yv) yoyPct = (cur.value / yv - 1) * 100 }
    }
    out.push({ bucket: cur.bucket, value: cur.value, momPct: round1(momPct), yoyPct: round1(yoyPct) })
  }
  return out
}

// 维度×度量 降序前 N（复用 groupAgg）
export function topN(table, dimCol, measureCol, { n = 10, op = 'sum' } = {}) {
  return groupAgg((table && table.rows) || [], dimCol, measureCol, op).slice(0, n).map(a => ({ name: a.name, value: a.value }))
}

// 时间序列预测：OLS 线性外推或朴素法，返回预测序列 + 95% 区间 + R²/MAPE/趋势（真实计算，无模拟）
export function forecast(series, { horizon = 6, method = 'linear' } = {}) {
  if (!series || series.length < 3) return null
  const n = series.length
  const xs = series.map((_, i) => i)
  const ys = series.map(s => Number(s.value))
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sxx += (xs[i] - meanX) ** 2; sxy += (xs[i] - meanX) * (ys[i] - meanY) }
  const b = sxx ? sxy / sxx : 0
  const a = meanY - b * meanX
  const predict = x => a + b * x
  const resid = ys.map((y, i) => y - predict(xs[i]))
  const sse = resid.reduce((acc, r) => acc + r * r, 0)
  const se = Math.sqrt(sse / Math.max(1, n - 2)) // 回归标准误
  const lastBucket = series[n - 1].bucket
  const isMonth = /^\d{4}-\d{2}$/.test(lastBucket)
  const isYear = /^\d{4}$/.test(lastBucket)
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(lastBucket)
  const nextBucket = (i) => {
    if (isMonth) { let p = lastBucket.split('-').map(Number); let y = p[0], m = p[1] + i; while (m > 12) { m -= 12; y++ } return y + '-' + String(m).padStart(2, '0') }
    if (isYear) return String(Number(lastBucket) + i)
    if (isDay) { const d = new Date(lastBucket); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10) }
    return lastBucket + '+' + i
  }
  const fc = []
  for (let k = 1; k <= horizon; k++) {
    const x0 = n - 1 + k
    if (method === 'naive') {
      const base = ys[n - 1]
      const lo = base - 1.96 * se, hi = base + 1.96 * se
      fc.push({ bucket: nextBucket(k), value: Math.max(0, base), lo: Math.max(0, lo), hi: Math.max(0, hi) })
    } else {
      const sePred = se * Math.sqrt(1 + 1 / n + (x0 - meanX) ** 2 / (sxx || 1))
      const val = predict(x0)
      fc.push({ bucket: nextBucket(k), value: Math.max(0, val), lo: Math.max(0, val - 1.96 * sePred), hi: Math.max(0, val + 1.96 * sePred) })
    }
  }
  const sst = ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0)
  const r2 = sst ? 1 - sse / sst : 0
  const mape = ys.reduce((acc, y, i) => acc + (y ? Math.abs(resid[i] / y) : 0), 0) / n * 100
  return {
    train: series.map(s => ({ bucket: s.bucket, value: Number(s.value) })),
    forecast: fc, method,
    r2: Math.round(r2 * 1000) / 1000,
    mape: Math.round(mape * 10) / 10,
    trend: b >= 0 ? '上升' : '下降',
    slope: Math.round(b * 1000) / 1000
  }
}

function medianOf(arr) {
  const a = [...arr].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
// 异常检测：Z-score 或抗离群 MAD，返回异常点 + 中心 + 正常区间
export function detectAnomalies(series, { k = 3, method = 'zscore' } = {}) {
  if (!series || series.length < 4) return null
  const vals = series.map(s => Number(s.value))
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = std(vals)
  let scores, center, half
  if (method === 'mad') {
    const med = medianOf(vals)
    const absdev = vals.map(v => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = absdev[Math.floor(absdev.length / 2)]
    const scale = 1.4826 * mad
    scores = vals.map(v => scale ? 0.6745 * (v - med) / scale : 0)
    center = med; half = k * scale / 0.6745
  } else {
    scores = vals.map(v => sd ? (v - mean) / sd : 0)
    center = mean; half = k * sd
  }
  const anomalies = []
  series.forEach((s, i) => {
    if (Math.abs(scores[i]) > k) {
      anomalies.push({ bucket: s.bucket, value: Number(s.value), score: Math.round(scores[i] * 100) / 100, reason: scores[i] > 0 ? '高于' : '低于' })
    }
  })
  return {
    anomalies,
    series: series.map(s => ({ bucket: s.bucket, value: Number(s.value) })),
    method, k, count: anomalies.length,
    center, upper: center + half, lower: center - half
  }
}

// 预测图 option：实际折线 + 预测虚线 + 置信带（stack 实现区间填充）
export function forecastOption(train, fc, name) {
  const histCats = train.map(p => p.bucket)
  const histVals = train.map(p => p.value)
  const fcCats = fc.map(p => p.bucket)
  const fcVals = fc.map(p => p.value)
  const lo = fc.map(p => p.lo)
  const hi = fc.map(p => p.hi)
  const connectVal = histVals[histVals.length - 1]
  const hideHist = () => histCats.map(() => '-')
  return {
    grid: { left: 8, right: 14, top: 32, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['实际', '预测'], top: 4, textStyle: { color: '#71717A', fontSize: 11 } },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    xAxis: { type: 'category', data: [...histCats, ...fcCats], ...axisBase(), axisLabel: { ...axisBase().axisLabel, rotate: (histCats.length + fcCats.length) > 10 ? 32 : 0, interval: 'auto' } },
    yAxis: { type: 'value', ...axisBase() },
    series: [
      { name: '实际', type: 'line', data: [...histVals, ...fcCats.map(() => '-')], smooth: true, symbol: 'circle', symbolSize: 5, itemStyle: { color: ACCENT }, lineStyle: { width: 2, color: ACCENT }, areaStyle: { color: 'rgba(21,121,91,.08)' } },
      { name: 'lo', type: 'line', data: [...hideHist(), connectVal, ...lo], stack: 'conf', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: 'hi', type: 'line', data: [...hideHist(), 0, ...hi.map((h, i) => Math.max(0, h - lo[i]))], stack: 'conf', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(21,121,91,.18)' }, silent: true, tooltip: { show: false } },
      { name: '预测', type: 'line', data: [...hideHist(), connectVal, ...fcVals], smooth: true, symbol: 'circle', symbolSize: 5, itemStyle: { color: '#E08A3C' }, lineStyle: { width: 2, color: '#E08A3C', type: 'dashed' } }
    ]
  }
}
// 异常图 option：正常折线 + 异常红点标注
export function anomalyOption(cats, vals, anomalies, name) {
  const anomMap = new Map(anomalies.map(a => [a.bucket, a]))
  const normal = vals.map((v, i) => anomMap.has(cats[i]) ? '-' : v)
  const anomPts = cats.map((c, i) => anomMap.has(c) ? [i, vals[i]] : '-')
  return {
    grid: { left: 8, right: 14, top: 32, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    xAxis: { type: 'category', data: cats, boundaryGap: false, ...axisBase(), axisLabel: { ...axisBase().axisLabel, rotate: cats.length > 8 ? 32 : 0, interval: 'auto' } },
    yAxis: { type: 'value', ...axisBase() },
    series: [
      { name: '正常', type: 'line', data: normal, smooth: true, symbol: 'circle', symbolSize: 4, itemStyle: { color: ACCENT }, lineStyle: { width: 2, color: ACCENT } },
      { name: '异常', type: 'scatter', data: anomPts, symbolSize: 13, itemStyle: { color: '#E0524C' }, z: 5 }
    ]
  }
}
// 地图：按地区维度聚合度量，返回需在 EChart 中注册底图后渲染的占位 option
export function mapOption(regionCol, measureCol, table, { op = 'sum' } = {}) {
  const rows = (table && table.rows) || []
  const agg = {}
  rows.forEach(r => {
    const region = String(r[regionCol] ?? '').trim()
    const v = toNum(r[measureCol])
    if (!region || isNaN(v)) return
    agg[region] = (agg[region] || 0) + v
  })
  const data = Object.entries(agg).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
  if (!data.length) return null
  return { _map: 'china', regionCol, measureCol, op, data, max: Math.max(...data.map(d => d.value)) }
}
