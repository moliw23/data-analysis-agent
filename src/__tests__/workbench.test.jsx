// @vitest-environment jsdom
// DatasetWorkbench（多数据集工作台）交互测试
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DatasetWorkbench from '../Workbench.jsx'
import { installDomMocks, makeSampleTable } from './testUtils.jsx'

const ds = (id, name, withTable = true) => ({
  id,
  meta: { name, source: 'csv', createdAt: Date.now(), colNames: withTable ? ['区域', '销售额'] : [] },
  table: withTable ? makeSampleTable() : null,
})

const baseProps = (over = {}) => ({
  datasets: [],
  selectedIds: [],
  onToggleSelect: vi.fn(),
  autoLinks: [],
  mergeMeta: null,
  batchBusy: null,
  onBatchFiles: vi.fn(),
  onRemoveDataset: vi.fn(),
  onRenameDataset: vi.fn(),
  onRunSingle: vi.fn(),
  onRunMerge: vi.fn(),
  idbRestoring: false,
  onPreviewDataset: vi.fn(),
  onExcludeLink: vi.fn(),
  onIncludeLink: vi.fn(),
  ...over,
})

beforeEach(() => {
  installDomMocks()
  vi.clearAllMocks()
  window.alert = vi.fn()
})

describe('DatasetWorkbench', () => {
  it('无数据集时显示引导文案', () => {
    render(<DatasetWorkbench {...baseProps()} />)
    expect(screen.getByText(/尚未导入数据集/)).toBeTruthy()
    expect(screen.getByText('数据集工作台')).toBeTruthy()
  })

  it('渲染数据集卡片，勾选/查看/删除触发回调', () => {
    const p = baseProps({ datasets: [ds('a', '表A'), ds('b', '表B')], selectedIds: ['a'] })
    render(<DatasetWorkbench {...p} />)
    expect(screen.getByText('表A')).toBeTruthy()
    expect(screen.getByText('表B')).toBeTruthy()
    expect(screen.getAllByText('12 行 × 4 列')).toHaveLength(2) // 每张卡片各一行统计
    // 勾选表 B（第二个 checkbox 对应表B）
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1])
    expect(p.onToggleSelect).toHaveBeenCalledWith('b')
    // 查看表 A（第一个「查看」按钮）
    fireEvent.click(screen.getAllByText('查看')[0])
    expect(p.onPreviewDataset).toHaveBeenCalledWith('a')
    // 删除表 B（第二个「删除」按钮）
    fireEvent.click(screen.getAllByText('删除')[1])
    expect(p.onRemoveDataset).toHaveBeenCalledWith('b')
  })

  it('重命名：点击铅笔 → 输入 → 回车提交', () => {
    const p = baseProps({ datasets: [ds('a', '表A')] })
    render(<DatasetWorkbench {...p} />)
    fireEvent.click(screen.getByTitle('重命名'))
    const input = screen.getByDisplayValue('表A')
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onRenameDataset).toHaveBeenCalledWith('a', '新名字')
  })

  it('展开高级面板后切换合并策略', () => {
    const p = baseProps({ datasets: [ds('a', '表A'), ds('b', '表B')], selectedIds: ['a', 'b'] })
    render(<DatasetWorkbench {...p} />)
    expect(screen.getByText(/已选 2 个数据集/)).toBeTruthy()
    fireEvent.click(screen.getByText('展开高级'))
    fireEvent.click(screen.getByText('纵向堆叠'))
    fireEvent.click(screen.getByText('关联合并（左连接）'))
    expect(screen.getByText('策略：关联合并（左连接）')).toBeTruthy()
    // 联合分析
    fireEvent.click(screen.getByText(/联合分析/))
    expect(p.onRunMerge).toHaveBeenCalledWith(expect.objectContaining({ ids: ['a', 'b'], mode: 'join' }))
  })

  it('仅选中 1 个数据集时提供「单独分析」', () => {
    const p = baseProps({ datasets: [ds('a', '表A')], selectedIds: ['a'] })
    render(<DatasetWorkbench {...p} />)
    fireEvent.click(screen.getByText('单独分析'))
    expect(p.onRunSingle).toHaveBeenCalledWith('a')
  })

  it('选中的数据集仅含元数据（无表）→ 联合分析弹 alert 拦截', () => {
    const p = baseProps({ datasets: [ds('a', '表A', false), ds('b', '表B', false)], selectedIds: ['a', 'b'] })
    render(<DatasetWorkbench {...p} />)
    fireEvent.click(screen.getByText(/联合分析/))
    expect(window.alert).toHaveBeenCalled()
    expect(p.onRunMerge).not.toHaveBeenCalled()
  })

  it('自动关联检测：解除关联触发 onExcludeLink', () => {
    const link = { fromId: 'a', toId: 'b', fromName: '表A', toName: '表B', fromKey: '区域', toKey: '区域', rate: 80, confidence: 'high', matched: 10, total: 12 }
    const p = baseProps({ datasets: [ds('a', '表A'), ds('b', '表B')], selectedIds: ['a', 'b'], autoLinks: [link] })
    render(<DatasetWorkbench {...p} />)
    expect(screen.getByText(/通过「区域」↔「区域」关联/)).toBeTruthy()
    fireEvent.click(screen.getByText('展开高级'))
    fireEvent.click(screen.getByText('解除关联'))
    expect(p.onExcludeLink).toHaveBeenCalledWith('a', 'b')
  })
})
