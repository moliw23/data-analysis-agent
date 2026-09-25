// 数据集工作台：多文件导入 → 数据集卡片 → 自动关联 → 联合分析
// 嵌入 Upload 页「文件」tab；仅持有元数据 + 内存表（刷新后原始行不落盘）
import React, { useState, useRef } from 'react'
import {
  Database, Trash2, Eye, Link2, Layers,
  ChevronDown, ChevronRight, Pencil, AlertTriangle, RotateCcw, CheckCircle2,
} from 'lucide-react'

const CONF_LABEL = { high: '高置信度', medium: '中置信度', low: '低置信度' }

export default function DatasetWorkbench({
  datasets, selectedIds, onToggleSelect, autoLinks, mergeMeta, batchBusy,
  onBatchFiles, onRemoveDataset, onRenameDataset, onRunSingle, onRunMerge,
  idbRestoring, onPreviewDataset, onExcludeLink, onIncludeLink,
}) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [mergeMode, setMergeMode] = useState('auto') // auto | join | union
  const [addSourceCol, setAddSourceCol] = useState(true)
  const [linkEdits, setLinkEdits] = useState({}) // `${fromId}->${toId}` → {fromKey,toKey} | null(解除)
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')

  function handleFiles(files) {
    const arr = Array.from(files || [])
    if (arr.length) onBatchFiles(arr)
  }

  function startRename(ds) {
    setRenamingId(ds.id)
    setRenameText(ds.meta.name)
  }

  function commitRename(id) {
    if (renamingId !== id) return
    const t = renameText.trim()
    if (t) onRenameDataset(id, t)
    setRenamingId(null)
  }

  // 应用高级面板里手动编辑/解除后的有效关联（join 模式用）
  function effectiveLinks() {
    return autoLinks
      .filter(l => linkEdits[`${l.fromId}->${l.toId}`] !== null)
      .filter(l => selectedIds.includes(l.fromId) && selectedIds.includes(l.toId))
      .map(l => {
        const edit = linkEdits[`${l.fromId}->${l.toId}`]
        if (!edit) {
          return { fromId: l.fromId, toId: l.toId, fromKey: l.fromKey, toKey: l.toKey, fromName: l.fromName, toName: l.toName, rate: l.rate, confidence: l.confidence }
        }
        return { ...l, fromKey: edit.fromKey || l.fromKey, toKey: edit.toKey || l.toKey }
      })
  }

  function handleMerge() {
    const ids = selectedIds.slice()
    if (ids.length < 2) return
    const missing = datasets.find(d => ids.includes(d.id) && !d.table)
    if (missing) {
      alert(`数据集「${missing.meta.name}」仅存元数据，请重新导入后再联合分析`)
      return
    }
    onRunMerge({ ids, mode: mergeMode, addSourceCol, links: effectiveLinks() })
  }

  const removedLinks = autoLinks.filter(l => linkEdits[`${l.fromId}->${l.toId}`] === null)

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="card-title"><Layers size={16} /> 数据集工作台</div>

      <div className={`upload-zone${dragActive ? ' drag-active' : ''}`}
        onClick={() => inputRef.current && inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer && e.dataTransfer.files) }}>
        <div className="upload-ic"><Database size={26} /></div>
        <div style={{ fontWeight: 600 }}>选择或拖入多个数据集（可一次多选）</div>
        <div className="upload-hint">CSV / Excel / JSON / 日志，逐个解析加入工作台；单文件上限 50MB / 50 万行</div>
        <input ref={inputRef} type="file" multiple accept=".csv,.xlsx,.xls,.json,.txt,.log" style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {batchBusy && <div className="batch-progress"><span className="spinner" />{batchBusy}</div>}

      {mergeMeta && mergeMeta.names && (
        <div className="join-preview" style={{ marginTop: 8 }}>
          <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> 最近一次联合分析：{mergeMeta.names.join('、')}（{mergeMeta.mode === 'union' ? '纵向堆叠' : '关联合并'}），可在分析看板中撤销
        </div>
      )}

      {datasets.length === 0 && (
        <p className="screen-desc" style={{ marginTop: 4 }}>尚未导入数据集。导入 ≥2 个数据集后会自动检测关联键，支持联合分析。</p>
      )}

      {datasets.length > 0 && (
        <div className="dataset-grid">
          {datasets.map(ds => {
            const selected = selectedIds.includes(ds.id)
            const hasTable = !!ds.table
            const isErr = !!ds.meta.error
            return (
              <div key={ds.id} className={`dataset-card${selected ? ' ds-selected' : ''}${isErr ? ' ds-err' : ''}`}>
                <div className="ds-head">
                  <input type="checkbox" className="ds-check" checked={selected} onChange={() => onToggleSelect(ds.id)} title={hasTable ? '选择参与联合分析' : '仅元数据，需重新导入'} />
                  {renamingId === ds.id ? (
                    <input className="form-input" style={{ flex: 1, minWidth: 0, minHeight: 32, padding: '4px 8px', fontSize: 13 }}
                      value={renameText} autoFocus
                      onChange={e => setRenameText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(ds.id); if (e.key === 'Escape') setRenamingId(null) }}
                      onBlur={() => commitRename(ds.id)} />
                  ) : (
                    <span className="ds-name" title={ds.meta.name}>{ds.meta.name}</span>
                  )}
                  <button className="icon-btn" style={{ width: 28, height: 28, minWidth: 28 }} title="重命名" onClick={() => startRename(ds)}><Pencil size={14} /></button>
                </div>
                <div className="ds-meta">
                  {isErr
                    ? <span className="ds-badge ds-err">解析失败：{ds.meta.error}</span>
                    : ds.restoredFromIdb
                      ? <span className="ds-badge ds-restored"><CheckCircle2 size={11} className="ds-badge-ic" /> 已从本地恢复</span>
                      : idbRestoring && !hasTable
                        ? <span className="ds-badge"><span className="mini-spinner" /> 正在恢复…</span>
                        : hasTable
                          ? <span className="ds-badge">{ds.table.rows.length.toLocaleString('zh-CN')} 行 × {ds.table.columns.length} 列</span>
                          : <span className="ds-badge ds-only-meta">仅元数据，需重新导入</span>}
                </div>
                <div className="ds-meta">{ds.meta.colNames && ds.meta.colNames.length ? `字段：${ds.meta.colNames.slice(0, 4).join('、')}${ds.meta.colNames.length > 4 ? ' 等' : ''}` : '（无字段信息）'}</div>
                <div className="ds-meta">来源：{ds.meta.source} · {new Date(ds.meta.createdAt).toLocaleString('zh-CN')}</div>
                <div className="ds-actions">
                  <button className="btn btn-ghost" disabled={!hasTable} onClick={() => onPreviewDataset(ds.id)}><Eye size={14} /> 查看</button>
                  <button className="btn btn-ghost" onClick={() => onRemoveDataset(ds.id)}><Trash2 size={14} /> 删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="link-panel" style={{ marginTop: 8 }}>
        <div className="card-title" style={{ marginBottom: 4 }}><Link2 size={16} /> 自动关联检测</div>
        {autoLinks.length === 0 && <div className="muted" style={{ fontSize: 13 }}>暂无关联。导入 ≥2 个含可关联字段的数据集后自动检测。</div>}
        {autoLinks.map(l => {
          const editKey = `${l.fromId}->${l.toId}`
          if (linkEdits[editKey] === null) return null
          const edit = linkEdits[editKey]
          const fromKey = (edit && edit.fromKey) || l.fromKey
          const toKey = (edit && edit.toKey) || l.toKey
          const fromDs = datasets.find(d => d.id === l.fromId)
          const toDs = datasets.find(d => d.id === l.toId)
          const low = l.confidence === 'low' || l.rate < 30
          return (
            <div className="link-item" key={editKey}>
              <Link2 size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>「{l.fromName}」与「{l.toName}」通过「{fromKey}」↔「{toKey}」关联</span>
              <span className={`conf-badge conf-${l.confidence}`}>{CONF_LABEL[l.confidence]}</span>
              <span className="card-sub">匹配率 {l.rate}%（{l.matched}/{l.total}）</span>
              {low && <span className="warn-text" style={{ fontSize: 12 }}>匹配率/置信度偏低，建议展开高级检查</span>}
              {advancedOpen && (
                <div className="advanced-area" style={{ width: '100%' }}>
                  {fromDs && fromDs.table && toDs && toDs.table && (
                    <div className="form-row">
                      <label className="form-label">关联键</label>
                      <select className="form-input" style={{ minHeight: 36 }} value={fromKey} onChange={e => setLinkEdits({ ...linkEdits, [editKey]: { ...(edit || {}), fromKey: e.target.value } })}>
                        {fromDs.table.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <span style={{ color: 'var(--muted)' }}>↔</span>
                      <select className="form-input" style={{ minHeight: 36 }} value={toKey} onChange={e => setLinkEdits({ ...linkEdits, [editKey]: { ...(edit || {}), toKey: e.target.value } })}>
                        {toDs.table.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                  <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 32, padding: '0 10px', fontSize: 13 }} onClick={() => { setLinkEdits({ ...linkEdits, [editKey]: null }); if (onExcludeLink) onExcludeLink(l.fromId, l.toId) }}>解除关联</button>
                </div>
              )}
            </div>
          )
        })}
        {removedLinks.length > 0 && (
          <div className="link-item">
            <AlertTriangle size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
            <span className="muted">已解除 {removedLinks.length} 条关联：{removedLinks.map(l => `「${l.fromName}」↔「${l.toName}」`).join('、')}</span>
            <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 32, padding: '0 10px', fontSize: 13 }} onClick={() => {
              const next = { ...linkEdits }
              removedLinks.forEach(l => { delete next[`${l.fromId}->${l.toId}`]; if (onIncludeLink) onIncludeLink(l.fromId, l.toId) })
              setLinkEdits(next)
            }}><RotateCcw size={14} /> 恢复</button>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 36, padding: '0 12px', fontSize: 13 }} onClick={() => setAdvancedOpen(v => !v)}>
            {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} 展开高级
          </button>
          {advancedOpen && (
            <div className="advanced-area">
              <div className="form-row form-row-stack">
                <label className="form-label">合并策略</label>
                <div className="chip-row">
                  <span className={`chip ${mergeMode === 'auto' ? 'chip-active' : ''}`} onClick={() => setMergeMode('auto')}>自动判断</span>
                  <span className={`chip ${mergeMode === 'join' ? 'chip-active' : ''}`} onClick={() => setMergeMode('join')}>关联合并（左连接）</span>
                  <span className={`chip ${mergeMode === 'union' ? 'chip-active' : ''}`} onClick={() => setMergeMode('union')}>纵向堆叠</span>
                </div>
              </div>
              {mergeMode === 'union' && (
                <div className="form-row">
                  <label className="form-label">添加来源列</label>
                  <button className="switch" data-on={addSourceCol ? '1' : '0'} onClick={() => setAddSourceCol(v => !v)} aria-label="添加来源列"><span className="switch-dot" /></button>
                  <span className="card-sub">{addSourceCol ? '合并结果含「来源」列（数据集名）' : '不添加来源列'}</span>
                </div>
              )}
              {mergeMode === 'auto' && <p className="screen-desc">自动模式：选中集两两存在高/中置信度关联（匹配率 ≥30%）时用关联合并，否则纵向堆叠。</p>}
              <p className="screen-desc">提示：上方对关联键的手动修改仅「关联合并/纵向堆叠」时生效；但「解除关联」现在对自动判断模式同样生效——解除后自动合并将跳过该关联。</p>
            </div>
          )}
        </div>
      </div>

      {selectedIds.length >= 2 && (
        <div className="merge-cta">
          <button className="btn btn-primary" onClick={handleMerge}><Layers size={18} /> 已选 {selectedIds.length} 个数据集 → 联合分析</button>
          {mergeMode !== 'auto' && <span className="card-sub">策略：{mergeMode === 'join' ? '关联合并（左连接）' : '纵向堆叠'}</span>}
        </div>
      )}
      {selectedIds.length === 1 && (
        <div className="merge-cta">
          <button className="btn btn-primary" onClick={() => onRunSingle(selectedIds[0])}><Database size={18} /> 单独分析</button>
        </div>
      )}
    </div>
  )
}
