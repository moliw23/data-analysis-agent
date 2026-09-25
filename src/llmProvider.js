// LLM Provider（网关优先 → OpenAI 兼容直连 → Mock 降级）
// 铁律：LLM 只做「选择与解释」——图表规划、意图解析、文案组织；
//      所有数字由 engine 真实计算，禁止把原始数据丢给模型口算。
// 双形态：后端在线时钩子走网关（/llm/chat），离线/未配 provider 回退本机直连。

import { gatewayChat, gatewayEnabled, TASK_KEYS } from './backend/gateway.js'

const LS_KEY = 'data-agent.llm.config'

// 会话级（不持久化）配置缓存：用户选择「仅本次会话」时，Key 只存内存，关闭页面即清除
let _sessionCfg = null

export function getLLMConfig() {
  if (_sessionCfg && _sessionCfg.baseUrl && _sessionCfg.apiKey && _sessionCfg.model) return _sessionCfg
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw)
    if (cfg && cfg.baseUrl && cfg.apiKey && cfg.model) return cfg
    return null
  } catch { return null }
}

// persist=false：仅写入内存，避免明文 Key 长期停留在 localStorage（降低 XSS 窃取风险）
export function saveLLMConfig(cfg, { persist = true } = {}) {
  if (persist) {
    _sessionCfg = null
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)) } catch { /* 隐私模式可能禁用 storage */ }
  } else {
    _sessionCfg = cfg
    try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
  }
}

export function clearLLMConfig() {
  _sessionCfg = null
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}

export function isLLMConfigured() {
  return !!getLLMConfig()
}

async function rawChat(messages, { timeoutMs = 15000, temperature = 0.2 } = {}) {
  const cfg = getLLMConfig()
  if (!cfg) throw new Error('LLM 未配置')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const base = cfg.baseUrl.replace(/\/+$/, '')
    const resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`接口返回 ${resp.status}${detail ? '：' + detail.slice(0, 120) : ''}`)
    }
    const data = await resp.json()
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!content) throw new Error('接口未返回内容')
    return content
  } finally {
    clearTimeout(timer)
  }
}

function parseJSONLoose(text) {
  try { return JSON.parse(text) } catch { /* 下一步 */ }
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) {
    try { return JSON.parse(m[1]) } catch { /* 下一步 */ }
  }
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)) } catch { /* 放弃 */ }
  }
  throw new Error('返回内容无法解析为 JSON')
}

async function chatJSON(messages, opts, taskKey) {
  // 网关优先：仅后端在线且网关未被禁用时尝试
  if (gatewayEnabled() && taskKey) {
    try {
      return parseJSONLoose(await gatewayChat(taskKey, messages, opts))
    } catch (e) {
      if (e && e.code === 4030) throw e // 隐私闸门：不回退、不自动重试，向上展示切档引导
      // 4010（后端未配 provider）/ 4020 / 网络错 → 静默落回本机直连
    }
  }
  return parseJSONLoose(await rawChat(messages, opts))
}

// 统一降级封装：任何失败都回退 mock，并说明原因
export async function withLLMFallback(fn, fallbackFactory) {
  if (!isLLMConfigured()) return { value: fallbackFactory('未配置 LLM，使用内置规则引擎'), mode: 'mock', reason: '未配置' }
  try {
    const value = await fn()
    if (value === null || value === undefined) return { value: fallbackFactory('LLM 返回为空'), mode: 'mock', reason: '返回为空' }
    return { value, mode: 'llm' }
  } catch (e) {
    return { value: fallbackFactory('LLM 调用失败：' + (e.message || e)), mode: 'mock', reason: e.message || String(e) }
  }
}

/* ---------- 钩子 1：图表规划（AnalysisPlan） ---------- */
export async function planAnalysis(schemaSummary) {
  const messages = [
    { role: 'system', content: '你是数据分析规划器。只输出 JSON，格式：{"charts":[{"chartType":"line|bar|pie|histogram|scatter","measure":"列名或null","dimension":"列名或null","timeField":"列名或null","aggregation":"sum|avg|count|max|min","title":"图表标题"}],"insightFocus":["关注点1","关注点2"]}。规则：数值型列用 measure 做 bar/line/histogram；若数据集没有数值列，用 pie 展示分类构成（chartType=pie、measure 置 null、dimension 为分类型列且基数≤12）；line 需要 timeField；最多 5 张图；只使用给定的列名，不要发明列。' },
    { role: 'user', content: `数据集概况：\n${JSON.stringify(schemaSummary)}` },
  ]
  const plan = await chatJSON(messages, {}, TASK_KEYS.plan)
  if (!plan || !Array.isArray(plan.charts) || !plan.charts.length) return null
  return plan
}

