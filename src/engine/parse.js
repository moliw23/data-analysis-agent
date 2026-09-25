// 解析层：CSV / JSON / 文件 / 文本解码（均为引擎自有实现，可离线运行）

// CSV 状态机：处理引号内逗号、引号内换行、CRLF
function parseCSV(text) {
  const rows = []
  let field = '', row = [], inQuotes = false
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
        row.push(field); field = ''; rows.push(row); row = []
      } else field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const headers = rows.shift().map(h => h.trim())
  const data = rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== '')).map(r => {
    const o = {}
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
    return o
  })
  return { columns: headers.map(h => ({ name: h })), rows: data }
}

export function parseJSON(text) {
  const obj = JSON.parse(text)
  let arr = Array.isArray(obj) ? obj : (obj.data && Array.isArray(obj.data) ? obj.data : null)
  if (!arr || !arr.length) throw new Error('JSON 需为对象数组')
  const headers = Object.keys(arr[0])
  return { columns: headers.map(h => ({ name: h })), rows: arr.map(o => {
    const r = {}
    headers.forEach(h => { r[h] = o[h] == null ? '' : (typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h])) })
    return r
  }) }
}

// 文本编码探测：优先 UTF-8 严格解码，失败或出现替换字符则回退 GBK
// （Windows/Excel 导出的 CSV 常见 GBK/GB2312 编码，直接 file.text() 会乱码）
export function decodeText(buf) {
  let text = null
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch (e) { /* 非法 UTF-8 序列 */ }
  if (text != null && !text.includes('\uFFFD')) return text
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch (e2) {
    return text != null ? text : new TextDecoder('utf-8').decode(buf)
  }
}

export async function parseFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const buf = await file.arrayBuffer()
    const text = decodeText(buf)
    return parseCSV(text)
  }
  if (name.endsWith('.json')) {
    const text = await file.text()
    return parseJSON(text)
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const headers = Object.keys(data[0] || {})
    return { columns: headers.map(h => ({ name: h })), rows: data.map(o => {
      const r = {}; headers.forEach(h => { r[h] = o[h] == null ? '' : String(o[h]) }); return r
    }) }
  }
  throw new Error('不支持的格式：' + file.name)
}

export function parseCSVText(text) { return parseCSV(text) }
