// @vitest-environment node
// 分析主流程 analyze() + LLM 协作接口单测
import { describe, it, expect } from 'vitest'
import { parseCSVText, inferSchema } from '../engine.js'
import {
  analyze, analyzeByPlan, executeIntent, chatAnswer, schemaSummaryFor, buildStatSummary, suggestQuestions,
} from '../engine/analyze.js'

const inf = (csv) => inferSchema(parseCSVText(csv))

// 标准表：时间 + 维度 + 2 度量（12 行，销售额/订单数 判为 measure）
function standardTable() {
  const rows = []
  const regions = ['华东', '华南', '华北', '西南']
  for (let i = 0; i < 12; i++) {
    rows.push(`2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${regions[i % 4]},${100 + i * 37},${i + 1}`)
  }
  return inf('日期,区域,销售额,订单数\n' + rows.join('\n'))
}

// 无时间：维度 + 2 度量
function noTimeTable() {
  const rows = []
  for (let i = 0; i < 12; i++) {
    rows.push(`${['华东', '华南', '华北', '西南'][i % 4]},${100 + i * 37},${i + 1}`)
  }
  return inf('区域,销售额,订单数\n' + rows.join('\n'))
}

// 纯分类型（无度量），含状态/学历/时间用于覆盖交叉与时间年份分支
function categoricalTable() {
  const rows = []
  const status = ['在职', '失业']
  const edu = ['本科', '硕士', '博士']
  const years = ['2020', '2021']
  for (let i = 0; i < 24; i++) {
    rows.push(`${years[i % 2]}-0${(i % 12) + 1}-15,${status[i % 2]},${edu[i % 3]}`)
  }
  return inf('日期,就业状态,学历\n' + rows.join('\n'))
}

// 单度量、无维度、无时间 → 触发分布直方图分支
function measureOnlyTable() {
  return inf(['数值', ...Array.from({ length: 20 }, (_, i) => String(10 + i * 3))].join('\n'))
}

// 仅数值列（无维度）→ 用于 executeIntent 无维度分支
function dualMeasureTable() {
  return inf(['销售额,订单数', ...Array.from({ length: 12 }, (_, i) => `${10 + i * 3},${i + 1}`)].join('\n'))
}

// 单度量 + 维度 + 时间（12 行）→ 图表数 <6，可触发 TopN 分支
function singleMeasureTable() {
  return inf(['日期,区域,销售额', ...Array.from({ length: 12 }, (_, i) =>
    `2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${['华东', '华南', '华北', '西南'][i % 4]},${100 + i * 37}`).join('\n')])
}

describe('analyze 规则引擎主流程', () => {
  it('标准表：产出折线/饼/交叉均值/散点/相关/TopN + 多条洞察', () => {
    const r = analyze(standardTable())
    const types = r.charts.map((c) => c.type)
    expect(types).toContain('line')
    expect(types).toContain('pie')
    expect(types).toContain('bar')
    expect(types).toContain('scatter')
    expect(types).toContain('heatmap')
    expect(r.charts.some((c) => c.id === 'corr_heat')).toBe(true)
    expect(r.charts.some((c) => c.id === 'corr_table' && c.table)).toBe(true)
    // 月度折线自动附同环比表
    const line = r.charts.find((c) => c.id === 'line_销售额')
    expect(line.table).toBeTruthy()
    expect(r.insights.length).toBeGreaterThan(3)
    // 首条为总体结论
    expect(r.insights[0].icon).toBe('summary')
    expect(r.insights[0].text).toContain('行')
  })

  it('无时间表：度量循环走维度柱状 + 排序洞察', () => {
    const r = analyze(noTimeTable())
    const bar = r.charts.find((c) => c.id === 'bar_销售额')
    expect(bar).toBeTruthy()
    expect(bar.drillDim).toBe('区域')
    expect(r.insights.some((i) => i.icon === 'rank')).toBe(true)
  })

  it('单度量表（图表数<6）：触发 TopN 分支产出 Top 条形', () => {
    const r = analyze(singleMeasureTable())
    expect(r.charts.some((c) => c.id.startsWith('top_'))).toBe(true)
  })

  it('单度量无维度无时间：走分布直方图分支', () => {
    const r = analyze(measureOnlyTable())
    expect(r.charts.some((c) => c.id.startsWith('hist_'))).toBe(true)
    expect(r.insights.some((i) => i.icon === 'dist')).toBe(true)
  })

  it('纯分类型表：饼/柱状/交叉/时间年份分布 + 分类型总体结论', () => {
    const r = analyze(categoricalTable())
    expect(r.measures).toHaveLength(0)
    expect(r.charts.some((c) => c.id.startsWith('pie_'))).toBe(true)
    expect(r.charts.some((c) => c.id.startsWith('bar_'))).toBe(true)
    expect(r.charts.some((c) => c.id.startsWith('bar_year_'))).toBe(true)
    expect(r.insights.some((i) => i.text.includes('交叉分析'))).toBe(true)
    expect(r.insights[0].text).toContain('全部为分类型字段')
  })

  it('空/无可用维度度量：返回空图表 + 结论', () => {
    const r = analyze(inf('销售额\n'))
    expect(r.charts).toEqual([])
    expect(r.insights[0].text).toContain('0 行')
  })

  it('超大表触发采样口径标注', () => {
    const rows = []
    const regions = ['华东', '华南', '华北', '西南']
    for (let i = 0; i < 50001; i++) {
      rows.push(`2024-0${(i % 3) + 1}-01,${regions[i % 4]},${100 + (i % 50)},${i % 7}`)
    }
    const t = inf('日期,区域,销售额,订单数\n' + rows.join('\n'))
    const r = analyze(t)
    expect(r.sampled.enabled).toBe(true)
    expect(r.insights.some((i) => i.caliber.includes('采样口径'))).toBe(true)
    expect(r.charts.length).toBeGreaterThan(0)
  })
})

