// 多数据集联合分析：检测关联键、纵向堆叠、按计划合并、跨表对比（真实计算；LLM 仅解释）
import { inferSchema, looksLikeId } from './schema.js'
import { isEmpty, uniq, sampleRows, toNum, avg } from './_shared.js'
import { multiBarOption, multiLineOption } from './charts.js'
import { joinTables, previewJoin } from './join.js'

// 列名归一化：去掉 _ / 空格 / 短横线，忽略大小写
function normName(s) {
  return String(s == null ? '' : s).replace(/[\s_-]+/g, '').toLowerCase()
}

function nameSim(a, b) {
  const na = normName(a), nb = normName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.7
  return 0
}

// 类型兼容：dimension ↔ dimension / text 视为兼容
function typeCompat(aCol, bCol) {
  const sa = aCol.semantic || 'text'
  const sb = bCol.semantic || 'text'
  if (sa === sb) return 1
  if ((sa === 'dimension' && sb === 'text') || (sa === 'text' && sb === 'dimension')) return 1
  return 0
}

// 取值重叠率：抽样后值集合交集/并集
function overlapRate(aVals, bVals) {
  if (!aVals.length || !bVals.length) return 0
  const setA = new Set(aVals)
  const setB = new Set(bVals)
  let inter = 0
  setA.forEach(v => { if (setB.has(v)) inter++ })
  const union = setA.size + setB.size - inter
  return union ? inter / union : 0
}

// 自动检测数据集间关联键：综合评分 = 0.35名称相似 + 0.2类型兼容 + 0.3取值重叠率 + 0.15唯一率；
// 键必须基数≥2 且非常量列；looksLikeId 加分；全局贪心去冲突（每数据集最多进一条 link）
export function detectLinks(datasets) {
  const list = (datasets || []).filter(d => d && d.rows && d.rows.length && d.columns && d.columns.length)
  const infos = list.map(d => ({ d, t: inferSchema({ columns: d.columns, rows: d.rows }) }))
  const links = []
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const a = infos[i], b = infos[j]
      const aSamples = sampleRows(a.d.rows, 20000)
      const bSamples = sampleRows(b.d.rows, 20000)
      let best = null
      for (const ac of a.t.columns) {
        for (const bc of b.t.columns) {
          const aVals = aSamples.map(r => r[ac.name]).filter(v => !isEmpty(v))
          const bVals = bSamples.map(r => r[bc.name]).filter(v => !isEmpty(v))
          const aCard = uniq(aVals).length
          const bCard = uniq(bVals).length
          if (aCard < 2 || bCard < 2) continue // 基数≥2
          const uniRate = (aCard / (aVals.length || 1) + bCard / (bVals.length || 1)) / 2
          let score = 0.35 * nameSim(ac.name, bc.name) + 0.2 * typeCompat(ac, bc) + 0.3 * overlapRate(aVals, bVals) + 0.15 * uniRate
          const aId = looksLikeId(ac.name, aVals, a.d.rows.length || 1)
          const bId = looksLikeId(bc.name, bVals, b.d.rows.length || 1)
          if (aId || bId) score += 0.05
          score = Math.min(1, score)
          if (!best || score > best.score) {
            best = { score, fromKey: ac.name, toKey: bc.name }
          }
        }
      }
      if (!best || best.score <= 0) continue
      const pv = previewJoin(a.d, b.d, best.fromKey, best.toKey)
      const sameName = normName(best.fromKey) === normName(best.toKey)
      const rate = pv.rate
      const rawScore = Math.round(best.score * 100) / 100
      // 可用性修正：匹配率为 0 的关联无实用价值，低匹配率打折（避免同名但取值零重叠的字段被标为高置信度）
      const usable = rate === 0 ? 0 : rate < 30 ? 0.5 : 1
      const effScore = Math.round(best.score * usable * 100) / 100
      const confidence = effScore >= 0.65 ? 'high' : effScore >= 0.4 ? 'medium' : 'low'
      links.push({
        fromId: a.d.id, toId: b.d.id,
        fromName: a.d.name || (a.d.meta && a.d.meta.name) || '',
        toName: b.d.name || (b.d.meta && b.d.meta.name) || '',
        fromKey: best.fromKey, toKey: best.toKey,
        score: rawScore,
        confidence,
        matched: pv.matched, total: pv.total, rate, sameName,
      })
    }
  }
  // 贪心去冲突前先按置信度 + 综合评分排序：高可用关联优先占用数据集，零重叠的同名字段不会抢占
  const CONF_RANK = { high: 3, medium: 2, low: 1 }
  links.sort((x, y) => (CONF_RANK[y.confidence] - CONF_RANK[x.confidence]) || (y.score - x.score))
  const used = new Set()
  const out = []
  for (const l of links) {
    if (used.has(l.fromId) || used.has(l.toId)) continue
    used.add(l.fromId)
    used.add(l.toId)
    out.push(l)
  }
  return out
}

