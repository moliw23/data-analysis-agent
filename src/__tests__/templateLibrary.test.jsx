// @vitest-environment jsdom
// TemplateLibrary（分析模板库）交互测试：保存 / 应用 / 重命名 / 删除 / 导出 + 各图表类型 buildSpec 分支
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TemplateLibrary from '../TemplateLibrary.jsx'
import { installDomMocks, makeSampleTable } from './testUtils.jsx'
import { saveTemplate, listTemplates } from '../templateStore.js'

beforeEach(() => {
  localStorage.clear()
  installDomMocks()
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock')
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
  vi.clearAllMocks()
})

// 第一个 combobox 始终是「图表类型」下拉
const setKind = (kind) => {
  const sel = screen.getAllByRole('combobox')[0]
  fireEvent.change(sel, { target: { value: kind } })
}
// 找到包含某 option 值的下拉并设定（用于按列名选维度/度量/地区列）
const setSelectByOption = (optionValue) => {
  const sel = screen.getAllByRole('combobox').find(s =>
    Array.from(s.options).some(o => o.value === optionValue))
  if (sel) fireEvent.change(sel, { target: { value: optionValue } })
}
const nameInput = () => screen.getByPlaceholderText('如：月度销售趋势')

describe('TemplateLibrary', () => {
  it('无表时仅渲染空态与表单，保存被拦截', () => {
    render(<TemplateLibrary table={null} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('分析模板库')).toBeTruthy()
    expect(screen.getByText(/暂无模板/)).toBeTruthy()
    fireEvent.click(screen.getByText('保存模板'))
    expect(listTemplates()).toHaveLength(0)
  })

  it('有表时按 schema 推断列，并支持保存趋势模板', () => {
    render(<TemplateLibrary table={makeSampleTable()} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    // 时间列自动识别为「日期」
    expect(screen.getByText(/自动（日期）/)).toBeTruthy()
    fireEvent.change(nameInput(), { target: { value: '月度趋势' } })
    fireEvent.click(screen.getByText('保存模板'))
    expect(listTemplates().some(t => t.name === '月度趋势')).toBe(true)
    expect(screen.getByText(/已保存模板/)).toBeTruthy()
  })

  it('保存校验：缺维度列时拦截 topN', () => {
    render(<TemplateLibrary table={makeSampleTable()} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    setKind('topN')
    fireEvent.change(nameInput(), { target: { value: 'TopN' } })
    fireEvent.click(screen.getByText('保存模板'))
    expect(screen.getByText(/请选择维度列/)).toBeTruthy()
    expect(listTemplates()).toHaveLength(0)
  })

  it('覆盖各图表类型的保存（buildSpec 分支）', () => {
    render(<TemplateLibrary table={makeSampleTable()} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    const kinds = ['topN', 'map', 'column', 'forecast', 'anomaly', 'pivot']
    for (const k of kinds) {
      setKind(k)
      fireEvent.change(nameInput(), { target: { value: 'T_' + k } })
      if (k === 'topN' || k === 'map') setSelectByOption('区域')
      if (k === 'column') setSelectByOption('销售额')
      fireEvent.click(screen.getByText('保存模板'))
    }
    const names = listTemplates().map(t => t.name)
    kinds.forEach(k => expect(names).toContain('T_' + k))
  })

  it('应用模板触发 onApply（含语义列映射）', () => {
    const table = makeSampleTable()
    saveTemplate({
      id: 'tpl_seed', v: 1, name: '已存趋势', kind: 'manual', createdAt: new Date().toISOString(),
      spec: { kind: 'trend', measureCol: '销售额', op: 'sum', timeCol: '日期', granularity: 'auto' },
      filters: [{ dim: '区域', values: ['华东'] }],
      schema: { columns: [{ name: '日期', type: 'time', semantic: 'time' }, { name: '销售额', type: 'number', semantic: 'measure' }] },
    })
    const onApply = vi.fn()
    render(<TemplateLibrary table={table} activeFilters={[]} onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTitle('应用到当前数据集'))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][1]).toEqual([{ dim: '区域', values: ['华东'] }])
  })

  it('应用含无法匹配列的模板时弹确认，取消则不应用', () => {
    // 用一张「无度量列」的表：模板引用 measureCol=销售额 → 无法映射到任何列 → 进入确认分支
    const noMeasureTable = { columns: [{ name: '分类' }], rows: [{ 分类: 'A' }, { 分类: 'B' }] }
    saveTemplate({
      id: 'tpl_bad', v: 1, name: '坏模板', kind: 'manual', createdAt: new Date().toISOString(),
      spec: { kind: 'trend', measureCol: '销售额', timeCol: '日期' },
      filters: [], schema: { columns: [] },
    })
    const onApply = vi.fn()
    window.confirm = vi.fn(() => false) // 取消确认
    render(<TemplateLibrary table={noMeasureTable} activeFilters={[]} onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTitle('应用到当前数据集'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('重命名 / 删除 模板', () => {
    const table = makeSampleTable()
    saveTemplate({ id: 'tpl_r', v: 1, name: '旧名', kind: 'manual', createdAt: new Date().toISOString(), spec: { kind: 'trend', measureCol: '销售额', timeCol: '日期' }, filters: [], schema: { columns: [] } })
    render(<TemplateLibrary table={table} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTitle('重命名'))
    const renameInput = screen.getByDisplayValue('旧名')
    fireEvent.change(renameInput, { target: { value: '新名' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })
    expect(listTemplates().some(t => t.name === '新名')).toBe(true)
    window.confirm = vi.fn(() => true)
    fireEvent.click(screen.getByTitle('删除'))
    expect(listTemplates().some(t => t.name === '新名')).toBe(false)
  })

  it('导出模板触发下载（不抛错）', () => {
    const table = makeSampleTable()
    saveTemplate({ id: 'tpl_e', v: 1, name: '导出测试', kind: 'manual', createdAt: new Date().toISOString(), spec: { kind: 'trend', measureCol: '销售额', timeCol: '日期' }, filters: [], schema: { columns: [] } })
    render(<TemplateLibrary table={table} activeFilters={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(() => fireEvent.click(screen.getByTitle('导出 .json'))).not.toThrow()
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
