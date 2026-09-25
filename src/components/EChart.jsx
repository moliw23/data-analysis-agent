import React, { useState, useRef, useEffect } from 'react'
import { Download, Sheet, FileSpreadsheet, Sparkles, TrendingUp, BarChart2, Layers, PieChart, GitCompare, Activity, BarChart3 } from 'lucide-react'
import { exportTableCSV, exportTableXLSX, fmt } from '../engine.js'

// ---------- ECharts 封装 ----------
// 散点/热力图默认更高，避免标签挤在中部不可读
// 中国地图底图：运行时从公共 CDN 拉取 GeoJSON 并注册（缓存），离线时降级提示
let _chinaGeo = null
let _chinaGeoPromise = null
const CHINA_GEO_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'
async function ensureChinaMap(ec) {
  if (_chinaGeo) return _chinaGeo
  if (_chinaGeoPromise) return _chinaGeoPromise
  _chinaGeoPromise = (async () => {
    const resp = await fetch(CHINA_GEO_URL, { mode: 'cors' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const json = await resp.json()
    ec.registerMap('china', json)
    _chinaGeo = json
    return json
  })()
  return _chinaGeoPromise
}
function normRegionName(s) {
  return String(s).trim().replace(/(省|市|自治区|特别行政区|壮族自治区|回族自治区|维吾尔自治区|地区|自治州|盟|区)$/, '')
}
// 把数据里的地区名匹配到 GeoJSON 的 feature 名称（兼容「广东」↔「广东省」等写法）
function matchRegion(rawName, featureNames) {
  const candidates = [rawName, normRegionName(rawName), rawName + '省', rawName + '市', normRegionName(rawName) + '省', normRegionName(rawName) + '市']
  const lower = candidates.map(c => String(c).toLowerCase())
  for (const fn of featureNames) {
    if (lower.includes(String(fn).toLowerCase())) return fn
  }
  // 前缀匹配：如「黑龙江」匹配「黑龙江省」
  for (const fn of featureNames) {
    const lfn = String(fn).toLowerCase()
    if (lower.some(c => lfn.startsWith(c.toLowerCase()) && c.length >= 2)) return fn
  }
  return null
}
// 运行时解析 design-tokens.css 的令牌值（ECharts 画在 canvas 上，读不到 CSS 变量）。
// 主题切换（themechange 事件）后会重新解析并 setOption，因此令牌变更即时生效。
// fallback 仅作解析失败兜底，不是颜色来源——正常路径一律走令牌。
export function resolveToken(name, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
function accentGradient() {
  return [
    resolveToken('--accent-50', '#EDF7F1'),
    resolveToken('--accent-200', '#BEE0CC'),
    resolveToken('--accent-400', '#5DA894'),
    resolveToken('--accent-600', '#15795B'),
  ]
}
function buildChinaOption(opt) {
  const featureNames = (_chinaGeo && _chinaGeo.features || []).map(f => (f.properties && f.properties.name) || '').filter(Boolean)
  const remap = opt.data.map(d => {
    const fn = matchRegion(d.name, featureNames)
    return { name: fn || d.name, value: d.value }
  })
  const max = opt.max || Math.max(...opt.data.map(d => d.value), 0)
  // 注意：visualMap 色阶、地图强调色、文字色全部由 applyChartTheme 统一注入（见下），
  // 此处不写死颜色，避免与应用主题脱节。
  return {
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>${opt.measureCol}：${fmt(p.value)}` },
    visualMap: { min: 0, max, left: 'left', bottom: 12, text: ['高', '低'], calculable: true, textStyle: { fontSize: 11 } },
    series: [{
      type: 'map', map: 'china', roam: true, data: remap,
      label: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 0.5 },
    }]
  }
}
function mapFallbackOption(msg) {
  return {
    title: { text: '地图底图加载失败', subtext: '需联网加载中国地图 GeoJSON（' + (msg || '未知错误') + '）', left: 'center', top: 'center', textStyle: { fontSize: 14 } },
    series: []
  }
}

// 深拷贝但保留函数（JSON.stringify 会静默丢弃 option 里的 formatter 等函数）
function deepClone(v, seen = new WeakMap()) {
  if (typeof v !== 'object' || v === null) return v
  if (seen.has(v)) return seen.get(v)
  const isArr = Array.isArray(v)
  const out = isArr ? [] : {}
  seen.set(v, out)
  for (const k of Object.keys(v)) out[k] = deepClone(v[k], seen)
  return out
}

// 按主题给图表上色：标题/坐标轴/图例/visualMap/热力图标签统一从令牌解析，
// 避免暗色下文字不可见，也保证图表与应用是同一套颜色。
// 仅作用于克隆体，不修改缓存的 option。
function applyChartTheme(opt, isDark) {
  if (!opt) return opt
  const c = {
    text: resolveToken('--fg', isDark ? '#ECEAE3' : '#27272A'),
    sub: resolveToken('--muted', isDark ? '#9C978D' : '#71717A'),
    axis: resolveToken('--chart-axis', isDark ? '#6A6E75' : '#A1A1AA'),
    split: resolveToken('--chart-grid', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.07)'),
  }
  const o = deepClone(opt)
  if (o.title) o.title.textStyle = { ...(o.title.textStyle || {}), color: c.text }
  for (const k of ['xAxis', 'yAxis']) {
    const arr = o[k]; if (!arr) continue
    ;(Array.isArray(arr) ? arr : [arr]).forEach(ax => {
      if (!ax) return
      ax.axisLabel = { ...(ax.axisLabel || {}), color: c.sub }
      if (ax.axisLine) ax.axisLine.lineStyle = { ...(ax.axisLine.lineStyle || {}), color: c.axis }
      if (ax.splitLine) ax.splitLine.lineStyle = { ...(ax.splitLine.lineStyle || {}), color: c.split }
      if (ax.nameTextStyle) ax.nameTextStyle.color = c.sub
    })
  }
  if (o.legend && o.legend.textStyle) o.legend.textStyle.color = c.sub
  // visualMap：文字色 + 连续色阶统一走令牌（地图与相关性热力图共用同一渐变，保证视觉一致）
  if (o.visualMap) {
    if (o.visualMap.textStyle) o.visualMap.textStyle.color = c.sub
    o.visualMap.inRange = { ...(o.visualMap.inRange || {}), color: accentGradient() }
  }
  // 地图 / 热力图系列的强调色与标签色由主题注入（来源组件不再自带颜色）
  for (const s of (o.series || [])) {
    if (!s) continue
    if (s.type === 'map') {
      s.emphasis = {
        ...(s.emphasis || {}),
        label: { ...((s.emphasis && s.emphasis.label) || {}), show: true, color: c.text },
        itemStyle: { ...((s.emphasis && s.emphasis.itemStyle) || {}), areaColor: resolveToken('--accent-600', '#15795B') },
      }
    }
    if (s.type === 'heatmap' && s.label) s.label = { ...s.label, color: c.text }
  }
  o.backgroundColor = 'transparent'
  return o
}

function EChart({ option, height, mobileHeight, kind, downloadable = false, fileName = 'chart', onItemClick }) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  const onItemClickRef = useRef(onItemClick)
  onItemClickRef.current = onItemClick
  const optionRef = useRef(option)
  optionRef.current = option
  const isDarkRef = useRef(false)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = e => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  // 真正渲染：地图需先注册底图；随后按当前主题上色（不修改缓存的 option）
  const render = async (ec) => {
    if (!ref.current || !ec) return
    let real = optionRef.current
    if (real && real._map === 'china') {
      try { await ensureChinaMap(ec); real = buildChinaOption(real) }
      catch (e) { real = mapFallbackOption(e && e.message) }
    }
    isDarkRef.current = document.documentElement.getAttribute('data-theme') === 'dark'
    ec.setOption(applyChartTheme(real, isDarkRef.current), true)
  }
  useEffect(() => {
    if (!ref.current) return
    let cancelled = false
    let ro
    // echarts 按需动态导入，避免首屏打包进 ~1MB 的图表库
    ;(async () => {
      try {
        const mod = await import('echarts')
        const ec = mod.default || mod
        if (cancelled || !ref.current) return
        if (!chartRef.current) chartRef.current = ec.init(ref.current)
        await render(chartRef.current) // 必须传实例（有 setOption），模块对象只有 init
        const clickHandler = (params) => { if (onItemClickRef.current) onItemClickRef.current(params) }
        try { chartRef.current.off('click', clickHandler) } catch (e) { /* 部分图表类型无事件 */ }
        if (onItemClickRef.current) chartRef.current.on('click', clickHandler)
        ro = new ResizeObserver(() => chartRef.current && chartRef.current.resize())
        ro.observe(ref.current)
      } catch (e) { console.error('[EChart] 渲染失败:', e) }
    })()
    return () => { cancelled = true; if (ro) ro.disconnect() }
  }, [option])
  // 组件卸载时释放 ECharts 实例，避免泄漏
  useEffect(() => () => {
    if (chartRef.current) { try { chartRef.current.dispose() } catch (e) { /* ignore */ } chartRef.current = null }
  }, [])
  // 主题切换：不重建实例，直接重新上色（监听 App 派发的 themechange）
  useEffect(() => {
    const onTheme = () => { if (chartRef.current) render(chartRef.current) }
    window.addEventListener('themechange', onTheme)
    return () => window.removeEventListener('themechange', onTheme)
  }, [])
  const h = (() => {
    if (mobileHeight && isMobile) return mobileHeight
    if (height) return height
    // 按图表类型自适应：热力图/散点图/地图需要更高容器
    if (kind === 'heatmap' || kind === 'scatter' || kind === 'map') return 420
    return 240
  })()
  const handleDownload = () => {
    if (!chartRef.current) return
    try {
      const bg = resolveToken('--bg', isDarkRef.current ? '#121314' : '#ffffff')
      const url = chartRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bg })
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) { /* 图表尚未渲染完成时忽略 */ }
  }
  // 空数据兜底：series.data 为空时显示占位（避免"画布存在但无任何点"的视觉空白）
  const isEmpty = !option || !option.series || option.series.every(s => !s.data || (Array.isArray(s.data) && s.data.length === 0))
  if (isEmpty) {
    return (
      <div className="echart-wrap" style={{ position: 'relative', width: '100%' }}>
        <div className="echart-empty" style={{ height: h }}>
          <BarChart3 size={32} className="echart-empty-icon" />
          <div className="echart-empty-text">样本不足，无法绘制图表</div>
          <div className="echart-empty-sub">当前数据缺少可绘制的有效点（少于 1 个）</div>
        </div>
        {downloadable && (
          <button className="chart-dl" title="下载图片 (PNG)" onClick={e => e.stopPropagation()}>
            <Download size={14} />
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="echart-wrap" style={{ position: 'relative', width: '100%' }}>
      <div ref={ref} style={{ width: '100%', height: h }} />
      {downloadable && (
        <button
          className="chart-dl"
          title="下载图片 (PNG)"
          onClick={e => { e.stopPropagation(); handleDownload() }}
        >
          <Download size={14} />
        </button>
      )}
    </div>
  )
}

// 图表附带的静态表（同环比表 / 相关性矩阵）渲染
function ChartTable({ table, exportName = '图表数据' }) {
  if (!table || !table.head || !table.rows) return null
  const asTable = { columns: table.head.map(h => ({ name: h })), rows: table.rows.map(r => {
    const o = {}; table.head.forEach((h, i) => { o[h] = r[i] }); return o
  }) }
  return (
    <div className="chart-table-wrap">
      <div className="chart-table-bar">
        <span className="card-sub">共 {table.rows.length} 行</span>
        <span className="chart-table-exports">
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 30, padding: '0 10px', fontSize: 12 }} onClick={() => exportTableCSV(asTable, exportName)}><Sheet size={13} /> CSV</button>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 30, padding: '0 10px', fontSize: 12 }} onClick={() => exportTableXLSX(asTable, exportName)}><FileSpreadsheet size={13} /> Excel</button>
        </span>
      </div>
      <table className="chart-table">
        <thead>
          <tr>{table.head.map((h, i) => <th key={i} className={i === 0 ? 'ct-first' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? 'ct-first' : ''}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 图标映射（Lucide，禁止 emoji 功能图标）
const INSIGHT_ICON = { summary: Sparkles, trend: TrendingUp, rank: BarChart2, dist: Layers, share: PieChart, cross: GitCompare, corr: Activity }

export { EChart, ChartTable, INSIGHT_ICON }
