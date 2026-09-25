# 数据分析 Agent · 可运行切片交付说明（Phase 3）

> 流程：Phase 0 需求澄清 → Phase 1 调研 → Phase 1.5 Spec → **Phase 3 端到端可运行切片**
> 配套规划文档：`../.workbuddy/plans/数据分析Agent-Phase1.5-Spec.md`

## 交付内容
一个**端到端可运行**的数据分析 Agent（前端切片），位于 `data-analysis-agent/`：
- 技术栈：Vite + React 18 + ECharts 5 + Lucide 图标 + SheetJS(xlsx)
- 运行：`npm install` → `npm run dev` → 打开 `http://localhost:5173/`

## 已实现的核心链路（Mock 引擎，离线可跑）
1. **上传/接入**：CSV / Excel(.xlsx) / JSON，自动解析归一为统一表结构
2. **语义层**：自动识别 维度 / 度量 / 时间 列
3. **数据质量诊断**：缺失、重复行、类型冲突、IQR 异常值检测 + 评分 + 修复建议
4. **可视化出图**：按语义推断图表类型（折线/柱状/饼/直方图/散点），真实计算聚合
5. **实质化建议**：每条结论附「口径说明」，数字可回溯
6. **对话式追问**：围绕数据集持续追问（最高/最低/均值/趋势/占比），答案由真实统计支撑
7. **一键报告导出**：图表 + 结论 + 数据预览 沉淀为独立 HTML 报告

## 设计基线（对齐「完美工作台」）
- 淡紫主色 `#8B7EC8` / `#8b5cf6`；bg `#FAF9FC`；移动端优先（OPPO A96 视窗）
- 触控热区 ≥40px；Lucide 线条图标（禁 emoji）；anti-slop 8 红线（禁渐变/营销 Hero/虚构指标）
- 8 页信息架构：入口 / 上传 / 看板 / 图表详情 / 质量诊断 / 报告导出 / 追问面板

## 与 Spec 的对应关系
- `src/engine.js` = Spec 中「自有 FastAPI 执行引擎」的可运行等价实现，接口形态一致，**后续可平滑替换为后端 + Dify 编排**（Provider 可切换，Mock 模式保留以便离线演示）。
- 定时调度+推送按决策 D3 后置（依赖部署形态与推送通道，待 Phase 1.5 后接入）。

## 验证
- `npm run build` 通过（2069 模块，产出 `dist/`）
- dev server `http://localhost:5173/` 返回 HTTP 200
- 可用「使用示例数据」一键走通全链路（示例含 1 处缺失值以演示质量诊断）

## 后续（未含在本切片）
- 接入真实 LLM / Dify 编排（替换 Mock 引擎）
- 定时调度 + 钉钉/企微/邮件推送
- 多表关联、NL2SQL 直连（Spec 列为 Backlog）