/* ---------- 钩子 2：结论叙述（基于已算好的统计量） ---------- */
export async function narrateInsights(statSummary) {
  const messages = [
    { role: 'system', content: '你是数据分析撰写者。你会收到一份「已由代码真实计算完成」的统计摘要。任务：把摘要改写为 3-5 条给业务人员看的中文结论与可落地建议。铁律：严禁自行计算或编造任何数字，只能引用摘要中已有的数字；每条包含 text（结论+建议）与 caliber（口径说明，可从摘要的口径字段提取）。只输出 JSON：{"insights":[{"text":"...","caliber":"...","icon":"summary|trend|rank|dist|share"}]}' },
    { role: 'user', content: JSON.stringify(statSummary) },
  ]
  const out = await chatJSON(messages, {}, TASK_KEYS.narrate)
  if (!out || !Array.isArray(out.insights) || !out.insights.length) return null
  return out.insights.map(i => ({
    text: String(i.text || ''), caliber: String(i.caliber || '口径见统计摘要'),
    icon: ['summary', 'trend', 'rank', 'dist', 'share'].includes(i.icon) ? i.icon : 'summary',
  })).filter(i => i.text)
}

/* ---------- 钩子 3：追问意图解析 ---------- */
export async function parseQuestion(schemaSummary, question) {
  const messages = [
    { role: 'system', content: '你是查询意图解析器。把用户的自然语言问题解析为 JSON：{"metric":"数值列名","dim":"维度列名或null","op":"max|min|avg|sum|trend|share","timeRange":"all 或 null"}。只使用给定列名；无法确定 metric 时输出 {"metric":null}。只输出 JSON。' },
    { role: 'user', content: `数据集概况：${JSON.stringify(schemaSummary)}\n用户问题：${question}` },
  ]
  const out = await chatJSON(messages, {}, TASK_KEYS.parse)
  if (!out || !out.metric) return null
  return { metric: String(out.metric), dim: out.dim ? String(out.dim) : null, op: out.op || 'max' }
}

/* ---------- 钩子 4：Text-to-SQL（模块④）生成只读 SELECT ---------- */
// 铁律：LLM 只生成 SQL 文本，数据由内存 SQL 引擎真实执行；模型不碰原始数字
export async function textToSQL(schemaSummary, question) {
  const tableName = schemaSummary.tableName || 't'
  const messages = [
    {
      role: 'system',
      content: `你是 SQL 生成器。根据给定表结构与用户问题，生成**单条只读 SELECT** 查询。硬性规则：
1. 只能 SELECT，可含 WHERE/GROUP BY/ORDER BY/LIMIT，禁止任何写操作与多语句（分号）；
2. 列名只能使用给定表中的列（表名 ${JSON.stringify(tableName)}，写为 \`FROM ${tableName}\`）；
3. 数字计算全部在 SQL 里做（SUM/AVG/COUNT/MAX/MIN），不要口头回答数字；
4. 结果集控制在 200 行内（必要时 LIMIT），优先给出 top 类排序；
5. 只输出 JSON，格式：{"sql":"...","explanation":"给业务人员的一句话解释","chartHint":"bar|line|pie|table|none"}。`
    },
    { role: 'user', content: `表结构（列名+类型+语义）：\n${JSON.stringify(schemaSummary)}\n\n用户问题：${question}` },
  ]
  const out = await chatJSON(messages, {}, TASK_KEYS.sql)
  if (!out || !out.sql || typeof out.sql !== 'string') return null
  return {
    sql: String(out.sql).trim(),
    explanation: typeof out.explanation === 'string' ? out.explanation : '',
    chartHint: ['bar', 'line', 'pie', 'table', 'none'].includes(out.chartHint) ? out.chartHint : 'none'
  }
}

/* ---------- 连接测试 ---------- */
export async function testConnection() {
  const content = await rawChat([{ role: 'user', content: '请返回 {"ok":true}' }], { timeoutMs: 12000 })
  return parseJSONLoose(content)
}
