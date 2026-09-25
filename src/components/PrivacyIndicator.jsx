// 隐私档位指示器（AC-29/31）：顶栏常驻的"解释入口"，不是标签
// AC-31：三档禁止价值编码——统一中性配色，仅当前档用 accent 描边

import React, { useState, useRef, useEffect } from 'react'
import { ShieldCheck, ChevronRight } from 'lucide-react'
import { useBackendStatus } from '../backend/probe.js'

const MODES = [
  { id: 'strict', label: '严格（默认）', desc: '明细与文档分块不出本机；知识库与服务端 SQL 关闭。' },
  { id: 'standard', label: '标准', desc: '允许文档分块出本机做检索；数据集明细仍不出本机。' },
  { id: 'full', label: '完整', desc: '允许数据集上传服务端执行只读 SQL。' },
]

export default function PrivacyIndicator({ onOpenSettings }) {
  const privacyMode = useBackendStatus(s => s.privacyMode)
  const status = useBackendStatus(s => s.status)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  const current = MODES.find(m => m.id === privacyMode)

  return (
    <div className="privacy-wrap" ref={ref}>
      <button
        className="privacy-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="隐私档位说明"
        onClick={() => setOpen(v => !v)}
      >
        <ShieldCheck size={16} />
        <span>{privacyMode ? privacyMode : '未连接'}</span>
      </button>
      {open && (
        <div className="privacy-pop" role="dialog" aria-label="隐私档位说明">
          <div className="privacy-pop__title">
            当前档位：{current ? current.label : (status === 'online' ? '未知' : '本地模式')}
          </div>
          {current && <p className="privacy-pop__desc">{current.desc}</p>}
          <ul className="privacy-pop__list">
            {MODES.map(m => (
              <li key={m.id} className={m.id === privacyMode ? 'is-current' : ''}>
                <span className="privacy-pop__mode">{m.label}</span>
                <span className="privacy-pop__mode-desc">{m.desc}</span>
              </li>
            ))}
          </ul>
          {status === 'offline' && (
            <p className="privacy-pop__desc">后端未连接时全部数据仅在本机处理。</p>
          )}
          <button className="privacy-pop__go" onClick={() => { setOpen(false); onOpenSettings && onOpenSettings() }}>
            去设置 <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
