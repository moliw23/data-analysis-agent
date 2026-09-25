// 分析模板库 UI（模块③）：新建/保存/加载/重命名/删除/导入/导出
// 模板 = 可复用的图表配置（spec）+ 表结构指纹；应用时按语义角色映射到当前数据集
import { useState, useRef } from 'react'
import { X, BookmarkPlus, RefreshCw, Trash2, Download, Upload, AlertTriangle, Info } from 'lucide-react'
import { inferSchema, looksLikeId } from './engine.js'
import {
  listTemplates, saveTemplate, deleteTemplate, renameTemplate,
  exportTemplateJson, importTemplateText, schemaFingerprint, matchTemplate
} from './templateStore.js'

const KIND_LABEL = {
  trend: '时间趋势', topN: 'Top N', momYoy: '同环比', corr: '相关性',
  pivot: '透视表', column: '列分析', map: '地图', forecast: '预测', anomaly: '异常检测'
}
const OP_LABEL = { sum: '合计', avg: '均值', count: '行数', max: '最大值', min: '最小值' }

export default function TemplateLibrary({ table, activeFilters, onApply, onClose }) {
  const [templates, setTemplates] = useState(listTemplates)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('trend')
  const [timeCol, setTimeCol] = useState('')
  const [measureCol, setMeasureCol] = useState('')
  const [dimCol, setDimCol] = useState('')
  const [rowDim, setRowDim] = useState('')
  const [colDim, setColDim] = useState('')
  const [colCol, setColCol] = useState('')
  const [regionCol, setRegionCol] = useState('')
  const [granularity, setGranularity] = useState('auto')
  const [op, setOp] = useState('sum')
  const [n, setN] = useState(10)
  const [horizon, setHorizon] = useState(6)
  const [method, setMethod] = useState('linear')
  const [k, setK] = useState(3)
  const [anomMethod, setAnomMethod] = useState('zscore')
  const [renaming, setRenaming] = useState(null) // { id, name }
  const [applyNote, setApplyNote] = useState('')
  const fileRef = useRef(null)
  const exportRef = useRef(null)

  // 与工具箱一致的 schema 分列（引擎真实推断）
  const { timeCols, numericCols, dimCandidates, regionCandidates, anyCols } = (() => {
    if (!table) return { timeCols: [], numericCols: [], dimCandidates: [], regionCandidates: [], anyCols: [] }
    const t = inferSchema(table)
    const rows = (table.rows || []).slice(0, 200)
    const tc = t.columns.filter(c => c.semantic === 'time').map(c => c.name)
    const nc = t.columns.filter(c => c.type === 'number' && !looksLikeId(c.name, rows.map(r => r[c.name]).filter(v => v !== '' && v != null), rows.length || 1) && c.cardinality >= 2).map(c => c.name)
    const dc = t.columns.filter(c => c.semantic === 'dimension' || (c.type !== 'number' && c.semantic !== 'time')).map(c => c.name)
    const rc = t.columns.filter(c => (c.semantic === 'dimension' || c.type !== 'number') && c.cardinality >= 2 && c.cardinality <= 40 && !looksLikeId(c.name, rows.map(r => r[c.name]).filter(v => v !== '' && v != null), rows.length || 1)).map(c => c.name)
    return { timeCols: tc, numericCols: nc, dimCandidates: dc, regionCandidates: rc, anyCols: t.columns.map(c => c.name) }
  })()

  const effMeasure = measureCol || numericCols[0] || ''
  const refresh = () => setTemplates(listTemplates())

  const buildSpec = () => {
    const base = { kind, measureCol: effMeasure, op }
    if (kind === 'trend' || kind === 'momYoy' || kind === 'forecast' || kind === 'anomaly') {
      return { ...base, timeCol: timeCol || timeCols[0] || '', granularity, ...(kind === 'forecast' ? { horizon: Number(horizon) || 6, method } : {}), ...(kind === 'anomaly' ? { k: Number(k) || 3, method: anomMethod } : {}) }
    }
    if (kind === 'topN') return { ...base, dimCol, n: Number(n) || 10 }
    if (kind === 'pivot') return { ...base, rowDim, colDim }
    if (kind === 'column') return { ...base, col: colCol }
    if (kind === 'map') return { ...base, regionCol, op }
    return { ...base }
  }

  const handleSave = () => {
    if (!table) return
    const spec = buildSpec()
    if (!name.trim()) { setApplyNote('请先输入模板名称'); return }
    if (kind === 'trend' && !spec.timeCol) { setApplyNote('当前数据集未检测到时间列，无法保存时间趋势模板'); return }
    if (kind === 'topN' && !spec.dimCol) { setApplyNote('请选择维度列'); return }
    const t = saveTemplate({
      id: 'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      v: 1, name: name.trim(), kind: 'manual', createdAt: new Date().toISOString(),
      spec, filters: (activeFilters || []).map(f => ({ dim: f.dim, values: [...f.values] })),
      schema: schemaFingerprint(table)
    })
    refresh(); setName(''); setApplyNote('已保存模板「' + t.name + '」')
  }

  const handleApply = (tpl) => {
    if (!table) return
    const { spec, mapping, unresolved } = matchTemplate(tpl, table)
    if (unresolved.length) {
      if (!window.confirm('模板部分列无法自动匹配到当前表：\n' + unresolved.join('\n') + '\n\n仍要继续（跳过这些参数）吗？')) return
    }
    const extra = Object.keys(mapping).length ? `（列映射：${Object.values(mapping).join('、')}）` : ''
    setApplyNote('已应用模板「' + tpl.name + '」' + extra)
    onApply(spec, tpl.filters || [])
  }

  const handleImport = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const t = importTemplateText(String(reader.result || ''))
        refresh(); setApplyNote('已导入模板「' + t.name + '」')
      } catch (e) { setApplyNote('导入失败：' + e.message) }
    }
    reader.onerror = () => setApplyNote('读取文件失败')
    if (file) reader.readAsText(file, 'utf-8')
  }

  return (
    <div className="toolbox-mask" onClick={onClose}>
      <div className="toolbox tpl-panel" onClick={e => e.stopPropagation()}>
        <div className="toolbox-head">
          <span className="card-title" style={{ margin: 0 }}><BookmarkPlus size={16} /> 分析模板库</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {applyNote && <div className="tpl-note"><Info size={13} /> {applyNote}</div>}

        {/* 新建模板 */}
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="card-title" style={{ fontSize: 13 }}>新建模板（把常用图表配置沉淀下来，跨数据集复用）</div>
          <div className="tpl-form">
            <div className="tpl-row">
              <label className="tpl-label">模板名称</label>
              <input className="form-input" value={name} placeholder="如：月度销售趋势" onChange={e => setName(e.target.value)} />
            </div>
            <div className="tpl-row">
              <label className="tpl-label">图表类型</label>
              <select className="form-input" value={kind} onChange={e => setKind(e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {(kind === 'trend' || kind === 'momYoy' || kind === 'forecast' || kind === 'anomaly') && (
              <div className="tpl-row">
                <label className="tpl-label">时间列</label>
                <select className="form-input" value={timeCol} onChange={e => setTimeCol(e.target.value)}>
                  <option value="">自动（{timeCols[0] ? timeCols[0] : '无时间列'}）</option>
                  {timeCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {kind !== 'column' && kind !== 'corr' && (
              <div className="tpl-row">
                <label className="tpl-label">度量列</label>
                <select className="form-input" value={effMeasure} onChange={e => setMeasureCol(e.target.value)}>
                  {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {kind === 'topN' && (
              <div className="tpl-row">
                <label className="tpl-label">维度列</label>
                <select className="form-input" value={dimCol} onChange={e => setDimCol(e.target.value)}>
                  <option value="">自动（{dimCandidates[0] || '无维度'}）</option>
                  {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {kind === 'pivot' && (
              <>
                <div className="tpl-row">
                  <label className="tpl-label">行维度</label>
                  <select className="form-input" value={rowDim} onChange={e => setRowDim(e.target.value)}>
                    <option value="">选择…</option>
                    {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="tpl-row">
                  <label className="tpl-label">列维度</label>
                  <select className="form-input" value={colDim} onChange={e => setColDim(e.target.value)}>
                    <option value="">选择…</option>
                    {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </>
            )}
            {kind === 'column' && (
              <div className="tpl-row">
                <label className="tpl-label">分析列</label>
                <select className="form-input" value={colCol} onChange={e => setColCol(e.target.value)}>
                  <option value="">选择…</option>
                  {anyCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {kind === 'map' && (
              <div className="tpl-row">
                <label className="tpl-label">地区列</label>
                <select className="form-input" value={regionCol} onChange={e => setRegionCol(e.target.value)}>
                  <option value="">选择…</option>
                  {regionCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {kind === 'forecast' && (
              <div className="tpl-row">
                <label className="tpl-label">预测期数</label>
                <input className="form-input" type="number" min={1} max={24} value={horizon} onChange={e => setHorizon(e.target.value)} />
              </div>
            )}
            {kind === 'anomaly' && (
              <div className="tpl-row">
                <label className="tpl-label">异常倍数 k</label>
                <input className="form-input" type="number" min={1} max={10} value={k} onChange={e => setK(e.target.value)} />
              </div>
            )}
            <div className="tpl-row">
              <button className="btn btn-primary" onClick={handleSave}><BookmarkPlus size={15} /> 保存模板</button>
              <button className="btn btn-ghost" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={15} /> 导入 .json</button>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => { handleImport(e.target.files && e.target.files[0]); e.target.value = '' }} />
            </div>
          </div>
        </div>

        {/* 模板列表 */}
        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>我的模板（{templates.length}）</div>
        {templates.length === 0 && <div className="muted" style={{ fontSize: 12 }}>暂无模板。先在上方保存一个图表配置，之后在结构相似的数据集上可一键复用。</div>}
        <div className="tpl-list">
          {templates.map(t => (
            <div className="tpl-item" key={t.id}>
              {renaming && renaming.id === t.id ? (
                <div className="tpl-rename">
                  <input className="form-input" autoFocus value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { renameTemplate(t.id, renaming.name.trim() || t.name); setRenaming(null); refresh() } if (e.key === 'Escape') setRenaming(null) }} />
                  <button className="btn btn-ghost" onClick={() => { renameTemplate(t.id, renaming.name.trim() || t.name); setRenaming(null); refresh() }}>确定</button>
                </div>
              ) : (
                <div className="tpl-item-main">
                  <div className="tpl-item-title">{t.name}</div>
                  <div className="tpl-item-sub">
                    {KIND_LABEL[t.spec && t.spec.kind] || t.spec && t.spec.kind} · {new Date(t.createdAt).toLocaleString('zh-CN')}
                    {t.filters && t.filters.length ? ` · 含 ${t.filters.length} 项筛选` : ''}
                    {t.schema && t.schema.columns && t.schema.columns.length ? ` · ${t.schema.columns.length} 列结构` : ''}
                  </div>
                  {t.schema && t.schema.columns && t.schema.columns.length > 0 && (
                    <div className="tpl-item-schema">{t.schema.columns.slice(0, 5).map(c => `${c.name}(${c.semantic === 'measure' ? '数值' : c.semantic === 'time' ? '时间' : '维度'})`).join('、')}{t.schema.columns.length > 5 ? ' 等' : ''}</div>
                  )}
                </div>
              )}
              <div className="tpl-item-ops">
                <button className="icon-btn" title="应用到当前数据集" onClick={() => handleApply(t)}><RefreshCw size={15} /></button>
                <button className="icon-btn" title="重命名" onClick={() => setRenaming({ id: t.id, name: t.name })}>✎</button>
                <button className="icon-btn" title="导出 .json" onClick={() => exportTemplateJson(t)}><Download size={15} /></button>
                <button className="icon-btn" title="删除" onClick={() => { if (window.confirm('删除模板「' + t.name + '」？')) { deleteTemplate(t.id); refresh() } }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
        {applyNote && <div className="tpl-note"><AlertTriangle size={13} /> 应用模板时按「语义角色」匹配列（同名优先，其次按时间/数值/维度角色），匹配失败会提示手动确认。</div>}
      </div>
    </div>
  )
}
