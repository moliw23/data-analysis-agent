// @vitest-environment jsdom
// Wave 3：命令面板(AC-17) + KnowledgeView 离线降级 + MemoryPanel 开关
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CommandPalette from '../components/CommandPalette.jsx'
import KnowledgeView from '../components/KnowledgeView.jsx'
import MemoryPanel from '../components/MemoryPanel.jsx'
import { useBackendStatus } from '../backend/probe.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useBackendStatus.setState({ status: 'offline', capabilities: null, privacyMode: null })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CommandPalette (AC-17)', () => {
  it('open=false 不渲染', () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} onNavigate={() => {}} />)
    expect(container.querySelector('.cp-panel')).toBeNull()
  })
  it('渲染全部主视图并可键盘选择回车跳转', () => {
    const onNavigate = vi.fn(); const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} />)
    expect(screen.getByText('分析看板')).toBeTruthy()
    expect(screen.getByText('知识库')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('搜索命令'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('home')
    expect(onClose).toHaveBeenCalled()
  })
  it('输入过滤后回车跳转对应视图', () => {
    const onNavigate = vi.fn()
    render(<CommandPalette open onClose={() => {}} onNavigate={onNavigate} />)
    const input = screen.getByLabelText('搜索命令')
    fireEvent.change(input, { target: { value: '知识' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('knowledge')
  })
})

describe('KnowledgeView 双形态', () => {
  it('离线态明示需要本地服务（AC-15 知识库分支）', () => {
    render(<KnowledgeView />)
    expect(screen.getByText('知识库需要本地服务支持')).toBeTruthy()
  })
})

describe('MemoryPanel', () => {
  it('离线态说明记忆仅保存在浏览器', () => {
    render(<MemoryPanel />)
    expect(screen.getByText(/记忆持久化需要本地服务支持/)).toBeTruthy()
  })
})
