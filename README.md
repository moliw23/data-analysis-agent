# 数据分析 Agent · Data Analysis Agent

> 全栈自助数据分析工作台：**浏览器端分析引擎 + 本地 FastAPI 服务**。
> 明细数据默认不出本机（隐私三档闸门），AI 只接触 schema 与统计量。从文件 / API / 数据库接入数据，经流式解析、清洗、质量诊断后，自动生成看板、图表、Text-to-SQL 问答、RAG 知识库检索与多格式报告；LLM 网关、会话记忆、真实 cron 调度由本地服务托管。

[![build](https://github.com/moliw23/data-analysis-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/moliw23/data-analysis-agent/actions)
[![test](https://img.shields.io/badge/test-258%20passed-brightgreen)](#测试)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#)

---

## ✨ 架构形态：双模式

| 形态 | 触发 | 能力 |
|---|---|---|
| **本地服务增强模式** | 前端探测 `GET /api/v1/health` 成功 | 全部能力：LLM 网关、会话与记忆持久化、RAG 知识库、服务端只读 SQL、真实 cron 调度与通知 |
| **纯浏览器模式** | 探测失败（1.5s 超时） | 9 视图本地分析能力 **100% 可用**，仅 AI 记忆 / 知识库 / 服务端调度不可用，状态条明示原因与启动指引 |

顶栏常驻双形态状态条与隐私档位指示器（解释入口，非标签）；`Cmd/Ctrl+K` 打开命令面板跳转全部视图。

---

## ✨ 核心功能

### 浏览器端（分析引擎）

| 模块 | 说明 |
|---|---|
| **多源数据接入** | CSV / Excel / JSON / 日志 / HTTP API；多数据集工作台 + 自动关联键检测 + 联合分析 |
| **大文件流式解析** | Web Worker + `File.stream()`，>8MB 自动流式，实测 **56 万行 / 15MB ≈ 8.9s** |
| **分析看板** | 质量评分、AI 结论（LLM / 规则双模式）、智能图表推荐（8 类）、筛选 / 下钻 / 联动 |
| **Text-to-SQL 闭环** | 自然语言 → SQL → 只读白名单校验 → alasql 真实执行 → 结果表 + 图表；支持手改 SQL 重跑 |
| **分析工具箱** | 时间趋势 / Top N / 同环比 / 相关性 / 透视表 / 列画像 |
| **报告导出** | HTML / PDF / Word / PPTX / Excel / CSV 六格式，同一指标数值完全一致 |
| **模板库** | 保存 / 复用分析模板，跨表语义角色映射；模板仅含配置不含原始数据 |

### 本地服务（FastAPI 后端）

| 模块 | 说明 |
|---|---|
| **隐私三档闸门（F0）** | strict(默认)/standard/full 单一真相源 `CAPABILITY_GATES`，贯穿路由级 / 请求体级 / capabilities 派生三类消费点；阻断统一 4030 且带可执行切档指引 |
| **LLM 网关（F1）** | 多 Provider 托管（Fernet 加密落库、响应只回掩码）、按 taskKey 路由 + 3s fallback、调用日志（request_id/tokens/latency）、Token 统计 NULL≠0 口径 |
| **会话与记忆（F6）** | conversations/messages/memories 全套 CRUD；上下文组装 = 记忆注入 + 滚动摘要 + token 预算裁剪；记忆总开关（关闭零注入） |
| **RAG 知识库（F9）** | 上传 pdf/docx/md/txt/csv → 解析切分 → FTS5(trigram) 中文检索；语义通道预留（chromadb 分层安装）；关键词降级徽标；出本机凭据 `ingested_mode/ingested_at` 审计 |
| **服务端只读 SQL（F2/F7）** | CSV 落库为真实 SQLite 表（数值列类型推断）；sql_guard 拦截 DDL/DML/多语句/PRAGMA 并给具体原因；`mode=ro` 只读连接执行 |
| **真实调度（F7）** | APScheduler 同进程 cron——**关浏览器照常执行**；运行历史（状态/耗时/行数/错误）；连续 3 次失败自动暂停并通知（AC-23） |
| **敏感操作确认** | 改档位 / 写密钥 / 开关记忆必须带 `X-Local-Confirm`，防 CSRF 与误点 |

---

## 🧱 技术栈

**前端**：React 18.3 + Vite 5 · ECharts 5 · alasql 4（动态 import）· Zustand · SheetJS / pptxgenjs · Web Worker 流式解析 · IndexedDB + localStorage · Vitest · design-tokens 设计令牌体系（Linear 式极简高密度，浅/暗双主题）

**后端**：Python 3.12+ · FastAPI · SQLAlchemy 2.0 · SQLite（WAL + busy_timeout + FTS5 trigram）· APScheduler · httpx · cryptography(Fernet) · pydantic-settings · pytest

> 架构取舍：本地优先（local-first）——后端与浏览器同机部署，服务端只存元数据与用户显式上传的服务端数据集；strict 档下明细与文档分块一律不出本机。

---

## 🏗️ 架构

```mermaid
flowchart LR
  subgraph 浏览器
    A[文件 / API] --> B[parseWorker 流式解析]
    B --> C[engine.js 分析引擎<br/>schema/quality/analyze/charts/join]
    Q[自然语言] --> R[llmProvider<br/>网关优先→直连→mock]
    S[sqlGuard 只读白名单] --> T[alasql 执行]
    U[看板 / 工具箱 / 问答 / 报告]
  end
  subgraph 本地 FastAPI 服务
    H[health / capabilities<br/>双形态探测]
    G[LLM 网关<br/>providers/chat/logs]
    K[(SQLite WAL<br/>会话/记忆/RAG/数据集/调度)]
    P[隐私闸门<br/>4030]
    CR[APScheduler cron]
  end
  R -. 1.5s 探测 .-> H
  R --> G
  C -. 在线同步 .-> K
  G --- P --- K
  CR --> K
```

---

## 🚀 快速开始

```bash
# 1) 前端
npm install
npm run dev            # http://localhost:5173

# 2) 本地服务（可选，启用网关/记忆/RAG/调度）
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-core.txt
.venv/Scripts/python run.py    # http://127.0.0.1:8000 （/docs 查看 OpenAPI）

# 3) 端到端验收（可选，13 项断言）
bash scripts/e2e_check.sh
```

打开首页点击「示例数据」即可一键体验全流程；启动本地服务后顶栏自动切为「已连接」。

---

## 🧪 测试

**共 258 项全绿**：

```bash
npm test                                    # 前端 Vitest：175 项 / 16 文件
cd backend && .venv/Scripts/python -m pytest tests/   # 后端 pytest：83 项 / 7 文件
```

- **前端（175）**：引擎层纯函数、Zustand store、全部核心视图与交互、双形态适配层（client/probe/网关回退链/4030 不回退）、命令面板、知识库与记忆面板。
- **后端（83）**：统一信封与错误码、F0 隐私闸门三档 × 端点矩阵逐格断言、密钥明文零泄漏、LLM 网关 fallback 与 Token 口径（NULL≠0）、会话/记忆/上下文裁剪、RAG 入库检索与 4091、sql_guard 拦截矩阵、调度三连败熔断与通知。
- **端到端**：`scripts/e2e_check.sh` 真实启动 uvicorn + curl 13 项断言（健康/档位/4010/4030/掩码/上传/只读 SQL/拦截）。

---

## 🔐 安全说明

- **隐私档位**：strict 档下明细与文档分块一律不出本机；档位语义是"禁外传"而非"禁本地访问"。
- **密钥托管**：API Key Fernet 加密落库，任何响应/日志只出现掩码（`sk-***abc`），grep 不到明文。
- **双重 SQL 防线**：前端 sqlGuard 白名单 + 后端 sql_guard 拦截并返回具体命中原因。
- **Text-to-SQL 铁律**：LLM 只生成 SQL 文本与解释，所有数字由真实引擎计算，模型不碰原始数据。
- **报告转义**：数据 / LLM 输出写入 HTML 前经 `esc()` 转义，防存储型 XSS。
- **审计**：文档入库记录 `ingested_mode/ingested_at`（出本机凭据），知识库统计提供按入库档位筛选。

---

## 📐 目录结构

```
src/                    # 浏览器端（React SPA）
  engine/               # 分析引擎（parse/schema/clean/analyze/charts/join/export…）
  backend/              # 双形态适配层：client(信封)/probe(探测)/gateway(网关路由)/conversationSync
  components/           # Views/EChart/ModeBanner/PrivacyIndicator/CommandPalette/KnowledgeView/MemoryPanel
  sqlGuard.js / sqlEngine.js / llmProvider.js   # Text-to-SQL 闭环
  design-tokens.css     # 设计令牌唯一真相源
backend/                # 本地服务（FastAPI）
  app/api/routes/       # health/settings/llm/conversations/memories/knowledge/datasets/schedules
  app/services/         # 业务编排（llm/conversation/knowledge/dataset/schedule/privacy）
  app/repositories/     # 数据访问（分层：route→service→repo→model）
  app/core/             # config/security/errors/middleware/privacy(闸门唯一真相源)
  tests/                # pytest 83 项（含 F0 全矩阵）
docs/                   # PRD / 架构 / UIUX / Spec 契约 / OpenAPI(47 path) / ADR
scripts/                # e2e_check.sh 端到端验收 / 契约门禁
server/db-proxy.mjs     # 可选：外部数据库直连代理
```

---

## ✅ 阶段性成果

- 完整分析闭环：接入 → 解析 → 清洗 → 质量 → 看板 → 问答 → RAG → 报告，**双形态（浏览器独跑 / 本地服务增强）**
- 后端 8 个功能波全部落地并通过端到端验收（`e2e_check.sh` 13/13）
- 26 条 EARS 验收标准中 P0 全部达成；契约先行（OpenAPI 47 path / Spec 13 章）
- 工程规范：Vitest + pytest 双测试体系、契约门禁脚本、CI 工作流
