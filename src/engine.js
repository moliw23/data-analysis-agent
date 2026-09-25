// ============================================================
// 数据分析引擎（Mock 模式，可离线运行）
// 管线：解析 → 语义层 → 质量诊断 → 图表推断 → 真实计算 → 洞察 → 报告/导出
//
// 本文件为「桶文件（barrel）」：仅做 re-export，真实实现按职责拆分在 ./engine/ 子模块中，
// 以便维护与单测隔离。对外接口（App / 测试 / 其它模块）的 import 路径保持不变。
//   _shared   公共常量与跨模块小工具
//   parse     解析（CSV/JSON/文件/流）
//   schema    语义推断、质量诊断、列画像
//   clean     缺失值/去重/异常值清洗
//   timeseries 时间序列、同环比、预测、异常检测、地图
//   pivot     交叉表、筛选、下钻匹配
//   charts    ECharts 配置生成（柱/线/饼/直方图/散点/多系列）
//   correlation 皮尔逊相关与热力图
//   manualChart 工具箱图表统一分发入口
//   analyze   分析主流程 + LLM 协作接口（按计划出图/意图执行/对话追问）
//   join      多表关联（join/preview/guess 键）
//   merge     多数据集联合分析（检测关联/堆叠/合并/跨表对比）
//   export    报告导出（HTML）与数据导出（CSV/Excel）
//   recommend 智能图表推荐
// ============================================================

export * from './engine/_shared.js'
export * from './engine/parse.js'
export * from './engine/schema.js'
export * from './engine/clean.js'
export * from './engine/timeseries.js'
export * from './engine/pivot.js'
export * from './engine/charts.js'
export * from './engine/correlation.js'
export * from './engine/manualChart.js'
export * from './engine/analyze.js'
export * from './engine/join.js'
export * from './engine/merge.js'
export * from './engine/export.js'
export * from './engine/recommend.js'
