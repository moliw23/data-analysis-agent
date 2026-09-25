import { describe, it, expect } from 'vitest'
import {
  parseCSVText, inferSchema, qualityCheck, correlation, recommendCharts, manualChart,
} from '../engine.js'

// 构造一个带时间/维度/度量的标准表
function sampleTable() {
  const rows = []
  const regions = ['华东', '华南', '华北', '西南']
  for (let i = 0; i < 12; i++) {
    rows.push(`2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${regions[i % 4]},${100 + i * 37},${i + 1}`)
  }
  const csv = '日期,区域,销售额,订单数\n' + rows.join('\n')
  return inferSchema(parseCSVText(csv))
}

describe('解析与 schema 推断', () => {
  it('解析 CSV 头部与行数正确', () => {
    const t = parseCSVText('a,b,c\n1,2,3\n4,5,6')
    expect(t.columns.map(c => c.name)).toEqual(['a', 'b', 'c'])
    expect(t.rows.length).toBe(2)
    expect(t.rows[1].b).toBe('5')
  })

  it('正确处理引号内逗号与换行', () => {
    const csv = 'name,note\n"张三,李四","第一行\n第二行"\nx,普通'
    const t = parseCSVText(csv)
    expect(t.rows[0].name).toBe('张三,李四')
    expect(t.rows[0].note).toBe('第一行\n第二行')
  })

  it('推断数值列语义为 measure、日期列为 time', () => {
    const t = sampleTable()
    const sales = t.columns.find(c => c.name === '销售额')
    const date = t.columns.find(c => c.name === '日期')
    expect(sales.type).toBe('number')
    expect(sales.semantic).toBe('measure')
    expect(date.semantic).toBe('time')
  })
})

describe('数据质量检查', () => {
  it('检出缺失值', () => {
    const csv = 'a,b\n1,\n,2\n3,4'
    const q = qualityCheck(parseCSVText(csv))
    const aIssue = q.issues.find(i => i.col === 'a' && i.type === '缺失值')
    const bIssue = q.issues.find(i => i.col === 'b' && i.type === '缺失值')
    expect(aIssue).toBeTruthy()
    expect(bIssue).toBeTruthy()
    expect(q.score).toBeLessThanOrEqual(100)
  })
})

describe('相关性（多表关联自相关防护）', () => {
  it('同源重复列（quantity / quantity_2 / quantity_3）被去重，不进入矩阵', () => {
    const csv = 'quantity,quantity_2,quantity_3,销售额\n' +
      [1, 2, 3, 4, 5].map((i, k) => `${k + 1},${k + 1},${k + 1},${(k + 1) * 10}`).join('\n')
    const cor = correlation(parseCSVText(csv))
    expect(cor.columns).toContain('quantity')
    expect(cor.columns).not.toContain('quantity_2')
    expect(cor.columns).not.toContain('quantity_3')
    expect(cor.sameOrigin).toEqual(expect.arrayContaining(['quantity_2', 'quantity_3']))
  })

  it('常量列（无方差）不参与相关性计算', () => {
    const csv = 'x,y\n1,5\n2,5\n3,5'
    const cor = correlation(parseCSVText(csv))
    expect(cor.columns).not.toContain('y')
  })
})

describe('智能图表推荐 recommendCharts', () => {
  it('对时间+度量+维度表返回带可执行 spec 的推荐', () => {
    const recs = recommendCharts(sampleTable())
    expect(Array.isArray(recs)).toBe(true)
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) {
      expect(r).toHaveProperty('title')
      expect(r).toHaveProperty('spec')
      expect(r.spec).toHaveProperty('kind')
    }
  })
})

describe('手动图表 manualChart', () => {
  it('趋势图生成含坐标轴 option', () => {
    const chart = manualChart(sampleTable(), { kind: 'trend', timeCol: '日期', measureCol: '销售额', op: 'sum' })
    expect(chart).not.toBeNull()
    expect(chart.type).toBe('line')
    expect(chart.option).toHaveProperty('xAxis')
    expect(chart.option).toHaveProperty('series')
  })

  it('缺时间列/度量列时返回 null（安全降级）', () => {
    const t = inferSchema(parseCSVText('a,b\nx,1\ny,2'))
    expect(manualChart(t, { kind: 'trend' })).toBeNull()
  })
})
