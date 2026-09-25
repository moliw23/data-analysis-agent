// 大文件流式解析 Worker（模块②）：
// 主线程把 File 对象传入 → 本 Worker 用 File.stream() + ReadableStream 分块读取、
// TextDecoder 流式解码、逐字符 CSV 状态机（与 engine.parseCSV 同算法）增量解析。
// 进度通过 postMessage 实时回报；支持取消；内存上限由 maxRows 控制（超出只保留前 N 行采样）。
// 首版范围：UTF-8 的 CSV/TXT/LOG；GBK/JSON/Excel 仍走主线程路径。

let cancelled = false

self.onmessage = async (e) => {
  const d = e.data
  if (!d || d.type === 'cancel') { cancelled = true; return }
  if (d.type !== 'start') return
  const { file, maxRows = 200000 } = d
  try {
    const stream = file.stream()
    const reader = stream.getReader()
    const dec = new TextDecoder('utf-8', { ignoreBOM: true })
    let headers = []
    let headerDone = false
    let rows = []
    let totalRaw = 0
    let field = ''
    let row = []
    let inQuotes = false

    // 与 engine.parseCSV 一致的逐字符状态机；跨块调用时状态保留（引号/换行正确拼接）
    const feed = (text, isEnd) => {
      for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
          } else field += c
        } else {
          if (c === '"') inQuotes = true
          else if (c === ',') { row.push(field); field = '' }
          else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++
            row.push(field); field = ''
            if (!headerDone) {
              headers = row.map(h => String(h).trim())
              headerDone = true
              row = []
              continue
            }
            if (row.length > 1 || (row.length === 1 && String(row[0]).trim() !== '')) {
              totalRaw++
              if (rows.length < maxRows) {
                const o = {}
                headers.forEach((h, j) => { o[h] = String(row[j] ?? '').trim() })
                rows.push(o)
              }
              if (rows.length % 5000 === 0 || totalRaw % 50000 === 0) {
                postMessage({ type: 'progress', rows: rows.length, totalRaw })
              }
            }
            row = []
          } else field += c
        }
      }
      if (isEnd && (field !== '' || row.length)) {
        row.push(field); field = ''
        if (!headerDone) {
          headers = row.map(h => String(h).trim())
          headerDone = true
        } else if (row.length > 1 || (row.length === 1 && String(row[0]).trim() !== '')) {
          totalRaw++
          if (rows.length < maxRows) {
            const o = {}
            headers.forEach((h, j) => { o[h] = String(row[j] ?? '').trim() })
            rows.push(o)
          }
        }
        row = []
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = dec.decode(value, { stream: true })
      const lastNl = chunk.lastIndexOf('\n')
      if (lastNl >= 0) feed(chunk.slice(0, lastNl + 1), false)
      feed(chunk.slice(lastNl + 1), false)
      if (cancelled) { postMessage({ type: 'cancelled' }); return }
    }
    const tail = dec.decode()
    if (tail) feed(tail, true)

    if (!headerDone || !headers.length) {
      postMessage({ type: 'error', message: '文件内容不是可识别的表格（未找到表头行）' })
      return
    }
    postMessage({
      type: 'done',
      columns: headers.map(h => ({ name: h })),
      rows,
      totalRows: totalRaw,
      sampled: totalRaw > rows.length,
      truncated: totalRaw > maxRows,
    })
  } catch (err) {
    postMessage({ type: 'error', message: (err && err.message) || String(err) })
  }
}
