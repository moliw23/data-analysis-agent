// IndexedDB 数据行持久化层：数据集原始行按块落盘，刷新后可恢复，避免大表全部加载卡死内存
// 库 data-agent-db v1，store datasetRows，index('byId')（keyPath='key'）
// 记录：{ key:'chunk_${id}_${i}', id, seq:i, columns:[{name}], rows:[...], savedAt }
// 降级策略：IDB 不可用 / 配额满 → 模块级 idbDisabled=true，后续 API 短路返回，不反复抛错
// 说明：IDB 原生 structured clone 直接存对象数组，不做 JSON.stringify 双序列化

const DB_NAME = 'data-agent-db'
const DB_VERSION = 1
const STORE = 'datasetRows'

export const CHUNK_SIZE = 50000

let dbPromise = null
let idbDisabled = false

function toPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB 请求失败'))
  })
}

// 打开数据库（单例 Promise<IDBDatabase>）；open 失败/被阻塞时置位降级并 reject
export function openDB() {
  if (idbDisabled) return Promise.reject(new Error('IndexedDB 已禁用，降级为内存态'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持 IndexedDB')); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex('byId', 'id', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'))
      req.onblocked = () => reject(new Error('IndexedDB 被阻塞'))
    }).catch(err => {
      dbPromise = null
      idbDisabled = true
      throw err
    })
  }
  return dbPromise
}

// 读取某 id 的全部 chunk key（只读事务，走 index('byId')）
function collectChunkKeys(db, id) {
  const tx = db.transaction(STORE, 'readonly')
  return toPromise(tx.objectStore(STORE).index('byId').getAllKeys(id))
}

// 删除一批 key（独立 readwrite 事务）
function deleteKeys(db, keys) {
  if (!keys || !keys.length) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const k of keys) store.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('删除事务失败'))
    tx.onabort = () => reject(tx.error || new Error('删除事务中止'))
  })
}

// 写入单块记录（独立短事务）
function putRecord(db, rec) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('写入事务失败'))
    tx.onabort = () => reject(tx.error || new Error('写入事务中止'))
  })
}

// 落盘：先经 index('byId') 删该 id 旧块，再按 CHUNK_SIZE 切块逐块写入（每块短事务，
// 块间 setTimeout(0) 让出主线程防大表卡顿）——先删后写保证幂等
export async function saveDatasetRows(id, columns, rows) {
  if (idbDisabled) return
  const db = await openDB()
  try {
    const oldKeys = await collectChunkKeys(db, id)
    await deleteKeys(db, oldKeys)
    const total = rows.length
    const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE))
    for (let i = 0; i < chunkCount; i++) {
      const rec = {
        key: `chunk_${id}_${i}`,
        id,
        seq: i,
        columns,
        rows: rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        savedAt: Date.now(),
      }
      await putRecord(db, rec) // 行数 ≤ 50000 时即单块 chunk_${id}_0
      if (i < chunkCount - 1) await new Promise(r => setTimeout(r, 0))
    }
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') idbDisabled = true
    throw e
  }
}

// 恢复：index('byId').getAll(id) → 按 seq 升序拼接 rows → { id, columns, rows, savedAt } | null
export async function loadDatasetRows(id) {
  if (idbDisabled) return null
  const db = await openDB()
  const tx = db.transaction(STORE, 'readonly')
  const recs = await toPromise(tx.objectStore(STORE).index('byId').getAll(id))
  if (!recs || !recs.length) return null
  recs.sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const rows = []
  for (const r of recs) {
    const chunk = r.rows
    for (let i = 0; i < chunk.length; i++) rows.push(chunk[i]) // 逐条 push，规避超大数组展开的参数上限
  }
  return { id, columns: recs[0].columns, rows, savedAt: recs[recs.length - 1].savedAt }
}

// 删除某 id 全部 chunk
export async function deleteDatasetRows(id) {
  if (idbDisabled) return
  const db = await openDB()
  const keys = await collectChunkKeys(db, id)
  await deleteKeys(db, keys)
}

// 列出所有已落盘数据集的 id（getAllKeys → 正则提取 → 去重）
export async function listDatasetIds() {
  if (idbDisabled) return []
  const db = await openDB()
  const keys = await toPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys())
  const ids = []
  for (const k of keys) {
    // key = chunk_${id}_${seq}；id 本身可能含下划线，用贪婪匹配提取前缀去重
    const m = /^chunk_(.+)_\d+$/.exec(k)
    if (m && !ids.includes(m[1])) ids.push(m[1])
  }
  return ids
}

// 清理孤儿块：对指定 ids 逐个删除（含降级短路）
export async function deleteOrphanRows(ids) {
  for (const id of ids) {
    if (idbDisabled) return
    await deleteDatasetRows(id)
  }
}
