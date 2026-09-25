// @vitest-environment jsdom
// 组件冒烟测试：核心视图渲染 + 关键回调（P1-3 补齐 UI 层测试空白）
// 覆盖 Home / Quality / SettingsPanel / ChatPanel / ChartToolbox 五个高频视图
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Home, Quality, SettingsPanel, ChatPanel } from '../components/Views.jsx'
import ChartToolbox from '../ChartToolbox.jsx'
import { parseCSVText } from '../engine.js'

// 与 store.test.js 同款 12 行样本（保证 inferSchema 语义判定稳定）
const regions = ['华东', '华南', '华北', '西南']
const T = parseCSVText('日期,区域,销售额,订单数\n' + Array.from({ length: 12 }, (_, i) =>
  `2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${regions[i % 4]},${100 + i * 37},${i + 1}`).join('\n'))

describe('Home 视图', () => {
  it('渲染标题与入口按钮，点击触发回调', () => {
    const onUpload = vi.fn(), onSample = vi.fn(), onSchedule = vi.fn(), onSettings = vi.fn()
    render(<Home onUpload={onUpload} onSample={onSample} onSchedule={onSchedule} onSettings={onSettings} llmOn={false} />)
    expect(screen.getByText('数据分析工作台')).toBeTruthy()
    expect(screen.getByText(/上传多源数据/)).toBeTruthy() // 能力清单渲染
    fireEvent.click(screen.getByRole('button', { name: '上传 / 接入数据' }))
    expect(onUpload).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '示例数据' }))
    expect(onSample).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '定时调度' }))
    expect(onSchedule).toHaveBeenCalledTimes(1)
  })
})

describe('Quality 视图', () => {
  it('渲染评分与问题清单，一键修复回调清洗步骤', () => {
    const quality = {
      score: 82,
      issues: [
        { col: '整行', type: '重复行', severity: 'warn', detail: '存在重复行', suggestion: '删除重复记录' },
        { col: '', type: '', severity: 'info', detail: '仅供参考', suggestion: '' },
      ],
    }
    const onFix = vi.fn()
    render(<Quality quality={quality} table={T} onFix={onFix} />)
    expect(screen.getByText('82')).toBeTruthy()
    expect(screen.getAllByText(/重复行/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 项问题 · 1 项提示/)).toBeTruthy()
    fireEvent.click(screen.getByText('一键修复'))
    expect(onFix).toHaveBeenCalledWith([{ type: 'dedupe', col: '', strategy: 'mean', method: 'IQR', action: 'dropRow', constValue: '' }])
  })

  it('无问题时展示良好提示', () => {
    render(<Quality quality={{ score: 98, issues: [] }} table={T} onFix={() => {}} />)
    expect(screen.getByText('未检出明显问题，数据质量良好。')).toBeTruthy()
  })
})

describe('SettingsPanel 视图', () => {
  it('渲染主题分段控件，点击回调 setTheme', () => {
    const setTheme = vi.fn()
    render(<SettingsPanel theme="light" setTheme={setTheme} onSaved={() => {}} />)
    expect(screen.getByRole('radio', { name: '浅色' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '暗色' }))
    expect(setTheme).toHaveBeenCalledWith('dark')
  })
})

describe('ChatPanel 视图', () => {
  it('渲染消息与生成 SQL，建议问题与回车发送回调 onSend', () => {
    const onSend = vi.fn(), onClose = vi.fn()
    const messages = [
      { role: 'user', text: '每个区域的销售额合计' },
      { role: 'bot', text: '查询完成（结果 4 行）', sql: 'SELECT 区域 AS 区域, SUM(销售额) AS 销售额 FROM t GROUP BY 区域', table: { head: ['区域', '销售额'], rows: [['华东', '1110']] } },
    ]
    render(<ChatPanel messages={messages} onClose={onClose} onSend={onSend} suggestions={['销售额最高的是哪个区域？']} />)
    expect(screen.getByText('每个区域的销售额合计')).toBeTruthy()
    expect(screen.getByText(/SELECT 区域/)).toBeTruthy() // SQL 代码块
    expect(screen.getByText('华东')).toBeTruthy() // 结果表格
    fireEvent.click(screen.getByText('销售额最高的是哪个区域？')) // 建议问题 chip
    expect(onSend).toHaveBeenCalledWith('销售额最高的是哪个区域？')
    const input = screen.getByPlaceholderText(/销售额最高的是哪个区域/)
    fireEvent.change(input, { target: { value: '帮我看看趋势' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('帮我看看趋势')
  })

  it('空消息列表展示引导文案', () => {
    render(<ChatPanel messages={[]} onClose={() => {}} onSend={() => {}} suggestions={[]} />)
    expect(screen.getByText(/试试下面的问题/)).toBeTruthy()
  })
})

describe('ChartToolbox 工具箱', () => {
  it('渲染模式 tab，切换 Top N 不崩溃', () => {
    const onGenerate = vi.fn(), onClose = vi.fn()
    render(<ChartToolbox table={T} onGenerate={onGenerate} onClose={onClose} />)
    expect(screen.getByText('图表推荐')).toBeTruthy()
    fireEvent.click(screen.getByText('Top N 排行'))
    expect(screen.getByText('Top N 排行')).toBeTruthy() // 切换后仍在（激活态）
  })
})
