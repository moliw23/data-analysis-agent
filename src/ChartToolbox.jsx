import { useState, useMemo, useEffect } from 'react'
import { TrendingUp, ListOrdered, Percent, Activity, X, Sparkles, Grid3x3, Columns3, Map, AlertTriangle, Wand2, Check } from 'lucide-react'
import { inferSchema, looksLikeId, recommendCharts } from './engine.js'

// ---------- 分析工具箱：智能推荐 + 手动生成图表 ----------
// 自动模式：根据数据特征规则推荐最合适的图表；其他模式同原手动生成
export default function ChartToolbox({ table, onGenerate, onClose }) {
  const [kind, setKind] = useState('auto')
  // 推荐列表（按当前数据集实时计算）
  const recs = useMemo(() => table ? recommendCharts(table) : [], [table])
  const [picked, setPicked] = useState(new Set())
  const [timeCol, setTimeCol] = useState('')
  const [measureCol, setMeasureCol] = useState('')
  const [granularity, setGranularity] = useState('auto')
  const [op, setOp] = useState('sum')
  const [dimCol, setDimCol] = useState('')
  const [rowDim, setRowDim] = useState('')
  const [colDim, setColDim] = useState('')
  const [colCol, setColCol] = useState('')
  const [n, setN] = useState(10)
  // 预测 / 异常 / 地图 专用参数
  const [regionCol, setRegionCol] = useState('')
  const [horizon, setHorizon] = useState(6)
  const [k, setK] = useState(3)
  const [method, setMethod] = useState('linear') // forecast: linear|naive
  const [anomMethod, setAnomMethod] = useState('zscore') // anomaly: zscore|mad

  // 用引擎真实 schema 推断分列，避免名称正则把 category_/day/生日之类列错杀
  const { typedCols, timeCols, numericCols, dimCandidates, regionCandidates } = useMemo(() => {
    if (!table) return { typedCols: [], timeCols: [], numericCols: [], dimCandidates: [], regionCandidates: [] }
    const t = inferSchema(table)
    const rows = (table.rows || []).slice(0, 200)
    const typed = t.columns
    const tc = typed.filter(c => c.semantic === 'time').map(c => c.name)
    // 度量列：真正数值、不是 ID、不是常量
    const nc = typed
      .filter(c => {
        if (c.type !== 'number') return false
        if (looksLikeId(c.name, rows.map(r => r[c.name]).filter(v => v !== '' && v != null), rows.length || 1)) return false
        if (!c.cardinality || c.cardinality < 2) return false
        return true
      })
      .map(c => c.name)
    // 维度候选：semantic=dimension 或语义不明但 cardinality 低
    const dc = typed
      .filter(c => c.semantic === 'dimension' || (c.type !== 'number' && c.semantic !== 'time'))
      .map(c => c.name)
    // 地区候选：低基数的分类型列（用于地图），排除 ID/高基数文本
    const rc = typed
      .filter(c => (c.semantic === 'dimension' || c.type !== 'number') && c.cardinality >= 2 && c.cardinality <= 40 && !looksLikeId(c.name, rows.map(r => r[c.name]).filter(v => v !== '' && v != null), rows.length || 1))
      .map(c => c.name)
    return { typedCols: typed, timeCols: tc, numericCols: nc, dimCandidates: dc, regionCandidates: rc }
  }, [table])

  if (!table) return null

  // 默认 measureCol：用 schema 的第一个测量列，方便"自动"模式不用手动选
  // 若用户已选的列不在新列表里，重置（避免 stale state 导致按钮无法工作）
  useEffect(() => {
    if (measureCol && !numericCols.includes(measureCol)) setMeasureCol('')
    if (dimCol && !dimCandidates.includes(dimCol)) setDimCol('')
    if (timeCol && !timeCols.includes(timeCol) && timeCol !== '') setTimeCol('')
    if (rowDim && !dimCandidates.includes(rowDim)) setRowDim('')
    if (colDim && !dimCandidates.includes(colDim)) setColDim('')
    if (colCol && !typedCols.some(c => c.name === colCol)) setColCol('')
    if (regionCol && !regionCandidates.includes(regionCol)) setRegionCol('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])
  const effectiveMeasure = measureCol || numericCols[0] || ''

  // 智能推荐模式：一键把推荐项加入画廊
  const submitAuto = (overrideSpecs) => {
    const specs = overrideSpecs || recs.map(r => r.spec)
    if (!specs.length) { alert('当前数据集暂无可推荐的图表，请先在其它 tab 手动选择'); return }
    let added = 0
    specs.forEach(s => onGenerate(s))
    added = specs.length
    onClose()
    if (typeof alert === 'function') {/* showToast 由父组件提供，这里静默 */}
  }

  const submit = () => {
    if ((kind === 'trend' || kind === 'momYoy') && !effectiveMeasure) {
      alert('当前数据集未检测到可用度量列（数值列），请使用相关性图或手动生成。')
      return
    }
    if (kind === 'pivot') {
      if (!rowDim || !colDim || !effectiveMeasure) { alert('透视表需要选择行维度、列维度和度量列'); return }
      onGenerate({ kind: 'pivot', rowDim, colDim, measureCol: effectiveMeasure, op })
      return
    }
    if (kind === 'column') {
      if (!colCol) { alert('请选择要分析的列'); return }
      onGenerate({ kind: 'column', col: colCol })
      return
    }
    if (kind === 'trend' || kind === 'momYoy') {
      onGenerate({ kind, timeCol: timeCol || timeCols[0], measureCol: effectiveMeasure, granularity, op })
      return
    }
    if (kind === 'topN') {
      const dc = dimCol || dimCandidates[0]
      if (!dc) { alert('当前数据集未检测到可用的分类维度列，请先在左侧选择。'); return }
      onGenerate({ kind, dimCol: dc, measureCol: effectiveMeasure, op, n: Number(n) || 10 })
      return
    }
    if (kind === 'forecast') {
      if (!effectiveMeasure) { alert('预测需要数值度量列'); return }
      onGenerate({ kind: 'forecast', timeCol: timeCol || timeCols[0], measureCol: effectiveMeasure, granularity, op, horizon: Number(horizon) || 6, method })
      return
    }
    if (kind === 'anomaly') {
      if (!effectiveMeasure) { alert('异常检测需要数值度量列'); return }
      onGenerate({ kind: 'anomaly', timeCol: timeCol || timeCols[0], measureCol: effectiveMeasure, granularity, op, k: Number(k) || 3, method: anomMethod })
      return
    }
    if (kind === 'map') {
      if (!regionCol) { alert('地图需要选择地区维度列'); return }
      if (!effectiveMeasure) { alert('地图需要数值度量列'); return }
      onGenerate({ kind: 'map', regionCol, measureCol: effectiveMeasure, op })
      return
    }
    onGenerate({ kind: 'corr' })
  }

  const isTimeForm = kind === 'trend' || kind === 'momYoy'

  return (
    <div className="toolbox-mask" onClick={onClose}>
      <div className="toolbox" onClick={e => e.stopPropagation()}>
        <div className="toolbox-head">
          <span className="card-title" style={{ margin: 0 }}><Sparkles size={16} /> 分析工具箱</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="toolbox-tabs">
          <button type="button" className={`toolbox-tab ${kind === 'auto' ? 'active' : ''}`} onClick={() => setKind('auto')}><Wand2 size={15} /> 图表推荐</button>
          <button type="button" className={`toolbox-tab ${kind === 'trend' ? 'active' : ''}`} onClick={() => setKind('trend')}><TrendingUp size={15} /> 时间趋势</button>
          <button type="button" className={`toolbox-tab ${kind === 'topN' ? 'active' : ''}`} onClick={() => setKind('topN')}><ListOrdered size={15} /> Top N 排行</button>
          <button type="button" className={`toolbox-tab ${kind === 'momYoy' ? 'active' : ''}`} onClick={() => setKind('momYoy')}><Percent size={15} /> 同环比</button>
          <button type="button" className={`toolbox-tab ${kind === 'corr' ? 'active' : ''}`} onClick={() => setKind('corr')}><Activity size={15} /> 相关性</button>
          <button type="button" className={`toolbox-tab ${kind === 'pivot' ? 'active' : ''}`} onClick={() => setKind('pivot')}><Grid3x3 size={15} /> 透视表</button>
          <button type="button" className={`toolbox-tab ${kind === 'column' ? 'active' : ''}`} onClick={() => setKind('column')}><Columns3 size={15} /> 列分析</button>
          <button type="button" className={`toolbox-tab ${kind === 'forecast' ? 'active' : ''}`} onClick={() => setKind('forecast')}><TrendingUp size={15} /> 预测</button>
          <button type="button" className={`toolbox-tab ${kind === 'anomaly' ? 'active' : ''}`} onClick={() => setKind('anomaly')}><AlertTriangle size={15} /> 异常检测</button>
          <button type="button" className={`toolbox-tab ${kind === 'map' ? 'active' : ''}`} onClick={() => setKind('map')}><Map size={15} /> 地图</button>
        </div>

        {kind === 'auto' && (
          <div className="toolbox-form toolbox-auto">
            <div className="toolbox-auto-head">
              <span>根据数据集特征匹配到 <b>{recs.length}</b> 张推荐图表</span>
              <button type="button" className="btn btn-primary" style={{ width: 'auto' }} disabled={!picked.size && !recs.length} onClick={() => submitAuto([...(picked.size ? recs.filter(r => picked.has(r.key)) : recs)].map(r => r.spec))}>
                <Wand2 size={14} /> {picked.size ? `加入选中的 ${picked.size} 张` : `全部加入画廊（${recs.length} 张）`}
              </button>
            </div>
            {!recs.length && <div className="toolbox-note">未识别到合适的图表模式。请检查数据集是否包含数值列/分类列/时间列，或手动选择其他 tab。</div>}
            <div className="toolbox-auto-list">
              {recs.map(r => {
                const isOn = picked.size === 0 || picked.has(r.key)
                return (
                  <div key={r.key} className={`toolbox-auto-item ${isOn ? 'on' : ''}`} onClick={() => {
                    setPicked(prev => {
                      // 三态：全选 → 反选当前项 → 反选全部
                      const next = new Set(prev.size === 0 ? recs.map(x => x.key) : prev)
                      if (next.has(r.key)) next.delete(r.key); else next.add(r.key)
                      return next
                    })
                  }}>
                    <div className="toolbox-auto-chk"><Check size={12} /></div>
                    <div className="toolbox-auto-main">
                      <div className="toolbox-auto-title">{r.title}</div>
                      <div className="toolbox-auto-reason">{r.reason}</div>
                    </div>
                    <button type="button" className="btn btn-ghost" style={{ width: 'auto', fontSize: 11, padding: '4px 8px' }} onClick={(e) => { e.stopPropagation(); onGenerate(r.spec); onClose() }}>加入</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {isTimeForm ? (
          <div className="toolbox-form">
            <label className="toolbox-label">时间列</label>
            <select value={timeCol} onChange={e => setTimeCol(e.target.value)}>
              <option value="">{timeCols[0] ? `自动（${timeCols[0]}）` : '请选择'}</option>
              {timeCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合粒度</label>
            <select value={granularity} onChange={e => setGranularity(e.target.value)}>
              <option value="auto">自动（≤31天按日 / ≤18月按月 / 其余按年）</option>
              <option value="day">按日</option>
              <option value="month">按月</option>
              <option value="year">按年</option>
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option>
              <option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            {kind === 'momYoy' && <div className="toolbox-note">同环比表仅对月度及以上粒度、且期数 ≥ 2 时有效（环比=本期/上期-1，同比=本期/去年同期-1）。</div>}
          </div>
        ) : kind === 'topN' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">维度列{dimCandidates.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用维度列）</span>}</label>
            <select value={dimCol} onChange={e => setDimCol(e.target.value)} disabled={dimCandidates.length === 0}>
              <option value="">请选择</option>
              {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option>
              <option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            <label className="toolbox-label">取前 N 名（1~50）</label>
            <input type="number" min={1} max={50} value={n} onChange={e => setN(e.target.value)} />
          </div>
        ) : kind === 'pivot' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">行维度（分组行）{dimCandidates.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用维度列）</span>}</label>
            <select value={rowDim} onChange={e => setRowDim(e.target.value)} disabled={dimCandidates.length === 0}>
              <option value="">请选择</option>
              {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">列维度（交叉列）{dimCandidates.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用维度列）</span>}</label>
            <select value={colDim} onChange={e => setColDim(e.target.value)} disabled={dimCandidates.length === 0}>
              <option value="">请选择</option>
              {dimCandidates.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列（聚合值）{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option>
              <option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            <div className="toolbox-note">透视表按行维度×列维度交叉聚合度量列；维度基数过大（&gt;60）时自动截断显示。</div>
          </div>
        ) : kind === 'column' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">选择列</label>
            <select value={colCol} onChange={e => setColCol(e.target.value)}>
              <option value="">请选择</option>
              {typedCols.map(c => <option key={c.name} value={c.name}>{c.name}（{c.type === 'number' ? '数值' : c.semantic === 'time' ? '时间' : '类别'}）</option>)}
            </select>
            <div className="toolbox-note">数值列展示统计指标 + 分布直方图；类别/时间列展示 Top 值排行与时间范围。</div>
          </div>
        ) : kind === 'forecast' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">时间列</label>
            <select value={timeCol} onChange={e => setTimeCol(e.target.value)}>
              <option value="">{timeCols[0] ? `自动（${timeCols[0]}）` : '请选择'}</option>
              {timeCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合粒度</label>
            <select value={granularity} onChange={e => setGranularity(e.target.value)}>
              <option value="auto">自动</option><option value="day">按日</option><option value="month">按月</option><option value="year">按年</option>
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option><option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            <label className="toolbox-label">预测期数（1~24）</label>
            <input type="number" min={1} max={24} value={horizon} onChange={e => setHorizon(e.target.value)} />
            <label className="toolbox-label">预测方法</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="linear">线性趋势（OLS 外推 + 区间）</option><option value="naive">朴素（末值 + 残差区间）</option>
            </select>
            <div className="toolbox-note">基于历史序列外推预测，附 95% 预测区间（真实计算，无模拟）；需 ≥3 个时间度点。</div>
          </div>
        ) : kind === 'anomaly' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">时间列</label>
            <select value={timeCol} onChange={e => setTimeCol(e.target.value)}>
              <option value="">{timeCols[0] ? `自动（${timeCols[0]}）` : '请选择'}</option>
              {timeCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合粒度</label>
            <select value={granularity} onChange={e => setGranularity(e.target.value)}>
              <option value="auto">自动</option><option value="day">按日</option><option value="month">按月</option><option value="year">按年</option>
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option><option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            <label className="toolbox-label">阈值 k（|z|&gt;k 判为异常）</label>
            <input type="number" min={1} max={5} step={0.5} value={k} onChange={e => setK(e.target.value)} />
            <label className="toolbox-label">判定方法</label>
            <select value={anomMethod} onChange={e => setAnomMethod(e.target.value)}>
              <option value="zscore">Z-score（基于标准差）</option><option value="mad">MAD（基于中位数，抗离群）</option>
            </select>
            <div className="toolbox-note">基于聚合序列检测异常点，需 ≥4 个时间度点；异常点在图上以红点标出。</div>
          </div>
        ) : kind === 'map' ? (
          <div className="toolbox-form">
            <label className="toolbox-label">地区维度列（省/市名）{regionCandidates.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无合适的地区列）</span>}</label>
            <select value={regionCol} onChange={e => setRegionCol(e.target.value)} disabled={regionCandidates.length === 0}>
              <option value="">请选择</option>
              {regionCandidates.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">度量列（着色值）{numericCols.length === 0 && <span style={{color:'var(--warn)', marginLeft:6}}>（无可用量度列）</span>}</label>
            <select value={measureCol} onChange={e => setMeasureCol(e.target.value)} disabled={numericCols.length === 0}>
              <option value="">{numericCols[0] ? `自动（${numericCols[0]}）` : '请选择'}</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="toolbox-label">聚合方式</label>
            <select value={op} onChange={e => setOp(e.target.value)}>
              <option value="sum">合计</option><option value="avg">均值</option><option value="count">行数</option><option value="max">最大值</option><option value="min">最小值</option>
            </select>
            <div className="toolbox-note">按地区聚合后渲染中国地图 choropleth；地区名需为省/市级（如「广东」「北京」），加载底图需联网。</div>
          </div>
        ) : (
          <div className="toolbox-form">
            <div className="toolbox-note">相关性基于全部数值列计算两两皮尔逊相关系数（成对删除缺失值），自动生成热力图与相关系数矩阵。建议数值列 ≥ 2 个。</div>
            <div className="toolbox-note" style={{marginTop:6}}>本次将参与计算的数值列（{numericCols.length}）：{numericCols.length ? numericCols.join('、') : '无'}</div>
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={submit}><Sparkles size={18} /> 生成图表</button>
        </div>
      </div>
    </div>
  )
}
