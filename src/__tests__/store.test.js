// 状态层（Zustand store）单测：覆盖筛选联动、数据集工作台、分析流水线与对话降级路径
// 迁移自原 App.jsx 的 useState/handler 行为，作为 P1-2 状态层抽离的回归保护网
import { describe, it, expect, beforeEach, vi } from 'vitest'

// node 测试环境无 localStorage：在模块求值前注入内存实现（store 主题初始化与 datasetStore 持久化需要）
vi.hoisted(() => {
  const mem = {}
  globalThis.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v) },
    removeItem: k => { delete mem[k] },
  }
  globalThis.alert = vi.fn()
  globalThis.window = { confirm: () => true }
})

import { useStore } from '../store.js'
import { parseCSVText } from '../engine.js'

// 12 行样本（4 区域 × 3 月）：行数/基数足够让 inferSchema 将销售额判为 measure
const regions = ['华东', '华南', '华北', '西南']
const mainCsv = '日期,区域,销售额,订单数\n' + Array.from({ length: 12 }, (_, i) =>
  `2024-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')},${regions[i % 4]},${100 + i * 37},${i + 1}`).join('\n')
const T = parseCSVText(mainCsv)
const T2 = parseCSVText('区域,人口\n' + regions.map((r, i) => `${r},${1000 + i * 500}`).join('\n'))
// 与 T 共享「销售额」度量（≥12 行 → 数值列判为 measure），供联合对比图断言
const Tm = parseCSVText('区域,销售额\n' + Array.from({ length: 12 }, (_, i) => `${regions[i % 4]},${500 + i * 37}`).join('\n'))

beforeEach(() => {
  useStore.setState({
    view: 'home', table: null, result: null, quality: null, fileName: '',
    baseTable: null, baseFileName: '', joinInfo: null, joinDraft: null,
    datasets: [], selectedIds: [], autoLinks: [], linkExcludes: {}, mergeMeta: null,
    activeFilters: [], baseResult: null, chat: [], chatOpen: false, toast: '',
    loading: false, aiMode: 'mock', cleanHistory: [], cleanNames: [],
  })
})

describe('交叉筛选状态（activeFilters）', () => {
  it('toggleFilterValue 新增维度筛选，再次切换同值则移除', () => {
    const s = useStore.getState()
    s.toggleFilterValue('地区', '华东')
    expect(useStore.getState().activeFilters).toEqual([{ dim: '地区', values: ['华东'] }])
    s.toggleFilterValue('地区', '华北')
    expect(useStore.getState().activeFilters).toEqual([{ dim: '地区', values: ['华东', '华北'] }])
    s.toggleFilterValue('地区', '华北') // 已选中 → 取消，values 变 ['华东']
    expect(useStore.getState().activeFilters).toEqual([{ dim: '地区', values: ['华东'] }])
    s.toggleFilterValue('地区', '华东') // 全部取消 → 该维度筛选整体移除
    expect(useStore.getState().activeFilters).toEqual([])
  })

  it('多维度筛选独立维护；removeFilterDim 只删指定维度；clearFilters 清空', () => {
    const s = useStore.getState()
    s.toggleFilterValue('地区', '华东')
    s.toggleFilterValue('渠道', '线上')
    expect(useStore.getState().activeFilters.length).toBe(2)
    s.removeFilterDim('地区')
    expect(useStore.getState().activeFilters).toEqual([{ dim: '渠道', values: ['线上'] }])
    s.clearFilters()
    expect(useStore.getState().activeFilters).toEqual([])
  })

  it('handleChartDrill 将图表类目值加入筛选（cross-filter）', () => {
    useStore.setState({ table: T })
    const chart = { drillDim: '区域' }
    useStore.getState().handleChartDrill(chart, '华北')
    expect(useStore.getState().activeFilters).toEqual([{ dim: '区域', values: ['华北'] }])
  })
})