// 纵向堆叠：列取并集，缺列补空；addSourceCol 时加「来源」列（值为数据集名）
export function unionTables(tables, addSourceCol = true) {
  const srcList = (tables || []).filter(t => t && t.rows && t.rows.length)
  if (!srcList.length) return { columns: [], rows: [] }
  const colSet = new Set()
  const colOrder = []
  srcList.forEach(t => (t.columns || []).forEach(c => {
    if (!colSet.has(c.name)) { colSet.add(c.name); colOrder.push(c.name) }
  }))
  const srcCol = colOrder.includes('来源') ? '来源（数据集）' : '来源'
  let cols = colOrder.map(name => ({ name }))
  if (addSourceCol) cols = [{ name: srcCol }, ...cols]
  const rows = []
  srcList.forEach(t => {
    const srcName = t.name || (t.meta && t.meta.name) || ''
    t.rows.forEach(r => {
      const nr = {}
      if (addSourceCol) nr[srcCol] = srcName
      colOrder.forEach(c => { nr[c] = r[c] === undefined ? '' : r[c] })
      rows.push(nr)
    })
  })
  return { columns: cols, rows }
}

function dsName(d) {
  return d.name || (d.meta && d.meta.name) || '数据集'
}

// 按 plan 合并：join = 以主表（选中集中行数最多者）为底，沿 links 依次左连接对方非键列；union = 纵向堆叠
export function mergeDatasets(datasets, plan) {
  const list = (datasets || []).filter(d => d && d.table)
  if (!list.length) {
    return { table: { columns: [], rows: [] }, meta: { mode: plan && plan.mode, links: [], matched: 0, total: 0, warnings: ['未找到可合并的数据集'] } }
  }
  const warnings = [...(plan.warnings || [])]
  if (plan.mode === 'union') {
    const tables = list.map(d => ({ ...d.table, name: dsName(d) }))
    const t = unionTables(tables, plan.addSourceCol !== false)
    return { table: t, meta: { mode: 'union', links: [], matched: t.rows.length, total: t.rows.length, warnings } }
  }
  // join 模式：主表 = 行数最多者；沿 links 依次左连接（支持链式：一端已并入结果表即续链）
  const main = [...list].sort((a, b) => b.table.rows.length - a.table.rows.length)[0]
  const byId = {}
  list.forEach(d => { byId[d.id] = d })
  const linkMeta = []
  const joinedIds = new Set([main.id]) // 已并入结果表的数据集
  const unconsumed = []
  let left = main.table
  let totalMatched = 0
  let totalTotal = 0
  for (const lk of plan.links || []) {
    let sub = null, mainKey = '', subKey = ''
    if (joinedIds.has(lk.fromId) && !joinedIds.has(lk.toId)) {
      sub = byId[lk.toId]; mainKey = lk.fromKey; subKey = lk.toKey
    } else if (joinedIds.has(lk.toId) && !joinedIds.has(lk.fromId)) {
      sub = byId[lk.fromId]; mainKey = lk.toKey; subKey = lk.fromKey
    }
    // 未消费：两侧都已入链、或关联键列不在当前结果表中（防链式键名不一致时静默丢数据）
    if (!sub) { unconsumed.push(lk); continue }
    if (!left.columns.some(c => c.name === mainKey)) { unconsumed.push(lk); continue }
    joinedIds.add(sub.id)
    const keepCols = sub.table.columns.map(c => c.name).filter(n => n !== subKey)
    const pv = previewJoin(left, sub.table, mainKey, subKey)
    const joined = joinTables(left, sub.table, mainKey, subKey, keepCols, 'left')
    linkMeta.push({
      fromName: dsName(byId[lk.fromId]), toName: dsName(byId[lk.toId]),
      fromId: lk.fromId, toId: lk.toId, mainKey, subKey,
      matched: pv.matched, total: pv.total, rate: pv.rate,
    })
    totalMatched += pv.matched // 多 link 累计（total 同步累计为各步主表行数之和）
    totalTotal += pv.total
    left = joined
  }
  if (!linkMeta.length) warnings.push('未指定有效关联，结果仅包含主表（可展开高级手动关联，或改用纵向堆叠）')
  if (unconsumed.length) {
    warnings.push(`有 ${unconsumed.length} 条关联未生效（未与主表连通或关联键不在结果表中），已跳过：${unconsumed.map(l => `「${l.fromName || l.fromId}」↔「${l.toName || l.toId}」`).join('、')}`)
  }
  return { table: left, meta: { mode: 'join', links: linkMeta, matched: totalMatched, total: totalTotal || main.table.rows.length, warnings } }
}

