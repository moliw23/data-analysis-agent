// 引擎共享层：常量、纯工具函数、跨模块内部助手
// 该文件被所有 engine/* 子模块复用，集中放此处可避免巨型 engine.js 中重复定义与循环依赖。
// 注意：内部助手（uniq / isEmpty / std ...）虽仅供其它子模块使用，但统一从此处导入，
// 以保证拆分后的各模块引用口径一致。

// 大表分析采样阈值：行数超过该值时 analyze() 采用等距抽样加速，并在所有图表/洞察/报告上显式标注「采样口径」
export const SAMPLE_ANALYZE_THRESHOLD = 50000

// 解析与语义层共用的列名模式
export const ID_NAME_PATTERN = /(身份证|证件号|证件|手机号|手机|电话|账号|账户|工号|卡号|会员号|工号|email|邮箱|ID|编号)$/i
// 码值/类别型数字列名：如 category_1、类目、code 等，本质是分类编码，求和无意义
export const CODE_NAME_PATTERN = /(category|cat_|类目|分类|code|编码|性别|gender|标志|flag|type_id|group_id)/i
// 备注类可选字段名：天然允许留空，缺失不算质量问题
export const OPTIONAL_COL = /^(备注|说明|附言|留言|备注信息|评论|comment|note|remark)/i
// 图表配色（ECharts option 共用）——克制翡翠绿 + 中性高级色板，去除紫罗兰 AI 模板感
export const ACCENT = '#15795B'
export const PALETTE = ['#15795B', '#3E7CB1', '#C2923A', '#B0543F', '#5E8C61', '#8C7B5A']

// ---------- 基础类型工具 ----------
export function isNumeric(v) {
  if (v === null || v === undefined || v === '') return false
  const s = String(v).replace(/,/g, '').replace(/%/g, '').trim()
  return s !== '' && !isNaN(Number(s))
}
export function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(String(v).replace(/,/g, '').replace(/%/g, '').trim())
}
export function isDate(v) {
  if (v === null || v === undefined || v === '') return false
  const s = String(v).trim()
  if (/^\d{8}$/.test(s)) { // 紧凑日期 YYYYMMDD（天池等导出常见，如 20140919）
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8)
    return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31
  }
  if (!/[-/年]/.test(s)) return false
  const t = Date.parse(s.replace(/年|月/g, '-').replace('日', ''))
  return !isNaN(t)
}
// 把 YYYYMMDD 规范化为 YYYY-MM-DD（否则 Date.parse 无法解析紧凑格式）
export function normDate(v) {
  const s = String(v).trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s
}
export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Math.round(n).toLocaleString('zh-CN')
}

// ---------- 内部助手（供子模块 import） ----------
export function uniq(arr) { return Array.from(new Set(arr)) }
export function isEmpty(v) { return v === null || v === undefined || String(v).trim() === '' }
// 常见 0/1/2 性别码 → 可读文案（仅当列名含 gender/性别 且值都在 0/1/2 内）
export function genderLabel(colName, v) {
  if (!/(gender|性别)/i.test(colName)) return v
  const map = { 0: '未知', 1: '男', 2: '女' }
  const s = String(v)
  return map[s] != null ? map[s] : v
}
// 标准差（样本，n-1）
export function std(arr) {
  const a = arr.filter(v => !isNaN(v))
  if (a.length < 2) return NaN
  const m = a.reduce((x, y) => x + y, 0) / a.length
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1))
}
export function avg(arr) { const n = arr.filter(v => !isNaN(v)); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : NaN }
// 维度×度量分组聚合（复用：topN / analyze / analyzeByPlan / executeIntent / merge）
export function groupAgg(rows, dimKey, measureKey, op = 'sum') {
  const map = {}
  rows.forEach(r => {
    const k = r[dimKey]; const v = toNum(r[measureKey])
    if (isEmpty(k) || isNaN(v)) return
    if (!map[k]) map[k] = []
    map[k].push(v)
  })
  return Object.entries(map).map(([name, vs]) => {
    let value
    if (op === 'avg') value = vs.reduce((a, b) => a + b, 0) / vs.length
    else if (op === 'count') value = vs.length
    else if (op === 'max') value = Math.max(...vs)
    else if (op === 'min') value = Math.min(...vs)
    else value = vs.reduce((a, b) => a + b, 0)
    return { name, value }
  }).sort((a, b) => b.value - a.value)
}
export function histogram(rows, key, bins = 10) {
  const nums = rows.map(r => toNum(r[key])).filter(v => !isNaN(v))
  if (!nums.length) return []
  const min = Math.min(...nums), max = Math.max(...nums)
  const width = (max - min) / bins || 1
  const out = Array.from({ length: bins }, (_, i) => ({ label: `${Math.round(min + i * width)}-${Math.round(min + (i + 1) * width)}`, value: 0 }))
  nums.forEach(v => { let idx = Math.min(bins - 1, Math.floor((v - min) / width)); out[idx].value++ })
  return out
}
// ECharts 坐标轴/网格基础样式
export function axisBase() {
  return {
    axisLabel: { color: '#71717A', fontSize: 11 },
    axisLine: { lineStyle: { color: '#E7E5E2' } },
    splitLine: { lineStyle: { color: '#E7E5E2' } }
  }
}
// 自动粒度：跨度≤31天→day，月份差≤18→month，否则 year（与 timeSeries 内部 auto 逻辑一致）
export function pickGranularity(rows, timeCol) {
  const ts = []
  for (const r of rows) {
    const raw = r[timeCol]
    if (isEmpty(raw) || !isDate(raw)) continue
    ts.push(Date.parse(normDate(raw)))
  }
  if (!ts.length) return 'day'
  const tmin = Math.min(...ts), tmax = Math.max(...ts)
  const days = (tmax - tmin) / 86400000
  if (days <= 31) return 'day'
  const a = new Date(tmin), b = new Date(tmax)
  const monthDiff = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  return monthDiff <= 18 ? 'month' : 'year'
}
// 超限抽样（等距），用于关联检测与匹配，避免超大表卡顿
export function sampleRows(rows, limit = 20000) {
  if (!rows || rows.length <= limit) return rows || []
  const step = rows.length / limit
  const out = []
  for (let i = 0; i < limit; i++) out.push(rows[Math.min(rows.length - 1, Math.floor(i * step))])
  return out
}
