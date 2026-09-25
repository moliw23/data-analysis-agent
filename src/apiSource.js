// API 数据源：URL GET 拉取 → 复用 engine.parseJSON 归一
import { parseJSON } from './engine.js'

export async function fetchApiData(url) {
  let parsedUrl
  try { parsedUrl = new URL(url) } catch { throw new Error('URL 格式不正确') }
  if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error('仅支持 http/https 协议')

  let resp
  try {
    resp = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json,text/plain,*/*' } })
  } catch {
    throw new Error('请求失败：可能是网络错误或目标接口不允许跨域访问（CORS）。请确认接口已开放 CORS，或改用文件上传。')
  }
  if (!resp.ok) throw new Error(`接口返回 ${resp.status} ${resp.statusText}`)
  const text = await resp.text()
  const table = parseJSON(text)
  if (!table || !table.rows.length) throw new Error('接口返回内容不是可识别的 JSON 数组数据')
  return table
}

// 经本地代理转发 SQL 到数据库（浏览器无法直接连 DB）。代理需自行部署（见 server/db-proxy.mjs）
export async function queryViaProxy(proxyUrl, payload) {
  let base
  try { base = new URL(proxyUrl) } catch { throw new Error('代理地址格式不正确，应为 http://host:port') }
  const url = base.origin + '/query'
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch {
    throw new Error('无法连接代理（' + base.origin + '）：请先运行 node server/db-proxy.mjs 启动本地代理。')
  }
  if (!resp.ok) {
    let msg = '代理返回 HTTP ' + resp.status
    try { const j = await resp.json(); if (j && j.error) msg = j.error } catch (e) { /* ignore */ }
    throw new Error(msg)
  }
  const j = await resp.json()
  if (j.error) throw new Error(j.error)
  return j.rows
}
