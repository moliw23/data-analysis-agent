// AC-20 会话持久化（双轨）：后端在线时把问数消息同步到 /conversations；
// 本地 chat 状态仍是唯一渲染真相，同步失败静默（离线零影响）。
import { useBackendStatus } from './probe.js'
import { apiGet, apiPost } from './client.js'

let _conversationId = null
let _creating = null

function online() { return useBackendStatus.getState().status === 'online' }

async function ensureConversation(fileName) {
  if (_conversationId) return _conversationId
  if (!_creating) {
    _creating = apiPost('/api/v1/conversations', {
      title: `问数 · ${fileName || '未命名数据集'}`,
    }, { timeoutMs: 5000 }).then(d => { _conversationId = d.id; return d.id })
  }
  try { return await _creating } catch { _creating = null; return null }
}

export async function syncUserMessage(text, fileName) {
  if (!online()) return
  try {
    const cid = await ensureConversation(fileName)
    if (cid) await apiPost(`/api/v1/conversations/${cid}/messages`, { role: 'user', content: text }, { timeoutMs: 5000 })
  } catch { /* 静默：本地为准 */ }
}

export async function syncBotMessage(text, fileName) {
  if (!online() || !text) return
  try {
    const cid = await ensureConversation(fileName)
    if (cid) await apiPost(`/api/v1/conversations/${cid}/messages`, { role: 'assistant', content: text }, { timeoutMs: 5000 })
  } catch { /* 静默 */ }
}

/** 拉取最近会话消息（旧→新），供空 chat 时回填。失败返回 []。 */
export async function loadRecentMessages(fileName) {
  if (!online()) return []
  try {
    const cid = await ensureConversation(fileName)
    if (!cid) return []
    const page = await apiGet(`/api/v1/conversations/${cid}/messages?page=1&limit=20`, { timeoutMs: 5000 })
    const items = (page.items || []).slice().reverse() // 接口倒序 → 转正序
    return items.map(m => ({ role: m.role === 'assistant' ? 'bot' : m.role, text: m.content }))
  } catch { return [] }
}

export function resetConversationCache() { _conversationId = null; _creating = null }
