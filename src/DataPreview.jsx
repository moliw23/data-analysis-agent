// 大数据表格虚拟滚动预览：仅渲染可视区行 + OVERSCAN 缓冲，拖拽调整列宽，表头/行号 sticky
import React, { useState, useRef, useEffect, useMemo } from 'react'

const ROW_H = 36
const OVERSCAN = 10
const ROWNUM_W = 56

// 字符估算宽度：中文/全角按 2 个单位计（13px 字号下中文约 13px，ASCII 约 6.5px，折中按 10px/单位）
function charWidth(s) {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    w += /[\u3000-\u9fff\uff00-\uffef]/.test(s[i]) ? 2 : 1
  }
  return w
}

// 初始列宽 = 列名 + 前 20 行样本的最大字符数 × 10px，clamp 80~320，末尾留 24px 内边距缓冲
function estimateWidth(columns, rows, colIdx) {
  const name = columns[colIdx].name
  let max = charWidth(name)
  const limit = Math.min(rows.length, 20)
  for (let r = 0; r < limit; r++) {
    const v = rows[r] && rows[r][name]
    if (v == null || v === '') continue
    const w = charWidth(String(v))
    if (w > max) max = w
  }
  return Math.max(80, Math.min(320, Math.ceil(max * 10) + 24))
}

function fmt(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return '' }
  }
  return String(v)
}

export default function DataPreview({ columns = [], rows = [] }) {
  // 多表联合后 mergeDatasets 会加 _source 列重复每行——按用户要求改为表头汇总展示
  const { cleanColumns, cleanRows, sources } = useMemo(() => {
    const srcIdx = columns.findIndex(c => c.name === '_source' || c.name === '来源')
    if (srcIdx < 0) return { cleanColumns: columns, cleanRows: rows, sources: null }
    const ccs = columns.filter((_, i) => i !== srcIdx)
    const srcName = columns[srcIdx].name
    const crs = rows.map(r => { const o = { ...r }; delete o[srcName]; return o })
    const counts = new Map()
    rows.forEach(r => { const s = (r && r[srcName]) || '(未命名)'; counts.set(s, (counts.get(s) || 0) + 1) })
    const list = Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
    return { cleanColumns: ccs, cleanRows: crs, sources: list }
  }, [columns, rows])
  const [colWidths, setColWidths] = useState(() => cleanColumns.map((_, i) => estimateWidth(cleanColumns, cleanRows, i)))
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(() => Math.min(rows.length, Math.ceil(480 / ROW_H) + OVERSCAN))
  const bodyRef = useRef(null)
  const headerRef = useRef(null)
  const dragRef = useRef({ colIndex: -1, startX: 0, startW: 0, latestX: 0 })
  const rafRef = useRef(null)

  // 挂载后按实际可视高度校准初始 end
  useEffect(() => {
    const body = bodyRef.current
    if (body) {
      const viewH = body.clientHeight || 480
      setEnd(Math.min(rows.length, Math.ceil(viewH / ROW_H) + OVERSCAN))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载兜底：解绑拖拽监听、取消待执行的 rAF
  useEffect(() => () => {
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeUp)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 滚动：rAF 节流计算可视区行区间，并同步表头横向滚动
  function handleScroll() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const body = bodyRef.current
      if (!body) return
      const scrollTop = body.scrollTop
      const viewH = body.clientHeight
      const s = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
      const e = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
      setStart(s)
      setEnd(e)
      if (headerRef.current) headerRef.current.scrollLeft = body.scrollLeft
    })
  }

  function startResize(e, colIndex) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { colIndex, startX: e.clientX, startW: colWidths[colIndex], latestX: e.clientX }
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onResizeMove(e) {
    dragRef.current.latestX = e.clientX // 始终记录最新坐标，仅每帧结算一次，避免拖拽跳变
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const d = dragRef.current
      if (d.colIndex < 0) return
      const delta = d.latestX - d.startX
      const w = Math.max(60, d.startW + delta) // 拖拽最小 60px
      setColWidths(prev => prev.map((cw, i) => (i === d.colIndex ? w : cw)))
    })
  }

  function onResizeUp() {
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeUp)
    dragRef.current = { colIndex: -1, startX: 0, startW: 0, latestX: 0 }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  // gridTemplateColumns 字符串精确拼接，保证表头与数据行逐列对齐
  const gridTemplate = '56px ' + colWidths.join('px ') + 'px'
  const contentWidth = 56 + colWidths.reduce((a, w) => a + w, 0)
  const visibleRows = cleanRows.slice(start, end)

  return (
    <div className="data-preview">
      {sources && (
        <div className="dp-source-bar" title="数据来源汇总">
          <span className="dp-source-bar-label">已合并 {sources.length} 个数据源：</span>
          {sources.map(s => <span key={s.name} className="dp-source-chip">{s.name} · {s.count.toLocaleString('zh-CN')} 行</span>)}
        </div>
      )}
      <div className="dp-header" ref={headerRef}>
        <div className="dp-head-inner" style={{ width: contentWidth, display: 'grid', gridTemplateColumns: gridTemplate }}>
          <div className="dp-th dp-th-rownum">#</div>
          {cleanColumns.map((c, i) => (
            <div key={c.name} className="dp-th" title={c.name}>
              <span className="dp-th-text">{c.name}</span>
              <div className="dp-resizer" onMouseDown={e => startResize(e, i)} />
            </div>
          ))}
        </div>
      </div>
      <div className="dp-body" ref={bodyRef} onScroll={handleScroll}>
        <div className="dp-body-inner" style={{ height: cleanRows.length * ROW_H, width: contentWidth }}>
          {visibleRows.map((row, i) => {
            const ri = start + i
            return (
              <div key={ri} className="dp-row" style={{ transform: `translateY(${ri * ROW_H}px)`, height: ROW_H, display: 'grid', gridTemplateColumns: gridTemplate }}>
                <div className="dp-cell dp-rownum">{ri + 1}</div>
                {cleanColumns.map(c => {
                  const v = fmt(row ? row[c.name] : '')
                  return <div key={c.name} className="dp-cell" title={v}>{v}</div>
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
