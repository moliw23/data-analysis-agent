// 日志文件解析：四级回退策略
// ① JSON lines ② 分隔符切分 ③ kv 正则抽取 ④ 兜底 {行号, 内容}
// 原则：宁可给原始数据，不给错误结构。

function buildTable(names, rows) {
  return { columns: names.map(n => ({ name: n })), rows }
}

function tryJSONLines(lines) {
  const objs = []
  let ok = 0
  for (const ln of lines) {
    const s = ln.trim()
    if (!s) continue
    try { objs.push(JSON.parse(s)); ok++ } catch { /* skip */ }
  }
  if (!objs.length || ok / lines.filter(l => l.trim()).length < 0.8) return null
  const cols = Array.from(new Set(objs.flatMap(o => Object.keys(o)))).slice(0, 50)
  const rows = objs.map(o => {
    const r = {}
    cols.forEach(c => { r[c] = o[c] === undefined || o[c] === null ? '' : String(o[c]) })
    return r
  })
  return buildTable(cols, rows)
}

function tryDelimiter(lines) {
  const seps = ['|', ';', '\t', ',']
  for (const sep of seps) {
    const split = lines.filter(l => l.trim()).map(l => l.split(sep).map(c => c.trim()))
    if (split.length < 3) continue
    const counts = split.map(r => r.filter(c => c !== '').length)
    const maxCols = Math.max(...counts)
    if (maxCols < 2) continue
    const consistent = counts.filter(c => c >= maxCols - 1).length
    if (consistent / split.length < 0.8) continue
    // 判断首行是否像表头（非纯数字）
    const first = split[0]
    const headerLike = first.some(c => c !== '' && isNaN(Number(c)))
    const cols = headerLike
      ? first.map((h, i) => h || `列${i + 1}`)
      : Array.from({ length: maxCols }, (_, i) => `字段${i + 1}`)
    const body = headerLike ? split.slice(1) : split
    const rows = body.map(r => {
      const o = {}
      cols.forEach((c, i) => { o[c] = (r[i] ?? '').trim() })
      return o
    })
    if (rows.length) return buildTable(cols, rows)
  }
  return null
}

function tryKV(lines) {
  const KV_RE = /([\w\u4e00-\u9fa5.-]+)[=:]\s*("[^"]*"|'[^']*'|[\w.,\-/:+]+)/g
  const parsed = []
  let ok = 0
  const nonEmpty = lines.filter(l => l.trim())
  for (const ln of nonEmpty) {
    const o = {}
    let m
    KV_RE.lastIndex = 0
    while ((m = KV_RE.exec(ln)) !== null) {
      o[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    if (Object.keys(o).length >= 2) { parsed.push(o); ok++ }
  }
  if (!parsed.length || ok / nonEmpty.length < 0.6) return null
  const cols = Array.from(new Set(parsed.flatMap(o => Object.keys(o)))).slice(0, 50)
  const rows = parsed.map(o => {
    const r = {}
    cols.forEach(c => { r[c] = o[c] ?? '' })
    return r
  })
  return buildTable(cols, rows)
}

function fallbackRaw(lines) {
  const rows = lines.map((l, i) => ({ 行号: String(i + 1), 内容: l })).slice(0, 2000)
  return { ...buildTable(['行号', '内容'], rows), note: '未识别出结构化字段，已按原始行展示（最多 2000 行）。' }
}

export function parseLogText(text) {
  const lines = text.split(/\r?\n/)
  const t1 = tryJSONLines(lines)
  const t2 = t1 || tryDelimiter(lines)
  const t3 = t2 || tryKV(lines)
  const table = t3 || fallbackRaw(lines)
  if (t1) table._mode = 'JSON lines'
  else if (t2) table._mode = '分隔符'
  else if (t3) table._mode = '键值对'
  else table._mode = '原始行'
  return table
}

export async function parseLogFile(file) {
  const text = await file.text()
  return parseLogText(text)
}
