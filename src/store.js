// 全局状态层（Zustand）：原 App.jsx 的 33 个 state 字段 + ~30 个 handler 整体迁入。
// 动作统一通过 get()/set() 读写，彻底消除 React 陈旧闭包（原代码多处 eslint-disable exhaustive-deps 即为此问题）。
// 组件用 selector 订阅；theme 应用副作用与 30s 调度轮询保留在 App（属生命周期副作用）。
import { create } from 'zustand'
import {
  parseFile, parseCSVText, analyze, qualityCheck, chatAnswer, exportReportHTML,
  schemaSummaryFor, analyzeByPlan, buildStatSummary, executeIntent, joinTables, previewJoin, detectLinks,
  mergeDatasets, buildMergePlan, compareAcrossTables, sampleRows, mergeSummary, manualChart,
  matchDrillValue, inferSchema, lineOption, barOption,
} from './engine.js'
import { parseLogFile } from './logParser.js'
import { parseStreamFile } from './streamParse.js'
import { isLLMConfigured, planAnalysis, narrateInsights, withLLMFallback, parseQuestion, textToSQL } from './llmProvider.js'
import { validateSQL } from './sqlGuard.js'
import { executeSQL } from './sqlEngine.js'
import { getDatasetsMeta as loadDatasetsMeta, saveDatasetMeta, renameDataset as renameStoredDataset, deleteDataset as deleteStoredDataset, saveLinks as persistLinks } from './datasetStore.js'
import { saveDatasetRows, loadDatasetRows, deleteDatasetRows, listDatasetIds, deleteOrphanRows } from './indexedDbStore.js'
import { applySteps } from './CleanPanel.jsx'
import { saveHistory } from './schedule.js'
import { SAMPLE_CSV } from './sampleData.js'

// 批量导入限额：单文件 50MB / 50 万行；合并结果 100 万行（超限自动抽样）
const MAX_BATCH_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_FILE_ROWS = 500000
const MAX_MERGE_ROWS = 1000000

// 模块级可变引用（非渲染状态）：流式解析中止控制器
let streamAbortRef = null

// 解析失败文件 → 带 error 标记的元数据卡片（不阻断其它文件）
function makeErrDataset(file, msg) {
  const now = new Date().toISOString()
  const meta = saveDatasetMeta({
    name: file.name.replace(/\.(csv|xlsx|xls|json|txt|log)$/i, ''),
    source: file.name,
    rows: 0, cols: 0, colNames: [],
    error: msg,
    createdAt: now,
  })
  return { id: meta.id, meta, table: null }
}

// 规则式 SQL 生成（无 LLM 时的降级：关键词 → 简单 SELECT，SQL 闭环始终可用）
function ruleSQL(question, schema) {
  const cols = schema.columns || []
  const measures = cols.filter(c => c.semantic === 'measure')
  const dims = cols.filter(c => c.semantic === 'dimension')
  const times = cols.filter(c => c.semantic === 'time')
  if (!measures.length) return null
  const m = measures[0].name
  const op = /平均|均值|avg/i.test(question) ? 'AVG' : /最大|最高|max/i.test(question) ? 'MAX' : /最小|最低|min/i.test(question) ? 'MIN' : 'SUM'
  const dim = dims[0]
  const t = times[0]
  let sql, explanation, chartHint
  if (dim) {
    const orderDesc = /最高|最大|最多|最少|最低|前|top/i.test(question)
    sql = `SELECT ${dim.name} AS ${dim.name}, ${op}(${m}) AS ${m} FROM t GROUP BY ${dim.name} ORDER BY 2 ${orderDesc ? 'DESC' : 'ASC'}${orderDesc ? ' LIMIT 10' : ''}`
    explanation = `规则引擎生成：按「${dim.name}」分组统计 ${m} 的 ${op}${orderDesc ? '（降序前 10）' : ''}`
    chartHint = 'bar'
  } else if (t) {
    sql = `SELECT ${t.name} AS ${t.name}, ${op}(${m}) AS ${m} FROM t GROUP BY ${t.name} ORDER BY 1${/趋势/.test(question) ? ' LIMIT 30' : ''}`
    explanation = `规则引擎生成：按「${t.name}」分组的 ${m} ${op} 趋势`
    chartHint = 'line'
  } else {
    sql = `SELECT ${op}(${m}) AS ${m} FROM t`
    explanation = `规则引擎生成：${m} 的 ${op}`
    chartHint = 'none'
  }
  return { sql, explanation, chartHint }
}

