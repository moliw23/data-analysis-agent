// 分析模板库（模块③）：保存/加载/导出/导入 可复用图表配置 + 语义角色映射（跨数据集复用）
// 铁律：模板只存「配置 + schema 描述」，绝不存原始数据（防泄露、防体积爆炸）
// 模板结构（v1）：
// {
//   id, v: 1, name, kind: 'manual'|'plan', createdAt,
//   spec: { kind: 'trend'|'topN'|..., timeCol, measureCol, dimCol, rowDim, colDim, col, regionCol, granularity, op, n, horizon, method, k, anomMethod },
//   filters: [{ dim, values: [] }],
//   schema: { columns: [{ name, type, semantic }] }   // 保存时的表结构指纹
// }
import { inferSchema } from './engine.js'

const LS_KEY = 'data-agent.templates'

function genId() { return 'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) }

export function listTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function writeAll(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export function saveTemplate(t) {
  const list = listTemplates()
  const idx = list.findIndex(x => x.id === t.id)
  if (idx >= 0) list[idx] = t; else list.unshift(t)
  writeAll(list)
  return t
}

export function getTemplate(id) {
  return listTemplates().find(x => x.id === id) || null
}

export function deleteTemplate(id) {
  writeAll(listTemplates().filter(x => x.id !== id))
}

export function renameTemplate(id, name) {
  const list = listTemplates()
  const t = list.find(x => x.id === id)
  if (t) { t.name = name; writeAll(list) }
  return t
}

// 当前表 schema 指纹：列名 + 类型 + 语义（inferSchema 真推断）
export function schemaFingerprint(table) {
  const t = inferSchema(table)
  return { columns: t.columns.map(c => ({ name: c.name, type: c.type, semantic: c.semantic })) }
}

// 语义角色映射：把模板 spec 里的列引用映射到目标表真实列（跨表复用核心）
// 匹配优先级：① 同名同语义 → ② 同名 → ③ 同语义且类型兼容（跨表按角色套用）
// 返回 { spec, mapping: {role: '原列→现列'}, unresolved: ['role:原列', ...] }
export function matchTemplate(template, table) {
  const t = inferSchema(table)
  const cols = t.columns
  const spec = { ...(template.spec || {}) }
  const mapping = {}
  const unresolved = []
  const refs = [
    { key: 'timeCol', sem: 'time', num: false },
    { key: 'measureCol', sem: 'measure', num: true },
    { key: 'dimCol', sem: 'dimension', num: false },
    { key: 'rowDim', sem: 'dimension', num: false },
    { key: 'colDim', sem: 'dimension', num: false },
    { key: 'col', sem: null, num: false },
    { key: 'regionCol', sem: 'dimension', num: false },
  ]
  refs.forEach(({ key, sem, num }) => {
    const name = spec[key]
    if (!name) return
    let hit = null
    if (sem) hit = cols.find(c => c.name === name && c.semantic === sem && (!num || c.type === 'number'))
    if (!hit) hit = cols.find(c => c.name === name)
    if (!hit && sem) hit = cols.find(c => c.semantic === sem && (!num || c.type === 'number'))
    if (hit) { spec[key] = hit.name; mapping[key] = `${name}→${hit.name}` }
    else unresolved.push(`${key}:${name}`)
  })
  return { spec, mapping, unresolved }
}

// 导出为 .json（不含任何原始数据）
export function exportTemplateJson(t) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(t.name || 'template').replace(/[\\/:*?"<>|]/g, '_')}.template.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

// 导入 .json 文本 → 校验结构 → 入库（返回模板对象；结构非法抛错）
export function importTemplateText(text) {
  const j = JSON.parse(text)
  if (!j || typeof j !== 'object') throw new Error('文件内容不是 JSON 对象')
  if (j.v !== 1 || !j.spec || typeof j.spec.kind !== 'string') throw new Error('不是有效的模板文件（需 v:1 且包含 spec.kind）')
  const t = {
    id: typeof j.id === 'string' && j.id ? j.id : genId(),
    v: 1,
    name: typeof j.name === 'string' && j.name ? j.name : '导入模板',
    kind: j.kind === 'plan' ? 'plan' : 'manual',
    createdAt: typeof j.createdAt === 'string' ? j.createdAt : new Date().toISOString(),
    spec: j.spec,
    filters: Array.isArray(j.filters) ? j.filters : [],
    schema: j.schema && Array.isArray(j.schema.columns) ? j.schema : { columns: [] },
  }
  saveTemplate(t)
  return t
}
