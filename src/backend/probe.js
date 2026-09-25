// 双形态探测：后端在线/离线唯一状态真相源（docs/04-详细设计 §2.2）
// 探测超时硬约束 1500ms（Spec §1.1）；状态由 zustand 微 store 承载，组件直接订阅。

import { create } from 'zustand'
import { apiGet } from './client.js'

export const useBackendStatus = create((set, get) => ({
  status: 'checking',            // 'checking' | 'online' | 'offline'
  capabilities: null,            // GET /capabilities 的 data（在线时缓存）
  privacyMode: null,             // 从 capabilities 派生
  lastProbeAt: 0,
  error: null,
}))

function applyProbe(set, health, caps) {
  set({
    status: 'online',
    capabilities: caps,
    privacyMode: (caps && caps.privacy_mode) || null,
    lastProbeAt: Date.now(),
    error: null,
  })
}

function applyOffline(set, err) {
  set({ status: 'offline', capabilities: null, privacyMode: null, lastProbeAt: Date.now(), error: err })
}

export async function probeNow() {
  const set = useBackendStatus.setState
  try {
    const health = await apiGet('/api/v1/health', { timeoutMs: 1500 })
    try {
      const caps = await apiGet('/api/v1/capabilities', { timeoutMs: 2500 })
      applyProbe(set, health, caps)
    } catch (capErr) {
      // health 通但 capabilities 失败：仍视为在线，能力按空处理
      applyProbe(set, health, null)
    }
    return get_status()
  } catch (e) {
    applyOffline(set, e)
    return 'offline'
  }
}

function get_status() { return useBackendStatus.getState().status }

export async function refreshCapabilities() {
  if (useBackendStatus.getState().status !== 'online') return null
  try {
    const caps = await apiGet('/api/v1/capabilities', { timeoutMs: 2500 })
    applyProbe(useBackendStatus.setState, null, caps)
    return caps
  } catch { return null }
}

// 档位变更（成功后调用）：先刷新派生能力，失败则整轮重探
export async function setPrivacyModeRemote(mode) {
  await apiPut('/api/v1/settings/privacy-mode', { privacy_mode: mode }, { confirm: true })
  const caps = await refreshCapabilities()
  if (!caps) await probeNow()
  return caps
}

let _timer = null
const PROBE_INTERVAL_MS = 30000

export function startBackendWatch() {
  if (_timer) return
  probeNow()
  _timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    probeNow()
  }, PROBE_INTERVAL_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') probeNow()
}

export function stopBackendWatch() {
  if (_timer) { clearInterval(_timer); _timer = null }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisible)
  }
}