// Text-to-SQL 结果 → 简单图表（chartHint 决定类型，数据来自执行结果）
function sqlChart(exec, hint) {
  if (!exec || !exec.rows.length || !exec.columns.length) return null
  const cols = exec.columns.map(c => c.name)
  const cats = exec.rows.map(r => String(r[cols[0]] ?? ''))
  const numCol = cols.slice(1).find(n => exec.rows.some(r => !isNaN(parseFloat(r[n])))) || cols[0]
  const vals = exec.rows.map(r => { const v = parseFloat(r[numCol]); return isNaN(v) ? 0 : v })
  if (hint === 'none') return null
  const t = hint === 'line' ? 'line' : 'bar'
  return {
    id: 'sql_chart_' + Date.now(), title: `${cols[0]} · ${numCol}`, type: t, manual: true,
    option: t === 'line' ? lineOption(cats, vals, numCol) : barOption(cats, vals, numCol),
    caliber: '口径：SQL 结果由内存 SQL 引擎真实执行后绘制。',
  }
}

export const useStore = create((set, get) => ({
  // ---------- 状态字段 ----------
  view: 'home', // home|upload|dashboard|chart|quality|report|schedule|settings
  table: null,
  result: null,
  quality: null,
  fileName: '',
  baseTable: null,
  baseFileName: '',
  joinInfo: null, // { subName, mainKey, subKey, cols, mode, matched, total }
  uploadTab: 'file',
  joinDraft: null, // { subTable, subFile, mainKey, subKey, keepCols, mode }
  datasets: [], // [{ id, meta, table|null }]
  selectedIds: [],
  autoLinks: [],
  linkExcludes: {}, // `${fromId}->${toId}` → true：在 auto 模式下排除该自动关联
  mergeMeta: null, // { mode, names, links, matched, total, warnings, summary }
  batchBusy: '',
  selectedChart: null,
  theme: (() => { try { return localStorage.getItem('data-agent.theme') || 'system' } catch { return 'system' } })(),
  appliedTheme: 'light',
  activeFilters: [], // [{ dim, values: [...] }]
  baseResult: null, // 未筛选时的分析结果，用于重置
  chatOpen: false,
  chat: [],
  reportHTML: '',
  loading: false,
  aiMode: 'mock', // mock|llm
  toast: '',
  previewDs: null, // { id, meta, table|null }
  idbRestoring: false, // 启动时 IndexedDB 行恢复进行中
  toolboxOpen: false,
  templateOpen: false,
  streamState: null, // { fileName, rows, totalRaw, phase: 'parsing'|'done' }
  cleanOpen: false,
  cleanSteps: [], // 清洗预填步骤（来自一键修复）
  cleanHistory: [], // [{name, before}] 逐级回退栈
  cleanNames: [], // 当前清洗链名称（用于回退显示）

  // ---------- 基础 setter（供视图直接回调） ----------
  setView: (v) => set({ view: v }),
  setUploadTab: (v) => set({ uploadTab: v }),
  setJoinDraft: (v) => set({ joinDraft: v }),
  setChatOpen: (v) => set({ chatOpen: v }),
  setTheme: (v) => set({ theme: v }),
  setAppliedTheme: (v) => set({ appliedTheme: v }),
  setSelectedChart: (v) => set({ selectedChart: v }),
  setResult: (v) => set({ result: v }),
  setToolboxOpen: (v) => set({ toolboxOpen: v }),
  setTemplateOpen: (v) => set({ templateOpen: v }),
  setCleanOpen: (v) => set({ cleanOpen: v }),
  setCleanSteps: (v) => set({ cleanSteps: v }),

  // 顶部返回按钮逻辑（原内联 onClick）
  navBack: () => {
    const { view, baseTable, mergeMeta, setView, setUploadTab } = get()
    if (view === 'preview') setView('upload')
    else if (['chart', 'quality', 'report', 'schedule', 'settings'].includes(view)) setView('dashboard')
    else if (view === 'dashboard' && (baseTable || mergeMeta)) { setUploadTab('file'); setView('upload') }
    else setView('home')
  },

  // ---------- 提示条 ----------
  showToast: (msg) => {
    set({ toast: msg })
    setTimeout(() => set({ toast: '' }), 4000)
  },

  // ---------- 核心分析流水线 ----------
  runPipeline: async (t, name, base = true, extra = {}) => {
    set({ loading: true })
    try {
      if (base) set({ baseTable: t, baseFileName: name, joinInfo: null })
      const q = qualityCheck(t)
      let a = null
      let mode = 'mock'
      if (isLLMConfigured()) {
        // LLM 规划图表 → 引擎真实计算执行
        const planRes = await withLLMFallback(() => planAnalysis(schemaSummaryFor(t)), () => null)
        if (planRes.mode === 'llm' && planRes.value) {
          a = analyzeByPlan(t, planRes.value)
          if (a) mode = 'llm'
        }
        // LLM 润色结论（只引用已算好的统计量）
        if (a) {
          const narrRes = await withLLMFallback(() => narrateInsights(buildStatSummary(t, a, q)), () => null)
          if (narrRes.mode === 'llm' && narrRes.value && narrRes.value.length) {
            a = { ...a, insights: narrRes.value.slice(0, 6) }
          }
        } else if (planRes.mode === 'mock' && planRes.reason && planRes.reason !== '未配置') {
          get().showToast('LLM 不可用（' + planRes.reason.slice(0, 60) + '），已降级规则引擎')
        }
      }
      if (!a) a = analyze(t)
      const finalA = extra.charts && extra.charts.length ? { ...a, charts: [...extra.charts, ...a.charts] } : a
      set({ table: t, quality: q, result: finalA, baseResult: finalA, activeFilters: [], fileName: name, aiMode: mode, view: 'dashboard' })
    } finally {
      set({ loading: false })
    }
  },

  // ---------- 交叉筛选（cross-filter 联动重算） ----------
  toggleFilterValue: (dim, value) => set(s => {
    const prev = s.activeFilters
    const existing = prev.find(f => f.dim === dim)
    if (!existing) return { activeFilters: [...prev, { dim, values: [value] }] }
    const has = existing.values.includes(value)
    const newValues = has ? existing.values.filter(x => x !== value) : [...existing.values, value]
    return { activeFilters: prev.map(f => f.dim === dim ? { ...f, values: newValues } : f).filter(f => f.values.length) }
  }),
  clearFilters: () => set({ activeFilters: [] }),
  removeFilterDim: (dim) => set(s => ({ activeFilters: s.activeFilters.filter(f => f.dim !== dim) })),
  handleChartDrill: (chart, label) => {
    const { table, toggleFilterValue } = get()
    if (!chart || !chart.drillDim || !label) return
    const raw = matchDrillValue(table, chart.drillDim, label)
    toggleFilterValue(chart.drillDim, raw)
  },

  // ---------- 数据集原始行落盘（fire-and-forget） ----------
  persistDataset: (id, table) => {
    if (!id || !table) return
    saveDatasetRows(id, table.columns, table.rows).catch(() => { /* 静默降级：IDB 失败仅存 meta */ })
  },

  // 启动后从 IndexedDB 恢复各数据集原始行：逐表恢复并让出主线程；
  // 全部完成后若任一恢复则惰性重算关联；最后清理 IDB 中的孤儿块
  restoreDatasetsFromIdb: async (metas) => {
    const list = (metas || []).map(m => ({ id: m.id, meta: m, table: null }))
    set({ idbRestoring: true })
    let restoredAny = false
    try {
      for (let i = 0; i < list.length; i++) {
        const m = list[i].meta
        if (m.error) continue
        try {
          const loaded = await loadDatasetRows(m.id)
          if (loaded) {
            list[i] = { ...list[i], table: { columns: loaded.columns, rows: loaded.rows }, restoredFromIdb: true }
            restoredAny = true
            set(s => ({ datasets: s.datasets.map(d => d.id === m.id ? { ...d, table: list[i].table, restoredFromIdb: true } : d) }))
          }
        } catch (e) { /* 单表恢复失败忽略，卡片保持仅元数据态 */ }
        await new Promise(r => setTimeout(r, 0)) // 每表间让出主线程
      }
      if (restoredAny) get().recomputeLinks(list) // 用重建后的 list 惰性重算，避免闭包拿到空 datasets
      const idbIds = await listDatasetIds()
      const keepIds = (metas || []).map(m => m.id)
      await deleteOrphanRows(idbIds.filter(id => !keepIds.includes(id)))
    } catch (e) { /* 恢复整体异常静默，不阻断应用 */ } finally {
      set({ idbRestoring: false })
    }
  },

  // 启动：加载持久化的数据集元数据与关联关系，并异步从 IndexedDB 恢复数据行（不阻塞 UI）
  initFromStorage: () => {
    const stored = loadDatasetsMeta()
    const metas = stored.datasets || []
    set({ datasets: metas.map(m => ({ id: m.id, meta: m, table: null })), autoLinks: stored.links || [] })
    get().restoreDatasetsFromIdb(metas)
  },

  // 预览页：从工作台卡片进入虚拟滚动表格预览
  openPreview: (id) => {
    const d = get().datasets.find(x => x.id === id)
    if (!d) return
    if (!d.table) { alert(`数据集「${d.meta.name}」暂无数据可预览，请重新导入后再试`); return }
    set({ previewDs: { id: d.id, meta: d.meta, table: d.table }, view: 'preview' })
  },
  closePreview: () => set({ previewDs: null, view: 'upload' }),

  // 单文件导入（含大文件流式 / 日志 / 普通解析三条路径）
  handleFile: async (file) => {
    try {
      set({ joinDraft: null, uploadTab: 'file' }) // 新主表：清空关联草稿
      let t
      if (file._table) { // API 拉取已完成解析
        t = file._table
      } else {
        const lower = file.name.toLowerCase()
        if ((lower.endsWith('.csv') || lower.endsWith('.txt')) && file.size > 8 * 1024 * 1024) {
          const ctrl = new AbortController()
          streamAbortRef = ctrl
          set({ streamState: { fileName: file.name, rows: 0, totalRaw: 0, phase: 'parsing' } })
          let streamed
          try {
            streamed = await parseStreamFile(file, {
              maxRows: 200000,
              onProgress: p => set(s => s.streamState && ({ ...s.streamState, rows: p.rows, totalRaw: p.totalRaw, phase: 'parsing' })),
              signal: ctrl.signal,
            })
          } finally {
            streamAbortRef = null
          }
          t = { columns: streamed.columns, rows: streamed.rows }
          set({ streamState: { fileName: file.name, rows: streamed.rows.length, totalRaw: streamed.totalRows, phase: 'done' } })
          if (streamed.sampled || streamed.truncated) {
            get().showToast(`已流式处理 ${(streamed.totalRows || streamed.rows.length).toLocaleString('zh-CN')} 行，预览基于前 ${streamed.rows.length.toLocaleString('zh-CN')} 行采样`)
          }
          setTimeout(() => set({ streamState: null }), 1500) // 完成后短暂展示，再收起
        } else if (lower.endsWith('.log') || lower.endsWith('.txt')) {
          t = await parseLogFile(file)
          if (t._mode === '原始行') get().showToast('日志未识别出结构化字段，已按原始行展示')
        } else {
          t = await parseFile(file)
        }
      }
      if (!t.rows.length) throw new Error('未解析到数据行')
      const baseName = file.name.replace(/\.(csv|xlsx|xls|json|txt|log)$/i, '')
      const now = new Date().toISOString()
      const existing = get().datasets.find(d => d.meta.source === file.name && !d.table)
      const meta = existing
        ? saveDatasetMeta({ id: existing.id, name: baseName, source: file.name, rows: t.rows.length, cols: t.columns.length, colNames: t.columns.map(c => c.name), createdAt: existing.meta.createdAt })
        : saveDatasetMeta({ name: baseName, source: file.name, rows: t.rows.length, cols: t.columns.length, colNames: t.columns.map(c => c.name), createdAt: now })
      get().persistDataset(meta.id, t)
      set(s => {
        const exists = s.datasets.some(d => d.id === meta.id)
        const card = { id: meta.id, meta, table: t }
        return { datasets: exists ? s.datasets.map(d => d.id === meta.id ? card : d) : [...s.datasets, card] }
      })
      get().runPipeline(t, file.name)
    } catch (e) { alert('解析失败：' + e.message) }
  },

  handleSample: () => {
    const t = parseCSVText(SAMPLE_CSV)
    set({ joinDraft: null, uploadTab: 'file' })
    get().runPipeline(t, '示例-区域月度销售.csv')
  },

  // 多表关联：先用预览校验，再按键合并（始终基于 baseTable，不链式叠加），失败时 inline 提示不阻断
  handleJoin: (main, sub, mainKey, subKey, cols, mode, subFileName) => {
    const pv = previewJoin(main, sub, mainKey, subKey)
    if (mode === 'inner' && pv.rate === 0) {
      get().showToast('关联键没有匹配到任何行：请检查关联键选择，或改用「左连接」')
      return
    }
    const joined = joinTables(main, sub, mainKey, subKey, cols, mode)
    if (!joined.rows.length) { get().showToast('关联后没有匹配行，请检查关联键或改用左连接'); return }
    const subName = (subFileName || '维度表').replace(/\.(csv|xlsx|xls|json)$/i, '')
    set({ joinInfo: { subName, mainKey, subKey, cols, mode, matched: pv.matched, total: pv.total } })
    get().runPipeline(joined, `${get().baseFileName || '主表'}＋${subName}（关联分析）`, false)
    get().showToast(`关联成功：${pv.matched}/${pv.total} 行匹配，合并 ${joined.columns.length - main.columns.length} 个字段`)
  },

  // 撤销关联：回到原始主表重新分析（关联草稿保留，便于再次关联）
  handleUndoJoin: () => {
    const { baseTable, baseFileName } = get()
    if (!baseTable) return
    set({ joinInfo: null })
    get().runPipeline(baseTable, baseFileName, true)
    get().showToast('已撤销关联，回到原始主表分析')
  },

  // ---------- 数据集工作台：勾选 / 批量导入 / 自动关联 / 联合分析 ----------
  handleToggleSelect: (id) => {
    const d = get().datasets.find(x => x.id === id)
    if (!d) return
    if (!d.table) { alert(`数据集「${d.meta.name}」仅存元数据，请重新导入后再参与分析`); return }
    set(s => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter(x => x !== id) : [...s.selectedIds, id] }))
  },

  // 根据当前数据集重算自动关联（list 缺省时用 state 中的 datasets）
  recomputeLinks: (list) => {
    const { datasets, linkExcludes } = get()
    const src = list || datasets
    const withData = src.filter(d => d.table)
    let links = []
    if (withData.length >= 2) {
      links = detectLinks(withData.map(d => ({ id: d.id, name: d.meta.name, columns: d.table.columns, rows: d.table.rows })))
    }
    if (linkExcludes && Object.keys(linkExcludes).length) {
      links = links.filter(l => !linkExcludes[`${l.fromId}->${l.toId}`] && !linkExcludes[`${l.toId}->${l.fromId}`])
    }
    set({ autoLinks: links })
    persistLinks(links)
    return links
  },

  // 手动排除/恢复某条自动关联（auto 模式生效）：写入排除集后重算 autoLinks
  excludeLink: (fromId, toId) => {
    const k1 = `${fromId}->${toId}`, k2 = `${toId}->${fromId}`
    set(s => ({ linkExcludes: { ...s.linkExcludes, [k1]: true, [k2]: true } }))
    get().recomputeLinks(get().datasets)
  },
  includeLink: (fromId, toId) => {
    const k1 = `${fromId}->${toId}`, k2 = `${toId}->${fromId}`
    set(s => { const n = { ...s.linkExcludes }; delete n[k1]; delete n[k2]; return { linkExcludes: n } })
    get().recomputeLinks(get().datasets)
  },

  // 顺序解析多个文件：超限跳过/截断；同名「仅元数据」卡片升级；解析失败不阻断其它文件
  handleBatchFiles: async (files) => {
    const arr = Array.from(files || [])
    if (!arr.length) return
    set({ batchBusy: `正在解析 0/${arr.length} …` })
    const added = []
    let failed = 0
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i]
      set({ batchBusy: `正在解析 ${i + 1}/${arr.length}：${file.name}` })
      try {
        if (file.size > MAX_BATCH_FILE_BYTES) {
          failed++
          added.push(makeErrDataset(file, '超过 50MB 限制，已跳过'))
          continue
        }
        const lower = file.name.toLowerCase()
        let t
        if (lower.endsWith('.log') || lower.endsWith('.txt')) {
          t = await parseLogFile(file)
          if (t._mode === '原始行') get().showToast(`「${file.name}」未识别出结构化字段，已按原始行展示`)
        } else {
          t = await parseFile(file)
        }
        if (!t.rows.length) throw new Error('未解析到数据行')
        if (t.rows.length > MAX_BATCH_FILE_ROWS) {
          t = { ...t, rows: t.rows.slice(0, MAX_BATCH_FILE_ROWS) }
          get().showToast(`「${file.name}」超过 ${MAX_BATCH_FILE_ROWS.toLocaleString('zh-CN')} 行，已截取前 ${MAX_BATCH_FILE_ROWS.toLocaleString('zh-CN')} 行`)
        }
        const baseName = file.name.replace(/\.(csv|xlsx|xls|json|txt|log)$/i, '')
        const now = new Date().toISOString()
        const existing = get().datasets.find(d => d.meta.source === file.name && !d.table)
        const meta = existing
          ? saveDatasetMeta({ id: existing.id, name: baseName, source: file.name, rows: t.rows.length, cols: t.columns.length, colNames: t.columns.map(c => c.name), createdAt: existing.meta.createdAt })
          : saveDatasetMeta({ name: baseName, source: file.name, rows: t.rows.length, cols: t.columns.length, colNames: t.columns.map(c => c.name), createdAt: now })
        get().persistDataset(meta.id, t) // 原始行落盘（fire-and-forget，不阻塞批量导入）
        added.push({ id: meta.id, meta, table: t })
      } catch (e) {
        failed++
        added.push(makeErrDataset(file, e.message))
      }
    }
    set({ batchBusy: '' })
    const addedIds = new Set(added.map(d => d.id))
    const next = [...get().datasets.filter(d => !addedIds.has(d.id)), ...added]
    set({ datasets: next })
    if (added.some(d => d.table)) get().recomputeLinks(next)
    if (failed) get().showToast(`导入完成：${added.length - failed} 个成功，${failed} 个失败（已在卡片标记）`)
    else get().showToast(`已导入 ${added.length} 个数据集`)
  },

  runSingleAnalysis: (id) => {
    const d = get().datasets.find(x => x.id === id)
    if (!d) return
    if (!d.table) { alert(`数据集「${d.meta.name}」仅存元数据，请重新导入后再分析`); return }
    set({ mergeMeta: null })
    get().runPipeline(d.table, d.meta.name, true)
  },

  // ---------- 分析工具箱：手动生成图表 ----------
  handleManualGenerate: (spec) => {
    const { table } = get()
    if (!table) return
    const chart = manualChart(table, spec)
    if (!chart) { get().showToast('所选参数无法生成图表：请检查时间列/度量列/维度列是否有效'); return }
    set(s => (s.result ? { result: { ...s.result, charts: [...s.result.charts, chart] } } : {}))
    set({ toolboxOpen: false })
    get().showToast('已生成「' + chart.title + '」并加入图表画廊')
  },

  // 模板库：应用模板（spec 已按语义角色映射到当前表）→ 生成图表 + 恢复筛选
  handleTemplateApply: (spec, filters) => {
    const { table } = get()
    if (!table) return
    const chart = spec ? manualChart(table, spec) : null
    if (chart) {
      set(s => (s.result ? { result: { ...s.result, charts: [...s.result.charts, chart] } } : {}))
      get().showToast('已生成「' + chart.title + '」并加入图表画廊')
    } else {
      get().showToast('模板应用后无法生成图表：参数与当前数据不匹配')
    }
    if (filters && filters.length) set({ activeFilters: filters })
    set({ templateOpen: false })
  },

  // ---------- 数据清洗：应用组合操作 → 重跑质量分与分析 → 可逐级回退 ----------
  openClean: (steps) => set({ cleanSteps: steps || [], cleanOpen: true }),
  handleCleanApply: (steps) => {
    const { table } = get()
    if (!table) return
    const newRows = applySteps(table.rows, steps)
    const names = steps.map(s => ({ fill: '填充缺失', trim: '去除空白', dedupe: '去重', outliers: '异常值' }[s.type] || s.type))
    set(s => ({ cleanHistory: [...s.cleanHistory, { name: names.join('＋'), before: table }], cleanNames: [...s.cleanNames, names.join('＋')] }))
    const newTable = { ...table, rows: newRows }
    set({ table: newTable, quality: qualityCheck(newTable), result: analyze(newTable), cleanOpen: false })
    get().showToast(`已清洗：${names.join('、')}（可回退）`)
  },
  undoClean: () => {
    const { cleanHistory } = get()
    if (!cleanHistory.length) { get().showToast('没有可回退的清洗操作'); return }
    const last = cleanHistory[cleanHistory.length - 1]
    set(s => ({ cleanHistory: s.cleanHistory.slice(0, -1), cleanNames: s.cleanNames.slice(0, -1) }))
    set({ table: last.before, quality: qualityCheck(last.before), result: analyze(last.before) })
    get().showToast(`已回退「${last.name}」`)
  },

  // 联合分析：buildMergePlan 自动决策（或按高级面板策略）→ mergeDatasets 真实合并 → runPipeline
  runMergeAnalysis: (opts = {}) => {
    const { selectedIds, datasets, autoLinks } = get()
    const ids = Array.isArray(opts.ids) ? opts.ids : selectedIds
    const sel = datasets.filter(d => ids.includes(d.id))
    if (sel.length < 2) return
    const missing = sel.find(d => !d.table)
    if (missing) { alert(`数据集「${missing.meta.name}」仅存元数据，请重新导入后再联合分析`); return }
    let plan
    if (opts.mode === 'join') {
      const main = [...sel].sort((a, b) => b.table.rows.length - a.table.rows.length)[0]
      plan = { mode: 'join', mainId: main.id, links: opts.links || [], addSourceCol: false }
    } else if (opts.mode === 'union') {
      plan = { mode: 'union', mainId: null, links: [], addSourceCol: opts.addSourceCol !== false }
    } else {
      plan = buildMergePlan(datasets, ids, autoLinks)
    }
    const { table: merged, meta } = mergeDatasets(sel, plan)
    let finalTable = merged
    let warnings = meta.warnings || []
    if (merged.rows.length > MAX_MERGE_ROWS) {
      finalTable = { ...merged, rows: sampleRows(merged.rows, MAX_MERGE_ROWS) }
      warnings = [...warnings, `合并结果超过 ${MAX_MERGE_ROWS.toLocaleString('zh-CN')} 行，已自动抽样至 ${MAX_MERGE_ROWS.toLocaleString('zh-CN')} 行`]
    }
    const names = sel.map(d => d.meta.name)
    set({ mergeMeta: { ...meta, warnings, names, mode: plan.mode, summary: mergeSummary(finalTable) } })
    let extraCharts = []
    if (plan.mode === 'union') {
      const cmp = compareAcrossTables(sel, ids)
      if (cmp) {
        extraCharts = [
          { id: 'merge_bar_' + cmp.measure, title: `多数据集对比：${cmp.measure} 均值/合计`, type: 'bar', option: cmp.bar, caliber: `口径：对每个数据集真实计算「${cmp.measure}」均值与合计。` },
          { id: 'merge_line_' + cmp.measure, title: `多数据集对比：${cmp.measure} 均值`, type: 'line', option: cmp.line, caliber: `口径：对每个数据集真实计算「${cmp.measure}」均值连线。` },
        ]
      }
    }
    get().runPipeline(finalTable, `联合分析（${sel.length} 个数据集）`, false, { charts: extraCharts })
  },

  removeDataset: (id) => {
    const d = get().datasets.find(x => x.id === id)
    if (!d) return
    if (!window.confirm(`删除数据集「${d.meta.name}」？将同时清除其元数据与关联关系。`)) return
    deleteStoredDataset(id)
    deleteDatasetRows(id).catch(() => { /* IDB 行清理失败静默 */ })
    const next = get().datasets.filter(x => x.id !== id)
    set({ datasets: next, selectedIds: get().selectedIds.filter(x => x !== id) })
    get().recomputeLinks(next)
  },

  renameDataset: (id, name) => {
    renameStoredDataset(id, name)
    set(s => ({
      datasets: s.datasets.map(x => x.id === id ? { ...x, meta: { ...x.meta, name } } : x),
      autoLinks: s.autoLinks.map(l => {
        if (l.fromId === id) return { ...l, fromName: name }
        if (l.toId === id) return { ...l, toName: name }
        return l
      }),
    }))
  },

  // 撤销联合分析：清空 banner；若存在原主表则回到原主表（对齐撤销关联模式）
  undoMerge: () => {
    const { baseTable, baseFileName } = get()
    set({ mergeMeta: null })
    if (baseTable) {
      get().runPipeline(baseTable, baseFileName, true)
      get().showToast('已撤销联合分析，回到原主表分析')
    } else {
      get().showToast('已撤销联合分析')
    }
  },

  backToWorkbench: () => set({ uploadTab: 'file', view: 'upload' }),
  openJoin: () => set({ uploadTab: 'join', view: 'upload' }),
  openUpload: () => set({ uploadTab: 'file', view: 'upload' }),

  // 追问（对话式分析）：LLM 意图/Text-to-SQL → 引擎真实计算；无 LLM 降级规则 SQL + 规则问答
  sendQuestion: async (text) => {
    if (!text.trim() || !get().table) return
    set(s => ({ chat: [...s.chat, { role: 'user', text }] }))
    let ans = null
    if (isLLMConfigured()) {
      const res = await withLLMFallback(() => parseQuestion(schemaSummaryFor(get().table), text), () => null)
      if (res.mode === 'llm' && res.value) {
        ans = executeIntent(get().table, res.value) // 数字由引擎真实计算
        if (ans) ans = { ...ans, llm: true }
      }
      if (!ans || !ans.chart) {
        try {
          const tbl = (get().fileName || 't').replace(/\.(csv|xlsx|xls|json|txt|log)$/i, '').replace(/[^A-Za-z0-9_\u4e00-\u9fa5]/g, '_') || 't'
          const sqlRes = await withLLMFallback(() => textToSQL({ ...schemaSummaryFor(get().table), tableName: tbl }, text), () => null)
          if (sqlRes.mode === 'llm' && sqlRes.value && sqlRes.value.sql) {
            const guard = validateSQL(sqlRes.value.sql, inferSchema(get().table))
            if (guard.ok) {
              const exec = await executeSQL(get().table, guard.sql)
              if (exec.columns.length) {
                ans = {
                  text: (sqlRes.value.explanation || '查询完成') + `（结果 ${exec.rows.length} 行${exec.truncated ? '，已截断' : ''}）`,
                  table: { head: exec.columns.map(c => c.name), rows: exec.rows.map(r => exec.columns.map(c => String(r[c.name] ?? ''))) },
                  sql: guard.sql,
                  chart: sqlChart(exec, sqlRes.value.chartHint),
                  caliber: '口径：SQL 由 LLM 生成文本，结果由内存 SQL 引擎（alasql）真实执行。',
                }
              } else { ans = { text: '查询执行成功但未返回列', sql: guard.sql } }
            } else {
              ans = { text: 'SQL 校验未通过：' + guard.error, sql: sqlRes.value.sql }
            }
          }
        } catch (e) { /* 降级规则 SQL */ }
      }
    }
    // 规则式 SQL 降级：未配置 LLM 或 LLM 失败时，用关键词规则生成 SELECT（SQL 闭环始终可用）
    if (!ans || !ans.chart) {
      try {
        const gen = ruleSQL(text, inferSchema(get().table))
        if (gen) {
          const guard = validateSQL(gen.sql, inferSchema(get().table))
          if (guard.ok) {
            const exec = await executeSQL(get().table, guard.sql)
            if (exec.columns.length) {
              ans = {
                text: gen.explanation + `（结果 ${exec.rows.length} 行${exec.truncated ? '，已截断' : ''}）`,
                table: { head: exec.columns.map(c => c.name), rows: exec.rows.map(r => exec.columns.map(c => String(r[c.name] ?? ''))) },
                sql: guard.sql,
                chart: sqlChart(exec, gen.chartHint),
                caliber: '口径：规则引擎生成 SQL，结果由内存 SQL 引擎（alasql）真实执行。',
              }
            }
          }
        }
      } catch (e) { /* 规则 SQL 失败则回退规则问答 */ }
    }
    if (!ans) ans = chatAnswer(get().table, text)
    set(s => ({ chat: [...s.chat, { role: 'bot', text: ans.text, chart: ans.chart, table: ans.table, sql: ans.sql, caliber: ans.caliber }] }))
  },

  openChart: (c) => set({ selectedChart: c, view: 'chart' }),
  openReport: async () => {
    const { table, result, quality } = get()
    if (table && result && quality) { set({ reportHTML: await exportReportHTML(table, result, quality), view: 'report' }) }
  },
  downloadReport: () => {
    const { reportHTML, fileName } = get()
    const blob = new Blob([reportHTML], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `数据分析报告_${fileName || 'export'}.html`; a.click()
    URL.revokeObjectURL(url)
  },

  // 调度：用当前会话数据试跑并生成报告 + 把问题作为追问跑一遍
  runSchedule: async (sch) => {
    const { table } = get()
    if (!table) { alert('试跑需要先在当前会话加载数据（调度绑定当前数据集）。'); return }
    get().openReport()
    if (Array.isArray(sch.questions) && sch.questions.length) {
      for (const q of sch.questions) {
        // eslint-disable-next-line no-await-in-loop
        await get().sendQuestion(q)
      }
      set({ chatOpen: true })
      get().showToast(`已试跑 ${sch.questions.length} 个问题，回答已加入对话`)
    } else {
      get().showToast(`已用当前引擎试跑「${sch.name}」，报告见预览`)
    }
  },

  // 后台定时真实跑批（演示级）：到点用当前引擎跑一次并把报告/回答入库，可选浏览器通知
  executeScheduleSilent: async (sch) => {
    const { table, result, quality } = get()
    if (!table || !result || !quality) {
      saveHistory({ id: 'h_' + Date.now(), name: sch.name, time: new Date().toISOString(), status: 'skipped', note: '会话未加载数据，跳过本次触发' })
      return
    }
    try {
      const html = await exportReportHTML(table, result, quality)
      const answers = (sch.questions || []).map(q => ({ q, a: chatAnswer(table, q).text }))
      saveHistory({
        id: 'h_' + Date.now(), name: sch.name, time: new Date().toISOString(),
        status: 'done', htmlLen: html.length,
        answers: answers.slice(0, 8),
        caliber: `共 ${result.charts.length} 张图、${result.insights.length} 条结论`,
      })
      get().notifySchedule(`定时调度「${sch.name}」已自动生成报告（含 ${answers.length} 个问题的真实回答）`)
    } catch (e) {
      saveHistory({ id: 'h_' + Date.now(), name: sch.name, time: new Date().toISOString(), status: 'error', note: String((e && e.message) || e) })
    }
  },
  notifySchedule: (msg) => {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('数据分析 Agent', { body: msg })
      }
    } catch {}
    get().showToast(msg)
  },

  cancelStream: () => { if (streamAbortRef) streamAbortRef.abort() },
}))

export { makeErrDataset, ruleSQL, sqlChart }
