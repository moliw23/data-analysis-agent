// 本地数据库代理：浏览器无法直接连接数据库（CORS + 安全），本代理在你的机器上
// 转发 SQL 到 MySQL / PostgreSQL，并把结果以 JSON 数组返回给前端。
//
// 启动：
//   cd <项目目录>
//   npm i mysql2 pg        # 仅用到对应数据库时可只装一个
//   node server/db-proxy.mjs
// 默认监听 http://localhost:3001 ，可通过环境变量 PORT 修改。
//
// 接口：POST /query
//   body: { type: 'mysql'|'postgres', connection: { host, port, user, password, database }, sql: 'SELECT ...' }
//   resp: { rows: [...] } 或 { error: '...' }
//
// 安全：仅监听本机回环地址（127.0.0.1），不对外暴露；凭证仅用于本次查询，不落盘、不上传。

import http from 'node:http'

const PORT = process.env.PORT || 3001
const HOST = '127.0.0.1'

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c; if (data.length > 5 * 1024 * 1024) req.destroy() })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function runQuery({ type, connection, sql }) {
  if (!connection || !sql) throw new Error('缺少 connection 或 sql')
  if (type === 'mysql') {
    let mysql
    try { mysql = await import('mysql2/promise') } catch { throw new Error('未安装 mysql2，请在项目目录运行：npm i mysql2') }
    const conn = await mysql.createConnection({
      host: connection.host || '127.0.0.1',
      port: Number(connection.port) || 3306,
      user: connection.user || '',
      password: connection.password || '',
      database: connection.database || ''
    })
    try {
      const [rows] = await conn.query(sql)
      return Array.isArray(rows) ? rows : (rows && rows.rows) ? rows.rows : []
    } finally { await conn.end().catch(() => {}) }
  }
  if (type === 'postgres') {
    let pg
    try { pg = await import('pg') } catch { throw new Error('未安装 pg，请在项目目录运行：npm i pg') }
    const client = new pg.Client({
      host: connection.host || '127.0.0.1',
      port: Number(connection.port) || 5432,
      user: connection.user || '',
      password: connection.password || '',
      database: connection.database || ''
    })
    await client.connect()
    try {
      const res = await client.query(sql)
      return res.rows || []
    } finally { await client.end().catch(() => {}) }
  }
  throw new Error('不支持的数据库类型：' + type)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return }
  if (req.method === 'POST' && req.url === '/query') {
    try {
      const raw = await readBody(req)
      const payload = JSON.parse(raw || '{}')
      const rows = await runQuery(payload)
      send(res, 200, { rows })
    } catch (e) {
      send(res, 200, { error: e.message || String(e) })
    }
    return
  }
  send(res, 404, { error: 'not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`[db-proxy] 监听 ${HOST}:${PORT}（仅本机）。前端「数据库」标签页默认连接此地址。`)
  console.log('[db-proxy] 首次使用请先：npm i mysql2 pg')
})
