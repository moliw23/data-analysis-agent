// 测试全局 setup：统一清理 jsdom DOM（避免组件测试间 DOM 累积导致多元素匹配）
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
