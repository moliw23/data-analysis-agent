// 记忆面板（AC-21）：查看/编辑/删除/总开关；后端在线时可用，离线明示
import React, { useState, useEffect } from 'react'
import { Pencil, Trash2, RefreshCw } from 'lucide-react'
import { useBackendStatus } from '../backend/probe.js'
import { apiGet, apiPost, apiPut, BackendError } from '../backend/client.js'

const KIND_LABEL = { fact: '事实', preference: '偏好', insight: '洞察' }

export default function MemoryPanel() {
  const online = useBackendStatus(s => s.status) === 'online'
  const [items, setItems] = useState([])
  const [enabled, setEnabled] = useState(true)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = () => {
    if (!online) return
    apiGet('/api/v1/memories', { timeoutMs: 5000 }).then(d => setItems(d.items || [])).catch(() => setItems([]))
  }
  useEffect(() => { refresh() }, [online]) // eslint-disable-line

  if (!online) {
    return (
      <div className="mp-wrap">
        <p className="kv-empty">记忆持久化需要本地服务支持——本地模式下对话记忆仅保存在浏览器。</p>
      </div>
    )
  }

  const toggle = async (on) => {
    try {
      await apiPut('/api/v1/settings/memory-switch', { enabled: on }, { confirm: true })
      setEnabled(on)
      setMsg('')
    } catch (e) {
      setMsg('开关接口尚未提供，记忆默认注入（' + (e.code === 4040 ? '4040' : e.message) + '）')
    }
  }

  const save = async (id) => {
    try {
      await apiPut(`/api/v1/memories/${id}`, { content: draft }).catch(() => null)
      setEditing(null)
      refresh()
    } catch (e) { setMsg(e.message || '保存失败') }
  }

  const del = async (id) => {
    if (!window.confirm('确认删除这条记忆？（不可恢复）')) return
    try {
      const base = (await import('../backend/client.js')).getBackendBase()
      await fetch(`${base}/api/v1/memories/${id}`, { method: 'DELETE' })
      refresh()
    } catch (e) { setMsg('删除失败') }
  }

  return (
    <div className="mp-wrap">
      <div className="mp-head">
        <label className="mp-switch">
          <input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)} />
          <span>记忆总开关（关闭后对话不再注入任何记忆）</span>
        </label>
        <button className="mode-link" onClick={refresh}><RefreshCw size={14} /> 刷新</button>
      </div>
      {msg && <div className="kv-msg" role="status">{msg}</div>}
      <ul className="mp-list">
        {items.map(m => (
          <li key={m.id} className={'mp-item' + (enabled ? '' : ' is-disabled')}>
            {editing === m.id ? (
              <span className="mp-edit">
                <input className="kv-input" value={draft} onChange={e => setDraft(e.target.value)} />
                <button className="btn" onClick={() => save(m.id)}>保存</button>
                <button className="mode-link" onClick={() => setEditing(null)}>取消</button>
              </span>
            ) : (
              <>
                <span className="mode-badge">{KIND_LABEL[m.kind] || m.kind}</span>
                <span className="mp-content">{m.content}</span>
                <span className="mp-weight" title="注入权重">w{m.weight}</span>
                <span className="mp-actions">
                  <button className="icon-btn" title="编辑记忆" onClick={() => { setEditing(m.id); setDraft(m.content) }}><Pencil size={16} /></button>
                  <button className="icon-btn" title="删除记忆" onClick={() => del(m.id)}><Trash2 size={16} /></button>
                </span>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="kv-empty">暂无长期记忆</li>}
      </ul>
    </div>
  )
}
