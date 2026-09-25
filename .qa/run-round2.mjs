// QA 第二轮回归：4 个源码 Bug 修复复测 + 快速回归
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
import path from 'path'

execSync('node .qa/build-engine.mjs', { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] })
const eng = await import(pathToFileURL(path.resolve('.qa/engine.bundle.mjs')).href)

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, ok: true, msg: '' }) }
  catch (e) { results.push({ name, ok: false, msg: e.message }) }
}
function eq(a, b, l) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${l}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
function ok(c, l) { if (!c) throw new Error(`${l}: assertion failed`) }
function mk(cols, rows, id, name) { return { id, name, columns: cols.map(c => ({ name: c })), rows } }
function wrap(id, name, cols, rows) { return { id, meta: { name }, table: mk(cols, rows, id, name) } }

// ============ Bug1 复测：detectLinks 置信度 ============
check('R1-1 同名零重叠 → confidence=low（原 high）', () => {
  const aRows = []; for (let i = 1; i <= 100; i++) aRows.push({ user_id: String(i) })
  const bRows = []; for (let i = 101; i <= 200; i++) bRows.push({ 'user-id': String(i) })
  const links = eng.detectLinks([mk(['user_id'], aRows, 'A', 'A'), mk(['user-id'], bRows, 'B', 'B')])
  ok(links.length >= 1, '应仍产出 link')
  const l = links[0]
  eq(l.confidence, 'low', `confidence 应为 low, got ${l.confidence} (score=${l.score})`)
  eq(l.rate, 0, 'rate=0')
})

check('R1-2 tianchi 真实 user_id↔user_id 仍 high', () => {
  const baby = []; for (let uid = 1; uid <= 953; uid++) baby.push({ user_id: String(uid), birthday: `199${uid % 10}0${(uid % 9) + 1}15`, gender: String(uid % 3) })
  const trade = []; const pool = []; for (let uid = 1; uid <= 700; uid++) pool.push(String(uid))
  for (let i = 0; i < 29971; i++) { const uid = pool[i % pool.length]; trade.push({ user_id: uid, auction_id: String(1000000000 + i), category_2: String((i % 100) + 1), category_1: String((i % 10) + 1), buy_mount: String((i % 5) + 1), day: '2014' + String((i % 12) + 1).padStart(2, '0') + String((i % 28) + 1).padStart(2, '0') }) }
  const links = eng.detectLinks([mk(['user_id', 'birthday', 'gender'], baby, 'baby', 'baby'), mk(['user_id', 'auction_id', 'category_2', 'category_1', 'buy_mount', 'day'], trade, 'trade', 'trade')])
  const l = links[0]
  ok(l.fromKey === 'user_id' && l.toKey === 'user_id', '键 user_id↔user_id')
  eq(l.confidence, 'high', `confidence=high, got ${l.confidence}`)
  eq(l.rate, 73, 'rate=73')
})

check('R1-3 贪心：零重叠同名字段不抢占真实 high 关联', () => {
  // A.user_id 1..100（真实键） × C.user_id 1..80（真实重叠 80%）  vs  A.user_id × B.user-id 101..200（零重叠同名字段）
  const aRows = []; for (let i = 1; i <= 100; i++) aRows.push({ user_id: String(i) })
  const bRows = []; for (let i = 101; i <= 200; i++) bRows.push({ 'user-id': String(i) })
  const cRows = []; for (let i = 1; i <= 80; i++) cRows.push({ user_id: String(i) })
  const links = eng.detectLinks([
    mk(['user_id'], aRows, 'A', 'A'),
    mk(['user-id'], bRows, 'B', 'B'),
    mk(['user_id'], cRows, 'C', 'C'),
  ])
  eq(links.length, 1, '贪心只留 1 条')
  ok(!(links[0].fromId === 'A' && links[0].toId === 'B') && !(links[0].fromId === 'B' && links[0].toId === 'A'), '不得选 A↔B 零重叠')
  ok((links[0].fromId === 'A' && links[0].toId === 'C') || (links[0].fromId === 'C' && links[0].toId === 'A'), '应选 A↔C 真实关联')
  eq(links[0].confidence, 'high', 'A↔C high')
  eq(links[0].rate, 80, 'A↔C rate=80')
})

// ============ Bug2 复测：链式 join ============
check('R2-1 链式 A→B→C 把 C 列并入、无 warning', () => {
  const A = wrap('A', 'A', ['id', 'va'], [{ id: '1', va: 'a1' }, { id: '2', va: 'a2' }, { id: '3', va: 'a3' }])
  const B = wrap('B', 'B', ['id', 'vb'], [{ id: '1', vb: 'b1' }, { id: '2', vb: 'b2' }])
  const C = wrap('C', 'C', ['id', 'vc'], [{ id: '1', vc: 'c1' }])
  const plan = { mode: 'join', mainId: 'A', addSourceCol: false, warnings: [], links: [
    { fromId: 'A', toId: 'B', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100, fromName: 'A', toName: 'B' },
    { fromId: 'B', toId: 'C', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100, fromName: 'B', toName: 'C' },
  ] }
  const { table, meta } = eng.mergeDatasets([A, B, C], plan)
  eq(table.rows.length, 3, '行数 3')
  eq(table.columns.map(c => c.name), ['id', 'va', 'vb', 'vc'], 'C 列 vc 已并入')
  eq(table.rows[0], { id: '1', va: 'a1', vb: 'b1', vc: 'c1' }, 'row0 全字段')
  ok(meta.warnings.length === 0, `无 warning, got ${JSON.stringify(meta.warnings)}`)
  eq(meta.links.length, 2, '两条 link 均消费')
})

