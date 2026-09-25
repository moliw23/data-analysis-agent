import React, { useRef, useEffect, useMemo } from 'react'
import { Sun, Moon, MessageCircle, Printer, FileText, Presentation, FileSpreadsheet, Sheet, Download, Home as HomeIcon, Upload as UploadIcon, BarChart3, AlertTriangle, Clock, Settings } from 'lucide-react'
import { useStore } from './store.js'
import { inferSchema, suggestQuestions, analyze, applyFilters, exportTableXLSX, exportTableCSV } from './engine.js'
import { isLLMConfigured } from './llmProvider.js'
import { exportPDF, exportWord, exportPPTX } from './reportExport.js'
import { getSchedules, shouldRunToday, touchRun } from './schedule.js'
import ChartToolbox from './ChartToolbox.jsx'
import TemplateLibrary from './TemplateLibrary.jsx'
import CleanPanel from './CleanPanel.jsx'
import { Home, Upload, PreviewView, Dashboard, ChartDetail, Quality, Report, SettingsPanel, ChatPanel } from './components/Views.jsx'

const ScheduleView = React.lazy(() => import('./ScheduleView.jsx'))

const TITLE = { upload: '上传 / 接入数据', preview: '数据预览', dashboard: '分析看板', chart: '图表详情', quality: '数据质量诊断', report: '分析报告', schedule: '定时调度', settings: '模型接入' }

