// @vitest-environment jsdom
// DataPreview（虚拟滚动数据表格）交互测试：渲染 / 来源汇总 / 列宽拖拽
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import DataPreview from '../DataPreview.jsx'
import { installDomMocks, makeSampleTable } from './testUtils.jsx'

beforeEach(() => {
  installDomMocks()
  vi.clearAllMocks()
})

describe('DataPreview', () => {
  it('渲染表头与首行数据', () => {
    const table = makeSampleTable()
    const { container } = render(<DataPreview columns={table.columns} rows={table.rows} />)
    expect(screen.getByText('区域')).toBeTruthy()
    expect(screen.getByText('销售额')).toBeTruthy()
    expect(screen.getByText('2024-01-01')).toBeTruthy()
    expect(container.querySelector('.dp-th-rownum')).toBeTruthy()
  })

  it('合并来源行时显示来源汇总条', () => {
    const table = makeSampleTable()
    const withSource = {
      columns: [...table.columns, { name: '来源' }],
      rows: table.rows.map((r, i) => ({ ...r, 来源: i % 2 ? '表A' : '表B' })),
    }
    const { container } = render(<DataPreview columns={withSource.columns} rows={withSource.rows} />)
    expect(screen.getByText(/已合并 2 个数据源/)).toBeTruthy()
    expect(container.querySelector('.dp-source-chip')).toBeTruthy()
  })

  it('拖拽调整列宽：mousedown → mousemove → mouseup', () => {
    const table = makeSampleTable()
    render(<DataPreview columns={table.columns} rows={table.rows} />)
    const resizer = document.querySelector('.dp-resizer')
    fireEvent.mouseDown(resizer)
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })) })
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { clientX: 300 })) })
    expect(() => fireEvent.mouseDown(document.querySelector('.dp-resizer'))).not.toThrow()
  })
})