check('R2-2 main=A 孤立 B→C：结果仅主表 + 明确 warning', () => {
  const A = wrap('A', 'A', ['id', 'va'], [{ id: '1', va: 'a1' }])
  const B = wrap('B', 'B', ['id', 'vb'], [{ id: '1', vb: 'b1' }])
  const C = wrap('C', 'C', ['id', 'vc'], [{ id: '1', vc: 'c1' }])
  const plan = { mode: 'join', mainId: 'A', addSourceCol: false, warnings: [], links: [
    { fromId: 'B', toId: 'C', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100, fromName: 'B', toName: 'C' },
  ] }
  const { table, meta } = eng.mergeDatasets([A, B, C], plan)
  eq(table.rows.length, 1, '仅主表行数')
  eq(table.columns.map(c => c.name), ['id', 'va'], '仅主表列')
  ok(meta.warnings.length >= 1, '应有明确 warning')
  ok(meta.warnings.some(w => w.includes('未生效') || w.includes('未指定有效关联')), `warning 内容: ${JSON.stringify(meta.warnings)}`)
})

// ============ Bug3 复测：matched/total 累计 ============
check('R3 链式 2 link matched/total 为两步之和', () => {
  const A = wrap('A', 'A', ['id', 'va'], [{ id: '1', va: 'a1' }, { id: '2', va: 'a2' }, { id: '3', va: 'a3' }])
  const B = wrap('B', 'B', ['id', 'vb'], [{ id: '1', vb: 'b1' }, { id: '2', vb: 'b2' }])
  const C = wrap('C', 'C', ['id', 'vc'], [{ id: '1', vc: 'c1' }])
  const plan = { mode: 'join', mainId: 'A', addSourceCol: false, warnings: [], links: [
    { fromId: 'A', toId: 'B', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100, fromName: 'A', toName: 'B' },
    { fromId: 'B', toId: 'C', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100, fromName: 'B', toName: 'C' },
  ] }
  const { meta } = eng.mergeDatasets([A, B, C], plan)
  eq(meta.matched, 3, 'matched=2+1')
  eq(meta.total, 6, 'total=3+3')
})

// ============ Bug4 复测：重导入清 error ============
const mem = new Map()
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
const store = await import(pathToFileURL(path.resolve('src/datasetStore.js')).href)

check('R4-1 带 error 落库 → 同 id 不带 error 更新 → 内存/持久化均无 error', () => {
  const m1 = store.saveDatasetMeta({ name: 'x', source: 'x.csv', error: '超过 50MB 限制，已跳过' })
  ok(!!m1.error, '初始有 error')
  const m2 = store.saveDatasetMeta({ id: m1.id, name: 'x', source: 'x.csv', rows: 953, cols: 3, colNames: ['a'] })
  ok(!('error' in m2) || !m2.error, `内存无 error, got ${JSON.stringify(m2.error)}`)
  const persisted = store.getDatasetsMeta().datasets.find(x => x.id === m1.id)
  ok(!('error' in persisted) || !persisted.error, `持久化无 error, got ${JSON.stringify(persisted.error)}`)
})

check('R4-2 再次失败仍保留 error', () => {
  const m = store.saveDatasetMeta({ name: 'y', source: 'y.csv' })
  const f = store.saveDatasetMeta({ id: m.id, name: 'y', source: 'y.csv', error: '解析失败: bad' })
  ok(!!f.error, '再次失败保留 error')
  const p = store.getDatasetsMeta().datasets.find(x => x.id === m.id)
  eq(p.error, '解析失败: bad', '持久化 error')
})

// ============ 快速回归 ============
check('R5 旧导出 analyze/joinTables/previewJoin/guessJoinKeys 可调', () => {
  const main = mk(['id', 'v'], [{ id: '1', v: 'a' }, { id: '2', v: 'b' }], 'm', 'm')
  const sub = mk(['id', 'w'], [{ id: '1', w: 'x' }], 's', 's')
  const j = eng.joinTables(main, sub, 'id', 'id', ['w'], 'left')
  eq(j.rows.length, 2, 'joinTables')
  eq(eng.previewJoin(main, sub, 'id', 'id').matched, 1, 'previewJoin')
  ok(eng.guessJoinKeys(main, sub).best, 'guessJoinKeys')
  ok(eng.analyze(main).charts, 'analyze')
})

const pass = results.filter(r => r.ok).length
const fail = results.filter(r => !r.ok)
console.log(`\n===== 第二轮专项: ${pass}/${results.length} 通过 =====`)
fail.forEach(r => console.log(`  FAIL ${r.name}: ${r.msg}`))
if (fail.length) process.exitCode = 1
