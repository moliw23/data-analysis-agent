// 后端网关客户端：统一信封解包 + 业务错误归一化（docs/04-详细设计 §2.1）
// 铁律：本目录只做转发与状态，不做任何数据计算；离线时上层必须能完整回退。

const BASE_KEY = 'data-agent.backend.base'

export function getBackendBase() {
  try { return localStorage.getItem(BASE_KEY) || 'http://127.0.0.1:8000' } catch { return 'http://127.0.0.1:8000' }
}

export function setBackendBase(url) {
  try {
    if (url) localStorage.setItem(BASE_KEY, url.replace(/\/+$/, ''))
    else localStorage.removeItem(BASE_KEY)
  } catch { /* 隐私模式可能禁用 storage */ }
}

export class BackendError extends Error {
  constructor(code, message, data, kind) {
    super(message)
    this.name = 'BackendError'
    this.code = code          // 业务错误码（4010/4030/...）；网络层为 -1
    this.data = data || null  // 4030 时含 current_mode/required_modes/setting_path
    this.kind = kind || 'business' // 'business' | 'network'
  }
}

async function request(path, { method = 'GET', body, confirm = false, timeoutMs = 10000, signal } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onOuterAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (confirm) headers['X-Local-Confirm'] = 'true'
    let resp
    try {
      resp = await fetch(getBackendBase() + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (e) {
      if (signal && signal.aborted) throw e
      throw new BackendError(-1, '本地服务不可达', null, 'network')
    }
    let payload = null
    try { payload = await resp.json() } catch { /* 非 JSON 响应 */ }
    if (!payload || typeof payload.code === 'undefined') {
      throw new BackendError(-1, `本地服务响应异常（HTTP ${resp.status}）`, null, 'network')
    }
    if (payload.code !== 0) {
      throw new BackendError(payload.code, payload.message || '请求失败', payload.data || null, 'business')
    }
    return payload.data
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onOuterAbort)
  }
}

export function apiGet(path, opts = {}) {
  return request(path, { method: 'GET', ...opts })
}

export function apiPost(path, body, opts = {}) {
  return request(path, { method: 'POST', body, ...opts })
}

export function apiPut(path, body, opts = {}) {
  return request(path, { method: 'PUT', body, ...opts })
}
