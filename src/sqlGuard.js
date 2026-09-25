// Text-to-SQL 安全校验（模块④）：只读 SELECT 白名单 + 列名白名单
// 铁律：LLM 只生成 SQL 文本，数字 100% 由执行引擎算；此处兜底拦截危险语句

const BANNED = /\b(insert|update|delete|drop|alter|truncate|create|exec|execute|call|grant|revoke|attach|detach|vacuum|pragma|replace|merge|upsert|union\s+select|into\s+outfile|load_file|sleep|benchmark)\b/i

// 宽松关键词集（用于列名校验时排除 SQL 关键字与函数名）
const KEYWORDS = new Set([
  'select','from','where','group','by','order','having','limit','as','asc','desc','and','or','not','null',
  'distinct','between','in','like','case','when','then','else','end','is','top','all','join','left','right','inner','outer','on',
  'sum','avg','count','max','min','abs','round','floor','ceiling','lower','upper','trim','substr','substring','coalesce','ifnull','now','date','year','month','day','concat','length','min','max'
])

// 校验 SQL：{ ok: true, sql } 或 { ok: false, error }
export function validateSQL(sql, schema) {
  if (!sql || typeof sql !== 'string') return { ok: false, error: 'SQL 为空' }
  const s = sql.trim().replace(/;\s*$/, '')
  if (!/^select\b/i.test(s)) return { ok: false, error: '仅支持 SELECT 查询' }
  if ((s.match(/;/g) || []).length > 0) return { ok: false, error: '不允许使用分号执行多条语句' }
  if (BANNED.test(s)) return { ok: false, error: '检测到非只读操作，仅允许 SELECT' }
  if (s.length > 2000) return { ok: false, error: 'SQL 过长（>2000 字符）' }

  // 列名白名单（宽松提取：排除关键字/函数/AS 别名/数字/表名/字符串字面量）
  const validCols = new Set((schema.columns || []).map(c => c.name))
  const sNoStr = s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' ') // 字符串字面量以空格占位，避免误判为列
  const tokens = sNoStr.match(/[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*/g) || []
  const unknown = []
  const aliases = new Set() // AS 定义的别名（后面 ORDER BY 等可再引用）
  let prevWasFrom = false
  let prevWasAs = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const tl = t.toLowerCase()
    if (prevWasFrom) { prevWasFrom = false; continue } // FROM 后的表名跳过
    if (prevWasAs) { prevWasAs = false; aliases.add(t); continue } // AS 后的别名登记
    if (tl === 'from') { prevWasFrom = true; continue }
    if (tl === 'as') { prevWasAs = true; continue }
    if (KEYWORDS.has(tl)) continue
    if (/^\d+$/.test(t)) continue
    if (aliases.has(t)) continue
    if (validCols.has(t)) continue
    if (!unknown.includes(t)) unknown.push(t)
  }
  if (unknown.length) {
    return { ok: false, error: '未识别的列名：' + unknown.join('、') + '（请使用数据集内已有的列）' }
  }
  return { ok: true, sql: s }
}
