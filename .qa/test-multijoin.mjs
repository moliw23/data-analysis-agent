// QA：mergeDatasets 多跳 join 的 matched/total 口径检查 + 多表 join 冒烟
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
import path from 'path'

execSync('node .qa/build-engine.mjs', { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] })
const eng = await import(pathToFileURL(path.resolve('.qa/engine.bundle.mjs')).href)

function wrap(id, name, cols, rows) { return { id, meta: { name }, table: { columns: cols.map(c => ({ name: c })), rows } } }

// 3 表链：A(id) ← B(id) ← C(id)
const A = wrap('A', 'A', ['id', 'va'], [{ id: '1', va: 'a1' }, { id: '2', va: 'a2' }, { id: '3', va: 'a3' }])
const B = wrap('B', 'B', ['id', 'vb'], [{ id: '1', vb: 'b1' }, { id: '2', vb: 'b2' }])
const C = wrap('C', 'C', ['id', 'vc'], [{ id: '1', vc: 'c1' }])
const plan = {
  mode: 'join', mainId: 'A', addSourceCol: false, warnings: [],
  links: [
    { fromId: 'A', toId: 'B', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100 },
    { fromId: 'B', toId: 'C', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100 },
  ],
}
const { table, meta } = eng.mergeDatasets([A, B, C], plan)
console.log('多跳join 行数 =', table.rows.length, '(期望 3)')
console.log('多跳join 列 =', table.columns.map(c => c.name).join(','), '(期望 id,va,vb,vc)')
console.log('meta.matched =', meta.matched, 'meta.total =', meta.total, '(matched 应为最后一条 link 的 matched=1 还是全部? 见下)')
console.log('linkMeta =', JSON.stringify(meta.links))
console.log('row0 =', JSON.stringify(table.rows[0]), '(期望 id:1,va:a1,vb:b1,vc:c1)')

// 主表=行数最多 验证：B 行数最多时主表应为 B
const B2 = wrap('B2', 'B2', ['id', 'vb'], [{ id: '1', vb: 'b1' }, { id: '2', vb: 'b2' }, { id: '3', vb: 'b3' }, { id: '4', vb: 'b4' }])
const plan2 = { mode: 'join', mainId: 'B2', addSourceCol: false, warnings: [], links: [{ fromId: 'A', toId: 'B2', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100 }] }
const r2 = eng.mergeDatasets([A, B2], plan2)
console.log('主表B2 join 行数 =', r2.table.rows.length, '(期望 4)')
