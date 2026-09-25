// @vitest-environment jsdom
// P2-3 前端适配层测试（docs/04-详细设计 §4）：client / probe / 网关回退链 / 两个全局组件

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BackendError, apiGet } from '../backend/client.js'
import { useBackendStatus, probeNow } from '../backend/probe.js'
import { planAnalysis, saveLLMConfig, clearLLMConfig } from '../llmProvider.js'
import ModeBanner from '../components/ModeBanner.jsx'
import PrivacyIndicator from '../components/PrivacyIndicator.jsx'

const CAPS = {
  privacy_mode: 'strict',
  llm: { gatewayEnabled: true },
  rag: { enabled: false },
  dataset: { server_sql_allowed: false },
}

function envelope(code, message, data) {
  return { code, message, data, request_id: 'r-test' }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useBackendStatus.setState({ status: 'offline', capabilities: null, privacyMode: null, lastProbeAt: 0, error: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearLLMConfig()
})

/* ---------------- client.js ---------------- */

describe('backend client', () => {
  it('code=0 解包返回 data', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify(envelope(0, 'ok', { hello: 1 })), { status: 200 }))
    const data = await apiGet('/api/v1/health')
    expect(data).toEqual({ hello: 1 })
  })

  it('4030 抛 BackendError 且携带闸门载荷', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify(envelope(4030, '被隐私档位阻断', { current_mode: 'strict', required_modes: ['standard', 'full'] })), { status: 403 }))
    const err = await apiGet('/api/v1/x').catch(e => e)
    expect(err).toBeInstanceOf(BackendError)
    expect(err.code).toBe(4030)
    expect(err.data.current_mode).toBe('strict')
  })

  it('网络不可达归一化为 kind=network', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await apiGet('/api/v1/health').catch(e => e)
    expect(err.kind).toBe('network')
    expect(err.code).toBe(-1)
  })
})

/* ---------------- probe.js ---------------- */

describe('backend probe', () => {
  it('health + capabilities 成功 → online 且派生档位', async () => {
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/capabilities')) {
        return Promise.resolve(new Response(JSON.stringify(envelope(0, 'ok', CAPS)), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(envelope(0, 'ok', { status: 'ok' })), { status: 200 }))
    })
    const st = await probeNow()
    expect(st).toBe('online')
    expect(useBackendStatus.getState().privacyMode).toBe('strict')
  })

  it('health 超时/失败 → offline', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const st = await probeNow()
    expect(st).toBe('offline')
    expect(useBackendStatus.getState().capabilities).toBeNull()
  })
})

/* ---------------- 网关回退链 ---------------- */

describe('llmProvider gateway routing', () => {
  const DIRECT_CHAT = {
    choices: [{ message: { content: JSON.stringify({ charts: [{ chartType: 'bar' }] }) } }],
  }

  beforeEach(() => {
    saveLLMConfig({ baseUrl: 'http://direct.local', apiKey: 'sk-x', model: 'm1' })
  })

  it('在线时走网关（POST /llm/chat，带 taskKey）', async () => {
    useBackendStatus.setState({ status: 'online', capabilities: CAPS, privacyMode: 'strict' })
    global.fetch.mockResolvedValue(new Response(
      JSON.stringify(envelope(0, 'ok', { content: JSON.stringify({ charts: [{ chartType: 'line' }] }) })),
      { status: 200 },
    ))
    const plan = await planAnalysis({ cols: 1 })
    expect(plan.charts[0].chartType).toBe('line')
    const called = global.fetch.mock.calls[0]
    expect(String(called[0])).toContain('/api/v1/llm/chat')
    expect(JSON.parse(called[1].body).taskKey).toBe('plan_analysis')
  })

  it('4010 静默落回直连', async () => {
    useBackendStatus.setState({ status: 'online', capabilities: CAPS, privacyMode: 'strict' })
    global.fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/v1/llm/chat')) {
        return Promise.resolve(new Response(JSON.stringify(envelope(4010, '未配置 Provider')), { status: 400 }))
      }
      expect(String(url)).toContain('/v1/chat/completions')
      return Promise.resolve(new Response(JSON.stringify(DIRECT_CHAT), { status: 200 }))
    })
    const plan = await planAnalysis({ cols: 1 })
    expect(plan.charts[0].chartType).toBe('bar')
  })

  it('4030 不回退、不重试，向上抛出', async () => {
    useBackendStatus.setState({ status: 'online', capabilities: CAPS, privacyMode: 'strict' })
    global.fetch.mockResolvedValue(new Response(
      JSON.stringify(envelope(4030, '被隐私档位阻断', { current_mode: 'strict' })), { status: 403 },
    ))
    await expect(planAnalysis({ cols: 1 })).rejects.toMatchObject({ code: 4030 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('离线时直接直连，不碰网关', async () => {
    useBackendStatus.setState({ status: 'offline' })
    global.fetch.mockResolvedValue(new Response(JSON.stringify(DIRECT_CHAT), { status: 200 }))
    const plan = await planAnalysis({ cols: 1 })
    expect(plan.charts[0].chartType).toBe('bar')
    expect(String(global.fetch.mock.calls[0][0])).toContain('/v1/chat/completions')
  })
})

/* ---------------- ModeBanner ---------------- */

describe('ModeBanner', () => {
  it('checking 态不渲染', () => {
    useBackendStatus.setState({ status: 'checking' })
    const { container } = render(<ModeBanner />)
    expect(container.querySelector('.mode-banner')).toBeNull()
  })

  it('offline 态展示本地模式 + 重试 + 启动指引', () => {
    useBackendStatus.setState({ status: 'offline' })
    render(<ModeBanner />)
    expect(screen.getByText(/本地模式/)).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
    expect(screen.getByText('启动指引')).toBeTruthy()
  })

  it('online 态展示连接状态与档位及降级徽标', () => {
    useBackendStatus.setState({ status: 'online', capabilities: CAPS, privacyMode: 'strict' })
    render(<ModeBanner />)
    expect(screen.getByText('本地服务已连接')).toBeTruthy()
    expect(screen.getByText(/隐私档位：严格/)).toBeTruthy()
    expect(screen.getByText('知识库·未启用')).toBeTruthy()
  })
})

/* ---------------- PrivacyIndicator ---------------- */

describe('PrivacyIndicator', () => {
  it('点击展开解释入口并跳设置（AC-29）', () => {
    useBackendStatus.setState({ status: 'online', capabilities: CAPS, privacyMode: 'strict' })
    const onOpenSettings = vi.fn()
    render(<PrivacyIndicator onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByTitle('隐私档位说明'))
    expect(screen.getByText(/当前档位/)).toBeTruthy()
    expect(screen.getByText('严格（默认）')).toBeTruthy()
    fireEvent.click(screen.getByText('去设置'))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('未连接时按钮显示未连接', () => {
    useBackendStatus.setState({ status: 'offline', privacyMode: null })
    render(<PrivacyIndicator />)
    expect(screen.getByText('未连接')).toBeTruthy()
  })
})