describe('analyzeByPlan 按计划出图', () => {
  it('null / 空 charts 返回 null（回退规则引擎）', () => {
    expect(analyzeByPlan(standardTable(), null)).toBeNull()
    expect(analyzeByPlan(standardTable(), { charts: [] })).toBeNull()
  })

  it('混合计划：line/bar/pie(计数)/scatter/histogram 均生成', () => {
    const plan = {
      charts: [
        { chartType: 'line', measure: '销售额', timeField: '日期', title: '销售额趋势' },
        { chartType: 'bar', measure: '销售额', dimension: '区域', aggregation: 'sum' },
        { chartType: 'pie', dimension: '区域' },
        { chartType: 'scatter', measure: '销售额' },
        { chartType: 'histogram', measure: '销售额' },
      ],
    }
    const r = analyzeByPlan(standardTable(), plan)
    expect(r).not.toBeNull()
    expect(r.charts.length).toBeGreaterThanOrEqual(4)
    expect(r.charts.some((c) => c.type === 'pie')).toBe(true)
    expect(r.insights).toBeTruthy()
  })

  it('pie 无度量时按维度计数；非法度量项被丢弃；全无效返回 null', () => {
    const pieOnly = analyzeByPlan(standardTable(), { charts: [{ chartType: 'pie', dimension: '区域' }] })
    expect(pieOnly.charts[0].type).toBe('pie')
    const invalid = analyzeByPlan(standardTable(), { charts: [{ chartType: 'bar', measure: '不存在的列' }] })
    expect(invalid).toBeNull()
  })
})

describe('executeIntent 意图执行', () => {
  const t = standardTable()
  it('null / 度量缺失 / 无有效值 → null', () => {
    expect(executeIntent(t, null)).toBeNull()
    expect(executeIntent(t, { metric: '不存在' })).toBeNull()
    expect(executeIntent(standardTable(), { metric: '销售额', op: 'max' })).not.toBeNull()
  })
  it('max/min/avg/sum 文本正确', () => {
    expect(executeIntent(t, { metric: '销售额', op: 'max' }).text).toContain('最高')
    expect(executeIntent(t, { metric: '销售额', op: 'min' }).text).toContain('最低')
    expect(executeIntent(t, { metric: '销售额', op: 'avg' }).text).toContain('均值')
    expect(executeIntent(t, { metric: '销售额', op: 'sum' }).text).toContain('合计')
  })
  it('trend 带时间 → 有图表；无时间 → null', () => {
    expect(executeIntent(t, { metric: '销售额', op: 'trend' }).chart).not.toBeNull()
    expect(executeIntent(noTimeTable(), { metric: '销售额', op: 'trend' })).toBeNull()
  })
  it('share 带维度 → 饼图；无维度 → null', () => {
    const r = executeIntent(standardTable(), { metric: '销售额', dim: '区域', op: 'share' })
    expect(r.chart.type).toBe('pie')
    expect(executeIntent(dualMeasureTable(), { metric: '销售额', op: 'share' })).toBeNull()
  })
})

describe('chatAnswer / suggestQuestions / 概要', () => {
  const t = standardTable()
  it('质量类问题返回缺失提示', () => {
    const r = chatAnswer(t, '数据质量有问题吗')
    expect(r.text).toContain('质量')
  })
  it('最高/最低/平均/合计/趋势/占比 各分支', () => {
    expect(chatAnswer(t, '销售额最高是多少').text).toContain('最高')
    expect(chatAnswer(t, '销售额最低是多少').text).toContain('最低')
    expect(chatAnswer(t, '销售额平均多少').text).toContain('均值')
    expect(chatAnswer(t, '销售额总和').text).toContain('合计')
    expect(chatAnswer(t, '整体趋势如何').chart).not.toBeNull()
    expect(chatAnswer(t, '区域占比').text).toContain('占比')
  })
  it('无匹配分支走兜底建议', () => {
    const r = chatAnswer(t, '随便聊聊')
    expect(r.text).toContain('试着问')
  })
  it('suggestQuestions 含度量/时间/维度/质量四类', () => {
    const q = suggestQuestions(t)
    expect(q).toContain('销售额最高是多少？')
    expect(q).toContain('整体趋势如何？')
    expect(q).toContain('区域占比多少？')
    expect(q).toContain('数据质量有问题吗？')
  })
  it('schemaSummaryFor / buildStatSummary 结构正确', () => {
    const s = schemaSummaryFor(t)
    expect(s.rowCount).toBe(12)
    expect(s.columns.length).toBe(4)
    expect(s.sampleRows.length).toBe(5)
    const analysis = analyze(t)
    const quality = { score: 80, issues: [] }
    const sum = buildStatSummary(t, analysis, quality)
    expect(sum.数据规模.行数).toBe(12)
    expect(sum.数据质量评分).toBe(80)
    expect(sum.说明).toContain('真实计算')
  })
})
