// ECharts option 构造：柱状 / 折线 / 饼图 / 直方图 / 散点 / 多系列对比
import { axisBase, ACCENT, PALETTE } from './_shared.js'

export function barOption(cats, vals, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    xAxis: { type: 'category', data: cats, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 0, rotate: cats.length > 6 ? 32 : 0 } },
    yAxis: { type: 'value', ...axisBase() },
    series: [{ type: 'bar', data: vals, itemStyle: { color: ACCENT, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 30 }]
  }
}
export function lineOption(cats, vals, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    xAxis: { type: 'category', data: cats, boundaryGap: false, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 'auto', rotate: cats.length > 8 ? 32 : 0 } },
    yAxis: { type: 'value', ...axisBase() },
    series: [{ type: 'line', data: vals, smooth: true, symbol: 'circle', symbolSize: 5, itemStyle: { color: ACCENT }, lineStyle: { width: 2, color: ACCENT }, areaStyle: { color: 'rgba(21,121,91,.10)' } }]
  }
}
function pieOption(items, name) {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    legend: { bottom: 0, textStyle: { color: '#71717A', fontSize: 11 }, type: 'scroll' },
    color: PALETTE,
    series: [{ type: 'pie', radius: ['42%', '66%'], center: ['50%', '46%'], data: items, label: { color: '#27272A', fontSize: 11 }, itemStyle: { borderColor: '#fff', borderWidth: 2 } }]
  }
}
function histOption(bins, name) {
  return barOption(bins.map(b => b.label), bins.map(b => b.value), name)
}
function scatterOption(points, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: 'item' },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    xAxis: { ...axisBase() }, yAxis: { ...axisBase() },
    series: [{ type: 'scatter', data: points, symbolSize: 8, itemStyle: { color: 'rgba(21,121,91,.7)' } }]
  }
}
// 多系列柱状/折线（跨数据集对比，PALETTE 上色）
export function multiBarOption(cats, series) {
  return {
    grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    title: { text: '多数据集对比', left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    color: PALETTE,
    legend: { top: 0, right: 0, textStyle: { color: '#71717A', fontSize: 11 } },
    xAxis: { type: 'category', data: cats, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 0, rotate: cats.length > 6 ? 32 : 0 } },
    yAxis: { type: 'value', ...axisBase() },
    series: (series || []).map(s => ({ type: 'bar', name: s.name, data: s.data, barMaxWidth: 26, itemStyle: { borderRadius: [4, 4, 0, 0] } })),
  }
}
export function multiLineOption(cats, series) {
  return {
    grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    title: { text: '多数据集对比', left: 0, top: 0, textStyle: { fontSize: 13, color: '#27272A', fontWeight: 600 } },
    color: PALETTE,
    legend: { top: 0, right: 0, textStyle: { color: '#71717A', fontSize: 11 } },
    xAxis: { type: 'category', data: cats, boundaryGap: false, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 'auto', rotate: cats.length > 8 ? 32 : 0 } },
    yAxis: { type: 'value', ...axisBase() },
    series: (series || []).map(s => ({ type: 'line', name: s.name, data: s.data, smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 } })),
  }
}

// pieOption / histOption / scatterOption 供 analyze 与 manualChart 调用
export { pieOption, histOption, scatterOption }
