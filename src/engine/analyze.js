// 分析主流程与 LLM 协作接口：规则引擎自动出图与洞察、按计划出图、意图执行、对话式追问、数据集概况
import { inferSchema, looksLikeId } from './schema.js'
import {
  SAMPLE_ANALYZE_THRESHOLD, fmt, uniq, isEmpty, toNum, avg, groupAgg, histogram, genderLabel, sampleRows, normDate, pickGranularity,
} from './_shared.js'
import { timeSeries, momYoy, topN } from './timeseries.js'
import { barOption, lineOption, pieOption, histOption, scatterOption } from './charts.js'
import { correlation, heatmapOption } from './correlation.js'

// 分析主流程：按字段类型/语义/分布真实计算图表与洞察
export function analyze(table) {
  const t = inferSchema(table)
  const { columns, rows } = t
  // 大表采样标注（P0）：行数超过阈值时用等距抽样加速，所有图表/洞察/报告显式标注采样口径
  const sampled = rows.length > SAMPLE_ANALYZE_THRESHOLD
    ? { enabled: true, total: rows.length, used: SAMPLE_ANALYZE_THRESHOLD, note: '等距抽样' }
    : { enabled: false }
  const workRows = sampled.enabled ? sampleRows(rows, SAMPLE_ANALYZE_THRESHOLD) : rows
  const workTable = { columns, rows: workRows }
  const totalRows = sampled.enabled ? sampled.total : rows.length
  const sp = () => (sampled.enabled ? `采样口径：${fmt(sampled.used)}/${fmt(sampled.total)} 行（等距抽样）；` : '')
  // 常量列（如整列价格恒为 1.0）无分析价值，从度量中剔除（质量诊断仍会提示）
  const measures = columns.filter(c => c.semantic === 'measure').filter(mm => uniq(workRows.map(r => r[mm.name]).filter(v => !isEmpty(v))).length > 1)
  const dims = columns.filter(c => c.semantic === 'dimension')
  const times = columns.filter(c => c.semantic === 'time')
  const charts = []
  const insights = []

  measures.slice(0, 3).forEach(m => {
    if (times.length) {
      const timeCol = times[0].name
      const gr = pickGranularity(workRows, timeCol)
      const grLabel = gr === 'day' ? '日' : gr === 'month' ? '月' : '年'
      const ts = timeSeries(workTable, timeCol, m.name, { granularity: gr, op: 'sum' })
      const cats = ts.map(x => x.bucket)
      const vals = ts.map(x => x.value)
      if (cats.length) {
        const lineChart = { id: `line_${m.name}`, title: `${m.name} 趋势`, type: 'line', option: lineOption(cats, vals, `${m.name}趋势`), caliber: sp() + `口径：按 ${timeCol} ${grLabel}聚合 · 合计，共 ${cats.length} 个${grLabel}度点。` }
        // 同环比表：月度及以上粒度且期数≥2 时自动附（P2）
        if (gr !== 'day' && cats.length >= 2) {
          const my = momYoy(ts, { granularity: gr })
          lineChart.table = {
            head: ['时间', '值', '环比%', '同比%'],
            rows: my.map(x => [x.bucket, fmt(x.value), x.momPct == null ? '—' : (x.momPct >= 0 ? '+' : '') + x.momPct + '%', x.yoyPct == null ? '—' : (x.yoyPct >= 0 ? '+' : '') + x.yoyPct + '%'])
          }
        }
        charts.push(lineChart)
      }
      if (vals.length >= 2) {
        const half = Math.floor(vals.length / 2)
        const first = avg(vals.slice(0, half)), last = avg(vals.slice(half))
        const pct = first ? ((last - first) / first * 100) : 0
        const txt = `「${m.name}」整体呈${pct >= 0 ? '上升' : '下降'}趋势，${grLabel}度后半段均值 ${fmt(last)}，较前半段（${fmt(first)}）变化 ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%。`
        insights.push({ icon: 'trend', text: txt, caliber: sp() + `口径：聚合序列前半段 vs 后半段均值对比（真实计算）。` })
      }
    } else if (dims.length) {
      const dim = dims[0].name
      const agg = groupAgg(workRows, dim, m.name, 'sum').slice(0, 12)
      charts.push({ id: `bar_${m.name}`, title: `${dim} 的${m.name}合计`, type: 'bar', drillDim: dim, option: barOption(agg.map(a => a.name), agg.map(a => a.value), `${dim}·${m.name}合计`), caliber: sp() + `口径：按 ${dim} 分组，对 ${m.name} 取合计，取前 12 项。` })
      if (agg.length) {
        const top = agg[0], bottom = agg[agg.length - 1]
        insights.push({ icon: 'rank', text: `「${m.name}」最高的 ${dim} 是 ${top.name}（${fmt(top.value)}），最低是 ${bottom.name}（${fmt(bottom.value)}），相差 ${fmt(top.value - bottom.value)}。`, caliber: sp() + `口径：按 ${dim} 分组合计后取极值。` })
      }
    } else {
      const bins = histogram(workRows, m.name, 10)
      charts.push({ id: `hist_${m.name}`, title: `${m.name} 分布`, type: 'bar', option: histOption(bins, `${m.name}分布`), caliber: sp() + `口径：等分 10 箱统计频数。` })
      const vals = workRows.map(r => toNum(r[m.name])).filter(v => !isNaN(v))
      insights.push({ icon: 'dist', text: `「${m.name}」均值 ${fmt(avg(vals))}，区间 ${fmt(Math.min(...vals))} ~ ${fmt(Math.max(...vals))}。`, caliber: sp() + `口径：极值与均值均为真实计算。` })
    }
  })

  // 维度分布饼图（取多个低基数维度，最多 3 张）
  const pieDims = dims.filter(d => d.cardinality >= 2 && d.cardinality <= 12)
  const pieDone = new Set()
  pieDims.slice(0, 3).forEach(dim => {
    if (charts.length >= 6) return
    const freq = workRows.reduce((acc, r) => { const k = r[dim.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
    const items = Object.entries(freq).map(([name, value]) => ({ name: genderLabel(dim.name, name), value })).sort((a, b) => b.value - a.value)
    if (!items.length) return
    charts.push({ id: `pie_${dim.name}`, title: `${dim.name} 构成`, type: 'pie', drillDim: dim.name, option: pieOption(items, `${dim.name}构成`), caliber: sp() + `口径：按 ${dim.name} 统计行频。` })
    pieDone.add(dim.name)
    const top = items[0]
    insights.push({ icon: 'share', text: `「${dim.name}」中 ${top.name} 占比最高，共 ${top.value} 条（${Math.round(top.value / totalRows * 100)}%）。`, caliber: sp() + `口径：行频占比。` })
  })

  // 维度 × 度量 交叉均值（如 gender × buy_mount：男女谁买得多）。优先可读性好的维度（非类目编码）
  if (measures.length && dims.length && charts.length < 6) {
    const isCodeName = n => /(category|cat_|类目|分类|code|编码|type_id|group_id)/i.test(n)
    const readableDims = dims.filter(d => d.cardinality >= 2 && d.cardinality <= 8 && !isCodeName(d.name) && !looksLikeId(d.name, workRows.map(r => r[d.name]).filter(v => !isEmpty(v)), workRows.length))
    const xDim = readableDims[0] || dims.find(d => d.cardinality >= 2 && d.cardinality <= 8)
    if (xDim) {
      const mm = measures[0]
      const grp = {}
      workRows.forEach(r => { const k = r[xDim.name]; const v = toNum(r[mm.name]); if (isEmpty(k) || isNaN(v)) return; (grp[k] = grp[k] || []).push(v) })
      const items = Object.entries(grp).map(([name, vs]) => ({ name: genderLabel(xDim.name, name), value: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length * 10) / 10 })).sort((a, b) => b.value - a.value)
      if (items.length >= 2) {
        charts.push({ id: `bar_${xDim.name}_avg${mm.name}`, title: `${xDim.name} × ${mm.name} 均值`, type: 'bar', drillDim: xDim.name, option: barOption(items.map(a => a.name), items.map(a => a.value), `${xDim.name}·${mm.name}均值`), caliber: sp() + `口径：按 ${xDim.name} 分组对 ${mm.name} 取均值（真实计算）。` })
        const hi = items[0], lo = items[items.length - 1]
        insights.push({ icon: 'cross', text: `交叉分析：「${xDim.name}」中 ${hi.name} 的「${mm.name}」均值最高（${fmt(hi.value)}），${lo.name} 最低（${fmt(lo.value)}）。`, caliber: sp() + `口径：分组均值对比（真实计算）。` })
      }
    }
  }

  // 双度量散点
  if (measures.length >= 2 && charts.length < 6) {
    const [a, b] = measures
    const pts = workRows.map(r => [toNum(r[a.name]), toNum(r[b.name])]).filter(p => !isNaN(p[0]) && !isNaN(p[1]))
    if (pts.length >= 3) {
      charts.push({ id: `scatter_${a.name}_${b.name}`, title: `${a.name} × ${b.name}`, type: 'scatter', option: scatterOption(pts.slice(0, 120), `${a.name}×${b.name}`), caliber: sp() + `口径：两度量原始值散点（共 ${pts.length} 个有效点，显示前 ${Math.min(pts.length, 120)} 点）。` })
    }
  }

  // 相关性（P2）：数值列两两皮尔逊系数，自动热力图 + 矩阵表（成对删除缺失）
  // 触发条件基于「数值变量列数」（type=number 且非 ID 且有方差），与 correlation() 口径一致
  const numericVars = columns.filter(c => c.type === 'number' && !looksLikeId(c.name, workRows.map(r => r[c.name]).filter(v => !isEmpty(v)), workRows.length || 1) && c.cardinality > 1)
  if (numericVars.length >= 2 && charts.length < 8) {
    const cor = correlation(workTable)
    if (cor.columns.length >= 2) {
      charts.push({
        id: 'corr_heat', title: '数值列相关性热力图', type: 'heatmap',
        option: heatmapOption(cor.matrix, cor.columns),
        caliber: sp() + `口径：数值列两两皮尔逊相关系数（成对删除缺失${cor.truncated ? '，已截断前 20 列' : ''}${cor.sameOrigin && cor.sameOrigin.length ? '；已合并 ' + cor.sameOrigin.length + ' 个同源列（如 quantity/quantity_2）' : ''}），共 ${cor.columns.length} 个数值列。`
      })
      charts.push({
        id: 'corr_table', title: '相关性矩阵', type: 'corr-table',
        table: { head: ['', ...cor.columns], rows: cor.matrix.map((row, i) => [cor.columns[i], ...row.map(v => (v >= 0 ? '+' : '') + v.toFixed(2))]) },
        caliber: sp() + `口径：皮尔逊相关系数矩阵（真实计算，成对删除）。|r|≥0.8 视为强相关。`
      })
      const strong = cor.pairs.filter(p => Math.abs(p.r) >= 0.8).slice(0, 2)
      if (strong.length) {
        insights.push({ icon: 'corr', text: `相关性较强的数值列组合：${strong.map(s => `「${s.a}」与「${s.b}」(r=${s.r >= 0 ? '+' : ''}${s.r.toFixed(2)})`).join('；')}。`, caliber: sp() + `口径：皮尔逊相关系数（真实计算）。` })
      }
    }
  }

  // Top N 条形图（P1）：维度 × 度量 合计降序前 N。与 measure 循环的 dims[0] 柱状互补：
  // 有时间列时 measure 循环出折线，这里补维度 TopN；无时间列时避开 dims[0] 防止重复
  if (measures.length && dims.length && charts.length < 6) {
    const avoidDim = times.length ? null : (dims[0] && dims[0].name)
    const isCodeName = n => /(category|cat_|类目|分类|code|编码|type_id|group_id)/i.test(n)
    const candidates = dims.filter(d =>
      d.cardinality >= 2 && d.cardinality <= 200 &&
      !isCodeName(d.name) &&
      !looksLikeId(d.name, workRows.map(r => r[d.name]).filter(v => !isEmpty(v)), workRows.length) &&
      d.name !== avoidDim
    ).sort((a, b) => b.cardinality - a.cardinality)
    const topDim = candidates[0] || (avoidDim ? null : dims.find(d => d.cardinality >= 2 && d.cardinality <= 200))
    if (topDim) {
      const items = topN(workTable, topDim.name, measures[0].name, { n: 10, op: 'sum' })
      if (items.length >= 2) {
        const nn = Math.min(10, items.length)
        charts.push({ id: `top_${topDim.name}`, title: `Top${nn} ${topDim.name}`, type: 'bar', drillDim: topDim.name, option: barOption(items.map(a => genderLabel(topDim.name, a.name)), items.map(a => a.value), `Top${nn}·${topDim.name}·${measures[0].name}`), caliber: sp() + `口径：按 ${topDim.name} 分组对 ${measures[0].name} 取合计，降序取前 ${nn} 名。` })
      }
    }
  }

  // 纯分类型（无数值度量）数据：以构成/分布/交叉分析为主
  if (measures.length === 0 && dims.length) {
    // 所有非数值、非时间的列都是候选分类型（含高基数文本列），排除主键/唯一标识
    const catCols = columns.filter(c => c.semantic !== 'measure' && c.semantic !== 'time')
    // 排除主键/唯一标识列（编号、证件号码、姓名、手机号等），它们无统计意义
    const analyticDims = catCols.filter(d => {
      const nonEmpty = workRows.map(r => r[d.name]).filter(v => !isEmpty(v))
      if (looksLikeId(d.name, nonEmpty, nonEmpty.length || 1)) return false
      if (d.cardinality >= totalRows) return false // 每行都不同 → 无意义
      return true
    })
    // 低基数维度 → 饼图（构成，跳过通用饼图已覆盖的维度）
    const lowCard = analyticDims.filter(d => d.cardinality >= 2 && d.cardinality <= 12 && !pieDone.has(d.name))
    lowCard.slice(0, 4).forEach(d => {
      if (charts.length >= 6) return
      const freq = workRows.reduce((acc, r) => { const k = r[d.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      if (!items.length) return
      charts.push({ id: `pie_${d.name}`, title: `${d.name} 构成`, type: 'pie', drillDim: d.name, option: pieOption(items, `${d.name}构成`), caliber: sp() + `口径：按 ${d.name} 统计行频（共 ${items.reduce((s, x) => s + x.value, 0)} 条有效）。` })
      const top = items[0]
      insights.push({ icon: 'share', text: `「${d.name}」中 ${top.name} 占比最高，共 ${top.value} 人（${Math.round(top.value / totalRows * 100)}%）。`, caliber: sp() + `口径：行频 ÷ 总行数。` })
    })
    // 中高基数维度 → 柱状（计数前 12）
    const midCard = analyticDims.filter(d => d.cardinality > 12)
    midCard.slice(0, 2).forEach(d => {
      if (charts.length >= 6) return
      const freq = workRows.reduce((acc, r) => { const k = r[d.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12)
      if (!items.length) return
      charts.push({ id: `bar_${d.name}`, title: `${d.name} 分布（前 12）`, type: 'bar', drillDim: d.name, option: barOption(items.map(a => a.name), items.map(a => a.value), `${d.name}·计数`), caliber: sp() + `口径：按 ${d.name} 分组计数，取前 12 项。` })
      insights.push({ icon: 'rank', text: `「${d.name}」出现最多的是 ${items[0].name}（${items[0].value} 人）。`, caliber: sp() + `口径：分组计数取极值。` })
    })
    // 交叉分析：就业状态 × 学历（若两者均存在）—— 仅产出 insight
    const statusCol = dims.find(d => /(就业状态|就业情况|就业类别)/.test(d.name)) || dims.find(d => /(状态|就业)/.test(d.name) && d.cardinality <= 8 && d.cardinality >= 2)
    const eduCol = dims.find(d => /(学历|教育|学位|层次)/.test(d.name))
    if (statusCol && eduCol) {
      const cross = {}
      workRows.forEach(r => { const s = r[statusCol.name], e = r[eduCol.name]; if (isEmpty(s) || isEmpty(e)) return; cross[s] = cross[s] || {}; cross[s][e] = (cross[s][e] || 0) + 1 })
      const statuses = Object.keys(cross)
      if (statuses.length) {
        let best = null
        statuses.forEach(s => Object.entries(cross[s]).forEach(([e, c]) => { if (!best || c > best.c) best = { s, e, c } }))
        insights.push({ icon: 'cross', text: `交叉分析：「${statusCol.name}=${best.s}」群体里以「${eduCol.name}=${best.e}」最多（${best.c} 人）。`, caliber: sp() + `口径：${statusCol.name} × ${eduCol.name} 计数取极值（真实计算）。` })
      }
    }
    // 有时间字段且无度量：按年份聚合出分布（如出生年份、下单年份），至少 2 个年份才有意义
    if (times.length && charts.length < 6) {
      const tf = times[0]
      const yearFreq = {}
      workRows.forEach(r => {
        const s = String(r[tf.name]).trim().replace(/-|\//g, '').slice(0, 4)
        if (/^\d{4}$/.test(s)) yearFreq[s] = (yearFreq[s] || 0) + 1
      })
      const yrs = Object.entries(yearFreq).sort((a, b) => a[0] > b[0] ? 1 : -1)
      if (yrs.length >= 2) {
        charts.push({ id: `bar_year_${tf.name}`, title: `${tf.name} 年份分布`, type: 'bar', drillDim: tf.name, option: barOption(yrs.map(x => x[0]), yrs.map(x => x[1]), `${tf.name}年份分布`), caliber: sp() + `口径：按 ${tf.name} 取前 4 位年份统计频数。` })
        const top = yrs.reduce((a, b) => a[1] > b[1] ? a : b)
        insights.push({ icon: 'rank', text: `「${tf.name}」中 ${top[0]} 年记录最多，共 ${top[1]} 条（${Math.round(top[1] / totalRows * 100)}%）。`, caliber: sp() + `口径：年份频数取极值。` })
      }
    }
  }

  // 总体结论（真实统计支撑）
  const head = measures[0]
  if (head) {
    const vals = workRows.map(r => toNum(r[head.name])).filter(v => !isNaN(v))
    insights.unshift({ icon: 'summary', text: `数据共 ${totalRows} 行、${columns.length} 列；核心度量「${head.name}」整体均值 ${fmt(avg(vals))}。建议优先核查下方质量诊断与异常点后再下结论。`, caliber: sp() + `口径：${sampled.enabled ? '抽样' : '全表'}真实统计。` })
  } else if (dims.length) {
    const named = dims.filter(d => !/(编号|姓名|证件|手机|账号|编号|备注|id|ID)/.test(d.name))
    const focusList = named.slice(0, 3).map(d => `「${d.name}」`).join('、') || (named[0] ? `「${named[0].name}」` : '')
    insights.unshift({ icon: 'summary', text: `数据共 ${totalRows} 行、${columns.length} 列，全部为分类型字段，已自动生成各类别构成与分布分析。建议优先查看 ${focusList} 等维度的构成与交叉关系。`, caliber: sp() + `口径：${sampled.enabled ? '抽样' : '全表'}真实统计（无数值度量，分析以频数与占比为主）。` })
  } else {
    insights.unshift({ icon: 'summary', text: `数据共 ${totalRows} 行、${columns.length} 列；未识别到可用于分析的维度或度量，请检查字段类型。`, caliber: sp() })
  }

  return { table: t, charts, insights, measures, dims, times, sampled }
}

// ---------- LLM 协作接口（LLM 只做选择与解释，数字全部由以下函数真实计算） ----------

// 数据集概况（供 LLM 规划/解析意图使用，只给 schema 与少量样本）
export function schemaSummaryFor(table) {
  const t = inferSchema(table)
  return {
    rowCount: t.rows.length,
    columns: t.columns.map(c => ({ name: c.name, semantic: c.semantic, type: c.type, cardinality: c.cardinality })),
    sampleRows: t.rows.slice(0, 5),
  }
}

// 按LLM返回的 AnalysisPlan 真实计算出图；字段非法的项丢弃，全无效返回 null（回退规则引擎）
export function analyzeByPlan(table, plan) {
  if (!plan || !Array.isArray(plan.charts) || !plan.charts.length) return null
  const t = inferSchema(table)
  const { rows } = t
  const colByName = Object.fromEntries(t.columns.map(c => [c.name, c]))
  const measures = t.columns.filter(c => c.semantic === 'measure')
  const dims = t.columns.filter(c => c.semantic === 'dimension')
  const times = t.columns.filter(c => c.semantic === 'time')
  const charts = []

  plan.charts.slice(0, 5).forEach((p, i) => {
    const type = ['line', 'bar', 'pie', 'histogram', 'scatter'].includes(p.chartType) ? p.chartType : 'bar'
    const m = p.measure && colByName[p.measure] ? colByName[p.measure] : null
    const d = p.dimension && colByName[p.dimension] && colByName[p.dimension].semantic === 'dimension' ? colByName[p.dimension] : (dims[0] || null)

    // 纯分类型数据集：pie 允许用 dimension 计数（measure 可为空）
    if (type === 'pie' && d && (!m || m.semantic !== 'measure')) {
      const freq = rows.reduce((acc, r) => { const k = r[d.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      const title = p.title || `${d.name} 构成`
      charts.push({ id: `plan_pie_${i}`, title, type: 'pie', option: pieOption(items, title), caliber: `口径：按 ${d.name} 统计行频。` })
      return
    }
    if (!m || m.semantic !== 'measure') return
    const tf = p.timeField && colByName[p.timeField] && colByName[p.timeField].semantic === 'time' ? colByName[p.timeField] : (times[0] || null)
    const op = ['sum', 'avg', 'count', 'max', 'min'].includes(p.aggregation) ? p.aggregation : 'sum'
    const title = p.title || `${m.name}（${op === 'sum' ? '合计' : op === 'avg' ? '均值' : op}）`

    if (type === 'line' && tf) {
      // 与规则引擎 analyze() 保持一致：时间序列按粒度聚合（不逐行连线）
      const ts = timeSeries({ columns: t.columns, rows }, tf.name, m.name, { granularity: 'auto', op })
      if (ts.length) {
        const gr = pickGranularity(rows, tf.name)
        const grLabel = gr === 'day' ? '日' : gr === 'month' ? '月' : '年'
        charts.push({ id: `plan_line_${i}`, title, type: 'line', option: lineOption(ts.map(x => x.bucket), ts.map(x => x.value), title), caliber: `口径：按 ${tf.name} ${grLabel}聚合，对 ${m.name} 取 ${op}。` })
      }
    } else if (type === 'pie' && d && d.cardinality <= 20) {
      const freq = rows.reduce((acc, r) => { const k = r[d.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      charts.push({ id: `plan_pie_${i}`, title, type: 'pie', option: pieOption(items, title), caliber: `口径：按 ${d.name} 统计行频。` })
    } else if (type === 'histogram') {
      const bins = histogram(rows, m.name, 10)
      charts.push({ id: `plan_hist_${i}`, title, type: 'bar', option: histOption(bins, title), caliber: `口径：等分 10 箱统计频数。` })
    } else if (type === 'scatter' && measures.length >= 2) {
      const other = measures.find(x => x.name !== m.name) || m
      const pts = rows.map(r => [toNum(r[m.name]), toNum(r[other.name])]).filter(p => !isNaN(p[0]) && !isNaN(p[1])).slice(0, 120)
      charts.push({ id: `plan_scatter_${i}`, title, type: 'scatter', option: scatterOption(pts, title), caliber: `口径：${m.name} × ${other.name} 散点（抽样 120 点）。` })
    } else if (d) {
      const agg = groupAgg(rows, d.name, m.name, op).slice(0, 12)
      charts.push({ id: `plan_bar_${i}`, title, type: 'bar', option: barOption(agg.map(a => a.name), agg.map(a => a.value), title), caliber: `口径：按 ${d.name} 分组，对 ${m.name} 取 ${op}，前 12 项。` })
    }
  })

  if (!charts.length) return null
  // 洞察仍由规则引擎生成（真实统计），LLM 之后可基于 buildStatSummary 润色
  const base = analyze(table)
  return { ...base, charts: charts.slice(0, 6), insights: base.insights }
}

// 已计算统计量摘要（供 LLM 润色结论；LLM 严禁自行算数，只能引用其中数字）
export function buildStatSummary(table, analysis, quality) {
  return {
    数据规模: { 行数: table.rows.length, 列数: table.columns.length },
    数据质量评分: quality.score,
    质量问题数: quality.issues.length,
    图表结论: analysis.charts.map(c => ({ 图表: c.title, 结论: c.insightText || c.caliber, 口径: c.caliber })),
    核心结论: analysis.insights.map(i => ({ 结论: i.text, 口径: i.caliber })),
    说明: '以上数字均由代码真实计算。请改写为业务语言，严禁新增/修改任何数字。',
  }
}

// 意图执行：LLM 解析出的 {metric, dim, op} → 真实计算 → 文本+图表
export function executeIntent(table, intent) {
  if (!intent || !intent.metric) return null
  const t = inferSchema(table)
  const { rows } = t
  const measures = t.columns.filter(c => c.semantic === 'measure')
  const dims = t.columns.filter(c => c.semantic === 'dimension')
  const times = t.columns.filter(c => c.semantic === 'time')
  const m = measures.find(c => c.name === intent.metric) || measures.find(c => c.name.includes(intent.metric) || intent.metric.includes(c.name))
  if (!m) return null
  const d = (intent.dim && (dims.find(c => c.name === intent.dim) || dims.find(c => c.name.includes(intent.dim)))) || dims[0] || null
  const op = intent.op || 'max'
  const clean = rows.filter(r => !isEmpty(r[m.name]) && !isNaN(toNum(r[m.name])))
  if (!clean.length) return null
  const vals = clean.map(r => toNum(r[m.name]))

  if (op === 'max' || op === 'min') {
    const v = op === 'max' ? Math.max(...vals) : Math.min(...vals)
    const row = clean.find(r => toNum(r[m.name]) === v)
    const where = d ? `（${d.name}="${row[d.name]}"）` : times[0] ? `（${times[0].name}=${row[times[0].name]}）` : ''
    return { text: `「${m.name}」${op === 'max' ? '最高' : '最低'}为 ${fmt(v)}${where}，共 ${vals.length} 个有效值参与比较。`, chart: null }
  }
  if (op === 'avg') return { text: `「${m.name}」均值为 ${fmt(avg(vals))}（${vals.length} 个有效值）。`, chart: null }
  if (op === 'sum') return { text: `「${m.name}」合计为 ${fmt(vals.reduce((a, b) => a + b, 0))}（${vals.length} 个有效值）。`, chart: null }
  if (op === 'trend' && times[0]) {
    const tf = times[0]
    const sorted = [...clean].sort((a, b) => Date.parse(normDate(a[tf.name])) - Date.parse(normDate(b[tf.name])))
    const vs = sorted.map(r => toNum(r[m.name]))
    const half = Math.floor(vs.length / 2)
    const first = avg(vs.slice(0, half)), last = avg(vs.slice(half))
    const pct = first ? (last - first) / first * 100 : 0
    return {
      text: `「${m.name}」整体呈${pct >= 0 ? '上升' : '下降'}趋势，后半段均值较前半段变化 ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%（${fmt(first)} → ${fmt(last)}）。`,
      chart: { id: 'intent_line', title: `${m.name}趋势`, type: 'line', option: lineOption(sorted.map(r => r[tf.name]), vs, `${m.name}趋势`), caliber: '口径：按时间升序，前后半段均值对比。' },
    }
  }
  if (op === 'share' && d) {
    const agg = groupAgg(rows, d.name, m.name, 'sum')
    const total = agg.reduce((s, a) => s + a.value, 0)
    const top = agg[0]
    return {
      text: `按 ${d.name} 合计，「${top.name}」贡献最高：${fmt(top.value)}，占 ${total ? (top.value / total * 100).toFixed(1) : 0}%。`,
      chart: { id: 'intent_pie', title: `${d.name} · ${m.name}占比`, type: 'pie', option: pieOption(agg.slice(0, 8).map(a => ({ name: a.name, value: a.value })), `${d.name}占比`), caliber: `口径：按 ${d.name} 分组合计后计算占比。` },
    }
  }
  return null
}

// ---------- 对话式追问（规则 + 真实统计，可扩展为 LLM） ----------
export function chatAnswer(table, question) {
  const t = inferSchema(table)
  const { rows, columns } = t
  const measures = columns.filter(c => c.semantic === 'measure')
  const dims = columns.filter(c => c.semantic === 'dimension')
  const times = columns.filter(c => c.semantic === 'time')
  const q = question.trim()
  const usedMeasure = measures.find(m => q.includes(m.name)) || measures[0]
  const usedDim = dims.find(d => q.includes(d.name)) || dims[0]

  if (/缺失|质量|异常/.test(q)) {
    return { text: `可在「数据质量诊断」页查看完整问题清单。当前检测到：${columns.filter(c => c.missing > 0).map(c => `${c.name} 缺失 ${c.missing} 行`).join('；') || '暂无缺失'}。`, chart: null }
  }
  if (usedMeasure) {
    const vals = rows.map(r => toNum(r[usedMeasure.name])).filter(v => !isNaN(v))
    if (/最高|最大|峰值/.test(q)) {
      const max = Math.max(...vals)
      let where = ''
      if (usedDim) { const row = rows.find(r => toNum(r[usedMeasure.name]) === max); where = `出现在 ${usedDim.name}="${row[usedDim.name]}"` }
      return { text: `「${usedMeasure.name}」最高为 ${fmt(max)}（${where}）。`, chart: null }
    }
    if (/最低|最小|谷值/.test(q)) {
      const min = Math.min(...vals)
      let where = ''
      if (usedDim) { const row = rows.find(r => toNum(r[usedMeasure.name]) === min); where = `出现在 ${usedDim.name}="${row[usedDim.name]}"` }
      return { text: `「${usedMeasure.name}」最低为 ${fmt(min)}（${where}）。`, chart: null }
    }
    if (/平均|均值/.test(q)) return { text: `「${usedMeasure.name}」均值为 ${fmt(avg(vals))}（基于 ${vals.length} 个有效值）。`, chart: null }
    if (/总和|合计|总量/.test(q)) return { text: `「${usedMeasure.name}」合计为 ${fmt(vals.reduce((a, b) => a + b, 0))}。`, chart: null }
    if (times.length && /趋势|变化|增长/.test(q)) {
      const timeCol = times[0].name
      const sorted = [...rows].sort((a, b) => Date.parse(normDate(a[timeCol])) - Date.parse(normDate(b[timeCol])))
      const vs = sorted.map(r => toNum(r[usedMeasure.name]))
      const half = Math.floor(vs.length / 2)
      const pct = avg(vs.slice(0, half)) ? (avg(vs.slice(half)) - avg(vs.slice(0, half))) / avg(vs.slice(0, half)) * 100 : 0
      return { text: `「${usedMeasure.name}」整体呈${pct >= 0 ? '上升' : '下降'}趋势，区间变化 ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%。`, chart: { id: 'chat_line', title: `${usedMeasure.name}趋势`, type: 'line', option: lineOption(sorted.map(r => normDate(r[timeCol])), vs, `${usedMeasure.name}趋势`), caliber: '口径：按时间升序真实计算。' } }
    }
    if (/占比|比例|份额/.test(q) && usedDim) {
      const freq = rows.reduce((acc, r) => { const k = r[usedDim.name]; if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1; return acc }, {})
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      return { text: `「${usedDim.name}」中 ${items[0].name} 占比最高，约 ${Math.round(items[0].value / rows.length * 100)}%。`, chart: { id: 'chat_pie', title: `${usedDim.name}构成`, type: 'pie', option: pieOption(items, `${usedDim.name}构成`), caliber: '口径：行频占比。' } }
    }
  }
  return { text: `我已基于真实统计回答。你可以试着问："${usedMeasure ? usedMeasure.name + ' 最高是多少' : '销售额最高是多少'}"、"整体趋势如何"、"${usedDim ? usedDim.name : '区域'} 占比"。`, chart: null }
}

export function suggestQuestions(table) {
  const t = inferSchema(table)
  const out = []
  if (t.columns.some(c => c.semantic === 'measure')) out.push('销售额最高是多少？')
  if (t.columns.some(c => c.semantic === 'time')) out.push('整体趋势如何？')
  if (t.columns.some(c => c.semantic === 'dimension')) out.push('区域占比多少？')
  out.push('数据质量有问题吗？')
  return out.slice(0, 4)
}
