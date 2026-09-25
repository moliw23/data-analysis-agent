// @vitest-environment jsdom
// ScheduleView（定时调度）交互测试：创建 / 试跑 / 启停 / 删除 / 历史清空 / 问题·通道切换
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScheduleView from '../ScheduleView.jsx'
import { installDomMocks } from './testUtils.jsx'
import { saveSchedule, saveHistory } from '../schedule.js'

beforeEach(() => {
  localStorage.clear()
  installDomMocks()
  vi.clearAllMocks()
})

describe('ScheduleView', () => {
  it('无数据时空态，cron 预览，创建被拦截', () => {
    const onRun = vi.fn()
    render(<ScheduleView hasData={false} onRun={onRun} />)
    expect(screen.getByText(/暂无调度/)).toBeTruthy()
    expect(screen.getByText(/暂无运行记录/)).toBeTruthy()
    expect(screen.getByText(/cron：00 09 \* \* \*/)).toBeTruthy()
    fireEvent.click(screen.getByText('创建调度'))
    expect(window.alert).toHaveBeenCalled() // 无数据 → alert 拦截
  })

  it('有数据时创建调度并进入列表', () => {
    render(<ScheduleView hasData={true} onRun={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例：每周一销售周报'), { target: { value: '销售周报' } })
    fireEvent.click(screen.getByText('创建调度'))
    expect(screen.getByText(/我的调度（1）/)).toBeTruthy()
    expect(screen.getByText(/销售周报/)).toBeTruthy()
  })

  it('切换问题 chip / 自定义问题 / 切换通道', () => {
    render(<ScheduleView hasData={true} onRun={vi.fn()} />)
    fireEvent.click(screen.getByText('整体趋势如何')) // 默认含此问题，点掉
    expect(screen.getByText(/已选 0 个问题/)).toBeTruthy()
    const qInput = screen.getByPlaceholderText('输入自定义问题，回车或点 + 加入')
    fireEvent.change(qInput, { target: { value: '自定义Q' } })
    fireEvent.keyDown(qInput, { key: 'Enter' })
    expect(screen.getByText('自定义Q')).toBeTruthy()
    expect(screen.getByText(/已选 1 个问题/)).toBeTruthy()
    fireEvent.click(screen.getByText('企业微信')) // 切换通道
    expect(screen.getByText('企业微信')).toBeTruthy()
  })

  it('已有调度：试跑 / 启用开关 / 删除', () => {
    saveSchedule({ name: '已有调度', freq: 'daily', time: '09:00', questions: ['整体趋势如何'], channels: ['email'], enabled: true })
    const onRun = vi.fn()
    render(<ScheduleView hasData={true} onRun={onRun} />)
    fireEvent.click(screen.getByTitle('立即试跑'))
    expect(onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('启用开关'))
    fireEvent.click(screen.getByTitle('删除'))
    expect(screen.queryByText('已有调度')).toBeNull()
  })

  it('运行历史：清空', () => {
    saveHistory({ id: 'h1', name: '历史1', status: 'done', time: new Date().toISOString(), caliber: '已生成', answers: [] })
    render(<ScheduleView hasData={true} onRun={vi.fn()} />)
    expect(screen.getByText(/历史1/)).toBeTruthy()
    fireEvent.click(screen.getByText('清空历史'))
    expect(screen.queryByText(/历史1/)).toBeNull()
  })
})
