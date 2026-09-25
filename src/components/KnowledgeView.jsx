// 知识库视图（P2-5 端点消费方）：建库/上传/检索/出本机凭据筛选；后端离线时明示降级
import React, { useState, useEffect, useRef } from 'react'
import { Plus, Search, Upload, RefreshCw, AlertTriangle, FileText } from 'lucide-react'
import { useBackendStatus } from '../backend/probe.js'
import { apiGet, apiPost, BackendError } from '../backend/client.js'

const STATUS_LABEL = { empty: '空', building: '建索引中', ready: '就绪', failed: '失败' }
const MODE_BADGE = { strict: '严格入库', standard: '标准入库', full: '完整入库' }

export default function KnowledgeView({ onOpenSettings }) {
  const online = useBackendStatus(s => s.status) === 'online'
  const [kbs, setKbs] = useState([])
  const [current, setCurrent] = useState(null)
  const [docs, setDocs] = useState([])
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)

  const refreshKbs = () => {
    if (!online) return
    apiGet('/api/v1/knowledge-bases').then(d => {
      setKbs(d.items || [])
      if (!current && d.items && d.items.length) pick(d.items[0])
    }).catch(() => {})
  }
  useEffect(() => { refreshKbs() }, [online]) // eslint-disable-line

  const pick = (kb) => {
    setCurrent(kb)
    setResult(null)
    apiGet(`/api/v1/knowledge-bases/${kb.id}/documents`).then(d => setDocs(d.items || [])).catch(() => setDocs([]))
  }

  const createKb = async () => {
    if (!name.trim()) return
    try {
      const kb = await apiPost('/api/v1/knowledge-bases', { name: name.trim() })
      setMsg('')
      setName('')
      setKbs(l => [kb, ...l])
      pick(kb)
    } catch (e) {
      setMsg(e.code === 4030 ? '当前隐私档位不允许建库，请到设置切档' : (e.message || '建库失败'))
    }
  }

  const upload = async (file) => {
    if (!current || !file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const base = (await import('../backend/client.js')).getBackendBase()
      const resp = await fetch(`${base}/api/v1/knowledge-bases/${current.id}/documents`, { method: 'POST', body: fd })
      const body = await resp.json()
      if (body.code === 0) {
        setMsg('')
        apiGet(`/api/v1/knowledge-bases/${current.id}/documents`).then(d => setDocs(d.items || [])).catch(() => {})
      } else if (body.code === 4030) {
        setMsg('当前隐私档位不允许上传文档（分块会出本机），请到设置切档')
      } else {
        setMsg(body.message || '上传失败')
      }
    } catch { setMsg('上传失败：本地服务不可达') }
  }

  const doSearch = async () => {
    if (!current || !query.trim()) return
    try {
      setResult(await apiPost(`/api/v1/knowledge-bases/${current.id}/search`, { query: query.trim(), mode: 'hybrid', topK: 5 }))
      setMsg('')
    } catch (e) {
      setResult(null)
      setMsg(e.code === 4091 ? '索引未就绪，先上传文档或重建索引' : (e.message || '检索失败'))
    }
  }

  if (!online) {
    return (
      <div className="kv-wrap">
        <div className="kv-offline">
          <AlertTriangle size={20} />
          <div>
            <b>知识库需要本地服务支持</b>
            <p>当前为本地模式。启动本地服务后可用：文档上传、分块检索与降级徽标（cd backend 后 python run.py）。</p>
            <button className="mode-link" onClick={onOpenSettings}>去模型接入与隐私设置</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="kv-wrap">
      {msg && <div className="kv-msg" role="status">{msg}</div>}
      <div className="kv-cols">
        <aside className="kv-side">
          <div className="kv-create">
            <input className="kv-input" placeholder="新建知识库名称" value={name}
                   onChange={e => setName(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && createKb()} />
            <button className="btn" onClick={createKb}><Plus size={16} /> 建库</button>
          </div>
          <ul className="kv-list">
            {kbs.map(kb => (
              <li key={kb.id}>
                <button className={'kv-item' + (current && current.id === kb.id ? ' is-current' : '')} onClick={() => pick(kb)}>
                  <FileText size={16} />
                  <span className="kv-item-name">{kb.name}</span>
                  <span className={`kv-badge kv-badge--${kb.indexStatus}`}>{STATUS_LABEL[kb.indexStatus] || kb.indexStatus}</span>
                  <span className="kv-count">{kb.docCount} 文档 / {kb.chunkCount} 分块</span>
                </button>
              </li>
            ))}
            {kbs.length === 0 && <li className="kv-empty">还没有知识库</li>}
          </ul>
        </aside>
        <section className="kv-main">
          {current ? (
            <>
              <div className="kv-upload-row">
                <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>
                  <Upload size={16} /> 上传文档（pdf/docx/md/txt/csv）
                </button>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.md,.txt,.csv" hidden
                       onChange={e => upload(e.target.files && e.target.files[0])} />
                <p className="kv-compliance">文档分块会随提问发送给所配模型服务——上传前请确认（AC-25）。</p>
              </div>
              <table className="kv-docs">
                <thead><tr><th>文件</th><th>状态</th><th>分块</th><th>入库档位</th></tr></thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id}>
                      <td>{d.filename}</td>
                      <td>{d.status}{d.error ? ` · ${d.error}` : ''}</td>
                      <td>{d.chunkCount}</td>
                      <td><span className="mode-badge">{MODE_BADGE[d.ingestedMode] || d.ingestedMode || '-'}</span></td>
                    </tr>
                  ))}
                  {docs.length === 0 && <tr><td colSpan="4" className="kv-empty">暂无文档</td></tr>}
                </tbody>
              </table>
              <div className="kv-search-row">
                <input className="kv-input" placeholder="在知识库中检索…" value={query}
                       onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} />
                <button className="btn" onClick={doSearch}><Search size={16} /> 检索</button>
              </div>
              {result && (
                <div className="kv-result">
                  <div className="kv-result-head">
                    模式：<b>{result.mode}</b>
                    {result.mode !== 'vector' && <span className="mode-badge mode-badge--warn">关键词模式（语义不可用时自动降级）</span>}
                    <span className="kv-latency">{result.latencyMs}ms</span>
                  </div>
                  <ol className="kv-hits">
                    {result.hits.map(h => (
                      <li key={h.chunkId}>
                        <div className="kv-hit-src">{h.filename} · 分块 #{h.seq}</div>
                        <div className="kv-hit-txt">{h.content}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : <div className="kv-empty">选择或新建一个知识库开始</div>}
        </section>
      </div>
    </div>
  )
}