export default function App() {
  // ---------- 订阅状态 ----------
  const view = useStore(s => s.view)
  const theme = useStore(s => s.theme)
  const appliedTheme = useStore(s => s.appliedTheme)
  const table = useStore(s => s.table)
  const result = useStore(s => s.result)
  const quality = useStore(s => s.quality)
  const fileName = useStore(s => s.fileName)
  const baseTable = useStore(s => s.baseTable)
  const baseFileName = useStore(s => s.baseFileName)
  const joinInfo = useStore(s => s.joinInfo)
  const uploadTab = useStore(s => s.uploadTab)
  const joinDraft = useStore(s => s.joinDraft)
  const datasets = useStore(s => s.datasets)
  const selectedIds = useStore(s => s.selectedIds)
  const autoLinks = useStore(s => s.autoLinks)
  const mergeMeta = useStore(s => s.mergeMeta)
  const batchBusy = useStore(s => s.batchBusy)
  const selectedChart = useStore(s => s.selectedChart)
  const activeFilters = useStore(s => s.activeFilters)
  const chatOpen = useStore(s => s.chatOpen)
  const chat = useStore(s => s.chat)
  const baseResult = useStore(s => s.baseResult)
  const setResult = useStore(s => s.setResult)
  const reportHTML = useStore(s => s.reportHTML)
  const loading = useStore(s => s.loading)
  const aiMode = useStore(s => s.aiMode)
  const toast = useStore(s => s.toast)
  const previewDs = useStore(s => s.previewDs)
  const idbRestoring = useStore(s => s.idbRestoring)
  const toolboxOpen = useStore(s => s.toolboxOpen)
  const templateOpen = useStore(s => s.templateOpen)
  const streamState = useStore(s => s.streamState)
  const cleanOpen = useStore(s => s.cleanOpen)
  const cleanHistoryLen = useStore(s => s.cleanHistory.length)
  const closePreview = useStore(s => s.closePreview)

  // ---------- 订阅动作 ----------
  const setView = useStore(s => s.setView)
  const setUploadTab = useStore(s => s.setUploadTab)
  const setJoinDraft = useStore(s => s.setJoinDraft)
  const setChatOpen = useStore(s => s.setChatOpen)
  const setTheme = useStore(s => s.setTheme)
  const setAppliedTheme = useStore(s => s.setAppliedTheme)
  const setToolboxOpen = useStore(s => s.setToolboxOpen)
  const setTemplateOpen = useStore(s => s.setTemplateOpen)
  const setCleanOpen = useStore(s => s.setCleanOpen)
  const showToast = useStore(s => s.showToast)
  const handleFile = useStore(s => s.handleFile)
  const handleSample = useStore(s => s.handleSample)
  const handleJoin = useStore(s => s.handleJoin)
  const handleUndoJoin = useStore(s => s.handleUndoJoin)
  const handleToggleSelect = useStore(s => s.handleToggleSelect)
  const excludeLink = useStore(s => s.excludeLink)
  const includeLink = useStore(s => s.includeLink)
  const handleBatchFiles = useStore(s => s.handleBatchFiles)
  const removeDataset = useStore(s => s.removeDataset)
  const renameDataset = useStore(s => s.renameDataset)
  const runSingleAnalysis = useStore(s => s.runSingleAnalysis)
  const handleManualGenerate = useStore(s => s.handleManualGenerate)
  const handleTemplateApply = useStore(s => s.handleTemplateApply)
  const openClean = useStore(s => s.openClean)
  const handleCleanApply = useStore(s => s.handleCleanApply)
  const undoClean = useStore(s => s.undoClean)
  const runMergeAnalysis = useStore(s => s.runMergeAnalysis)
  const undoMerge = useStore(s => s.undoMerge)
  const openPreview = useStore(s => s.openPreview)
  const openChart = useStore(s => s.openChart)
  const openReport = useStore(s => s.openReport)
  const downloadReport = useStore(s => s.downloadReport)
  const sendQuestion = useStore(s => s.sendQuestion)
  const runSchedule = useStore(s => s.runSchedule)
  const cancelStream = useStore(s => s.cancelStream)
  const toggleFilterValue = useStore(s => s.toggleFilterValue)
  const clearFilters = useStore(s => s.clearFilters)
  const removeFilterDim = useStore(s => s.removeFilterDim)
  const handleChartDrill = useStore(s => s.handleChartDrill)
  const openJoin = useStore(s => s.openJoin)
  const openUpload = useStore(s => s.openUpload)
  const backToWorkbench = useStore(s => s.backToWorkbench)

  const fileRef = useRef(null)
  const iframeRef = useRef(null)

  // 主题应用：跟随 system 或手动切换，写入 data-theme 并分发事件（启动即生效）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const eff = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.setAttribute('data-theme', eff)
      setAppliedTheme(eff)
      try { localStorage.setItem('data-agent.theme', theme) } catch { /* 忽略 */ }
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: eff } }))
    }
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme, setAppliedTheme])

  // 交互式看板：筛选条件变化时，对筛选后的数据重新分析，所有图表联动刷新（cross-filter）
  useEffect(() => {
    if (!table) return
    if (!activeFilters.length) {
      if (baseResult) setResult(baseResult)
      return
    }
    try {
      const ft = applyFilters(table, activeFilters)
      setResult(analyze(ft))
    } catch (e) { /* 重算失败静默降级 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters, table])

  // 启动：从持久化存储恢复数据集元数据 + IndexedDB 行
  useEffect(() => {
    useStore.getState().initFromStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 应用生命周期内轮询：每 30s 检查已启用的调度是否到达触发时间，自动跑批并入库
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}) } catch {}
    const timer = setInterval(() => {
      const now = new Date()
      getSchedules().forEach(sch => {
        if (!sch.enabled) return
        if (!shouldRunToday(sch, now)) return
        const last = sch.lastRun ? new Date(sch.lastRun) : null
        if (last && last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth() && last.getDate() === now.getDate()) return
        touchRun(sch.id)
        useStore.getState().executeScheduleSilent(sch)
      })
    }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, result, quality])

  // 维度候选（用于筛选器）与取某维度的 Top 值（派生视图数据，非状态）
  const filterDimCandidates = useMemo(() => {
    if (!table) return []
    const t = inferSchema(table)
    return t.columns.filter(c => c.semantic === 'dimension' || (c.type !== 'number' && c.semantic !== 'time')).map(c => c.name)
  }, [table])
  function topValuesForDim(dim, k = 15) {
    const rows = (table && table.rows) || []
    const freq = {}
    rows.forEach(r => { const v = r[dim]; if (v !== '' && v != null) { const s = String(v); freq[s] = (freq[s] || 0) + 1 } })
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, k).map(([v]) => v)
  }

  // 侧栏：当前视图对应的一级导航项（子视图归并到父级高亮）
  const activeNav = { home: 'home', upload: 'upload', preview: 'upload', dashboard: 'dashboard', chart: 'dashboard', quality: 'quality', report: 'dashboard', schedule: 'schedule', settings: 'settings' }[view]
  // 需要数据的导航项：未就绪时禁用并拦截跳转
  const goNav = (target) => {
    if (target === 'dashboard' && !result) return
    if (target === 'quality' && !quality) return
    setView(target)
  }

  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="sidebar-brand">
          <span className="sidebar-mark"><BarChart3 size={18} /></span>
          <span className="sidebar-brand-text">数据分析</span>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${activeNav === 'home' ? 'nav-active' : ''}`} onClick={() => setView('home')}>
            <span className="nav-ic"><HomeIcon size={18} /></span>
            <span className="nav-label">概览</span>
          </button>
          <button className={`nav-item ${activeNav === 'upload' ? 'nav-active' : ''}`} onClick={() => setView('upload')}>
            <span className="nav-ic"><UploadIcon size={18} /></span>
            <span className="nav-label">上传接入</span>
          </button>
          <button className={`nav-item ${activeNav === 'dashboard' ? 'nav-active' : ''} ${!result ? 'nav-disabled' : ''}`} onClick={() => goNav('dashboard')} disabled={!result}>
            <span className="nav-ic"><BarChart3 size={18} /></span>
            <span className="nav-label">分析看板</span>
          </button>
          <button className={`nav-item ${activeNav === 'quality' ? 'nav-active' : ''} ${!quality ? 'nav-disabled' : ''}`} onClick={() => goNav('quality')} disabled={!quality}>
            <span className="nav-ic"><AlertTriangle size={18} /></span>
            <span className="nav-label">数据质量</span>
          </button>
          <button className={`nav-item ${activeNav === 'schedule' ? 'nav-active' : ''}`} onClick={() => setView('schedule')}>
            <span className="nav-ic"><Clock size={18} /></span>
            <span className="nav-label">定时调度</span>
          </button>
          <button className={`nav-item ${activeNav === 'settings' ? 'nav-active' : ''}`} onClick={() => setView('settings')}>
            <span className="nav-ic"><Settings size={18} /></span>
            <span className="nav-label">模型接入</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="nav-ic"><BarChart3 size={16} /></span>
          <span className="nav-label">本地分析 · v1.0</span>
        </div>
      </aside>

      <div className="shell-content">
        <div className="topbar no-print">
          <div style={{ flex: 1 }}>
            <div className="topbar-title">{TITLE[view] || '概览'}</div>
            {fileName && <div className="topbar-sub">{fileName} · {table ? `${table.rows.length} 行` : ''}</div>}
          </div>
          <button className="icon-btn" title={appliedTheme === 'dark' ? '切换为浅色' : '切换为暗色'} onClick={() => setTheme(appliedTheme === 'dark' ? 'light' : 'dark')}>
            {appliedTheme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          {view === 'dashboard' && <button className="icon-btn" onClick={() => setChatOpen(v => !v)}><MessageCircle size={20} /></button>}
          {view === 'report' && (
            <>
              <button className="icon-btn" title="导出 PDF（打印）" onClick={() => exportPDF(iframeRef)}><Printer size={20} /></button>
              <button className="icon-btn" title="导出 Word" onClick={() => exportWord(table, result, quality, `数据分析报告_${fileName || 'export'}`)}><FileText size={20} /></button>
              <button className="icon-btn" title="导出 PPTX" onClick={async () => { try { await exportPPTX(table, result, quality, `数据分析报告_${fileName || 'export'}`); showToast('PPTX 已导出') } catch (e) { alert('PPTX 导出失败：' + (e.message || e)) } }}><Presentation size={20} /></button>
              <button className="icon-btn" title="导出 Excel" onClick={() => exportTableXLSX(result.table, `数据分析结果_${fileName || 'export'}`)}><FileSpreadsheet size={20} /></button>
              <button className="icon-btn" title="导出 CSV" onClick={() => exportTableCSV(result.table, `数据分析结果_${fileName || 'export'}`)}><Sheet size={20} /></button>
              <button className="icon-btn" title="下载 HTML" onClick={downloadReport}><Download size={20} /></button>
            </>
          )}
        </div>

        <div className="shell-main">
          {view === 'home' && <Home onUpload={() => setView('upload')} onSample={handleSample} onSchedule={() => setView('schedule')} onSettings={() => setView('settings')} llmOn={isLLMConfigured()} />}
      {view === 'upload' && <Upload onFile={handleFile} onSample={handleSample} fileRef={fileRef} table={table} fileName={fileName} baseTable={baseTable} baseFileName={baseFileName} joinInfo={joinInfo} uploadTab={uploadTab} onTabChange={setUploadTab} joinDraft={joinDraft} setJoinDraft={setJoinDraft} onJoin={handleJoin} onUndoJoin={handleUndoJoin} datasets={datasets} selectedIds={selectedIds} onToggleSelect={handleToggleSelect} autoLinks={autoLinks} mergeMeta={mergeMeta} batchBusy={batchBusy} onBatchFiles={handleBatchFiles} onRemoveDataset={removeDataset} onRenameDataset={renameDataset} onRunSingle={runSingleAnalysis} onRunMerge={runMergeAnalysis} idbRestoring={idbRestoring} onPreviewDataset={openPreview} onExcludeLink={excludeLink} onIncludeLink={includeLink} streamState={streamState} onCancelStream={cancelStream} />}
      {view === 'preview' && previewDs && <PreviewView key={previewDs.id} ds={previewDs} onClose={closePreview} onAnalyze={runSingleAnalysis} />}
      {view === 'dashboard' && result && <Dashboard result={result} quality={quality} aiMode={aiMode} onChart={openChart} onQuality={() => setView('quality')} onReport={openReport} onChat={() => setChatOpen(true)} onSchedule={() => setView('schedule')} baseTable={baseTable} joinInfo={joinInfo} onJoinOpen={openJoin} onUndoJoin={handleUndoJoin} mergeMeta={mergeMeta} onBackToWorkbench={backToWorkbench} onUndoMerge={undoMerge} onToolbox={() => setToolboxOpen(true)} onTemplate={() => setTemplateOpen(true)} onClean={() => openClean(null)} canUndoClean={cleanHistoryLen > 0} onUndoClean={undoClean} fileName={fileName} activeFilters={activeFilters} filterDimCandidates={filterDimCandidates} topValuesForDim={topValuesForDim} toggleFilterValue={toggleFilterValue} clearFilters={clearFilters} removeFilterDim={removeFilterDim} onDrill={handleChartDrill} />}
      {view === 'chart' && selectedChart && <ChartDetail chart={selectedChart} onBack={() => setView('dashboard')} />}
      {view === 'quality' && quality && <Quality quality={quality} table={table} onFix={openClean} />}
      {view === 'report' && <Report html={reportHTML} iframeRef={iframeRef} />}
      {view === 'schedule' && (
        <React.Suspense fallback={<div className="loading">正在加载调度模块…</div>}>
          <ScheduleView hasData={!!table} onRun={runSchedule} />
        </React.Suspense>
      )}
      {view === 'settings' && <SettingsPanel theme={theme} setTheme={setTheme} onSaved={() => showToast('LLM 配置已保存')} />}

      {(view === 'dashboard') && (
        <>
          {!chatOpen && <button className="fab" onClick={() => setChatOpen(true)}><MessageCircle size={18} /><span>问数据</span></button>}
          {chatOpen && (
            <ChatPanel
              messages={chat}
              onClose={() => setChatOpen(false)}
              onSend={sendQuestion}
              suggestions={table ? suggestQuestions(table) : []}
            />
          )}
        </>
      )}

      {toolboxOpen && table && <ChartToolbox table={table} onGenerate={handleManualGenerate} onClose={() => setToolboxOpen(false)} />}
      {templateOpen && table && <TemplateLibrary table={table} activeFilters={activeFilters} onApply={handleTemplateApply} onClose={() => setTemplateOpen(false)} />}
      {cleanOpen && table && <CleanPanel table={table} onApply={handleCleanApply} onClose={() => setCleanOpen(false)} />}

      {loading && <div className="loading">正在解析与计算…</div>}
      {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    </div>
  )
}
