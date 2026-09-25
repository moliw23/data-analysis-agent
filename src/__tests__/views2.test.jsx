// @vitest-environment jsdom
// Views.jsx 中尚未覆盖的视图：PreviewView / Upload / Dashboard / ChartDetail / Report
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PreviewView, Upload, Dashboard, ChartDetail, Report } from '../components/Views.jsx'
import { installDomMocks, makeSampleTable, makeResult } from './testUtils.jsx'

// Dashboard / ChartDetail 内嵌 EChart（动态 import('echarts')），统一 mock
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

describe('PreviewView', () => {
  const table = makeSampleTable()
  it('有数据时渲染数据预览，点击返回/分析触发回调', () => {
    const onClose = vi.fn(), onAnalyze = vi.fn()
    render(<PreviewView ds={{ id: 'd1', meta: { name: '销售数据' }, table }} onClose={onClose} onAnalyze={onAnalyze} />)
    expect(screen.getByText('销售数据')).toBeTruthy()
    expect(screen.getByText('2024-01-01')).toBeTruthy() // DataPreview 渲染首行
    fireEvent.click(screen.getByText('返回工作台'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('开始分析'))
    expect(onAnalyze).toHaveBeenCalledWith('d1')
  })

  it('仅元数据（无表）时提示无数据可预览', () => {
    render(<PreviewView ds={{ id: 'd2', meta: { name: '空数据集' } }} onClose={() => {}} onAnalyze={() => {}} />)
    expect(screen.getByText(/该数据集仅存元数据/)).toBeTruthy()
  })
})

describe('Upload', () => {
  const baseProps = () => ({
    onFile: vi.fn(), onSample: vi.fn(), fileRef: { current: null }, table: null, fileName: '',
    baseTable: null, baseFileName: '', joinInfo: null, uploadTab: 'file', onTabChange: vi.fn(),
    joinDraft: null, setJoinDraft: vi.fn(), onJoin: vi.fn(), onUndoJoin: vi.fn(),
    datasets: [], selectedIds: [], onToggleSelect: vi.fn(), autoLinks: [], mergeMeta: null,
    batchBusy: null, onBatchFiles: vi.fn(), onRemoveDataset: vi.fn(), onRenameDataset: vi.fn(),
    onRunSingle: vi.fn(), onRunMerge: vi.fn(), idbRestoring: false, onPreviewDataset: vi.fn(),
    onExcludeLink: vi.fn(), onIncludeLink: vi.fn(), streamState: null, onCancelStream: vi.fn(),
  })

  it('文件 tab 默认渲染上传区 + 工作台 + 示例数据按钮', () => {
    const p = baseProps()
    render(<Upload {...p} />)
    expect(screen.getByText(/选择或拖入多个数据集/)).toBeTruthy()
    expect(screen.getByText('使用示例数据快速体验')).toBeTruthy()
    expect(screen.getByText(/尚未导入数据集/)).toBeTruthy()
  })

  it('切换 tab 触发 onTabChange（日志 / API / 数据库 / 多表关联）', () => {
    const p = baseProps()
    render(<Upload {...p} />)
    fireEvent.click(screen.getByText('日志'))
    expect(p.onTabChange).toHaveBeenCalledWith('log')
    fireEvent.click(screen.getByText('API'))
    expect(p.onTabChange).toHaveBeenCalledWith('api')
    fireEvent.click(screen.getByText('数据库'))
    expect(p.onTabChange).toHaveBeenCalledWith('db')
  })

  it('多表关联 tab：无主表时提示先上传主表', () => {
    const p = { ...baseProps(), uploadTab: 'join', table: null, baseTable: null }
    render(<Upload {...p} />)
    // 「先上传主表」既出现在说明段落也出现在按钮上，按按钮角色定位
    expect(screen.getByRole('button', { name: /先上传主表/ })).toBeTruthy()
  })

  it('多表关联 tab：有主表时进入维度表关联流程', () => {
    const p = { ...baseProps(), uploadTab: 'join', table: makeSampleTable(), fileName: '主表.csv' }
    render(<Upload {...p} />)
    expect(screen.getByText(/选择维度表/)).toBeTruthy()
    expect(screen.getByText(/主表 12 行/)).toBeTruthy()
  })
})

describe('Dashboard', () => {
  const table = makeSampleTable()
  const buildProps = (over = {}) => ({
    result: makeResult(table),
    quality: { score: 80, issues: [] },
    aiMode: 'mock',
    fileName: '结果',
    activeFilters: [],
    filterDimCandidates: ['区域'],
    topValuesForDim: (dim, n) => [...new Set(table.rows.map(r => r[dim]))].slice(0, n),
    toggleFilterValue: vi.fn(),
    clearFilters: vi.fn(),
    removeFilterDim: vi.fn(),
    onChart: vi.fn(), onQuality: vi.fn(), onReport: vi.fn(), onChat: vi.fn(),
    onSchedule: vi.fn(), onJoinOpen: vi.fn(), onUndoJoin: vi.fn(), onToolbox: vi.fn(),
    onTemplate: vi.fn(), onClean: vi.fn(), canUndoClean: true, onUndoClean: vi.fn(),
    onBackToWorkbench: vi.fn(), onUndoMerge: vi.fn(),
    ...over,
  })

  it('渲染质量分 / 洞察 / 图表画廊，交互触发回调', async () => {
    const p = buildProps()
    render(<Dashboard {...p} />)
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    expect(screen.getByText('80')).toBeTruthy() // 质量分
    expect(screen.getByText('整体销售额呈上升趋势')).toBeTruthy() // 洞察
    expect(screen.getByText('区域销售额')).toBeTruthy() // 图表标题
    expect(screen.getByText('同环比表')).toBeTruthy() // 静态表图表

    // 交互式筛选下钻（仅命中筛选项，避开洞察文案里的同名文本）
    fireEvent.click(screen.getByText('华东', { selector: '.filter-val' }))
    expect(p.toggleFilterValue).toHaveBeenCalledWith('区域', '华东')
    // 图表详情（每个图卡都有「查看详情」按钮，取第一个）
    fireEvent.click(screen.getAllByTitle('查看详情')[0])
    expect(p.onChart).toHaveBeenCalled()
    // 各动作按钮
    fireEvent.click(screen.getByText('查看', { selector: 'button' }))
    expect(p.onQuality).toHaveBeenCalled()
    fireEvent.click(screen.getByText('导出报告'))
    expect(p.onReport).toHaveBeenCalled()
    fireEvent.click(screen.getByText('追问'))
    expect(p.onChat).toHaveBeenCalled()
    fireEvent.click(screen.getByText('数据清洗'))
    expect(p.onClean).toHaveBeenCalled()
    fireEvent.click(screen.getByText('模板库'))
    expect(p.onTemplate).toHaveBeenCalled()
    fireEvent.click(screen.getByText('分析工具箱'))
    expect(p.onToolbox).toHaveBeenCalled()
    fireEvent.click(screen.getByText('多表关联'))
    expect(p.onJoinOpen).toHaveBeenCalled()
    fireEvent.click(screen.getByText('回退清洗'))
    expect(p.onUndoClean).toHaveBeenCalled()
  })

  it('存在关联/联合横幅时显示撤销入口', () => {
    const p = buildProps({ joinInfo: { subName: '维度表', mainKey: '区域', matched: 10, total: 12 }, baseTable: makeSampleTable() })
    render(<Dashboard {...p} />)
    expect(screen.getByText(/关联分析中/)).toBeTruthy()
    fireEvent.click(screen.getByText('撤销关联'))
    expect(p.onUndoJoin).toHaveBeenCalled()
  })
})

describe('ChartDetail', () => {
  const table = makeSampleTable()
  it('渲染图表详情与口径说明，返回触发 onBack', async () => {
    const onBack = vi.fn()
    const chart = { ...makeResult(table).charts[0], caliber: '聚合后求和' }
    render(<ChartDetail chart={chart} onBack={onBack} />)
    await waitFor(() => expect(instance.setOption).toHaveBeenCalled())
    expect(screen.getByText('区域销售额')).toBeTruthy()
    expect(screen.getByText('口径说明')).toBeTruthy()
    fireEvent.click(screen.getByText('返回看板'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('Report', () => {
  it('渲染 iframe 预览（srcDoc 注入 HTML）', () => {
    const { container } = render(<Report html='<p>季度报告</p>' />)
    const iframe = container.querySelector('iframe.report-frame')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('srcdoc')).toBe('<p>季度报告</p>')
  })
})
