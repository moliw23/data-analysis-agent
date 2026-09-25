// @vitest-environment node
// 引擎时间序列模块单测：聚合 / 同环比 / TopN / 预测 / 异常 / 地图 / 各类 option 构造
import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../engine.js'
import {
  timeSeries, momYoy, topN, forecast, detectAnomalies, forecastOption, anomalyOption, mapOption,
} from '../engine/timeseries.js'

const mk = (csv) => parseCSVText(csv) // {columns, rows}

describe('timeSeries 聚合', () => {
  const daily = mk([
    '日期,数值',
    '2024-01-01,10',
    '2024-01-02,20',
    '2024-01-03,30',
  ].join('\n'))

  it('day 粒度：按日分桶求和并升序', () => {
    const ts = timeSeries(daily, '日期', '数值', { granularity: 'day', op: 'sum' })
    expect(ts.map((x) => x.bucket)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03'])
    expect(ts.map((x) => x.value)).toEqual([10, 20, 30])
  })

  it('month / avg / count / max / min 各算子', () => {
    const monthCsv = mk([
      '日期,数值',
      '2024-01-10,10', '2024-01-20,30',
      '2024-02-10,20', '2024-02-20,40',
    ].join('\n'))
    const sumM = timeSeries(monthCsv, '日期', '数值', { granularity: 'month', op: 'sum' })
    expect(sumM.map((x) => x.value)).toEqual([40, 60])
    const avgM = timeSeries(monthCsv, '日期', '数值', { granularity: 'month', op: 'avg' })
    expect(avgM.map((x) => x.value)).toEqual([20, 30])
    const cntM = timeSeries(monthCsv, '日期', '数值', { granularity: 'month', op: 'count' })
    expect(cntM.map((x) => x.value)).toEqual([2, 2])
    const maxM = timeSeries(monthCsv, '日期', '数值', { granularity: 'month', op: 'max' })
    expect(maxM.map((x) => x.value)).toEqual([30, 40])
    const minM = timeSeries(monthCsv, '日期', '数值', { granularity: 'month', op: 'min' })
    expect(minM.map((x) => x.value)).toEqual([10, 20])
  })

  it('year 粒度：按年分桶', () => {
    const yearCsv = mk([
      '日期,数值',
      '2022-05-01,5', '2023-05-01,8',
    ].join('\n'))
    const ts = timeSeries(yearCsv, '日期', '数值', { granularity: 'year', op: 'sum' })
    expect(ts.map((x) => x.bucket)).toEqual(['2022', '2023'])
    expect(ts.map((x) => x.value)).toEqual([5, 8])
  })

  it('auto 粒度：按跨度推断 day/month/year', () => {
    const withinMonth = mk(['日期,v\n2024-01-01,1\n2024-01-15,2'].join('\n'))
    expect(timeSeries(withinMonth, '日期', 'v').every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.bucket))).toBe(true)
    const threeMonths = mk(['日期,v\n2024-01-01,1\n2024-03-01,2'].join('\n'))
    expect(timeSeries(threeMonths, '日期', 'v').every((x) => /^\d{4}-\d{2}$/.test(x.bucket))).toBe(true)
    const twoYears = mk([
      '日期,v', '2020-01-01,1', '2022-06-01,2',
    ].join('\n'))
    expect(timeSeries(twoYears, '日期', 'v').every((x) => /^\d{4}$/.test(x.bucket))).toBe(true)
  })

  it('非法算子回退为 sum；非法粒度回退 day', () => {
    const ts = timeSeries(daily, '日期', '数值', { op: 'unknownOp', granularity: 'bogus' })
    expect(ts.map((x) => x.value)).toEqual([10, 20, 30])
  })

  it('空表 / 全非法日期 / 全非数值度量 → 返回空数组', () => {
    expect(timeSeries(mk('日期,数值'), '日期', '数值')).toEqual([])
    const badDate = mk(['日期,数值\n不是日期,5\n', '2024-13-99,6'].join('\n'))
    expect(timeSeries(badDate, '日期', '数值')).toEqual([])
    const badNum = mk(['日期,数值\n2024-01-01,abc\n2024-01-02,def'].join('\n'))
    expect(timeSeries(badNum, '日期', '数值')).toEqual([])
  })
})

describe('momYoy 同环比', () => {
  it('同年内两月：环比有值、同比为空', () => {
    const series = [
      { bucket: '2023-01', value: 100 },
      { bucket: '2023-02', value: 150 },
    ]
    const out = momYoy(series, { granularity: 'month' })
    expect(out).toHaveLength(2)
    expect(out[0].momPct).toBe(null)
    expect(out[1].momPct).toBeCloseTo(50, 1)
    expect(out[1].yoyPct).toBe(null)
  })

  it('跨两年月度：次年月份可算同比', () => {
    const series = [
      { bucket: '2022-01', value: 80 },
      { bucket: '2022-12', value: 60 },
      { bucket: '2023-01', value: 100 },
      { bucket: '2023-02', value: 200 },
    ]
    const out = momYoy(series, { granularity: 'month' })
    expect(out[0].yoyPct).toBe(null)
    expect(out[1].yoyPct).toBe(null)
    expect(out[2].yoyPct).toBeCloseTo(25, 1) // (100-80)/80
    expect(out[3].yoyPct).toBe(null) // 无 2022-02
  })

  it('day 粒度且存在去年同日：可算同比', () => {
    const series = [
      { bucket: '2022-03-15', value: 10 },
      { bucket: '2023-03-15', value: 30 },
    ]
    const out = momYoy(series, { granularity: 'day' })
    expect(out[1].yoyPct).toBeCloseTo(200, 1)
  })

  it('year 粒度：无同比', () => {
    const out = momYoy([
      { bucket: '2021', value: 1 },
      { bucket: '2022', value: 2 },
    ], { granularity: 'year' })
    expect(out[1].yoyPct).toBe(null)
    expect(out[1].momPct).toBeCloseTo(100, 1)
  })

  it('单点序列返回空数组', () => {
    expect(momYoy([{ bucket: '2023-01', value: 1 }])).toEqual([])
  })
})

