// 数据集元数据持久化（仅元数据 + 关联关系；原始数据行不落盘）
// 仿 schedule.js 的 localStorage CRUD 模式；LS_KEY='data-agent.datasets'
// meta 结构：{ id, name, source, rows, cols, colNames, createdAt, error? }

const LS_KEY = 'data-agent.datasets'

function emptyState() {
  return { datasets: [], links: [] }
}

export function getDatasetsMeta() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const obj = raw ? JSON.parse(raw) : null
    if (!obj || typeof obj !== 'object') return emptyState()
    return {
      datasets: Array.isArray(obj.datasets) ? obj.datasets : [],
      links: Array.isArray(obj.links) ? obj.links : [],
    }
  } catch {
    return emptyState()
  }
}

function persist(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用（隐私模式/配额满）时静默降级为内存态
  }
}

// 新增或更新（带 id 视为更新）；返回最终落库的 meta
export function saveDatasetMeta(meta) {
  const st = getDatasetsMeta()
  const list = st.datasets
  if (meta && meta.id) {
    const i = list.findIndex(x => x.id === meta.id)
    if (i >= 0) {
      const merged = { ...list[i], ...meta }
      // 更新时若未显式携带 error 字段（成功重导入/重命名等），清除旧的失败标记
      if (!('error' in meta)) delete merged.error
      list[i] = merged
      persist(st)
      return list[i]
    }
  }
  const item = {
    ...(meta || {}),
    id: (meta && meta.id) || 'ds_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    createdAt: (meta && meta.createdAt) || new Date().toISOString(),
  }
  list.push(item)
  persist(st)
  return item
}

export function renameDataset(id, name) {
  const st = getDatasetsMeta()
  const i = st.datasets.findIndex(x => x.id === id)
  if (i >= 0) {
    st.datasets[i].name = name
    persist(st)
  }
}

export function deleteDataset(id) {
  const st = getDatasetsMeta()
  st.datasets = st.datasets.filter(x => x.id !== id)
  st.links = st.links.filter(l => l.fromId !== id && l.toId !== id)
  persist(st)
}

export function saveLinks(links) {
  const st = getDatasetsMeta()
  st.links = Array.isArray(links) ? links : []
  persist(st)
}
