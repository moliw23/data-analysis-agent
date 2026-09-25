// 多表关联：维度表按关联键合并到主表，含轻量预览与自动键猜测
import { inferSchema } from './schema.js'
import { isEmpty } from './_shared.js'

// 把维度表 sub 的指定列按关联键合并到主表 main（键重复时取首条；支持 inner / left）
export function joinTables(main, sub, mainKey, subKey, cols, mode = 'inner') {
  const subCols = sub.columns
  const idx = new Map()
  sub.rows.forEach(r => {
    const k = r[subKey]
    if (isEmpty(k) || idx.has(k)) return
    idx.set(k, r)
  })
  const keepCols = cols && cols.length
    ? cols.filter(c => subCols.some(sc => sc.name === c))
    : subCols.filter(sc => sc.name !== subKey).map(sc => sc.name)
  // 合并列与主表列重名时加 _2/_3 后缀，避免覆盖
  const added = keepCols.map(n => {
    let nn = n, i = 2
    while (main.columns.some(c => c.name === nn)) { nn = `${n}_${i++}` }
    return { name: nn, src: n }
  })
  const colsOut = [...main.columns.map(c => ({ name: c.name })), ...added.map(a => ({ name: a.name }))]
  const rowsOut = []
  let matched = 0
  main.rows.forEach(r => {
    const subRow = idx.get(r[mainKey])
    if (subRow) {
      const nr = { ...r }
      added.forEach(a => { nr[a.name] = subRow[a.src] })
      rowsOut.push(nr); matched++
    } else if (mode === 'left') {
      const nr = { ...r }
      added.forEach(a => { nr[a.name] = '' })
      rowsOut.push(nr)
    } // inner：不匹配的行丢弃
  })
  return { columns: colsOut, rows: rowsOut, matched, unmatched: main.rows.length - matched }
}

// 轻量关联预览：只统计匹配行数，不构建输出行（供 UI 实时预览与键候选排序）
export function previewJoin(main, sub, mainKey, subKey) {
  const idx = new Map()
  sub.rows.forEach(r => { const k = r[subKey]; if (isEmpty(k) || idx.has(k)) return; idx.set(k, r) })
  let matched = 0
  main.rows.forEach(r => { if (idx.has(r[mainKey])) matched++ })
  const total = main.rows.length
  return { matched, unmatched: total - matched, total, rate: total ? Math.round(matched / total * 100) : 0 }
}

// 自动猜测关联键：候选 = 名字含 id/编号/用户/email 等或高基数 dimension 列；
// 排序规则：同名(忽略_与大小写)优先，其次值交集匹配率；返回 top 5 候选 + 最佳
export function guessJoinKeys(main, sub) {
  const keys = t => inferSchema(t).columns.filter(c =>
    /(id|编号|用户|user|手机|email|邮箱|account|账号)/i.test(c.name) || (c.semantic === 'dimension' && c.cardinality > 1)
  ).map(c => c.name)
  const mKeys = keys(main), sKeys = keys(sub), out = []
  mKeys.forEach(mk => sKeys.forEach(sk => {
    const p = previewJoin(main, sub, mk, sk)
    const same = mk.replace(/[\s_]+/g, '').toLowerCase() === sk.replace(/[\s_]+/g, '').toLowerCase()
    out.push({ mainKey: mk, subKey: sk, ...p, same })
  }))
  out.sort((a, b) => (b.same - a.same) || (b.rate - a.rate) || 0)
  return { candidates: out.slice(0, 5), best: out[0] || null }
}