describe('topN 降序前 N', () => {
  const t = mk([
    '区域,销售额',
    '华东,300', '华南,100', '华北,200', '西南,50',
  ].join('\n'))
  it('默认取前 10 并降序', () => {
    const items = topN(t, '区域', '销售额')
    expect(items.map((x) => x.name)).toEqual(['华东', '华北', '华南', '西南'])
  })
  it('n 截断与算子 max', () => {
    const items = topN(t, '区域', '销售额', { n: 2, op: 'max' })
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('华东')
  })
})

describe('forecast 预测', () => {
  const series = Array.from({ length: 12 }, (_, i) => ({ bucket: `2023-${String(i + 1).padStart(2, '0')}`, value: 100 + i * 10 }))
  it('序列 <3 返回 null', () => {
    expect(forecast([{ bucket: 'a', value: 1 }, { bucket: 'b', value: 2 }])).toBeNull()
  })
  it('linear：返回训练/预测序列 + R²/MAPE/趋势/斜率', () => {
    const fc = forecast(series, { horizon: 3, method: 'linear' })
    expect(fc).not.toBeNull()
    expect(fc.method).toBe('linear')
    expect(fc.forecast).toHaveLength(3)
    expect(fc.train).toHaveLength(12)
    expect(typeof fc.r2).toBe('number')
    expect(typeof fc.mape).toBe('number')
    expect(['上升', '下降']).toContain(fc.trend)
    expect(typeof fc.slope).toBe('number')
  })
  it('naive：以前值外推', () => {
    const fc = forecast(series, { horizon: 2, method: 'naive' })
    expect(fc.method).toBe('naive')
    expect(fc.forecast).toHaveLength(2)
    expect(fc.forecast[0].value).toBe(series[series.length - 1].value)
  })
})

describe('detectAnomalies 异常检测', () => {
  it('序列 <4 返回 null', () => {
    expect(detectAnomalies([{ bucket: 'a', value: 1 }, { bucket: 'b', value: 2 }, { bucket: 'c', value: 3 }])).toBeNull()
  })
  it('zscore：检出离群点（单点极端值抬高方差，需足够基数）', () => {
    const series = [
      ...Array.from({ length: 11 }, () => ({ bucket: `2023-${String(Math.random()).slice(2, 4)}`, value: 10 })),
      { bucket: '2023-99', value: 100 },
    ]
    const an = detectAnomalies(series, { k: 3, method: 'zscore' })
    expect(an).not.toBeNull()
    expect(an.method).toBe('zscore')
    expect(an.count).toBeGreaterThanOrEqual(1)
    expect(an.anomalies[0]).toHaveProperty('reason')
    expect(typeof an.upper).toBe('number')
  })
  it('mad 方法可运行且给出区间', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ bucket: `2023-0${i + 1}`, value: 10 + i }))
    const an = detectAnomalies(series, { k: 3, method: 'mad' })
    expect(an.method).toBe('mad')
    expect(typeof an.center).toBe('number')
    expect(an.upper).toBeGreaterThanOrEqual(an.lower)
  })
  it('全平坦序列：返回对象但无异常', () => {
    const series = Array.from({ length: 5 }, (_, i) => ({ bucket: `2023-0${i + 1}`, value: 5 }))
    const an = detectAnomalies(series)
    expect(an).not.toBeNull()
    expect(an.count).toBe(0)
  })
})

describe('option 构造', () => {
  it('forecastOption 含实际/预测/置信带四条 series', () => {
    const opt = forecastOption(
      [{ bucket: '2023-01', value: 1 }, { bucket: '2023-02', value: 2 }],
      [{ bucket: '2023-03', value: 3, lo: 2, hi: 4 }],
      '测试'
    )
    expect(opt.series).toHaveLength(4)
    expect(opt.xAxis.data).toContain('2023-03')
  })
  it('anomalyOption 用 scatter 标注异常点', () => {
    const opt = anomalyOption(
      ['a', 'b', 'c'], [1, 2, 3],
      [{ bucket: 'b', value: 2, reason: '高于' }], '测试'
    )
    expect(opt.series.some((s) => s.type === 'scatter')).toBe(true)
  })
  it('mapOption 按地区聚合，空表返回 null', () => {
    const t = mk([
      '地区,销售额',
      '广东,100', '广东,50', '北京,30',
    ].join('\n'))
    const mo = mapOption('地区', '销售额', t, { op: 'sum' })
    expect(mo._map).toBe('china')
    expect(mo.data.find((d) => d.name === '广东').value).toBe(150)
    expect(mapOption('地区', '销售额', mk('地区,销售额'))).toBeNull()
  })
})
