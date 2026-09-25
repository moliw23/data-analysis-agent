import React, { useState, useRef, useEffect } from 'react'
import {
  AlertTriangle, ArrowLeft, BarChart2, BookmarkPlus, CheckCircle2, Clock, Database, Download,
  Eraser, FileCode2, FileSpreadsheet, FileText, Filter, GitCompare, HelpCircle, Layers, Link2,
  ListChecks, Maximize2, MessageCircle, RotateCcw, Settings, Share2, Sheet, Sparkles, Trash2,
  UploadIcon, Wand2, X, Zap, ZapOff
} from 'lucide-react'
import { parseFile, previewJoin, guessJoinKeys, looksLikeId, exportTableXLSX, exportTableCSV } from '../engine.js'
import { getLLMConfig, saveLLMConfig, clearLLMConfig, testConnection } from '../llmProvider.js'
import { suggestFixSteps } from '../CleanPanel.jsx'
import DataPreview from '../DataPreview.jsx'
import DatasetWorkbench from '../Workbench.jsx'
import { EChart, ChartTable, INSIGHT_ICON } from './EChart.jsx'

// ---------- 数据预览页（虚拟滚动表格） ----------
function PreviewView({ ds, onClose, onAnalyze }) {
  const hasTable = !!(ds && ds.table)
  return (
    <div className="screen preview-screen">
      <div className="preview-toolbar">
        <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} onClick={onClose}><ArrowLeft size={18} /> 返回工作台</button>
        <div className="preview-info">
          <div className="preview-name" title={ds && ds.meta.name}>{ds && ds.meta.name}</div>
          <div className="card-sub">{hasTable ? `${ds.table.rows.length.toLocaleString('zh-CN')} 行 × ${ds.table.columns.length} 列` : '暂无数据'}</div>
        </div>
        <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} disabled={!hasTable} onClick={() => hasTable && exportTableXLSX(ds.table, ds.meta.name || 'data')}>
          <FileSpreadsheet size={16} /> 导出 Excel
        </button>
        <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} disabled={!hasTable} onClick={() => hasTable && exportTableCSV(ds.table, ds.meta.name || 'data')}>
          <Sheet size={16} /> 导出 CSV
        </button>
        <button className="btn btn-primary" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} disabled={!hasTable} onClick={() => hasTable && onAnalyze(ds.id)}>
          <BarChart2 size={16} /> 开始分析
        </button>
      </div>
      {hasTable
        ? <div className="preview-body"><DataPreview columns={ds.table.columns} rows={ds.table.rows} /></div>
        : <div className="card"><p className="screen-desc">该数据集仅存元数据，暂无数据可预览。请重新导入文件后再试。</p></div>}
    </div>
  )
}

