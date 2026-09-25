// 双形态状态条（AC-15/16）：在线展示档位与降级徽标；离线明示本地模式与启动指引
// checking 态不渲染，避免闪条（docs/04-详细设计 §2.4）

import React, { useState } from 'react'
import { Circle, RefreshCw, Info } from 'lucide-react'
import { useBackendStatus, probeNow } from '../backend/probe.js'

const MODE_LABEL = { strict: '严格', standard: '标准', full: '完整' }

function degradedList(caps) {
  if (!caps) return []
  const items = []
  const ragOk = caps.rag && caps.rag.enabled
  if (ragOk === false) items.push('知识库·未启用')
  if (caps.dataset && caps.dataset.server_sql_allowed === false) items.push('服务端 SQL·受档位限制')
  if (caps.privacy_mode === 'strict') items.push('明细·不出本机')
  return items
}

export default function ModeBanner({ onOpenSettings }) {
  const status = useBackendStatus(s => s.status)
  const capabilities = useBackendStatus(s => s.capabilities)
  const privacyMode = useBackendStatus(s => s.privacyMode)
  const [retrying, setRetrying] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  if (status === 'checking') return null

  if (status === 'online') {
    const degraded = degradedList(capabilities)
    return (
      <div className="mode-banner" data-status="online">
        <Circle size={8} fill="var(--success)" stroke="none" aria-hidden="true" />
        <span>本地服务已连接</span>
        {privacyMode && <span className="mode-badge">隐私档位：{MODE_LABEL[privacyMode] || privacyMode}</span>}
        {degraded.map(t => <span key={t} className="mode-badge mode-badge--warn">{t}</span>)}
      </div>
    )
  }

  return (
    <div className="mode-banner" data-status="offline">
      <Circle size={8} fill="var(--n-400)" stroke="none" aria-hidden="true" />
      <span>本地模式——AI 记忆、知识库、服务端调度不可用，分析能力完整可用</span>
      <button
        className="mode-link"
        disabled={retrying}
        onClick={async () => { setRetrying(true); await probeNow(); setRetrying(false) }}
      >
        <RefreshCw size={14} className={retrying ? 'spin' : ''} /> 重试
      </button>
      <button className="mode-link" aria-expanded={showGuide} onClick={() => setShowGuide(v => !v)}>
        <Info size={14} /> 启动指引
      </button>
      {showGuide && (
        <div className="mode-guide" role="note">
          在项目目录执行：<code>cd backend &amp;&amp; python run.py</code>，启动后本条会自动切换为已连接。
        </div>
      )}
    </div>
  )
}
