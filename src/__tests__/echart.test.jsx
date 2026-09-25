// @vitest-environment jsdom
// EChart / ChartTable 交互测试：mock 动态 import('echarts')，避免 canvas 依赖
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EChart, ChartTable } from '../components/EChart.jsx'
import { installDomMocks } from './testUtils.jsx'

// vi.hoisted 让 mock 工厂与测试用例共享同一个实例（避免 vi.mock 提升导致的 TDZ）
const { instance, init, echartsMock } = vi.hoisted(() => {
  const instance = {
    setOption: vi.fn(),
    getDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }
  const init = vi.fn(() => instance)
  return { instance, init, echartsMock: { default: { init }, init } }
})
vi.mock('echarts', () => echartsMock)

beforeEach(() => {
  installDomMocks()
  vi.clearAllMocks()
})

describe('EChart', () => {
  it('空数据 / 无有效点 → 渲染占位，不初始化图表', () => {
    render(<EChart option={{ series: [{ data: [] }] }} />)
    expect(screen.getByText('样本不足，无法绘制图表')).toBeTruthy()
    expect(init).not.toHaveBeenCalled()
  })

  it('有数据时动态加载 echarts 并 setOption；downloadable 显示下载按钮', async () => {
    const option = { xAxis: {}, yAxis: {}, series: [{ type: 'bar', data: [1, 2] }] }
    render(<EChart option={option} downloadable fileName="区域销售额" />)
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    expect(init).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('下载图片 (PNG)')).toBeTruthy()
  })

  it('点击下载按钮调用 getDataURL 生成 PNG', async () => {
    const option = { series: [{ type: 'bar', data: [1, 2] }] }
    render(<EChart option={option} downloadable />)
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('下载图片 (PNG)'))
    expect(instance.getDataURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'png' }))
  })

  it('监听 themechange 事件并重新上色（再次 setOption）', async () => {
    const option = { series: [{ type: 'bar', data: [1, 2] }] }
    render(<EChart option={option} />)
    await waitFor(() => expect(instance.setOption).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('themechange'))
    await waitFor(() => expect(instance.setOption).toHaveBeenCalledTimes(2))
  })
})

describe('ChartTable', () => {
  it('渲染静态表与行数统计', () => {
    render(<ChartTable table={{ head: ['区域', '销售额'], rows: [['华东', '1110'], ['华南', '640']] }} exportName="x" />)
    expect(screen.getByText('华东')).toBeTruthy()
    expect(screen.getByText(/共 2 行/)).toBeTruthy()
  })

  it('无表对象时不渲染', () => {
    const { container } = render(<ChartTable table={null} />)
    expect(container.firstChild).toBeNull()
  })
})
