// 全局命令面板（AC-17）：Cmd/Ctrl+K 唤起，按名称跳转全部主视图
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'

const COMMANDS = [
  { id: 'home', label: '概览', keywords: 'home 概览 首页' },
  { id: 'upload', label: '上传 / 接入数据', keywords: 'upload 上传 数据 导入' },
  { id: 'dashboard', label: '分析看板', keywords: 'dashboard 看板 分析' },
  { id: 'quality', label: '数据质量诊断', keywords: 'quality 质量 诊断 清洗' },
  { id: 'report', label: '分析报告', keywords: 'report 报告 导出' },
  { id: 'knowledge', label: '知识库', keywords: 'knowledge 知识库 检索 rag' },
  { id: 'schedule', label: '定时调度', keywords: 'schedule 定时 调度 cron' },
  { id: 'settings', label: '模型接入与隐私', keywords: 'settings 设置 模型 隐私 档位' },
]

export default function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS
    return COMMANDS.filter(c => (c.label + c.keywords).toLowerCase().includes(q))
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30)
    }
  }, [open])

  useEffect(() => { setActive(a => Math.min(a, Math.max(0, results.length - 1))) }, [results.length])

  if (!open) return null

  const pick = (id) => { onNavigate(id); onClose() }
  const onKey = (e) => {
    if (e.key === 'Escape') { onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { pick(results[active].id) }
  }

  return (
    <div className="cp-mask" onMouseDown={onClose} onKeyDown={onKey}>
      <div className="cp-panel" role="dialog" aria-label="命令面板" onMouseDown={e => e.stopPropagation()}>
        <div className="cp-input-row">
          <Search size={16} />
          <input
            ref={inputRef} className="cp-input" placeholder="跳转到…（输入名称过滤）"
            value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索命令"
          />
        </div>
        <ul className="cp-list">
          {results.length === 0 && <li className="cp-empty">没有匹配项</li>}
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                className={'cp-item' + (i === active ? ' is-active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c.id)}
              >
                <span className="cp-item-label">{c.label}</span>
                {i === active && <CornerDownLeft size={14} />}
              </button>
            </li>
          ))}
        </ul>
        <div className="cp-foot">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
      </div>
    </div>
  )
}
