// QA：datasetStore.js 测试（node 环境 + mock localStorage；无 localStorage 时降级不崩）
import path from 'path'
import { pathToFileURL } from 'url'

// 场景1：无 localStorage（node 原生环境）→ 应静默降级不抛错
const store = await import(pathToFileURL(path.resolve('src/datasetStore.js')).href)
let threw = false
try { store.getDatasetsMeta(); store.saveDatasetMeta({ name: 'x' }); store.renameDataset('a', 'b'); store.deleteDataset('a'); store.saveLinks([]) } catch (e) { threw = true; console.log('NO_LS_THROW', e.message) }
console.log(threw ? 'FAIL: 无 localStorage 抛错' : 'PASS: 无 localStorage 降级不崩')

// 场景2：mock localStorage → CRUD + 链接清理
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}
const s2 = await import(pathToFileURL(path.resolve('src/datasetStore.js')).href)
const e0 = s2.getDatasetsMeta()
console.log(JSON.stringify(e0) === JSON.stringify({ datasets: [], links: [] }) ? 'PASS: 空态' : 'FAIL: 空态')

const m1 = s2.saveDatasetMeta({ name: 'A', source: 'a.csv', rows: 1, cols: 1 })
const m2 = s2.saveDatasetMeta({ name: 'B', source: 'b.csv', rows: 2, cols: 2 })
console.log(m1.id && m2.id && m1.id !== m2.id ? 'PASS: 生成 id' : 'FAIL: id')
s2.saveLinks([{ fromId: m1.id, toId: m2.id }])
console.log(s2.getDatasetsMeta().links.length === 1 ? 'PASS: saveLinks' : 'FAIL: saveLinks')
s2.renameDataset(m1.id, 'A2')
console.log(s2.getDatasetsMeta().datasets.find(x => x.id === m1.id).name === 'A2' ? 'PASS: renameDataset' : 'FAIL: renameDataset')
s2.deleteDataset(m1.id)
const st = s2.getDatasetsMeta()
console.log(st.datasets.length === 1 && st.links.length === 0 ? 'PASS: deleteDataset 清理 links' : `FAIL: deleteDataset (datasets=${st.datasets.length}, links=${st.links.length})`)
// 更新已有（带 id）
const m3 = s2.saveDatasetMeta({ id: m2.id, name: 'B2' })
console.log(m3.name === 'B2' && s2.getDatasetsMeta().datasets.length === 1 ? 'PASS: 带 id 更新不重复新增' : 'FAIL: 带 id 更新')

// 场景3：损坏 JSON → 空态不崩
mem.set('data-agent.datasets', '{broken json')
console.log(JSON.stringify(s2.getDatasetsMeta()) === JSON.stringify({ datasets: [], links: [] }) ? 'PASS: 损坏 JSON 降级' : 'FAIL: 损坏 JSON')