describe('数据集工作台', () => {
  it('handleToggleSelect 勾选/取消；无数据表时提示且不勾选', () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '主表' }, table: T }, { id: 'b', meta: { name: '空表' }, table: null }] })
    const s = useStore.getState()
    s.handleToggleSelect('a')
    expect(useStore.getState().selectedIds).toEqual(['a'])
    s.handleToggleSelect('a')
    expect(useStore.getState().selectedIds).toEqual([])
    s.handleToggleSelect('b') // 仅元数据 → alert 且不勾选
    expect(globalThis.alert).toHaveBeenCalled()
    expect(useStore.getState().selectedIds).toEqual([])
  })

  it('recomputeLinks 依据同名同值列自动发现关联', () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '主表' }, table: T }, { id: 'b', meta: { name: '维度表' }, table: T2 }], linkExcludes: {} })
    const links = useStore.getState().recomputeLinks()
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0].fromKey === '区域' || links[0].toKey === '区域').toBe(true)
    expect(useStore.getState().autoLinks).toEqual(links)
  })

  it('excludeLink 将双向键写入排除集并从 autoLinks 剔除；includeLink 恢复', () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '主表' }, table: T }, { id: 'b', meta: { name: '维度表' }, table: T2 }], linkExcludes: {} })
    const links = useStore.getState().recomputeLinks()
    expect(links.length).toBeGreaterThanOrEqual(1)
    const l = links[0]
    useStore.getState().excludeLink(l.fromId, l.toId)
    expect(useStore.getState().linkExcludes[`${l.fromId}->${l.toId}`]).toBe(true)
    expect(useStore.getState().linkExcludes[`${l.toId}->${l.fromId}`]).toBe(true)
    expect(useStore.getState().autoLinks.some(x => x.fromId === l.fromId && x.toId === l.toId)).toBe(false)
    useStore.getState().includeLink(l.fromId, l.toId)
    expect(useStore.getState().autoLinks.some(x => x.fromId === l.fromId && x.toId === l.toId)).toBe(true)
  })
})

describe('分析流水线（mock 路径，未配置 LLM）', () => {
  it('runPipeline 计算质量分与分析结果并跳转看板', async () => {
    await useStore.getState().runPipeline(T, '测试表.csv')
    const s = useStore.getState()
    expect(s.table).toBe(T)
    expect(s.quality).toBeTruthy()
    expect(s.result).toBeTruthy()
    expect(s.result.charts.length).toBeGreaterThan(0)
    expect(s.baseResult).toBe(s.result)
    expect(s.activeFilters).toEqual([])
    expect(s.fileName).toBe('测试表.csv')
    expect(s.aiMode).toBe('mock')
    expect(s.view).toBe('dashboard')
    expect(s.loading).toBe(false)
  })

  it('runPipeline(base=true) 重置 baseTable/joinInfo；(base=false) 保留', async () => {
    const prevBase = { columns: [{ name: 'x' }], rows: [{ x: 1 }] }
    useStore.setState({ baseTable: prevBase, baseFileName: '原表.csv', joinInfo: { subName: 's' } })
    await useStore.getState().runPipeline(T, '新表.csv', false)
    const s = useStore.getState()
    expect(s.baseTable).toBe(prevBase) // base=false：保留原主表（用于撤销关联）
    expect(s.joinInfo).toBeTruthy()
    await useStore.getState().runPipeline(T, '主表.csv', true)
    expect(useStore.getState().baseTable).toBe(T)
    expect(useStore.getState().joinInfo).toBeNull()
  })

  it('handleManualGenerate 用引擎真实计算追加图表', () => {
    useStore.setState({ table: T, result: { charts: [{ id: 'c1' }] } })
    useStore.getState().handleManualGenerate({ kind: 'topN', dimCol: '区域', measureCol: '销售额', op: 'sum', n: 10 })
    const charts = useStore.getState().result.charts
    expect(charts.length).toBe(2)
    expect(charts[1].option).toBeTruthy()
    expect(useStore.getState().toolboxOpen).toBe(false)
  })

  it('handleCleanApply 应用清洗并支持 undoClean 回退', () => {
    useStore.setState({ table: T, result: { charts: [] }, quality: { issues: [] } })
    useStore.getState().handleCleanApply([{ type: 'dedupe' }])
    const s = useStore.getState()
    expect(s.table.rows.length).toBe(T.rows.length) // 无重复行，行数不变
    expect(s.cleanHistory.length).toBe(1)
    expect(s.cleanOpen).toBe(false)
    useStore.getState().undoClean()
    expect(useStore.getState().cleanHistory.length).toBe(0)
    expect(useStore.getState().table).toBe(T)
  })
})