// ---------- 入口 ----------
function Home({ onUpload, onSample, onSchedule, onSettings, llmOn }) {
  const caps = [
    { ic: UploadIcon, t: '上传多源数据', d: 'CSV / Excel / JSON / 日志 / API，自动解析归一' },
    { ic: AlertTriangle, t: '数据质量诊断', d: '缺失、异常、类型冲突自动检出并给修复建议' },
    { ic: BarChart2, t: '自动可视化出图', d: '按数据语义自动生成最合适的图表' },
    { ic: Sparkles, t: '实质化分析建议', d: '每个数字可回溯，每条建议带口径说明' },
    { ic: MessageCircle, t: '数据问答', d: '围绕数据集持续提问，答案由真实统计支撑' },
    { ic: FileText, t: '一键报告导出', d: 'HTML / PDF / Word，图表 + 结论可分享' },
    { ic: Clock, t: '定时调度', d: '定时报表配置（推送通道待部署后接入）' },
  ]
  return (
    <div className="screen">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="screen-title">数据分析工作台</div>
          <p className="screen-desc">上传数据，得到敢签字的结论——每个数字可回溯到计算。</p>
        </div>
        <button className="icon-btn" title={llmOn ? '模型已接入，点击配置' : '接入分析模型'} onClick={onSettings}>
          {llmOn ? <Zap size={20} /> : <ZapOff size={20} />}
        </button>
      </div>
      <div className="btn-row-group">
        <button className="btn btn-primary" onClick={onUpload}><UploadIcon size={18} /> 上传 / 接入数据</button>
        <button className="btn btn-ghost" onClick={onSample}><Database size={18} /> 示例数据</button>
        <button className="btn btn-ghost" onClick={onSchedule}><Clock size={18} /> 定时调度</button>
      </div>
      <div className="card">
        <div className="card-title"><CheckCircle2 size={16} /> 能做什么</div>
        <div className="cap-list">
          {caps.map(c => (
            <div className="cap-item" key={c.t}>
              <div className="cap-ic"><c.ic size={20} /></div>
              <div className="cap-tx"><b>{c.t}</b><p>{c.d}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- 上传（文件 / 日志 / API / 多表关联 四个 tab） ----------
function Upload({ onFile, onSample, fileRef, table, fileName, baseTable, baseFileName, joinInfo, uploadTab, onTabChange, joinDraft, setJoinDraft, onJoin, onUndoJoin, datasets, selectedIds, onToggleSelect, autoLinks, mergeMeta, batchBusy, onBatchFiles, onRemoveDataset, onRenameDataset, onRunSingle, onRunMerge, idbRestoring, onPreviewDataset, onExcludeLink, onIncludeLink, streamState, onCancelStream }) {
  const [apiUrl, setApiUrl] = useState('')
  const [apiBusy, setApiBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  // 外部数据源（数据库）连接器：经本地代理转发 SQL，浏览器无法直接连 DB
  const [dbType, setDbType] = useState('mysql')
  const [dbHost, setDbHost] = useState('127.0.0.1')
  const [dbPort, setDbPort] = useState('3306')
  const [dbUser, setDbUser] = useState('')
  const [dbPass, setDbPass] = useState('')
  const [dbName, setDbName] = useState('')
  const [dbSql, setDbSql] = useState('SELECT * FROM your_table LIMIT 1000')
  const [dbProxy, setDbProxy] = useState('http://localhost:3001')
  const [dbBusy, setDbBusy] = useState(false)
  const [dbMsg, setDbMsg] = useState('')
  const subFileRef = useRef(null)
  const tab = uploadTab
  const setTab = onTabChange
  const main = baseTable || table
  const draft = joinDraft // 别名：组件内 21 行引用 draft，解构仅提供 joinDraft

  function updateDraft(patch) { setJoinDraft(d => ({ ...(d || {}), ...patch })) }

  // 实时匹配预览（随键变化重算）
  const preview = (main && draft && draft.subTable && draft.mainKey && draft.subKey)
    ? previewJoin(main, draft.subTable, draft.mainKey, draft.subKey)
    : null

  // 过滤维度表里 ID 类列（合并字段默认不含）
  function nonIdCols(t, excludeKey) {
    return t.columns.map(c => c.name).filter(n => n !== excludeKey && !looksLikeId(n, t.rows.map(r => r[n]).filter(v => v !== '' && v != null), t.rows.length || 1))
  }

  function pickSubFile(f) {
    if (!f) return
    const isTabular = /\.(csv|xlsx|xls|json)$/i.test(f.name)
    const p = isTabular ? parseFile(f) : Promise.reject(new Error('仅支持 CSV / Excel / JSON'))
    p.then(t => {
      const g = guessJoinKeys(main, t)
      const best = g.best || { mainKey: '', subKey: t.columns[0] && t.columns[0].name }
      const sk = best.subKey || (t.columns[0] && t.columns[0].name) || ''
      updateDraft({ subTable: t, subFile: f, mainKey: best.mainKey || '', subKey: sk, keepCols: nonIdCols(t, sk), mode: 'inner', candidates: g.candidates })
    }).catch(err => alert('维度表解析失败：' + err.message))
  }

  function onDropFile(e) {
    e.preventDefault()
    setDragActive(false)
    pickSubFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])
  }

  function changeMainKey(mk) {
    updateDraft({ mainKey: mk })
  }

  function changeSubKey(sk) {
    updateDraft({ subKey: sk, keepCols: draft && draft.subTable ? nonIdCols(draft.subTable, sk) : [] })
  }

  const noMatch = preview && preview.rate === 0

  return (
    <div className="screen">
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <span className={`chip ${tab === 'file' ? 'chip-active' : ''}`} onClick={() => setTab('file')}><UploadIcon size={14} style={{ verticalAlign: -2 }} /> 文件</span>
        <span className={`chip ${tab === 'log' ? 'chip-active' : ''}`} onClick={() => setTab('log')}><FileCode2 size={14} style={{ verticalAlign: -2 }} /> 日志</span>
        <span className={`chip ${tab === 'api' ? 'chip-active' : ''}`} onClick={() => setTab('api')}><Link2 size={14} style={{ verticalAlign: -2 }} /> API</span>
        <span className={`chip ${tab === 'db' ? 'chip-active' : ''}`} onClick={() => setTab('db')}><Database size={14} style={{ verticalAlign: -2 }} /> 数据库</span>
        <span className={`chip ${tab === 'join' ? 'chip-active' : ''}`} onClick={() => setTab('join')}><GitCompare size={14} style={{ verticalAlign: -2 }} /> 多表关联</span>
      </div>

      {tab === 'file' && (
        <>
          <div className="upload-zone" onClick={() => fileRef.current && fileRef.current.click()}>
            <div className="upload-ic"><UploadIcon size={26} /></div>
            <div style={{ fontWeight: 600 }}>点击选择文件</div>
            <div className="upload-hint">或将文件拖拽到此处</div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.txt,.log" style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          </div>
          {streamState && (
            <div className="stream-progress card" style={{ marginTop: 10 }}>
              <div className="stream-line">
                <span>
                  {streamState.phase === 'done' ? <span className="inline-ok"><CheckCircle2 size={14} /> 解析完成</span> : '正在流式解析（Web Worker 不卡界面）…'}
                  「{streamState.fileName}」
                </span>
                <span className="stream-count">
                  已解析 <b>{streamState.rows.toLocaleString('zh-CN')}</b> 行
                  {streamState.totalRaw > 0 ? ` / 共 ${streamState.totalRaw.toLocaleString('zh-CN')} 行` : ''}
                </span>
              </div>
              <div className="stream-bar">
                <div
                  className={`stream-bar-fill ${streamState.phase === 'parsing' && !streamState.totalRaw ? 'stream-indeterminate' : ''}`}
                  style={{ width: streamState.totalRaw > 0 ? `${Math.min(100, Math.round(streamState.rows / streamState.totalRaw * 100))}%` : '35%' }}
                />
              </div>
              {streamState.phase === 'parsing' && (
                <button className="btn btn-ghost" style={{ marginTop: 8, width: 'auto' }} onClick={onCancelStream}><X size={14} /> 取消解析</button>
              )}
            </div>
          )}
          <div className="center" style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span className="tag">CSV</span><span className="tag">Excel</span><span className="tag">JSON</span><span className="tag">TXT</span>
          </div>
          <DatasetWorkbench
            datasets={datasets}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            autoLinks={autoLinks}
            mergeMeta={mergeMeta}
            batchBusy={batchBusy}
            onBatchFiles={onBatchFiles}
            onRemoveDataset={onRemoveDataset}
            onRenameDataset={onRenameDataset}
            onRunSingle={onRunSingle}
            onRunMerge={onRunMerge}
            idbRestoring={idbRestoring}
            onPreviewDataset={onPreviewDataset}
            onExcludeLink={onExcludeLink}
            onIncludeLink={onIncludeLink}
          />
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="upload-zone" onClick={() => fileRef.current && fileRef.current.click()}>
            <div className="upload-ic"><FileCode2 size={26} /></div>
            <div style={{ fontWeight: 600 }}>选择日志文件（.log / .txt）</div>
            <div className="upload-hint">自动识别 JSON lines / 分隔符 / 键值对，失败则按原始行展示</div>
            <input ref={fileRef} type="file" accept=".log,.txt" style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          </div>
          <p className="screen-desc">解析策略四级回退：JSON lines → 分隔符切分 → 键值对抽取 → 原始行兜底。宁可给原始数据，不给错误结构。</p>
        </>
      )}

      {tab === 'api' && (
        <div className="card">
          <div className="card-title"><Link2 size={16} /> 从 API 拉取数据</div>
          <div className="form-row">
            <input className="form-input" value={apiUrl} placeholder="https://example.com/api/data（返回 JSON 数组）" onChange={e => setApiUrl(e.target.value)} />
            <button className="btn btn-primary" style={{ width: 'auto', minHeight: 40, padding: '0 16px', flexShrink: 0 }} disabled={apiBusy} onClick={async () => {
              setApiBusy(true)
              try {
                const t = await fetchApiData(apiUrl)
                onFile({ name: 'api:' + new URL(apiUrl).hostname, _table: t })
              } catch (e) { alert(e.message) } finally { setApiBusy(false) }
            }}>{apiBusy ? '抓取中…' : '抓取并分析'}</button>
          </div>
          <p className="screen-desc">提示：浏览器直连要求目标接口开放 CORS；仅支持 GET 与 JSON 数组响应。受限接口请改用文件上传。</p>
        </div>
      )}

      {tab === 'db' && (
        <div className="card">
          <div className="card-title"><Database size={16} /> 从数据库导入（经本地代理）</div>
          <div className="form-row">
            <label className="form-label" style={{ width: 90 }}>数据库类型</label>
            <select className="form-input" value={dbType} onChange={e => { setDbType(e.target.value); setDbPort(e.target.value === 'mysql' ? '3306' : '5432') }}>
              <option value="mysql">MySQL</option><option value="postgres">PostgreSQL</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label" style={{ width: 90 }}>代理地址</label>
            <input className="form-input" value={dbProxy} placeholder="http://localhost:3001" onChange={e => setDbProxy(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label" style={{ width: 90 }}>主机 / 端口</label>
            <input className="form-input" style={{ flex: 2 }} value={dbHost} placeholder="127.0.0.1" onChange={e => setDbHost(e.target.value)} />
            <input className="form-input" style={{ flex: 1, minWidth: 80 }} value={dbPort} placeholder="3306" onChange={e => setDbPort(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label" style={{ width: 90 }}>库名</label>
            <input className="form-input" value={dbName} placeholder="database" onChange={e => setDbName(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label" style={{ width: 90 }}>账号</label>
            <input className="form-input" value={dbUser} placeholder="user" onChange={e => setDbUser(e.target.value)} />
            <input className="form-input" type="password" value={dbPass} placeholder="password" onChange={e => setDbPass(e.target.value)} />
          </div>
          <div className="form-row" style={{ alignItems: 'stretch' }}>
            <label className="form-label" style={{ width: 90 }}>SQL</label>
            <textarea className="form-input" style={{ minHeight: 70, fontFamily: 'monospace' }} value={dbSql} onChange={e => setDbSql(e.target.value)} />
          </div>
          <div className="btn-row" style={{ padding: 0 }}>
            <button className="btn btn-ghost" disabled={dbBusy} onClick={async () => {
              setDbBusy(true); setDbMsg('')
              try {
                const rows = await queryViaProxy(dbProxy, { type: dbType, connection: { host: dbHost, port: Number(dbPort), user: dbUser, password: dbPass, database: dbName }, sql: 'SELECT 1' })
                setDbMsg('连接成功（代理可达，驱动已加载）')
              } catch (e) { setDbMsg('连接测试失败：' + e.message) } finally { setDbBusy(false) }
            }}>连接测试</button>
            <button className="btn btn-primary" disabled={dbBusy} onClick={async () => {
              setDbBusy(true); setDbMsg('')
              try {
                const rows = await queryViaProxy(dbProxy, { type: dbType, connection: { host: dbHost, port: Number(dbPort), user: dbUser, password: dbPass, database: dbName }, sql: dbSql })
                if (!Array.isArray(rows) || !rows.length) throw new Error('返回为空或非数组')
                const headers = Object.keys(rows[0])
                const t = { columns: headers.map(h => ({ name: h })), rows: rows.map(o => { const r = {}; headers.forEach(h => { r[h] = o[h] == null ? '' : (typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h])) }); return r }) }
                onFile({ name: 'db:' + dbName + '.' + (dbType), _table: t })
              } catch (e) { setDbMsg('导入失败：' + e.message) } finally { setDbBusy(false) }
            }}>{dbBusy ? '执行中…' : '导入并分析'}</button>
          </div>
          {dbMsg && <div className="screen-desc" style={{ marginTop: 8 }}>{dbMsg}</div>}
          <p className="screen-desc">浏览器出于安全与 CORS 限制无法直接连接数据库，需配合本地代理 <code>server/db-proxy.mjs</code> 转发 SQL（在项目目录运行 <code>node server/db-proxy.mjs</code>，默认监听 3001）。代理仅在你的机器上执行查询，凭证不离开本机。</p>
        </div>
      )}

      {tab === 'join' && (
        <div className="card">
          <div className="card-title"><GitCompare size={16} /> 多表关联分析</div>
          {!main ? (
            <>
              <p className="screen-desc">第一步：先上传主表（交易/订单明细等），这里会自动帮你关联维度表（用户画像、商品字典等）。</p>
              <button className="btn btn-ghost" onClick={() => setTab('file')}><UploadIcon size={16} /> 先上传主表</button>
            </>
          ) : (
            <>
              <div className="main-card">
                <div className="main-card-name"><Database size={16} /> <b>{baseFileName || fileName || '当前数据'}</b></div>
                <div className="card-sub">主表 {main.rows.length} 行 × {main.columns.length} 列{joinInfo ? `｜已关联「${joinInfo.subName}」` : ''}</div>
                {joinInfo && <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 36, padding: '0 12px' }} onClick={onUndoJoin}><ArrowLeft size={14} /> 撤销关联</button>}
              </div>

              <div className={`upload-zone${dragActive ? ' drag-active' : ''}`} style={{ margin: '10px 0' }}
                onClick={() => subFileRef.current && subFileRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDropFile}>
                <div className="upload-ic"><GitCompare size={22} /></div>
                <div style={{ fontWeight: 600 }}>{draft && draft.subFile ? draft.subFile.name + `（${draft.subTable.rows.length} 行）` : '选择维度表（CSV / Excel / JSON），自动识别关联键'}</div>
                <div className="upload-hint">可直接拖拽文件到此处；系统会自动匹配关联键并预览匹配率</div>
                <input ref={subFileRef} type="file" accept=".csv,.xlsx,.xls,.json" style={{ display: 'none' }} onChange={e => { pickSubFile(e.target.files && e.target.files[0]); e.target.value = '' }} />
              </div>

              {draft && draft.subTable && (
                <>
                  {preview && (
                    <div className={`join-preview${noMatch ? ' warn-text' : ''}`}>
                      <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> 自动匹配：<b>{draft.mainKey || '?'}</b> ↔ <b>{draft.subKey || '?'}</b>，预计匹配 <b>{preview.matched}/{preview.total}</b> 行（{preview.rate}%）
                      {preview.rate < 30 && <span className="warn-text">｜匹配率偏低，可换一组关联键或改「左连接」</span>}
                    </div>
                  )}
                  <div className="form-row">
                    <label className="form-label" style={{ minWidth: 110 }}>主表关联键</label>
                    <select className="form-input" value={draft.mainKey} onChange={e => changeMainKey(e.target.value)}>
                      {main.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="form-label" style={{ minWidth: 110 }}>维度表关联键</label>
                    <select className="form-input" value={draft.subKey} onChange={e => changeSubKey(e.target.value)}>
                      {draft.subTable.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  {draft.candidates && draft.candidates.length > 1 && (
                    <div className="form-row">
                      <label className="form-label" style={{ minWidth: 110 }}>其他候选键</label>
                      <div className="chip-row">
                        {draft.candidates.slice(0, 4).map(cd => (
                          <span key={cd.mainKey + cd.subKey} className={`chip ${cd.mainKey === draft.mainKey && cd.subKey === draft.subKey ? 'chip-active' : ''}`}
                            onClick={() => updateDraft({ mainKey: cd.mainKey, subKey: cd.subKey, keepCols: nonIdCols(draft.subTable, cd.subKey) })}>
                            {cd.mainKey} ↔ {cd.subKey}（{cd.rate}%）
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="form-row form-row-stack">
                    <label className="form-label" style={{ minWidth: 110 }}>合并字段</label>
                    <div className="chip-row">
                      {draft.subTable.columns.filter(c => c.name !== draft.subKey).map(c => (
                        <span key={c.name} className={`chip ${draft.keepCols.includes(c.name) ? 'chip-active' : ''}`} onClick={() => updateDraft({ keepCols: draft.keepCols.includes(c.name) ? draft.keepCols.filter(x => x !== c.name) : [...draft.keepCols, c.name] })}>{c.name}</span>
                      ))}
                    </div>
                  </div>
                  <div className="form-row form-row-stack">
                    <label className="form-label" style={{ minWidth: 110 }}>连接方式</label>
                    <div className="chip-row">
                      <span className={`chip ${draft.mode === 'inner' ? 'chip-active' : ''}`} onClick={() => updateDraft({ mode: 'inner' })}>内连接（仅匹配行）</span>
                      <span className={`chip ${draft.mode === 'left' ? 'chip-active' : ''}`} onClick={() => updateDraft({ mode: 'left' })}>左连接（保留主表全部行）</span>
                    </div>
                  </div>
                  {noMatch && draft.mode === 'inner' && <p className="warn-text" style={{ margin: '8px 0' }}>当前关联键没有匹配到任何行：请换一组关联键，或把连接方式改为「左连接」。</p>}
                  <button className="btn btn-primary" style={{ width: '100%' }}
                    disabled={!draft.mainKey || !draft.subKey || (noMatch && draft.mode === 'inner')}
                    onClick={() => onJoin(main, draft.subTable, draft.mainKey, draft.subKey, draft.keepCols, draft.mode, draft.subFile.name)}>
                    <GitCompare size={16} /> {noMatch && draft.mode === 'inner' ? '关联键无匹配，请调整' : '合并并分析'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <button className="btn btn-ghost" onClick={onSample}><Database size={18} /> 使用示例数据快速体验</button>
      <p className="screen-desc">提示：未配置模型时为可离线运行的规则引擎；在首页右上角接入分析模型后，图表规划与结论叙述自动升级。</p>
    </div>
  )
}

// ---------- 看板 ----------
function Dashboard({ result, quality, aiMode, onChart, onQuality, onReport, onChat, onSchedule, baseTable, joinInfo, onJoinOpen, onUndoJoin, mergeMeta, onBackToWorkbench, onUndoMerge, onToolbox, onClean, canUndoClean, onUndoClean, fileName, onTemplate,
  activeFilters, filterDimCandidates, topValuesForDim, toggleFilterValue, clearFilters, removeFilterDim, onDrill }) {
  return (
    <div className="screen">
      {mergeMeta && (
        <div className="join-banner card">
          <div className="join-badge"><Layers size={16} /> 联合分析中</div>
          <div className="card-sub" style={{ margin: 0, flex: 1 }}>
            已合并 {mergeMeta.names ? mergeMeta.names.length : 0} 个数据集（{mergeMeta.mode === 'union' ? '纵向堆叠' : '关联合并'}）：{mergeMeta.names ? mergeMeta.names.join('、') : ''}；当前 {result.table ? result.table.rows.length : '-'} 行
            {mergeMeta.mode === 'join' && mergeMeta.matched != null ? `；关联匹配 ${mergeMeta.matched}/${mergeMeta.total}` : ''}
            {mergeMeta.warnings && mergeMeta.warnings.length ? `；${mergeMeta.warnings[0]}` : ''}
          </div>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px', flexShrink: 0 }} onClick={onBackToWorkbench}><Layers size={16} /> 返回工作台</button>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px', flexShrink: 0 }} onClick={onUndoMerge}><ArrowLeft size={16} /> 撤销联合</button>
        </div>
      )}
      {joinInfo && baseTable && (
        <div className="join-banner card">
          <div className="join-badge"><GitCompare size={16} /> 关联分析中</div>
          <div className="card-sub" style={{ margin: 0, flex: 1 }}>「{joinInfo.subName}」按 {joinInfo.mainKey} 关联（{joinInfo.matched}/{joinInfo.total} 行匹配），原主表 {baseTable.rows.length} 行 → 当前 {result.table ? result.table.rows.length : '-'} 行</div>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px', flexShrink: 0 }} onClick={onUndoJoin}><ArrowLeft size={16} /> 撤销关联</button>
        </div>
      )}
      <div className="quality-banner card">
        <div className="quality-score">{quality.score}</div>
        <div style={{ flex: 1 }}>
          <div className="card-title" style={{ margin: 0 }}>数据质量评分</div>
          <div className="card-sub">检出 {quality.issues.length} 项问题{quality.issues.length ? '，建议先核查' : '，数据干净'}</div>
        </div>
        <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px' }} onClick={onQuality}><AlertTriangle size={16} /> 查看</button>
      </div>

      <div className="card">
        <div className="card-title"><Sparkles size={16} /> 分析结论与建议 {aiMode === 'llm' ? <span className="badge-ai">引擎生成 · 数字经引擎真实计算</span> : <span className="badge-mock">规则引擎</span>}{result.sampled && result.sampled.enabled && <span className="badge-sample">采样统计</span>}</div>
        <div className="insight-list">
          {result.insights.map((it, i) => {
            const Ic = INSIGHT_ICON[it.icon] || Sparkles
            return (
              <div className="insight" key={i}>
                <div className="insight-ic"><Ic size={16} /></div>
                <div>
                  <div className="insight-tx">{it.text}</div>
                  <div className="insight-caliber">{it.caliber}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Download size={16} /> 导出当前数据集（{result.table ? `${result.table.rows.length} 行 × ${result.table.columns.length} 列` : ''}）</div>
        <div className="btn-row-group">
          <button className="btn btn-ghost" onClick={() => exportTableXLSX(result.table, fileName || '数据分析结果')}><FileSpreadsheet size={18} /> 导出 Excel</button>
          <button className="btn btn-ghost" onClick={() => exportTableCSV(result.table, fileName || '数据分析结果')}><Sheet size={18} /> 导出 CSV</button>
        </div>
      </div>

      {filterDimCandidates.length > 0 && (
        <div className="card filter-card">
          <div className="card-title"><Filter size={16} /> 交互式筛选（点击数值下钻，多维度联动所有图表）</div>
          {activeFilters.length > 0 ? (
            <div className="filter-chips">
              {activeFilters.map(f => (
                <span className="filter-chip" key={f.dim}>
                  <b>{f.dim}</b>: {f.values.join('、')}
                  <button className="filter-x" title="移除该维度筛选" onClick={() => removeFilterDim(f.dim)}>×</button>
                </span>
              ))}
              <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={clearFilters}>重置全部</button>
            </div>
          ) : (
            <div className="card-sub">未筛选，展示全部数据。点击下方维度数值即可下钻联动；也可在图表上点击类目下钻。</div>
          )}
          <div className="filter-dim-row">
            {filterDimCandidates.map(dim => (
              <div className="filter-dim" key={dim}>
                <div className="filter-dim-name">{dim}</div>
                <div className="filter-vals">
                  {topValuesForDim(dim, 18).map(v => {
                    const af = activeFilters.find(f => f.dim === dim)
                    const on = af && af.values.includes(v)
                    return <span key={v} className={`filter-val ${on ? 'on' : ''}`} onClick={() => toggleFilterValue(dim, v)}>{v}</span>
                  })}
                </div>
              </div>
            ))}
            {filterDimCandidates.length === 0 && <div className="muted" style={{ fontSize: 12 }}>当前数据集未检测到可筛选的分类维度</div>}
          </div>
        </div>
      )}

      <div className="card-title" style={{ margin: '4px 2px' }}><BarChart2 size={16} /> 图表画廊 {result.sampled && result.sampled.enabled && <span className="badge-sample">采样统计</span>}{activeFilters.length > 0 && <span className="badge-sample">已筛选 {activeFilters.reduce((n, f) => n + f.values.length, 0)} 项</span>}</div>
      <div className="gallery">
        {result.charts.map(c => (
          <div className="chart-card" key={c.id}>
            <div className="chart-head">
              <span className="chart-title">{c.title}</span>
              <span className="badge-ai">{c.manual ? '手动生成' : (aiMode === 'llm' ? '自动规划' : '自动生成')}</span>
              {c.caliber && (
                <span className="chart-tip-wrap" tabIndex={0} aria-label="查看备注">
                  <HelpCircle size={14} className="chart-tip-icon" />
                  <span className="chart-tip-bubble">{c.caliber}</span>
                </span>
              )}
              <button className="chart-view-btn" title="查看详情" onClick={() => onChart(c)}><Maximize2 size={14} /></button>
            </div>
            {c.option ? <EChart option={c.option} kind={c.type} mobileHeight={180} downloadable fileName={c.title || 'chart'} onItemClick={c.drillDim ? (p) => onDrill(c, p.name) : undefined} /> : null}
            {c.table ? <ChartTable table={c.table} exportName={c.title || '图表数据'} /> : null}
          </div>
        ))}
      </div>

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onJoinOpen}><GitCompare size={18} /> 多表关联</button>
        <button className="btn btn-ghost" onClick={onToolbox}><Sparkles size={18} /> 分析工具箱</button>
        <button className="btn btn-ghost" onClick={onTemplate}><BookmarkPlus size={18} /> 模板库</button>
        <button className="btn btn-ghost" onClick={onClean}><Eraser size={18} /> 数据清洗</button>
        <button className="btn btn-ghost" onClick={onReport}><FileText size={18} /> 导出报告</button>
        <button className="btn btn-primary" onClick={onChat}><MessageCircle size={18} /> 问数据</button>
        <button className="btn btn-ghost" onClick={onSchedule}><Clock size={18} /> 定时调度</button>
        {canUndoClean && <button className="btn btn-ghost" onClick={onUndoClean}><RotateCcw size={18} /> 回退清洗</button>}
      </div>
    </div>
  )
}

// ---------- 图表详情 ----------
function ChartDetail({ chart, onBack }) {
  return (
    <div className="screen">
      <div className="card">
        <div className="card-title"><BarChart2 size={16} /> {chart.title}</div>
        {chart.option ? <EChart option={chart.option} kind={chart.type} height={chart.type === 'heatmap' || chart.type === 'scatter' ? 460 : 360} mobileHeight={chart.type === 'heatmap' || chart.type === 'scatter' ? 380 : 300} downloadable fileName={chart.title || 'chart'} /> : null}
        {chart.table ? <ChartTable table={chart.table} exportName={chart.title || '图表数据'} /> : null}
      </div>
      {chart.caliber && (
        <div className="card">
          <div className="card-title"><ListChecks size={16} /> 口径说明</div>
          <div className="insight-caliber">{chart.caliber}</div>
        </div>
      )}
      <button className="btn btn-ghost" onClick={onBack}><ArrowLeft size={18} /> 返回看板</button>
    </div>
  )
}

// ---------- 质量诊断 ----------
function Quality({ quality, table, onFix }) {
  return (
    <div className="screen">
      <div className="quality-banner card">
        <div className="quality-score">{quality.score}</div>
        <div><div className="card-title" style={{ margin: 0 }}>综合评分</div><div className="card-sub">基于缺失、重复、类型、异常加权计算</div></div>
      </div>
      <div className="card">
        <div className="card-title"><AlertTriangle size={16} /> 问题清单（{quality.issues.filter(i => i.severity !== 'info').length} 项问题 · {quality.issues.filter(i => i.severity === 'info').length} 项提示）</div>
        {quality.issues.length === 0 && <div className="muted">未检出明显问题，数据质量良好。</div>}
        {quality.issues.map((it, i) => {
          const fixSteps = suggestFixSteps(it, table)
          return (
            <div className="issue" key={i}>
              <div className={`sev sev-${it.severity}`} />
              <div className="issue-body">
                <div className="issue-title">{it.col} · {it.type}</div>
                <div className="issue-detail">{it.detail}</div>
                <div className="issue-fix">建议：{it.suggestion}</div>
              </div>
              {fixSteps.length > 0 && (
                <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 36, padding: '0 12px', flexShrink: 0, alignSelf: 'center' }} onClick={() => onFix(fixSteps)}><Wand2 size={14} /> 一键修复</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- 报告 ----------
function Report({ html, iframeRef }) {
  return (
    <div className="screen">
      <div className="card-title no-print" style={{ margin: '4px 2px' }}><FileText size={16} /> 报告预览（右上角可导出 PDF / Word / HTML）</div>
      <iframe className="report-frame" title="report" srcDoc={html} ref={iframeRef} />
    </div>
  )
}

// ---------- LLM 设置 ----------
function SettingsPanel({ theme, setTheme, onSaved }) {
  const existing = getLLMConfig() || { baseUrl: '', apiKey: '', model: '' }
  const [baseUrl, setBaseUrl] = useState(existing.baseUrl)
  const [apiKey, setApiKey] = useState(existing.apiKey)
  const [model, setModel] = useState(existing.model)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [persist, setPersist] = useState(true)
  return (
    <div className="screen">
      <div className="card">
        <div className="card-title"><Settings size={16} /> 界面主题</div>
        <div className="seg" role="radiogroup" aria-label="主题">
          {[
            { v: 'light', label: '浅色' },
            { v: 'dark', label: '暗色' },
            { v: 'system', label: '跟随系统' },
          ].map(opt => (
            <button
              key={opt.v}
              className={`seg-item ${theme === opt.v ? 'seg-on' : ''}`}
              onClick={() => setTheme(opt.v)}
              role="radio"
              aria-checked={theme === opt.v}
            >{opt.label}</button>
          ))}
        </div>
        <div className="screen-desc" style={{ marginTop: 8 }}>暗色模式仅切换视觉层，不重跑分析；偏好自动保存。</div>
      </div>
      <div className="card">
        <div className="card-title"><Settings size={16} /> 接入分析模型（OpenAI 兼容接口）</div>
        <div className="form-row">
          <label className="form-label">Base URL</label>
          <input className="form-input" value={baseUrl} placeholder="https://api.openai.com 或其他兼容网关" onChange={e => setBaseUrl(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">API Key</label>
          <input className="form-input" type="password" value={apiKey} placeholder="sk-…（可仅本次会话保存）" onChange={e => setApiKey(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">模型名</label>
          <input className="form-input" value={model} placeholder="gpt-4o-mini / deepseek-chat 等" onChange={e => setModel(e.target.value)} />
        </div>
        <div className="form-row" style={{ alignItems: 'center' }}>
          <label className="form-label" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={persist} onChange={e => setPersist(e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />
            永久保存密钥（关闭后仅本次会话生效，不写入浏览器存储）
          </label>
        </div>
        <div className="btn-row" style={{ padding: 0 }}>
          <button className="btn btn-primary" onClick={() => {
            if (!baseUrl || !apiKey || !model) { alert('请填写完整'); return }
            saveLLMConfig({ baseUrl, apiKey, model }, { persist })
            onSaved()
          }}><CheckCircle2 size={18} /> 保存</button>
          <button className="btn btn-ghost" disabled={testing} onClick={async () => {
            setTesting(true); setTestMsg('')
            saveLLMConfig({ baseUrl, apiKey, model }, { persist })
            try { await testConnection(); setTestMsg('连接成功') }
            catch (e) { setTestMsg('连接失败：' + (e.message || e)) }
            finally { setTesting(false) }
          }}>{testing ? '测试中…' : '测试连接'}</button>
          <button className="btn btn-ghost" onClick={() => { clearLLMConfig(); setBaseUrl(''); setApiKey(''); setModel(''); setTestMsg('已清空，回到规则引擎模式') }}><Trash2 size={18} /> 清空</button>
        </div>
        {testMsg && <div className="screen-desc" style={{ marginTop: 8 }}>{testMsg}</div>}
      </div>
      <div className="card">
        <div className="card-title"><ListChecks size={16} /> 使用说明与边界</div>
        <div className="insight-list">
          <div className="insight"><div className="insight-ic"><Sparkles size={16} /></div><div><div className="insight-tx">分析模型只做「选图表、解意图、写结论」三件事，所有数字仍由本地引擎真实计算，可回溯口径。</div></div></div>
          <div className="insight"><div className="insight-ic"><AlertTriangle size={16} /></div><div><div className="insight-tx">Key 仅存本机浏览器 localStorage，不会上传到我们的服务器；请勿使用生产环境高权限 Key。浏览器直连要求接口开放 CORS。</div></div></div>
          <div className="insight"><div className="insight-ic"><ZapOff size={16} /></div><div><div className="insight-tx">未配置或调用失败时自动降级为内置规则引擎，全流程依然可用（离线亦可）。</div></div></div>
        </div>
      </div>
    </div>
  )
}

// ---------- 追问面板 ----------
function ChatPanel({ messages, onClose, onSend, suggestions, fileName }) {
  const [text, setText] = useState('')
  const msgsRef = useRef(null)
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight }, [messages])
  useEffect(() => {
    if (messages.length === 0 && fileName) {
      import('../backend/conversationSync.js').then(({ loadRecentMessages }) =>
        loadRecentMessages(fileName).then(h => { if (h.length) useStore.getState().hydrateChat(h) })
      )
    }
  }, []) // eslint-disable-line
  return (
    <div className="chat-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="card-title" style={{ margin: 0 }}><MessageCircle size={16} /> 围绕这份数据提问</div>
        <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={onClose}><ArrowLeft size={18} /></button>
      </div>
      <div className="chat-msgs" ref={msgsRef}>
        {messages.length === 0 && <div className="muted" style={{ fontSize: 13 }}>试试下面的问题，答案由真实统计支撑。</div>}
        {messages.map((m, i) => (
          <div key={i}>
            <div className={`chat-msg ${m.role}`}>{m.text}</div>
            {m.sql && (
              <div className="chat-sql">
                <div className="chat-sql-head">
                  <span>生成的 SQL（仅 SELECT，结果由内存引擎执行）</span>
                  <button className="chat-sql-copy" onClick={() => { try { navigator.clipboard.writeText(m.sql); alert('SQL 已复制') } catch (e) { /* 剪贴板不可用时忽略 */ } }}>复制</button>
                </div>
                <pre>{m.sql}</pre>
              </div>
            )}
            {m.table && (
              <div className="chat-table-wrap">
                <table className="chat-table">
                  <thead><tr>{m.table.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{m.table.rows.slice(0, 20).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            {m.chart && <div className="chart-card" style={{ marginTop: 8 }}><EChart option={m.chart.option} kind={m.chart.type} height={m.chart.type === 'heatmap' || m.chart.type === 'scatter' ? 360 : 220} mobileHeight={180} downloadable fileName={m.chart.title || 'chart'} /></div>}
          </div>
        ))}
      </div>
      <div className="chip-row">
        {suggestions.map(s => <span className="chip" key={s} onClick={() => onSend(s)}>{s}</span>)}
      </div>
      <div className="chat-input-row" style={{ marginTop: 8 }}>
        <input className="chat-input" value={text} placeholder="例如：销售额最高的是哪个区域？" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && (onSend(text), setText(''))} />
        <button className="icon-btn" onClick={() => { onSend(text); setText('') }}><Share2 size={18} /></button>
      </div>
    </div>
  )
}

export { PreviewView, Home, Upload, Dashboard, ChartDetail, Quality, Report, SettingsPanel, ChatPanel }
