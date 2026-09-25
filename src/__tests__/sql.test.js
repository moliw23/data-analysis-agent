import { describe, it, expect } from 'vitest'
import { validateSQL } from '../sqlGuard.js'
import { executeSQL } from '../sqlEngine.js'

const schema = { columns: [{ name: '区域' }, { name: '销售额' }, { name: '订单数' }, { name: '日期' }] }

const TABLE = {
  columns: [{ name: '区域' }, { name: '销售额' }],
  rows: [
    { 区域: '华东', 销售额: 100 },
    { 区域: '华南', 销售额: 200 },
    { 区域: '华东', 销售额: 300 },
    { 区域: '华北', 销售额: 150 },
  ],
}

describe('SQL 安全白名单 validateSQL', () => {
  it('允许单条只读 SELECT（含 WHERE / GROUP BY / ORDER BY / LIMIT）', () => {
    const r = validateSQL('SELECT 区域, SUM(销售额) AS s FROM t GROUP BY 区域 ORDER BY s DESC LIMIT 10', schema)
    expect(r.ok).toBe(true)
  })

  it('允许带字符串字面量的 WHERE', () => {
    const r = validateSQL("SELECT * FROM t WHERE 区域 = '华东'", schema)
    expect(r.ok).toBe(true)
  })

  it('拦截 DROP 等 DDL', () => {
    const r = validateSQL('DROP TABLE t', schema)
    expect(r.ok).toBe(false)
  })

  it('拦截 UPDATE / DELETE 等 DML', () => {
    expect(validateSQL('UPDATE t SET 销售额 = 0', schema).ok).toBe(false)
    expect(validateSQL('DELETE FROM t', schema).ok).toBe(false)
  })

  it('拦截分号多语句', () => {
    const r = validateSQL('SELECT * FROM t; DELETE FROM t', schema)
    expect(r.ok).toBe(false)
  })

  it('拦截引用不存在的列', () => {
    const r = validateSQL('SELECT 不存在列 FROM t', schema)
    expect(r.ok).toBe(false)
  })
})

describe('SQL 执行引擎 executeSQL（alasql 真实执行）', () => {
  it('GROUP BY 聚合返回正确结果', async () => {
    const res = await executeSQL(TABLE, 'SELECT 区域, SUM(销售额) AS 销售额 FROM t GROUP BY 区域 ORDER BY 2 DESC LIMIT 5')
    expect(res.columns.map(c => c.name)).toEqual(['区域', '销售额'])
    expect(res.rows.length).toBe(3)
    // 华东 100+300=400 应排第一
    expect(res.rows[0].区域).toBe('华东')
    expect(res.rows[0].销售额).toBe(400)
  })

  it('中文列名自动加反引号可正常执行', async () => {
    const res = await executeSQL(TABLE, 'SELECT 区域 FROM t WHERE 销售额 > 150')
    expect(res.rows.map(r => r.区域)).toEqual(['华南', '华东'])
  })

  it('超阈值结果被截断并标记', async () => {
    const big = { columns: TABLE.columns, rows: Array.from({ length: 20 }, (_, i) => ({ 区域: 'R' + i, 销售额: i })) }
    const res = await executeSQL(big, 'SELECT * FROM t', { limit: 5 })
    expect(res.rows.length).toBe(5)
    expect(res.truncated).toBe(true)
  })
})
