// 定时调度配置（纯前端演示版：localStorage 持久化；真实推送待部署形态锁定后接入）

const LS_KEY = 'data-agent.schedules'

export function getSchedules() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function persist(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export function saveSchedule(sch) {
  const list = getSchedules()
  if (sch.id) {
    const i = list.findIndex(x => x.id === sch.id)
    if (i >= 0) { list[i] = sch; persist(list); return sch }
  }
  const item = { ...sch, id: 'sch_' + Date.now().toString(36), createdAt: new Date().toISOString() }
  list.push(item)
  persist(list)
  return item
}

export function deleteSchedule(id) {
  persist(getSchedules().filter(x => x.id !== id))
}

export function toggleSchedule(id, enabled) {
  const list = getSchedules()
  const i = list.findIndex(x => x.id === id)
  if (i >= 0) { list[i].enabled = !!enabled; persist(list) }
}

export function buildCron(freq, time) {
  const [h, m] = (time || '09:00').split(':').map(x => x.padStart(2, '0'))
  if (freq === 'daily') return `${m} ${h} * * *`
  if (freq === 'weekly') return `${m} ${h} ? * MON`
  if (freq === 'monthly') return `${m} ${h} 1 * ?`
  return `${m} ${h} * * *`
}

export const FREQ_LABEL = { daily: '每日', weekly: '每周一', monthly: '每月 1 日' }
export const CHANNELS = [
  { key: 'email', label: '邮件' },
  { key: 'wecom', label: '企业微信' },
  { key: 'dingtalk', label: '钉钉' },
]

// 注意：dataset 快照仅存列名与行数（不落原始数据，避免 Key/数据外泄到其他存储）
export function makeScheduleMeta(name, table, freq, time, questions, channels) {
  return {
    name: name || '未命名调度',
    freq, time,
    cron: buildCron(freq, time),
    questions: questions || [],
    channels: channels || [],
    enabled: true,
    dataset: table ? { rows: table.rows.length, cols: table.columns.length } : null,
  }
}

// ---------- 触发判定与运行历史（演示级：应用内轮询，真实跑批入库）----------
// 真实后端定时推送待部署形态锁定后接入；此处做到：到点在应用内自动用当前引擎跑一次并留存报告
export function shouldRunToday(sch, now = new Date()) {
  if (!sch.enabled) return false
  const [h, m] = (sch.time || '09:00').split(':').map(Number)
  if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return false
  if (sch.freq === 'weekly') return now.getDay() === 1 // 周一
  if (sch.freq === 'monthly') return now.getDate() === 1 // 每月 1 日
  return true // daily
}

export function touchRun(id) {
  const list = getSchedules()
  const i = list.findIndex(x => x.id === id)
  if (i >= 0) { list[i].lastRun = new Date().toISOString(); persist(list) }
}

const HIST_KEY = 'data-agent.schedule.history'
export function getHistory() {
  try { const raw = localStorage.getItem(HIST_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : [] }
  catch { return [] }
}
export function saveHistory(item) {
  const l = getHistory(); l.unshift(item); localStorage.setItem(HIST_KEY, JSON.stringify(l.slice(0, 50)))
}
export function clearHistory() { localStorage.removeItem(HIST_KEY) }
