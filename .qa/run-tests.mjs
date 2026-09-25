// QA 回归测试：多数据集联合分析（引擎 + 存储 + 边界/异常）
// 运行：node .qa/run-tests.mjs （会自动先 esbuild 打包 engine.js）
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
import path from 'path'

// 1) 打包 engine.js（stub ?raw）
execSync('node .qa/build-engine.mjs', { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] })

const eng = await import(pathToFileURL(path.resolve('.qa/engine.bundle.mjs')).href)

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true, msg: '' })
  } catch (e) {
    results.push({ name, ok: false, msg: e.message })
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`)
}
function ok(cond, label) { if (!cond) throw new Error(`${label}: assertion failed`) }

// ---------- 数据构造 ----------
function mkTable(cols, rows, id, name) {
  return { id, name, columns: cols.map(c => ({ name: c })), rows }
}

// 真实数据形态：母婴用户画像 953 行 × 交易流水 29971 行（天池 schema）
function makeRealBabyProfile() {
  const rows = []
  for (let uid = 1; uid <= 953; uid++) {
    rows.push({
      user_id: String(uid),
      birthday: `199${(uid % 10)}0${(uid % 9) + 1}15`, // YYYYMMDD 紧凑
      gender: String(uid % 3),
    })
  }
  return mkTable(['user_id', 'birthday', 'gender'], rows, 'baby', '母婴用户画像')
}
function makeRealTradeHistory() {
  const rows = []
  const pool = []
  for (let uid = 1; uid <= 700; uid++) pool.push(String(uid)) // 仅 700/953 用户有交易
  for (let i = 0; i < 29971; i++) {
    const uid = pool[i % pool.length]
    rows.push({
      user_id: uid,
      auction_id: String(1000000000 + i),
      category_2: String((i % 100) + 1),
      category_1: String((i % 10) + 1),
      buy_mount: String((i % 5) + 1),
      day: `2014${String((i % 12) + 1).padStart(2, '0')}${String((i % 28) + 1).padStart(2, '0')}`,
    })
  }
  return mkTable(['user_id', 'auction_id', 'category_2', 'category_1', 'buy_mount', 'day'], rows, 'trade', '母婴交易流水')
}

// ---------- 1. detectLinks ----------
check('T01 detectLinks 真实形态(953×29971) 命中 user_id↔user_id 且 high', () => {
  const links = eng.detectLinks([makeRealBabyProfile(), makeRealTradeHistory()])
  ok(links.length >= 1, '应至少检测到 1 条关联')
  const l = links[0]
  ok(l.fromKey === 'user_id' && l.toKey === 'user_id', `键应为 user_id↔user_id, got ${l.fromKey}↔${l.toKey}`)
  ok(l.confidence === 'high', `置信度应为 high, got ${l.confidence} (score=${l.score})`)
  ok(l.rate >= 60 && l.rate <= 100, `匹配率应≈73%, got ${l.rate}%`)
  ok(l.matched === 700, `matched 应为 700, got ${l.matched}`)
})

check('T02 detectLinks 无共同字段 → 空且不抛错', () => {
  const a = mkTable(['a'], [{ a: '1' }, { a: '2' }], 'A', 'A')
  const b = mkTable(['c'], [{ c: '3' }], 'B', 'B')
  const links = eng.detectLinks([a, b])
  eq(links, [], 'links 应为空')
})

check('T03 detectLinks 仅名称相似但值不重叠 → 不误判为 join', () => {
  const aRows = []; for (let i = 1; i <= 100; i++) aRows.push({ user_id: String(i) })
  const bRows = []; for (let i = 101; i <= 200; i++) bRows.push({ 'user-id': String(i) })
  const links = eng.detectLinks([mkTable(['user_id'], aRows, 'A', 'A'), mkTable(['user-id'], bRows, 'B', 'B')])
  // 功能安全网：无论链接如何，零重叠绝不能产生 join 计划
  const plan = eng.buildMergePlan(
    [{ id: 'A', meta: { name: 'A' }, table: mkTable(['user_id'], aRows, 'A', 'A') },
     { id: 'B', meta: { name: 'B' }, table: mkTable(['user-id'], bRows, 'B', 'B') }],
    ['A', 'B'], links)
  eq(plan.mode, 'union', '零重叠时计划必须为 union')
  // 【发现】记录：零重叠同名字段仍得 score=0.75 → high（见 Bug 清单）
  if (links.length) {
    const l = links[0]
    console.log(`  [FINDING] T03: 零重叠同名字段 score=${l.score}, confidence=${l.confidence}, rate=${l.rate}% (rate=0 但 confidence=high)`)
  }
})

check('T04 detectLinks 同名字段 measure vs dimension 不误关联', () => {
  const aRows = []; for (let i = 1; i <= 100; i++) aRows.push({ amount: String(i) })
  const bRows = []; for (let i = 0; i < 30; i++) bRows.push({ amount: String((i % 3) + 1) })
  const dsA = { id: 'A', meta: { name: 'A' }, table: mkTable(['amount'], aRows, 'A', 'A') }
  const dsB = { id: 'B', meta: { name: 'B' }, table: mkTable(['amount'], bRows, 'B', 'B') }
  const links = eng.detectLinks([dsA.table, dsB.table].map((t, i) => ({ ...t, id: i ? 'B' : 'A' })))
  const plan = eng.buildMergePlan([dsA, dsB], ['A', 'B'], links)
  eq(plan.mode, 'union', '语义不同的同名字段不得产生 join 计划')
})

// ---------- 2. unionTables ----------
check('T05 unionTables 3 表堆叠（列并集/补空/来源列）', () => {
  const t1 = mkTable(['a', 'b'], [{ a: '1', b: 'x' }], 't1', 't1')
  const t2 = mkTable(['b', 'c'], [{ b: 'y', c: '2' }], 't2', 't2')
  const t3 = mkTable(['a', 'c'], [{ a: '3', c: '4' }], 't3', 't3')
  const out = eng.unionTables([t1, t2, t3], true)
  eq(out.columns.map(c => c.name), ['来源', 'a', 'b', 'c'], '列序')
  eq(out.rows.length, 3, '行数')
  eq(out.rows[0], { 来源: 't1', a: '1', b: 'x', c: '' }, 't1 行补空')
  eq(out.rows[1], { 来源: 't2', a: '', b: 'y', c: '2' }, 't2 行补空')
  eq(out.rows[2], { 来源: 't3', a: '3', b: '', c: '4' }, 't3 行补空')
  const out2 = eng.unionTables([t1, t2, t3], false)
  ok(!out2.columns.some(c => c.name === '来源'), 'addSourceCol=false 无来源列')
})

check('T06 unionTables 空表/全空不崩', () => {
  const out = eng.unionTables([], true)
  eq(out, { columns: [], rows: [] }, '空输入')
  const out2 = eng.unionTables([mkTable(['a'], [], 'e', 'e')], true)
  eq(out2, { columns: [], rows: [] }, '全空表')
})

// ---------- 3. buildMergePlan ----------
function wrapDs(id, name, cols, rows) {
  return { id, meta: { name }, table: mkTable(cols, rows, id, name) }
}

check('T07 buildMergePlan 有可靠 link → join', () => {
  const dsA = wrapDs('A', 'A', ['id', 'v'], [{ id: '1', v: 'a' }, { id: '2', v: 'b' }, { id: '3', v: 'c' }])
  const dsB = wrapDs('B', 'B', ['id', 'w'], [{ id: '1', w: 'x' }, { id: '2', w: 'y' }])
  const links = [{ fromId: 'A', toId: 'B', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 80 }]
  const plan = eng.buildMergePlan([dsA, dsB], ['A', 'B'], links)
  eq(plan.mode, 'join', '应 join')
  eq(plan.mainId, 'A', '主表应为行数最多 A')
  eq(plan.warnings.length, 0, '无 warning')
})

check('T08 buildMergePlan 无 link → union+warning', () => {
  const dsA = wrapDs('A', 'A', ['id'], [{ id: '1' }])
  const dsB = wrapDs('B', 'B', ['id'], [{ id: '1' }])
  const plan = eng.buildMergePlan([dsA, dsB], ['A', 'B'], [])
  eq(plan.mode, 'union', '应 union')
  ok(plan.warnings.length >= 1, '应有 warning')
})

check('T09 buildMergePlan rate<30% → union+warning', () => {
  const rowsA = []; for (let i = 1; i <= 10; i++) rowsA.push({ id: String(i) })
  const dsA = wrapDs('A', 'A', ['id'], rowsA)
  const dsB = wrapDs('B', 'B', ['id'], [{ id: '1' }, { id: '2' }])
  const links = [{ fromId: 'A', toId: 'B', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 20 }]
  const plan = eng.buildMergePlan([dsA, dsB], ['A', 'B'], links)
  eq(plan.mode, 'union', 'rate<30 应 union')
  ok(plan.warnings.length >= 1, '应有 warning')
})

// ---------- 4. mergeDatasets ----------
check('T10 mergeDatasets join 模式行数=主表、字段并入', () => {
  const main = wrapDs('main', 'main', ['id', 'name'], [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }])
  const sub = wrapDs('sub', 'sub', ['id', 'age'], [{ id: '1', age: '30' }, { id: '2', age: '25' }])
  const plan = { mode: 'join', mainId: 'main', addSourceCol: false, warnings: [], links: [{ fromId: 'main', toId: 'sub', fromKey: 'id', toKey: 'id', confidence: 'high', rate: 100 }] }
  const { table, meta } = eng.mergeDatasets([main, sub], plan)
  eq(table.rows.length, 3, 'join 行数=主表')
  eq(table.columns.map(c => c.name), ['id', 'name', 'age'], '字段并入')
  eq(table.rows[0], { id: '1', name: 'A', age: '30' }, '匹配行并入')
  eq(table.rows[2], { id: '3', name: 'C', age: '' }, '未匹配行补空(left)')
  eq(meta.matched, 2, 'matched=2')
  eq(meta.total, 3, 'total=3')
})

check('T11 mergeDatasets union 模式行数=各表之和', () => {
  const dsA = wrapDs('A', 'A', ['id'], [{ id: '1' }, { id: '2' }, { id: '3' }])
  const dsB = wrapDs('B', 'B', ['id'], [{ id: '4' }, { id: '5' }])
  const plan = { mode: 'union', addSourceCol: true, warnings: [] }
  const { table, meta } = eng.mergeDatasets([dsA, dsB], plan)
  eq(table.rows.length, 5, '行数=3+2')
  eq(meta.mode, 'union', 'meta.mode')
  eq(meta.matched, 5, 'union matched=总数')
})

// ---------- 5. compareAcrossTables ----------
check('T12 compareAcrossTables 同名度量多系列且数值=手算', () => {
  // 用非整数浮点值，避免被 inferSchema 判为低基数码值维度（card>6 或非整数才会保留 measure 语义）
  const dsA = wrapDs('A', '表A', ['v'], [{ v: '10.5' }, { v: '20.5' }])
  const dsB = wrapDs('B', '表B', ['v'], [{ v: '5.25' }, { v: '15.75' }])
  const cmp = eng.compareAcrossTables([dsA, dsB], ['A', 'B'])
  ok(cmp, '应返回对比')
  eq(cmp.measure, 'v', 'measure')
  eq(cmp.cats, ['表A', '表B'], 'cats')
  eq(cmp.avg.map(s => s.value), [15.5, 10.5], '均值 15.5/10.5')
  eq(cmp.sum.map(s => s.value), [31, 21], '合计 31/21')
  eq(cmp.bar.series.length, 2, 'bar 两系列')
  eq(cmp.bar.series[0].data, [15.5, 10.5], 'bar 均值系列')
  eq(cmp.line.series.length, 1, 'line 一系列')
  eq(cmp.line.series[0].data, [15.5, 10.5], 'line 数据')
})

check('T13 compareAcrossTables 无同名度量 → null', () => {
  const dsA = wrapDs('A', 'A', ['v1'], [{ v1: '10' }])
  const dsB = wrapDs('B', 'B', ['v2'], [{ v2: '20' }])
  eq(eng.compareAcrossTables([dsA, dsB], ['A', 'B']), null, '应 null')
  eq(eng.compareAcrossTables([dsA], ['A']), null, '单表应 null')
})

// ---------- 6. sampleRows ----------
check('T14 sampleRows 超限等距/未超限原样/limit=1', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ i }))
  const s1 = eng.sampleRows(rows, 10)
  eq(s1.length, 10, '抽样 10 条')
  eq(s1.map(r => r.i), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], '等距索引')
  const s2 = eng.sampleRows(rows, 200)
  eq(s2.length, 100, '未超限原样')
  eq(s2, rows, '未超限返回原数组')
  const s3 = eng.sampleRows(rows, 1)
  eq(s3.length, 1, 'limit=1')
  eq(s3[0].i, 0, 'limit=1 首条')
  eq(eng.sampleRows([], 10), [], '空数组')
})

// ---------- 7. mergeSummary ----------
check('T15 mergeSummary 类型/缺失率/唯一率齐全', () => {
  const t = mkTable(['id', 'v'], [{ id: '1', v: '10' }, { id: '2', v: '' }, { id: '2', v: '30' }], 't', 't')
  const s = eng.mergeSummary(t)
  eq(s.rowCount, 3, 'rowCount')
  eq(s.colCount, 2, 'colCount')
  const idCol = s.columns.find(c => c.name === 'id')
  ok(idCol.type && idCol.semantic && typeof idCol.missingRate === 'number' && typeof idCol.uniqueRate === 'number', '字段齐全')
  eq(idCol.uniqueRate, 0.67, 'id 唯一率 2/3 四舍五入 0.67')
  const vCol = s.columns.find(c => c.name === 'v')
  eq(vCol.missingRate, 0.33, 'v 缺失率 1/3 四舍五入 0.33')
})

// ---------- 8. 边界/异常 ----------
check('T16 空 rows 数据集 analyze/detectLinks 不崩', () => {
  const t = mkTable(['x'], [], 'e', 'e')
  const a = eng.analyze(t)
  ok(a && Array.isArray(a.charts), 'analyze 返回')
  const links = eng.detectLinks([t, makeRealTradeHistory()])
  eq(links, [], '空表不参与关联')
})

check('T17 单行数据集不崩、不产生关联', () => {
  const t = mkTable(['id', 'v'], [{ id: '1', v: 'x' }], 'one', 'one')
  const a = eng.analyze(t)
  ok(a && Array.isArray(a.charts), 'analyze 返回')
  const links = eng.detectLinks([t, makeRealTradeHistory()])
  eq(links, [], '单行表基数<2 不关联')
})

check('T18 列名含特殊字符/来源列冲突', () => {
  // 归一化后同名
  const a = mkTable(['user_id'], [{ user_id: '1' }, { user_id: '2' }], 'A', 'A')
  const b = mkTable(['user-id'], [{ 'user-id': '1' }, { 'user-id': '2' }, { 'user-id': '3' }], 'B', 'B')
  const links = eng.detectLinks([a, b])
  ok(links.length >= 1, 'user_id vs user-id 应识别')
  // unionTables 遇到字面「来源」列 → 来源列改名不冲突
  const t1 = mkTable(['来源', 'v'], [{ 来源: 'a', v: '1' }], 't1', 't1')
  const t2 = mkTable(['v'], [{ v: '2' }], 't2', 't2')
  const out = eng.unionTables([t1, t2], true)
  ok(out.columns.some(c => c.name === '来源（数据集）'), '来源列应改名')
  ok(out.columns.some(c => c.name === '来源'), '原「来源」列作为数据列保留（无冲突覆盖）')
  eq(out.rows[0]['来源（数据集）'], 't1', '来源（数据集）值')
  eq(out.rows[0]['来源'], 'a', '原始来源列值保留')
})

// ---------- 9. 旧导出回归 ----------
check('T19 旧导出 analyze/joinTables/previewJoin/guessJoinKeys 可调用', () => {
  const main = mkTable(['id', 'v'], [{ id: '1', v: 'a' }, { id: '2', v: 'b' }], 'm', 'm')
  const sub = mkTable(['id', 'w'], [{ id: '1', w: 'x' }], 's', 's')
  const joined = eng.joinTables(main, sub, 'id', 'id', ['w'], 'left')
  eq(joined.rows.length, 2, 'joinTables 行数')
  eq(joined.rows[1].w, '', 'left 补空')
  const pv = eng.previewJoin(main, sub, 'id', 'id')
  eq(pv.matched, 1, 'previewJoin matched')
  const g = eng.guessJoinKeys(main, sub)
  ok(Array.isArray(g.candidates) && g.best, 'guessJoinKeys 返回')
})

// ---------- 输出 ----------
const pass = results.filter(r => r.ok).length
const fail = results.filter(r => !r.ok)
console.log(`\n===== 引擎测试汇总: ${pass}/${results.length} 通过 =====`)
fail.forEach(r => console.log(`  FAIL ${r.name}: ${r.msg}`))
if (fail.length) process.exitCode = 1
