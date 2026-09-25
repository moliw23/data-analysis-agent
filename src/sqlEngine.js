// Text-to-SQL 内存表执行引擎（模块④，后端 A）：alasql 动态 import，离线无后端
// 把当前 table 注册为 alasql 临时表（对象数组），执行校验过的只读 SELECT，返回 { columns, rows, truncated, sql }

let alasqlMod = null
const ALIAS = 'ds' // 统一别名，SQL 中真实表名会被替换为此

// alasql 方言要求中文等非 ASCII 标识符用反引号包裹：给列名（非纯 ASCII 标识符）加反引号
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function quoteIdentifiers(sql, cols) {
  let out = sql
  for (const col of cols) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
      const re = new RegExp('(?<![A-Za-z0-9_`\\u4e00-\\u9fa5])' + escapeRegExp(col) + '(?![A-Za-z0-9_`\\u4e00-\\u9fa5])', 'g')
      out = out.replace(re, '`' + col + '`')
    }
  }
  return out
}

export async function executeSQL(table, sql, { limit = 5000 } = {}) {
  if (!alasqlMod) {
    try { alasqlMod = (await import('alasql')).default } catch (e) {
      throw new Error('内存 SQL 引擎加载失败（alasql）：' + (e && e.message))
    }
  }
  const alasql = alasqlMod
  // 注册当前表：对象数组（列名即键），避免逐行建表插入的开销
  try { alasql.tables[ALIAS] = { data: table.rows } } catch (e) { /* 注册失败时下面仍会尝试 */ }
  // 把 SQL 中的真实表名替换为别名（找不到表名则补 from 别名）
  let finalSql = sql
  const fm = sql.match(/from\s+([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*)/i)
  if (fm) finalSql = sql.replace(fm[1], ALIAS)
  else if (/from/i.test(sql)) finalSql = sql.replace(/from\s*/i, 'from ' + ALIAS + ' ')
  // 中文等非 ASCII 列名 → 反引号（alasql 方言要求）
  finalSql = quoteIdentifiers(finalSql, (table.columns || []).map(c => c.name))
  let result
  try {
    result = alasql(finalSql)
  } catch (e) {
    throw new Error('SQL 执行失败：' + ((e && e.message) || String(e)))
  }
  if (!Array.isArray(result)) result = []
  const truncated = result.length > limit
  const out = truncated ? result.slice(0, limit) : result
  const cols = out.length ? Object.keys(out[0]).map(n => ({ name: n })) : []
  return { columns: cols, rows: out, truncated, sql: finalSql }
}
