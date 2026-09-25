import { useState, useMemo } from 'react'
import { Eraser, ArrowLeft, Wand2, Check, RotateCcw, X } from 'lucide-react'
import { cleanFillMissing, cleanTrim, cleanDedupe, cleanOutliers, qualityCheck } from './engine.js'

const STEP_LABEL = { fill: '填充缺失', trim: '去除空白', dedupe: '去重', outliers: '异常值' }

// ---------- 数据清洗面板：①配置操作(可组合) → ②预览影响(抽样diff) → ③应用 → ④回退 ----------
// 预览只对抽样执行（不卡大表）；应用时全量执行并交由 App 重跑 qualityCheck+analyze
export default function CleanPanel({ table, onApply, onClose }) {
  const [steps, setSteps] = useState([]) // [{ type:'fill'|'trim'|'dedupe'|'outliers', col, strategy, method, action, constValue }]
  const [draft, setDraft] = useState({ type: 'fill', col: '', strategy: 'mean', method: 'IQR', action: 'dropRow', constValue: '' })
  const [applied, setApplied] = useState(false)

  const cols = useMemo(() => (table ? table.columns || [] : []), [table])
  const colNames = useMemo(() => cols.map(c => c.name), [cols])
  const rows = useMemo(() => (table ? table.rows : []), [table])

  // 预览：对前 20 行抽样执行操作序列，返回 before/after 与影响统计（只跑抽样，不卡大表）
  const preview = useMemo(() => {
    if (!steps.length || !table) return null
    const sample = rows.slice(0, 20).map(r => ({ ...r }))
    const before = sample.map(r => ({ ...r }))
    const after = applySteps(sample, steps)
    const affected = {}
    steps.forEach(s => {
      const key = s.type === 'dedupe' ? '去重' : s.col || '全部'
      affected[key] = (affected[key] || 0)
    })
    // 统计受影响单元格/行（抽样内）
    let changedCells = 0
    before.forEach((r, i) => {
      const a = after[i]
      if (!a) return
      colNames.forEach(c => { if (String(r[c] ?? '') !== String(a[c] ?? '')) changedCells++ })
    })
    return { before, after, changedCells, sampleSize: sample.length, afterSize: after.length }
  }, [steps, table, rows, colNames])

  function addStep() {
    if (!draft.type) return
    const step = { ...draft }
    if (step.type === 'fill' && !step.col) { alert('请选择要填充的列'); return }
    if (step.type === 'outliers' && !step.col) { alert('请选择异常值列'); return }
    setSteps(s => [...s, step])
    setDraft(d => ({ ...d, col: '' }))
  }
  function removeStep(i) { setSteps(s => s.filter((_, j) => j !== i)) }

  function submit() {
    if (!steps.length) { alert('请先添加至少一个清洗操作'); return }
    onApply(steps) // 由 App 对全量 rows 执行并重跑质量分/分析
  }

  return (
    <div className="toolbox-mask" onClick={onClose}>
      <div className="toolbox toolbox-wide" onClick={e => e.stopPropagation()}>
        <div className="toolbox-head">
          <span className="card-title" style={{ margin: 0 }}><Eraser size={16} /> 数据清洗</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="card-sub" style={{ margin: '4px 0 10px' }}>
          操作仅在当前会话的新表上生效，不改源文件与本地存储；应用后可从历史回退。
        </div>

        {/* ① 操作配置 */}
        <div className="clean-config">
          <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
            <option value="fill">填充缺失值</option>
            <option value="trim">去除首尾空白</option>
            <option value="dedupe">删除重复行</option>
            <option value="outliers">处理异常值</option>
          </select>
          {draft.type !== 'dedupe' && (
            <select value={draft.col} onChange={e => setDraft(d => ({ ...d, col: e.target.value }))}>
              <option value="">选择列</option>
              {colNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {draft.type === 'fill' && (
            <select value={draft.strategy} onChange={e => setDraft(d => ({ ...d, strategy: e.target.value }))}>
              <option value="mean">均值填充</option><option value="median">中位数填充</option>
              <option value="mode">众数填充</option><option value="const">固定值填充</option>
            </select>
          )}
          {draft.type === 'fill' && draft.strategy === 'const' && (
            <input placeholder="固定值" value={draft.constValue} onChange={e => setDraft(d => ({ ...d, constValue: e.target.value }))} />
          )}
          {draft.type === 'outliers' && (
            <>
              <select value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))}>
                <option value="IQR">IQR（四分位距）</option><option value="3sigma">3σ 标准差</option>
              </select>
              <select value={draft.action} onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}>
                <option value="dropRow">删除行</option><option value="mask">置空（mask）</option>
              </select>
            </>
          )}
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} onClick={addStep}><Wand2 size={16} /> 添加</button>
        </div>

        {/* 操作序列 */}
        {steps.length > 0 && (
          <div className="clean-steps">
            {steps.map((s, i) => (
              <div className="clean-step" key={i}>
                <span>{STEP_LABEL[s.type]}</span>
                {s.type !== 'dedupe' && <span> · {s.col}</span>}
                {s.type === 'fill' && <span> · {s.strategy === 'const' ? `固定值 ${s.constValue}` : ({ mean: '均值', median: '中位数', mode: '众数' }[s.strategy] || s.strategy)}</span>}
                {s.type === 'outliers' && <span> · {s.method === 'IQR' ? 'IQR' : '3σ'} / {s.action === 'dropRow' ? '删行' : '置空'}</span>}
                <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => removeStep(i)}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {/* ② 预览影响 */}
        {preview && (
          <div className="clean-preview">
            <div className="card-title" style={{ margin: '8px 0 6px' }}><Check size={15} /> 影响预览（抽样前 20 行）</div>
            <div className="clean-preview-stats">
              抽样 {preview.sampleSize} 行 → 处理后 {preview.afterSize} 行；抽样内 {preview.changedCells} 个单元格发生变化。
              {preview.afterSize < preview.sampleSize && ` 将删除 ${preview.sampleSize - preview.afterSize} 行。`}
            </div>
            <div className="clean-diff">
              <div className="clean-diff-col">
                <div className="clean-diff-head">清洗前</div>
                {preview.before.slice(0, 5).map((r, i) => (
                  <div className="clean-diff-row" key={i}>{colNames.slice(0, 5).map(c => <span key={c} title={String(r[c] ?? '')}>{String(r[c] ?? '') || '·'}</span>)}</div>
                ))}
              </div>
              <div className="clean-diff-col">
                <div className="clean-diff-head">清洗后</div>
                {preview.after.slice(0, 5).map((r, i) => (
                  <div className="clean-diff-row" key={i}>{colNames.slice(0, 5).map(c => <span key={c} title={String(r[c] ?? '')}>{String(r[c] ?? '') || '·'}</span>)}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onClose}><ArrowLeft size={18} /> 取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={!steps.length || applied}><RotateCcw size={18} /> {applied ? '已应用' : '应用并重新分析'}</button>
        </div>
      </div>
    </div>
  )
}

// 按操作序列对 rows 执行清洗（供预览/应用复用），返回新 rows
export function applySteps(rows, steps) {
  let out = rows
  for (const s of steps) {
    if (s.type === 'fill') {
      const r = cleanFillMissing(out, [s.col], { strategy: s.strategy, constValue: s.constValue })
      out = r.rows
    } else if (s.type === 'trim') {
      out = cleanTrim(out, s.col ? [s.col] : null).rows
    } else if (s.type === 'dedupe') {
      out = cleanDedupe(out, s.col ? [s.col] : null).rows
    } else if (s.type === 'outliers') {
      out = cleanOutliers(out, s.col, { method: s.method, action: s.action }).rows
    }
  }
  return out
}

// 「一键修复」：从质量诊断问题映射为清洗步骤（智能入口）
export function suggestFixSteps(issue, table) {
  if (!issue) return []
  const isNumeric = (() => {
    if (!table || !issue.col || issue.col === '整行') return false
    const samples = table.rows.slice(0, 30).map(r => r[issue.col]).filter(v => v !== '' && v != null)
    return samples.length > 0 && samples.every(v => !isNaN(Number(v)))
  })()
  if (issue.type === '缺失值' && issue.col && issue.col !== '整行') {
    return [{ type: 'fill', col: issue.col, strategy: isNumeric ? 'mean' : 'mode', method: 'IQR', action: 'dropRow', constValue: '' }]
  }
  if (issue.type === '重复行') return [{ type: 'dedupe', col: '', strategy: 'mean', method: 'IQR', action: 'dropRow', constValue: '' }]
  if (issue.type === '异常值' && issue.col) return [{ type: 'outliers', col: issue.col, strategy: 'mean', method: 'IQR', action: 'mask', constValue: '' }]
  return []
}