describe('对话式追问（规则 SQL 降级路径，未配置 LLM）', () => {
  it('sendQuestion 生成 SQL 并由内存引擎真实执行', async () => {
    useStore.setState({ table: T, fileName: '测试表.csv' })
    await useStore.getState().sendQuestion('每个区域的销售额合计是多少')
    const chat = useStore.getState().chat
    expect(chat.length).toBe(2)
    expect(chat[0]).toMatchObject({ role: 'user' })
    const bot = chat[1]
    expect(bot.role).toBe('bot')
    expect(bot.sql).toMatch(/SELECT\s/i)
    expect(bot.sql).toMatch(/销售额/)
    expect(bot.table.rows.length).toBeGreaterThan(0)
    expect(bot.chart).toBeTruthy() // 有维度列 → bar 图
  })

  it('空问题或不加载数据时不产生对话', async () => {
    await useStore.getState().sendQuestion('   ')
    expect(useStore.getState().chat.length).toBe(0)
    await useStore.getState().sendQuestion('销售额合计')
    expect(useStore.getState().chat.length).toBe(0) // 无 table
  })
})

describe('数据导入与关联编排', () => {
  it('handleFile 走 _table 直通路径：落库卡片 + 跳转看板', async () => {
    await useStore.getState().handleFile({ name: '直通表.csv', _table: T })
    const s = useStore.getState()
    expect(s.datasets.length).toBe(1)
    expect(s.datasets[0].meta.source).toBe('直通表.csv')
    expect(s.datasets[0].table).toBe(T)
    expect(s.view).toBe('dashboard')
    expect(s.fileName).toBe('直通表.csv')
  })

  it('handleJoin 预览校验 → 合并 → 记录 joinInfo 并重分析', async () => {
    useStore.setState({ baseTable: T, baseFileName: '主表.csv' })
    await useStore.getState().handleJoin(T, T2, '区域', '区域', ['人口'], 'inner', '维度表.csv')
    const s = useStore.getState()
    expect(s.joinInfo).toMatchObject({ subName: '维度表', mainKey: '区域', subKey: '区域', mode: 'inner' })
    expect(s.joinInfo.matched).toBe(12)
    expect(s.view).toBe('dashboard')
    expect(s.table.columns.some(c => c.name === '人口')).toBe(true) // 关联字段已并入
  })

  it('handleJoin inner 模式零匹配时阻断并提示', async () => {
    const T3 = parseCSVText('区域,人口\n火星,1\n月球,2')
    await useStore.getState().handleJoin(T, T3, '区域', '区域', ['人口'], 'inner', '坏表.csv')
    expect(useStore.getState().joinInfo).toBeNull()
    expect(useStore.getState().view).toBe('home')
    expect(useStore.getState().toast).toMatch(/没有匹配到任何行/)
  })

  it('handleUndoJoin 回到原主表并清空 joinInfo', async () => {
    useStore.setState({ baseTable: T, baseFileName: '主表.csv', joinInfo: { subName: 's' } })
    await useStore.getState().handleUndoJoin()
    const s = useStore.getState()
    expect(s.joinInfo).toBeNull()
    expect(s.table).toBe(T)
    expect(s.view).toBe('dashboard')
  })

  it('runSingleAnalysis 按数据集触发分析', async () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '主表' }, table: T }] })
    await useStore.getState().runSingleAnalysis('a')
    const s = useStore.getState()
    expect(s.view).toBe('dashboard')
    expect(s.fileName).toBe('主表')
    expect(s.mergeMeta).toBeNull()
  })

  it('runMergeAnalysis 联合两个数据集并产出对比图表', async () => {
    useStore.setState({
      datasets: [{ id: 'a', meta: { name: '主表' }, table: T }, { id: 'b', meta: { name: '维度表' }, table: Tm }],
      selectedIds: ['a', 'b'],
    })
    useStore.getState().recomputeLinks() // 生成 autoLinks 供 buildMergePlan 决策
    await useStore.getState().runMergeAnalysis({ mode: 'union' })
    const s = useStore.getState()
    expect(s.view).toBe('dashboard')
    expect(s.mergeMeta).toBeTruthy()
    expect(s.mergeMeta.names).toEqual(['主表', '维度表'])
    expect(s.result.charts.some(c => c.id.startsWith('merge_'))).toBe(true) // union 对比图
  })
})