// 自动决策合并方案：选中集内部 link 覆盖全部且置信度≥medium 且 rate≥30% → join（主表=行数最多）；否则 union + warning
export function buildMergePlan(datasets, selectedIds, links) {
  const sel = (datasets || []).filter(d => d && d.table && (selectedIds || []).includes(d.id))
  if (sel.length === 0) return { mode: 'union', mainId: null, links: [], addSourceCol: true, warnings: ['未选择数据集'] }
  if (sel.length === 1) return { mode: 'single', mainId: sel[0].id, links: [], addSourceCol: false, warnings: [] }
  const relLinks = (links || []).filter(l =>
    sel.some(d => d.id === l.fromId) && sel.some(d => d.id === l.toId) &&
    l.confidence !== 'low' && l.rate >= 30
  )
  const adj = {}
  sel.forEach(d => { adj[d.id] = new Set() })
  relLinks.forEach(l => { adj[l.fromId].add(l.toId); adj[l.toId].add(l.fromId) })
  const seen = new Set()
  const stack = [sel[0].id]
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const nbrs = adj[id] || []
    nbrs.forEach(n => { if (!seen.has(n)) stack.push(n) })
  }
  const main = [...sel].sort((a, b) => b.table.rows.length - a.table.rows.length)[0]
  if (seen.size === sel.length && relLinks.length >= 1) {
    return { mode: 'join', mainId: main.id, links: relLinks, addSourceCol: false, warnings: [] }
  }
  return {
    mode: 'union', mainId: null, links: relLinks, addSourceCol: true,
    warnings: ['数据集间未形成可靠关联（置信度或匹配率不足），已改用「纵向堆叠」合并；可展开高级手动指定关联'],
  }
}

// 跨数据集对比：找同名度量列，对每个数据集真实计算均值/合计，产出多系列图表；无同名度量返回 null
export function compareAcrossTables(datasets, selectedIds) {
  const sel = (datasets || []).filter(d => d && d.table && (selectedIds || []).includes(d.id))
  if (sel.length < 2) return null
  const infos = sel.map(d => ({ d, t: inferSchema(d.table) }))
  const measureCount = {}
  infos.forEach(({ t }) => {
    t.columns.filter(c => c.semantic === 'measure').forEach(c => { measureCount[c.name] = (measureCount[c.name] || 0) + 1 })
  })
  const common = Object.keys(measureCount).filter(n => measureCount[n] >= 2)
  if (!common.length) return null
  const m = common[0]
  const cats = sel.map(d => dsName(d))
  const avgSeries = sel.map(d => {
    const vals = d.table.rows.map(r => toNum(r[m])).filter(v => !isNaN(v))
    return { name: dsName(d), value: vals.length ? Math.round(avg(vals) * 100) / 100 : 0 }
  })
  const sumSeries = sel.map(d => {
    const vals = d.table.rows.map(r => toNum(r[m])).filter(v => !isNaN(v))
    return { name: dsName(d), value: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : 0 }
  })
  return {
    measure: m,
    cats,
    avg: avgSeries,
    sum: sumSeries,
    bar: multiBarOption(cats, [
      { name: `${m} 均值`, data: avgSeries.map(s => s.value) },
      { name: `${m} 合计`, data: sumSeries.map(s => s.value) },
    ]),
    line: multiLineOption(cats, [{ name: `${m} 均值`, data: avgSeries.map(s => s.value) }]),
  }
}

// 合并结果字段汇总（列数/行数/每列类型/缺失率/唯一率），供结果页展示
export function mergeSummary(mergedTable) {
  const { columns, rows } = mergedTable
  const t = inferSchema(mergedTable)
  return {
    rowCount: rows.length,
    colCount: columns.length,
    columns: t.columns.map(c => ({
      name: c.name,
      type: c.type,
      semantic: c.semantic,
      missingRate: rows.length ? Math.round(c.missing / rows.length * 100) / 100 : 0,
      uniqueRate: (rows.length - c.missing) ? Math.round(c.cardinality / (rows.length - c.missing) * 100) / 100 : 0,
    })),
  }
}
