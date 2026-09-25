// LLM 网关路由：后端在线时 4 钩子走 /llm/chat，未配置/失败回退直连（docs/04-详细设计 §2.3）
// 铁律：网关只转发与记账；SQL 由前端 sqlEngine 执行，数字由 engine 计算。

import { apiPost } from './client.js'
import { BackendError } from './client.js'
import { useBackendStatus } from './probe.js'

export const TASK_KEYS = {
  plan: 'plan_analysis',
  narrate: 'narrate_insights',
  parse: 'parse_question',
  sql: 'text_to_sql',
}

function gatewayEnabled() {
  const st = useBackendStatus.getState()
  if (st.status !== 'online') return false
  const caps = st.capabilities
  if (caps && caps.llm && caps.llm.gatewayEnabled === false) return false
  return true
}

/**
 * 经网关执行一次 chat。返回模型原文（string）。
 * - 4010（后端未配 provider）：抛 BackendError，由调用方静默落回直连
 * - 4030（隐私闸门）：原样向上抛，禁止回退与自动重试
 * - 其他错误：抛出，调用方决定是否降级
 */
export async function gatewayChat(taskKey, messages, { timeoutMs = 20000 } = {}) {
  if (!TASK_KEYS[Object.keys(TASK_KEYS).find(k => TASK_KEYS[k] === taskKey)]) {
    // 未知 taskKey 仍放行（后端为唯一校验方），仅保留常量作映射文档
  }
  const data = await apiPost('/api/v1/llm/chat', { taskKey, messages }, { timeoutMs })
  const content = data && typeof data.content === 'string' ? data.content : null
  if (!content) throw new BackendError(-1, '网关返回为空', null, 'network')
  return content
}

export { gatewayEnabled }
