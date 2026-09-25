// 分析工具箱统一入口：手动生成图表（趋势 / TopN / 同环比 / 相关 / 透视 / 列分析 / 预测 / 异常 / 地图）
// 按 spec.kind 分发到各图表类型的真实计算与 option 构造（数字全部引擎真实计算）。
import { inferSchema, columnProfile } from './schema.js'
import { SAMPLE_ANALYZE_THRESHOLD, fmt, genderLabel, pickGranularity } from './_shared.js'
import {
  timeSeries, momYoy, topN, forecast, detectAnomalies, forecastOption, anomalyOption, mapOption,
} from './timeseries.js'
import { lineOption, barOption } from './charts.js'
import { correlation, heatmapOption } from './correlation.js'
import { pivot } from './pivot.js'

export function manualChart(table, spec) {
  const t = inferSchema(table)
  const rows = (table && table.rows) || []
  const sp = rows.length > SAMPLE_ANALYZE_THRESHOLD
    ? `采样口径：${fmt(SAMPLE_ANALYZE_THRESHOLD)}/${fmt(rows.length)} 行（等距抽样）；`
    : ''
  const measures = t.columns.filter(c => c.semantic === 'measure')
  const measureCol = spec.measureCol || (measures[0] && measures[0].name)
  const dimCol = spec.dimCol
  if (spec.kind === 'trend') {
    const timeCol = spec.timeCol || (t.columns.find(c => c.semantic === 'time') || {}).name
    if (!timeCol || !measureCol) return null
    const ts = timeSeries(table, timeCol, measureCol, { granularity: spec.granularity || 'auto', op: spec.op || 'sum' })
    if (!ts.length) return null
    const gr = (spec.granularity || pickGranularity(rows, timeCol))
    const grLabel = gr === 'day' ? '日' : gr === 'month' ? '月' : '年'
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    return {
      id: `manual_trend_${Date.now()}`,
      title: `${measureCol} 趋势（按${grLabel}·${opLabel}）`,
      type: 'line', manual: true,
      option: lineOption(ts.map(x => x.bucket), ts.map(x => x.value), `${measureCol}趋势`),
      caliber: sp + `口径：按 ${timeCol} 按${grLabel}聚合 · ${opLabel}（真实计算），共 ${ts.length} 个${grLabel}度点。`
    }
  }
  if (spec.kind === 'topN') {
    if (!dimCol || !measureCol) return null
    const n = Math.max(1, Math.min(50, spec.n || 10))
    const items = topN(table, dimCol, measureCol, { n, op: spec.op || 'sum' })
    if (items.length < 2) return null
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    const nn = Math.min(n, items.length)
    return {
      id: `manual_top_${Date.now()}`,
      title: `Top${nn} ${dimCol}（${opLabel}）`,
      type: 'bar', manual: true,
      option: barOption(items.map(a => genderLabel(dimCol, a.name)), items.map(a => a.value), `Top${nn}·${dimCol}·${opLabel}`),
      caliber: sp + `口径：按 ${dimCol} 分组对 ${measureCol} 取${opLabel}，降序取前 ${nn} 名（真实计算）。`
    }
  }
  if (spec.kind === 'momYoy') {
    const timeCol = spec.timeCol || (t.columns.find(c => c.semantic === 'time') || {}).name
    if (!timeCol || !measureCol) return null
    const ts = timeSeries(table, timeCol, measureCol, { granularity: spec.granularity || 'auto', op: spec.op || 'sum' })
    if (ts.length < 2) return null
    const gr = spec.granularity || pickGranularity(rows, timeCol)
    const grLabel = gr === 'day' ? '日' : gr === 'month' ? '月' : '年'
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    const my = momYoy(ts, { granularity: gr })
    const rowsTbl = my.map(x => [x.bucket, fmt(x.value), x.momPct == null ? '—' : (x.momPct >= 0 ? '+' : '') + x.momPct + '%', x.yoyPct == null ? '—' : (x.yoyPct >= 0 ? '+' : '') + x.yoyPct + '%'])
    return {
      id: `manual_momyoy_${Date.now()}`,
      title: `${measureCol} 同环比（按${grLabel}）`,
      type: 'line', manual: true,
      option: lineOption(ts.map(x => x.bucket), ts.map(x => x.value), `${measureCol}`),
      table: { head: ['时间', '值', '环比%', '同比%'], rows: rowsTbl },
      caliber: sp + `口径：按 ${timeCol} 按${grLabel}聚合 · ${opLabel}；环比=本期/上期-1，同比=本期/去年同期-1（真实计算），共 ${ts.length} 个${grLabel}度点。`
    }
  }
  if (spec.kind === 'corr') {
    const cor = correlation(table, spec.cols)
    if (cor.columns.length < 2) return null
    return {
      id: `manual_corr_${Date.now()}`,
      title: '数值列相关性', type: 'heatmap', manual: true,
      option: heatmapOption(cor.matrix, cor.columns),
      table: { head: ['', ...cor.columns], rows: cor.matrix.map((row, i) => [cor.columns[i], ...row.map(v => (v >= 0 ? '+' : '') + v.toFixed(2))]) },
      caliber: sp + `口径：数值列两两皮尔逊相关系数（成对删除缺失${cor.truncated ? '，已截断前 20 列' : ''}${cor.sameOrigin && cor.sameOrigin.length ? '；已合并 ' + cor.sameOrigin.length + ' 个同源列（如 quantity/quantity_2）' : ''}），共 ${cor.columns.length} 个数值列。`
    }
  }
  if (spec.kind === 'pivot') {
    if (!spec.rowDim || !spec.colDim || !spec.measureCol) return null
    const p = pivot(table, { rowDim: spec.rowDim, colDim: spec.colDim, measure: spec.measureCol, op: spec.op || 'sum' })
    if (!p) return null
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    return {
      id: `manual_pivot_${Date.now()}`,
      title: `透视表：${spec.rowDim} × ${spec.colDim}（${spec.measure}·${opLabel}）`,
      type: 'pivot', manual: true,
      table: { head: p.head, rows: p.rows },
      caliber: sp + `口径：按 ${spec.rowDim}（行）× ${spec.colDim}（列）交叉聚合 ${spec.measure} 的${opLabel}（真实计算），行 ${p.rowKeys.length}、列 ${p.colKeys.length}${p.truncated ? '（基数过大已截断显示前 ' + p.rowKeys.length + ' 行 / ' + p.colKeys.length + ' 列）' : ''}。`
    }
  }
  if (spec.kind === 'column') {
    if (!spec.col) return null
    const prof = columnProfile(table, spec.col)
    if (!prof) return null
    let tbl = null, option = null
    if (prof.type === 'number' && !prof.topValues) {
      const s = prof.stats
      tbl = { head: ['指标', '值'], rows: [
        ['非缺失计数', fmt(prof.count - prof.missing)],
        ['缺失', `${prof.missing} (${prof.missingPct.toFixed(1)}%)`],
        ['唯一值', prof.unique],
        ['最小值', fmt(s.min)], ['最大值', fmt(s.max)],
        ['均值', fmt(s.mean)], ['中位数', fmt(s.median)],
        ['Q1', fmt(s.q1)], ['Q3', fmt(s.q3)], ['标准差', fmt(s.std)]
      ] }
      if (prof.hist) option = barOption(prof.hist.labels, prof.hist.bins, `${spec.col} 分布`)
    } else {
      tbl = { head: [spec.col, '计数', '占比%'], rows: prof.topValues.map(t => [t.value, t.count, t.pct.toFixed(1)]) }
      if (prof.timeRange) tbl.rows.unshift(['时间范围', `${prof.timeRange.min} ~ ${prof.timeRange.max}`, ''])
    }
    return {
      id: `manual_col_${Date.now()}`,
      title: `列分析：${spec.col}`,
      type: prof.type === 'number' ? 'histogram' : 'table', manual: true,
      table: tbl, option,
      caliber: sp + `口径：对列「${spec.col}」（类型 ${prof.type}）真实统计，共 ${prof.count} 行，缺失 ${prof.missing}（${prof.missingPct.toFixed(1)}%），唯一值 ${prof.unique}。`
    }
  }
  if (spec.kind === 'forecast') {
    const timeCol = spec.timeCol || (t.columns.find(c => c.semantic === 'time') || {}).name
    if (!timeCol || !measureCol) return null
    const ts = timeSeries(table, timeCol, measureCol, { granularity: spec.granularity || 'auto', op: spec.op || 'sum' })
    if (ts.length < 3) return null
    const fc = forecast(ts, { horizon: Number(spec.horizon) || 6, method: spec.method || 'linear' })
    if (!fc) return null
    const gr = spec.granularity || pickGranularity(rows, timeCol)
    const grLabel = gr === 'day' ? '日' : gr === 'month' ? '月' : '年'
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    return {
      id: `manual_forecast_${Date.now()}`,
      title: `${measureCol} 预测（${fc.method === 'linear' ? '线性趋势' : '朴素'}·未来${fc.forecast.length}期）`,
      type: 'forecast', manual: true,
      option: forecastOption(fc.train, fc.forecast, `${measureCol}预测`),
      caliber: sp + `口径：基于 ${timeCol} 按${grLabel}聚合的${opLabel}序列（${ts.length}点）做 ${fc.method} 预测；R²=${fc.r2}，MAPE=${fc.mape}%，整体${fc.trend}（斜率 ${fc.slope}）。`
    }
  }
  if (spec.kind === 'anomaly') {
    const timeCol = spec.timeCol || (t.columns.find(c => c.semantic === 'time') || {}).name
    if (!timeCol || !measureCol) return null
    const ts = timeSeries(table, timeCol, measureCol, { granularity: spec.granularity || 'auto', op: spec.op || 'sum' })
    if (ts.length < 4) return null
    const an = detectAnomalies(ts, { k: Number(spec.k) || 3, method: spec.method || 'zscore' })
    if (!an) return null
    return {
      id: `manual_anomaly_${Date.now()}`,
      title: `${measureCol} 异常检测（${spec.method === 'mad' ? 'MAD' : 'Z-score'}·|z|>${spec.k || 3}）`,
      type: 'anomaly', manual: true,
      option: anomalyOption(ts.map(x => x.bucket), ts.map(x => x.value), an.anomalies, `${measureCol}异常`),
      caliber: sp + `口径：基于 ${timeCol} 聚合序列（${ts.length}点）做异常检测，阈值 |z|>${an.k}（${an.method}），共 ${an.count} 个异常点（中心 ${fmt(an.center)}，正常区间 ${fmt(an.lower)}~${fmt(an.upper)}）。`
    }
  }
  if (spec.kind === 'map') {
    if (!spec.regionCol || !measureCol) return null
    const mo = mapOption(spec.regionCol, measureCol, table, { op: spec.op || 'sum' })
    if (!mo) return null
    const opLabel = spec.op === 'avg' ? '均值' : spec.op === 'count' ? '行数' : spec.op === 'max' ? '最大值' : spec.op === 'min' ? '最小值' : '合计'
    return {
      id: `manual_map_${Date.now()}`,
      title: `${spec.regionCol} × ${measureCol}（地图）`,
      type: 'map', manual: true,
      option: mo,
      caliber: sp + `口径：按 ${spec.regionCol} 分组对 ${measureCol} 取${opLabel}（真实计算），共 ${mo.data.length} 个地区；加载中国地图底图需联网。`
    }
  }
  return null
}
