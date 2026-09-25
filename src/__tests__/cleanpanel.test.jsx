// @vitest-environment jsdom
// CleanPanel（数据清洗面板）交互测试：添加步骤 / 影响预览 / 应用 / 校验 / suggestFixSteps
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CleanPanel, { suggestFixSteps } from '../CleanPanel.jsx'
import { installDomMocks, makeSampleTable } from './testUtils.jsx'

beforeEach(() => {
  installDomMocks()
  vi.clearAllMocks()
})

describe('CleanPanel', () => {
  it('空态与标题', () => {
    render(<CleanPanel table={makeSampleTable()} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('数据清洗')).toBeTruthy()
  })

  it('添加填充步骤并预览影响', () => {
    const table = makeSampleTable()
    const t2 = { columns: table.columns, rows: table.rows.map((r, i) => (i === 0 ? { ...r, 销售额: '' } : r)) }
    render(<CleanPanel table={t2} onApply={vi.fn()} onClose={vi.fn()} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: '销售额' } }) // 选择填充列
    fireEvent.click(screen.getByText('添加'))
    expect(screen.getByText('填充缺失')).toBeTruthy() // 步骤标签（精确匹配，避开下拉选项）
    expect(screen.getByText(/影响预览/)).toBeTruthy()
  })

  it('各操作类型：trim / dedupe / outliers / 固定值填充', () => {
    const table = makeSampleTable()
    render(<CleanPanel table={table} onApply={vi.fn()} onClose={vi.fn()} />)
    const addStepFor = (type, col) => {
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: type } })
      if (col) {
        const colSel = screen.getAllByRole('combobox').find(s => Array.from(s.options).some(o => o.value === col))
        if (colSel) fireEvent.change(colSel, { target: { value: col } })
      }
      if (type === 'fill') {
        const stratSel = screen.getAllByRole('combobox').find(s => Array.from(s.options).some(o => o.value === 'const'))
        fireEvent.change(stratSel, { target: { value: 'const' } })
        fireEvent.change(screen.getByPlaceholderText('固定值'), { target: { value: '0' } })
      }
      fireEvent.click(screen.getByText('添加'))
    }
    addStepFor('trim', null)
    addStepFor('dedupe', null)
    addStepFor('outliers', '销售额')
    addStepFor('fill', '销售额')
    expect(screen.getAllByText(/填充缺失|去除空白|删除重复行|处理异常值/).length).toBeGreaterThanOrEqual(4)
  })

  it('应用清洗步骤触发 onApply', () => {
    const onApply = vi.fn()
    render(<CleanPanel table={makeSampleTable()} onApply={onApply} onClose={vi.fn()} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: '销售额' } })
    fireEvent.click(screen.getByText('添加'))
    fireEvent.click(screen.getByText('应用并重新分析'))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toHaveLength(1)
  })

  it('校验：fill 缺列时拦截', () => {
    render(<CleanPanel table={makeSampleTable()} onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('添加')) // fill 无列 → alert
    expect(window.alert).toHaveBeenCalledWith('请选择要填充的列')
  })

  it('空步骤时「应用」按钮禁用（防止空提交）', () => {
    render(<CleanPanel table={makeSampleTable()} onApply={vi.fn()} onClose={vi.fn()} />)
    const btn = screen.getByText('应用并重新分析')
    expect(btn.disabled).toBe(true)
  })

  it('suggestFixSteps：按问题类型映射清洗步骤', () => {
    const table = makeSampleTable()
    expect(suggestFixSteps({ type: '缺失值', col: '销售额' }, table)[0].type).toBe('fill')
    expect(suggestFixSteps({ type: '重复行', col: '整行' }, table)[0].type).toBe('dedupe')
    expect(suggestFixSteps({ type: '异常值', col: '销售额' }, table)[0].type).toBe('outliers')
    expect(suggestFixSteps({ type: '其他' }, table)).toEqual([])
  })
})
