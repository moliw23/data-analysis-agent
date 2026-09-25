// @vitest-environment jsdom
// 共享测试基础设施：DOM 环境垫片 + 样本数据 + echarts 动态导入 mock 工厂
import { vi } from 'vitest'
import { parseCSVText } from '../engine.js'

// 与 store.test.js 同款 12 行样本（保证 inferSchema 语义判定稳定）
export const SAMPLE_CSV =
  '日期,区域,销售额,订单数\n' +
  Array.from({ length: 12 }, (_, i) =>
    `2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${['华东', '华南', '华北', '西南'][i % 4]},${100 + i * 37},${i + 1}`).join('\n')

export function makeSampleTable() {
  return parseCSVText(SAMPLE_CSV)
}

// jsdom 缺失的 API 垫片（幂等，多文件重复调用安全）
export function installDomMocks() {
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (typeof window.matchMedia === 'undefined') {
    window.matchMedia = (q) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false },
    })
  }
  if (typeof global.requestAnimationFrame === 'undefined') {
    global.requestAnimationFrame = (cb) => { cb(0); return 0 }
    global.cancelAnimationFrame = () => {}
  }
  // 多数组件用 window.alert / window.confirm，统一换成可被断言的 spy
  if (!window.alert || !window.alert._isMock) {
    window.alert = vi.fn()
  }
  if (!window.confirm || !window.confirm._isMock) {
    window.confirm = vi.fn(() => true)
  }
}

// EChart 通过 `await import('echarts')` 动态加载；提供无 canvas 的桩实例
export function makeEchartsInstance() {
  return {
    setOption: () => {},
    getDataURL: () => 'data:image/png;base64,AAAA',
    on: () => {},
    off: () => {},
    resize: () => {},
    dispose: () => {},
  }
}
export function echartsMockFactory() {
  const inst = makeEchartsInstance()
  return { default: { init: () => inst }, init: () => inst }
}

// 构造一个最小 result（看板/图表详情用）
export function makeResult(table) {
  return {
    table,
    sampled: { enabled: false },
    insights: [
      { icon: 'summary', text: '整体销售额呈上升趋势', caliber: '基于 12 行样本' },
      { icon: 'trend', text: '华东贡献最高', caliber: '按区域聚合' },
    ],
    charts: [
      {
        id: 'c1',
        title: '区域销售额',
        type: 'bar',
        manual: false,
        caliber: '聚合后求和',
        option: { xAxis: { type: 'category', data: ['华东', '华南'] }, yAxis: {}, series: [{ type: 'bar', data: [100, 200] }] },
      },
      {
        id: 'c2',
        title: '同环比表',
        type: 'table',
        manual: true,
        table: { head: ['区域', '销售额'], rows: [['华东', '1110'], ['华南', '640']] },
      },
    ],
  }
}