describe('预览 / 删除 / 重命名 / 批量导入', () => {
  it('openPreview 无数据时提示；有数据进入预览；closePreview 返回工作台', () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '空表' }, table: null }, { id: 'b', meta: { name: '有表' }, table: T }] })
    useStore.getState().openPreview('a')
    expect(globalThis.alert).toHaveBeenCalled()
    useStore.getState().openPreview('b')
    expect(useStore.getState().previewDs).toMatchObject({ id: 'b' })
    expect(useStore.getState().view).toBe('preview')
    useStore.getState().closePreview()
    expect(useStore.getState().previewDs).toBeNull()
    expect(useStore.getState().view).toBe('upload')
  })

  it('removeDataset 移除卡片与勾选并重算关联', async () => {
    useStore.setState({
      datasets: [{ id: 'a', meta: { name: '主表' }, table: T }, { id: 'b', meta: { name: '维度表' }, table: T2 }],
      selectedIds: ['a'],
    })
    useStore.getState().recomputeLinks()
    await useStore.getState().removeDataset('a')
    const s = useStore.getState()
    expect(s.datasets.length).toBe(1)
    expect(s.selectedIds).toEqual([])
    expect(s.autoLinks.length).toBe(0) // 只剩一个数据集，关联清空
  })

  it('renameDataset 同步卡片与关联里的名称', () => {
    useStore.setState({ datasets: [{ id: 'a', meta: { name: '旧名' }, table: T }], autoLinks: [{ fromId: 'a', fromName: '旧名', toId: 'b', toName: 'x' }] })
    useStore.getState().renameDataset('a', '新名')
    const s = useStore.getState()
    expect(s.datasets[0].meta.name).toBe('新名')
    expect(s.autoLinks[0].fromName).toBe('新名')
  })

  it('handleBatchFiles 超限文件跳过并生成错误卡片；空数组无操作', async () => {
    await useStore.getState().handleBatchFiles([{ name: '巨大.csv', size: 60 * 1024 * 1024 }])
    const s = useStore.getState()
    expect(s.datasets.length).toBe(1)
    expect(s.datasets[0].meta.error).toMatch(/50MB/)
    expect(s.batchBusy).toBe('')
    expect(s.toast).toMatch(/0 个成功，1 个失败/)
    await useStore.getState().handleBatchFiles([])
    expect(useStore.getState().datasets.length).toBe(1) // 无变化
  })

  it('notifySchedule 弹提示；executeScheduleSilent 无数据时记录 skipped', async () => {
    useStore.getState().notifySchedule('定时任务完成')
    expect(useStore.getState().toast).toMatch(/定时任务完成/)
    await useStore.getState().executeScheduleSilent({ name: '日报', questions: [] }) // table 为空 → skipped
    expect(useStore.getState().toast).toMatch(/定时任务完成/) // skipped 不弹新提示
  })
})
