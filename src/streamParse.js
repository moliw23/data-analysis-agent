// 大文件流式解析入口（模块②）：大 CSV/TXT/LOG 交给 Web Worker 流式解析
// 返回 Promise<{ columns, rows, totalRows, sampled, truncated }>，onProgress 实时回报进度
export function parseStreamFile(file, { onProgress, maxRows = 200000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' })
    } catch (e) {
      reject(new Error('当前环境不支持 Web Worker：' + (e.message || '')))
      return
    }
    let settled = false
    const cleanup = () => { try { worker.terminate() } catch (e) { /* ignore */ } }
    const abortHandler = () => { if (!settled) { settled = true; cleanup(); reject(new Error('已取消解析')) } }
    if (signal) {
      if (signal.aborted) { abortHandler(); return }
      signal.addEventListener('abort', abortHandler, { once: true })
    }
    worker.onmessage = (e) => {
      const m = e.data
      if (!m) return
      if (m.type === 'progress') {
        if (onProgress) onProgress({ rows: m.rows, totalRaw: m.totalRaw })
      } else if (m.type === 'done') {
        if (settled) return
        settled = true
        if (signal) signal.removeEventListener('abort', abortHandler)
        cleanup()
        resolve({ columns: m.columns, rows: m.rows, totalRows: m.totalRows, sampled: m.sampled, truncated: m.truncated })
      } else if (m.type === 'cancelled') {
        if (settled) return
        settled = true
        if (signal) signal.removeEventListener('abort', abortHandler)
        cleanup()
        reject(new Error('已取消解析'))
      } else if (m.type === 'error') {
        if (settled) return
        settled = true
        if (signal) signal.removeEventListener('abort', abortHandler)
        cleanup()
        reject(new Error(m.message || '解析失败'))
      }
    }
    worker.onerror = (e) => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', abortHandler)
      cleanup()
      reject(new Error((e && e.message) || '解析线程异常'))
    }
    worker.postMessage({ type: 'start', file, maxRows })
  })
}
