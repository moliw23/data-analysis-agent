// @vitest-environment node
// 手动图表 manualChart：9 种图表类型 + 各缺失参数的安全降级（null）
import { describe, it, expect } from 'vitest'
import { parseCSVText, inferSchema } from '../engine.js'
import { manualChart } from '../engine/manualChart.js'

const inf = (csv) => inferSchema(parseCSVText(csv))

// 标准表：时间 + 维度 + 2 度量
function standardTable() {
  const rows = []
  const regions = ['华东', '华南', '华北', '西南']
  for (let i = 0; i < 12; i++) {
    rows.push(`2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${regions[i % 4]},${100 + i * 37},${i + 1}`)
  }
  return inf('日期,区域,销售额,订单数\n' + rows.join('\n'))
}

// 12 个月度序列（用于 forecast/anomaly，需 >=3 / >=4 桶）
function monthlyTable() {
  const rows = []
  for (let m = 1; m <= 12; m++) {
    rows.push(`2023-${String(m).padStart(2, '0')}-15,${100 + m * 7}`)
  }
  return inf('日期,销售额\n' + rows.join('\n'))
}

// 单行 → 时间序列只有 1 个桶（用于 momYoy<2 / forecast<3 / anomaly<4 的安全降级）
function singleMonthTable() {
  return inf(['日期,销售额', '2024-01-15,100'].join('\n'))
}

// 单数值列（相关/列分析降级用）
function singleNumericTable() {
  return inf(['销售额', '10', '20', '30'].join('\n'))
}

// 维度 × 维度 × 度量（透视用）
function pivotTable() {
  const rows = []
  const channel = ['线上', '线下']
  const regions = ['华东', '华南']
  for (let i = 0; i < 16; i++) {
    rows.push(`${regions[i % 2]},${channel[i % 2]},${100 + i * 5}`)
  }
  return inf('区域,渠道,销售额\n' + rows.join('\n'))
}

describe('manualChart 各类型', () => {
  it('trend：折线 + 口径', () => {
    const c = manualChart(standardTable(), { kind: 'trend', timeCol: '日期', measureCol: '销售额', op: 'sum' })
    expect(c.type).toBe('line')
    expect(c.option).toHaveProperty('xAxis')
    expect(c.caliber).toContain('口径')
  })
  it('topN：柱状 + 截断', () => {
    const c = manualChart(standardTable(), { kind: 'topN', dimCol: '区域', measureCol: '销售额', n: 3, op: 'sum' })
    expect(c.type).toBe('bar')
    expect(c.title).toContain('Top3')
  })
  it('momYoy：折线 + 同环比表', () => {
    const c = manualChart(standardTable(), { kind: 'momYoy', timeCol: '日期', measureCol: '销售额' })
    expect(c.type).toBe('line')
    expect(c.table.head).toEqual(['时间', '值', '环比%', '同比%'])
  })
  it('corr：热力图 + 矩阵表', () => {
    const c = manualChart(standardTable(), { kind: 'corr', cols: ['销售额', '订单数'] })
    expect(c.type).toBe('heatmap')
    expect(c.table).toBeTruthy()
  })
  it('pivot：交叉表', () => {
    const c = manualChart(pivotTable(), { kind: 'pivot', rowDim: '区域', colDim: '渠道', measureCol: '销售额', op: 'sum' })
    expect(c.type).toBe('pivot')
    expect(c.table.head.length).toBeGreaterThan(1)
  })
  it('column 数值列：统计表（含均值行）+ 分布 option', () => {
    const c = manualChart(standardTable(), { kind: 'column', col: '销售额' })
    expect(c.table.head).toEqual(['指标', '值'])
    expect(c.table.rows.some((r) => r[0] === '均值')).toBe(true)
    expect(c.option).toBeTruthy()
  })
  it('column 分类型列：Top 值表', () => {
    const c = manualChart(standardTable(), { kind: 'column', col: '区域' })
    expect(c.type).toBe('table')
    expect(c.table.head).toContain('区域')
  })
  it('forecast：预测序列图', () => {
    const c = manualChart(monthlyTable(), { kind: 'forecast', timeCol: '日期', measureCol: '销售额', horizon: 4 })
    expect(c.type).toBe('forecast')
    expect(c.option.series).toBeTruthy()
    expect(c.caliber).toContain('R²')
  })
  it('anomaly：异常标注图', () => {
    const c = manualChart(monthlyTable(), { kind: 'anomaly', timeCol: '日期', measureCol: '销售额', k: 3, method: 'zscore' })
    expect(c.type).toBe('anomaly')
    expect(c.caliber).toContain('异常')
  })
  it('map：地区聚合占位 option', () => {
    const c = manualChart(standardTable(), { kind: 'map', regionCol: '区域', measureCol: '销售额' })
    expect(c.type).toBe('map')
    expect(c.option._map).toBe('china')
  })
})

describe('manualChart 安全降级（null）', () => {
  it('trend 缺时间/度量 → null', () => {
    expect(manualChart(inf('a,b\nx,1\ny,2'), { kind: 'trend' })).toBeNull()
  })
  it('topN 缺维度/度量 → null；items<2 → null', () => {
    expect(manualChart(standardTable(), { kind: 'topN', measureCol: '销售额' })).toBeNull()
    const single = inf(['区域,销售额', '华东,100'].join('\n'))
    expect(manualChart(single, { kind: 'topN', dimCol: '区域', measureCol: '销售额' })).toBeNull()
  })
  it('momYoy 序列 <2 → null', () => {
    expect(manualChart(singleMonthTable(), { kind: 'momYoy', timeCol: '日期', measureCol: '销售额' })).toBeNull()
  })
  it('corr 数值列 <2 → null', () => {
    expect(manualChart(singleNumericTable(), { kind: 'corr', cols: ['销售额'] })).toBeNull()
  })
  it('pivot 缺 row/col/measure → null；pivot 计算返回 null → null', () => {
    expect(manualChart(standardTable(), { kind: 'pivot', rowDim: '区域' })).toBeNull()
  })
  it('column 缺列 / 列不存在 → null', () => {
    expect(manualChart(standardTable(), { kind: 'column' })).toBeNull()
    expect(manualChart(standardTable(), { kind: 'column', col: '不存在' })).toBeNull()
  })
  it('forecast 序列 <3 → null', () => {
    expect(manualChart(singleMonthTable(), { kind: 'forecast', timeCol: '日期', measureCol: '销售额' })).toBeNull()
  })
  it('anomaly 序列 <4 → null', () => {
    expect(manualChart(singleMonthTable(), { kind: 'anomaly', timeCol: '日期', measureCol: '销售额' })).toBeNull()
  })
  it('map 缺地区 → null；仅有地区(度量默认取首个) → 正常出图', () => {
    expect(manualChart(standardTable(), { kind: 'map', measureCol: '销售额' })).toBeNull()
    expect(manualChart(standardTable(), { kind: 'map', regionCol: '区域' })).not.toBeNull()
  })
  it('未知 kind → null', () => {
    expect(manualChart(standardTable(), { kind: 'unknownKind' })).toBeNull()
  })
})
