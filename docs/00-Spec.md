# Spec · 数据分析 Agent v2.0

> 生成日期：2026-09-25
> 基于：PRD v2.3（`docs/01-PRD.md`）+ 架构文档（`docs/02-架构.md`）+ UIUX 文档（`docs/03-UIUX.md`）
> 状态：**待确认**
> 契约性质：本文件是团队内部唯一依据。开发/测试以本文件为准，三份源文档为佐证材料。

---

## 1. 产品定义

- **一句话描述**：一个默认本地优先、明细数据不出本机的自助数据分析工作台——上传文件即得看板、结论与六格式报告，AI 只接触 schema 与统计量。
- **目标用户**：① 小团队里"事实上的数据分析师"（运营/产品/财务岗，会 Excel 不写 SQL）② AI Agent 方向求职者与独立开发者（画像 B，本项目作者自身）③ 对数据合规敏感的专业用户。
- **核心问题**：自助分析工具在"易用性"与"明细不出本机"之间存在真空带；且 ChatBI 类产品普遍"能问数但不敢用"——幻觉、口径混乱、结论不可复现、不可审计。

### 1.1 与 v1.0 的形态差异

| 形态 | 触发条件 | 能力 |
|---|---|---|
| **本地服务增强模式** | `GET /api/v1/health` 探测成功（超时 1.5s） | 全部能力：AI 网关、多轮会话与记忆、RAG、真实 cron 调度与推送、服务端 SQL（受隐私档位约束） |
| **纯前端降级模式** | 探测失败 | 原 9 视图 + 全部本地分析能力 **100% 可用**；仅 AI 记忆 / RAG / 服务端调度 / 服务端导出不可用，明示原因与启动指引 |

**硬验收**：后端离线时前端功能完整性必须有专门测试覆盖（杀掉后端进程后跑完整回归）。

---

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | 编号 | 功能 | 验收标准摘要 | RICE |
|---|---|---|---|---|
| **P0** | F1 | LLM 网关 + 密钥托管 | 未配 Key 拒绝并提示配置位置；按 `task_key` 路由命中正确 provider；调用日志含 request_id/model/tokens_in/tokens_out/latency_ms/status；Token 统计与上游 usage 误差 < 1%；`GET /providers` 只返回掩码，日志中 grep 不到明文 Key | 6.00 |
| **P0** | F2 | Text-to-SQL 可信闭环增强 | 100% 的 DDL/DML/多语句被拦截并给出拦截原因；手改 SQL 重跑结果与直接提问一致；每条答案展示引用的口径定义；连续 5 轮追问不丢实体与筛选条件 | 5.40 |
| **P0** | F3 | 设计系统落地 + Linear 式极简高密度布局 | 全站颜色/间距/字号 100% 引用 Token（**不变量口径：不存在未迁移的硬编码颜色**，**禁用计数口径**——计数会随代码变化失真）；**第二套语义色板清零（只迁移不清理等于没做）**；Cmd+K 可跳转全部主视图；表格支持列排序+筛选+显隐；删除均有二次确认；**后端在线/离线双形态有可见状态条**；156 项单测全绿且 `vite build` 通过 | 4.00 |
| **P0 横切** | F0 | 隐私档位 `privacy_mode` | 三档 strict(默认)/standard/full；单一真相源 `PrivacyPolicy`，三类消费点（路由级 dependency / 请求体级校验 / capabilities 派生）；读写经 `GET`+`PUT /api/v1/settings/privacy-mode`；阻断统一错误码 **4030** | — |
| P1 | F4 | 大文件与首屏性能优化 | 首屏 TTI < 2.5s（4G 中端机）；15MB/56 万行 CSV 解析 ≤ 9s **不劣化**；首屏 bundle 不因设计系统膨胀超 400KB | 4.50 |
| P1 | F5 | 报告导出增强 | PDF 由服务端产出（非 `window.print`），中文字体完整；六格式同一指标数值完全一致；导出成功率 ≥ 99%；失败返回可读错误 + 一键重试 | 2.56 |
| P1 | F6 | 会话与记忆管理 | 刷新/换设备后会话不丢；"记住了什么"面板可查看/编辑/删除；关闭记忆后不再注入；会话标题自动生成且可改 | 2.40 |
| P1 | F7 | 数据服务与任务调度 | 默认 `storageMode=local` 时服务端不存明细且 `/query` 返回可辨错误码；调度由后端 cron 触发，**关页面照常执行**；历史含状态/耗时/行数/错误；连续 3 次失败自动暂停并通知 | 1.83 |
| P2 | F8 | 分析能力增强 | "为什么跌"返回按维度贡献度排序的解释列表并可视化；确认过的口径可被后续提问复用；异常检测可调灵敏度并给可解释依据 | 2.13 |
| P2 | F9 | RAG 知识库检索 | 支持 PDF/Word/Markdown/TXT/CSV 上传并返回切分预览；**语义可用时** Top-5 召回 ≥ 80%（30 条标注集）；**语义不可用时**自动降关键词检索 FTS5，Top-5 ≥ 60% 且 UI 显示降级徽标；回答标注引用来源；上传前 UI 明示"文档分块会随 prompt 发给上游模型" | 1.83 |

**排期硬约束**：F0 不得早于 F1 开工（F0 的 Effort=2 以 F1 存在为前提）。

> **F9 的两条防误读**：① F9 属本轮既定范围，**不是 Out-of-Scope**；② **不承诺"语义检索"为硬需求** —— 多数"OpenAI 兼容"服务只实现 chat 不实现 `/v1/embeddings`，统一表述为"语义（若支持）/ 关键词（兜底）"，禁止任何下游文档写成无条件承诺。

> **F4 的有意偏离**：RICE 4.50 名义高于 F3 的 4.00，但现状基线已达标，本轮定位是**防劣化**（新引入的设计系统与后端不得拖慢首屏），故排 P1 首项，P0 三个名额给地基项与差异化卖点项。

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|---|---|---|
| 多用户 / 登录 / RBAC 权限体系 | 单机单用户产品，`users`/`roles`/`kb_permissions` 表是为不存在的需求写代码 | 出现多人协作的真实需求后 |
| 云端多租户 SaaS 部署 | 与"明细不出本机"的核心定位直接冲突 | 不做——除非产品定位整体转向 |
| 移动端原生 App / 小程序 | 现有移动端 Web 适配已满足 P0；原生是独立工程量级 | 移动端占比 > 40% 后 |
| 实时流式数据接入（Kafka/Flink） | 用户画像无此场景，引入后运维复杂度远超 MVP 承受 | 出现明确的流式场景客户 |
| 自研 Embedding 模型训练 / 微调 | 成本极高且与"零外部依赖 pip 可装"冲突 | 不做 |
| 数据仓库建模（dbt/维度建模） | 属数据工程范畴，不在自助分析产品边界 | 用户明确要求 |
| 协作批注 / 评论 / @提醒 | 单用户产品无协作对象 | 多用户能力落地后 |
| 填报与数据回写 | 与只读分析定位冲突，且涉及写回生产库的风险 | 明确要求且具备权限管控时 |
| 移动端离线包 / PWA 完整离线 | 与后端依赖能力矛盾，收益低于成本 | 明确要求时 |
| SQL 编辑器全功能 IDE（语法高亮补全多标签） | MVP 只需"可查看/可复制/可手改/可重跑"，全功能 IDE 是另一个产品 | F2 稳定运行 3 个月后评估 |
| Alembic 迁移框架 | MVP 用"幂等 `create_all` + 启动时列检查"，见架构 §12 R7 | 表结构进入频繁变更期 |

---

## 4. 技术架构（锁定 — 含版本锚定）

> **技术栈由架构师选型，本节锁定版本**。锚定格式 `>=floor,<ceiling`，防 `pip install` 拉到破坏性新版。

| 层 | 技术 | 实际版本锚定 | 锁定原因 |
|----|------|-------------|----------|
| 运行时 | CPython | `>=3.12,<3.14` | 本机实测：托管 **3.13.14**（`C:\Users\hui_2\.workbuddy\binaries\python\versions\3.13.12\python.exe`，pip 26.1.2）+ anaconda 3.12.7。**用托管解释器建独立 venv**，不污染 conda base |
| 数据库 | SQLite（Python 内置） | `>=3.45` | 实测 3.53.1；FTS5 `trigram` 分词器需 ≥3.34.0，已满足；`WAL` + `busy_timeout=5000` + `foreign_keys=ON` |
| Web 框架 | `fastapi` | `>=0.115,<1.0` | floor 对齐 job-tracker 已验证的 0.115 线 |
| ASGI | `uvicorn[standard]` | `>=0.30,<0.60` | `[standard]` 带 httptools/websockets，SSE 转发需要 |
| 校验 | `pydantic` | `>=2.9,<3.0` | `pydantic_core` 有 84 个 cp313-win_amd64 预编译轮子，**无需 C++ 编译器** |
| 配置 | `pydantic-settings` | `>=2.4,<3.0` | 纯 Python 轮子 |
| ORM | `sqlalchemy` | `>=2.0.36,<2.1` | **刻意避开 2.1.0**：2.0.x 文档/教程/SO 答案最成熟，MVP 不求新 |
| 调度 | `apscheduler` | `>=3.10,<4.0` | 4.x 仅 alpha，无正式版；必须与 FastAPI **同进程** `BackgroundScheduler` |
| HTTP 客户端 | `httpx` | `>=0.27,<0.29` | httpx 1.0 未发布 |
| 上传 | `python-multipart` | `>=0.0.9,<0.1` | FastAPI 处理 multipart 的硬依赖，缺失时上传接口 500 |
| 向量库 | `chromadb` | `>=1.0,<2.0` | `chromadb-1.5.9-cp39-abi3-win_amd64.whl` 实测存在；`PersistentClient('./chroma_data')`，零外部服务 |
| 切分 | `langchain-text-splitters` | `>=1.0,<2.0` | 依赖 `langchain-core>=1.2.31,<2.0.0` |
| 密钥加密 | `cryptography` | `>=43,<51` | Fernet 加密落库 API Key；`cryptography-50.0.1-cp311-abi3-win_amd64.whl` abi3 兼容 3.13 |
| 文档解析 | `pypdf` / `python-docx` | `>=5.0,<7.0` / `>=1.1,<2.0` | 纯 Python |
| 前端 | React + Vite | `18.3.1` / `5.4.x`（**保持不变**） | 不换框架，只做视觉与功能改造 |
| 前端图标 | `lucide-react` | `^0.400.0`（**死锁**） | P0 规则要求 Spec 锁定一套图标库 |
| 测试 | `vitest` / `pytest` | `2.1.9` / `>=8,<9` | 前端沿用；后端新增 |

### 4.1 分层 requirements（控制安装风险）

```
backend/requirements-core.txt   # fastapi uvicorn pydantic pydantic-settings sqlalchemy
                                # apscheduler httpx python-multipart cryptography
backend/requirements-rag.txt    # chromadb langchain-text-splitters pypdf python-docx
backend/requirements-dev.txt    # pytest pytest-asyncio ruff
```

**理由**：`chromadb` 会拉入 onnxruntime/grpcio/kubernetes/opentelemetry 共 31 个包。分层后核心装完即可启动 LLM 网关+会话+调度；RAG 装失败时自动降级到 FTS5 关键词检索，项目仍可用。

### 4.2 依赖方向（强制）

```
api/routes → services → repositories → models / core
     ↓            ↓
  schemas      schemas
```

**禁止**：`repository → service` ｜ `route → repository`（跨层）｜ `service` 内出现 `fastapi.Request/Response` ｜ `service A → repository B`（跨模块直连，应调 service B）。

### 4.3 铁律（写进代码注释，防后续开发者破坏）

**后端网关只做转发与记账，不做计算。** 前端 `engine/` 依旧是唯一计算引擎；`narrateInsights` 仍只让模型改写**已算好**的统计量。禁止把"让模型算数"的能力加到后端。

---

## 5. API 端点清单（锁定 — 唯一依据）

> 完整契约见 `docs/api/openapi.yaml`（OpenAPI 3.0.3，47 path / 66 操作 / 39 schema）。前端据此生成类型，后端据此实现。

| 分组 | 前缀 | 端点数量 | 代表端点 |
|---|---|---|---|
| 健康检查与元信息 | `/api/v1` | 4 | `GET /health`、`GET /capabilities` |
| LLM 网关 | `/api/v1/llm` | 11 | `POST /chat`、`GET/POST /providers`、`GET/PUT /routes`、`GET /logs`、`GET /stats` |
| 会话与记忆 | `/api/v1/conversations`、`/memories` | 12 | `GET/POST /conversations`、`POST /{id}/messages`、`GET/POST/PUT/DELETE /memories` |
| RAG 知识库 | `/api/v1/knowledge-bases` | 14 | `POST /`、`POST /{id}/documents`、`POST /{id}/reindex`、`POST /{id}/retrieve` |
| 数据集与服务端 SQL | `/api/v1/datasets`、`/sql` | 10 | `POST /datasets`、`POST /sql/query`、`POST /sql/validate` |
| 调度与通知 | `/api/v1/schedules`、`/notifications` | 9 | `GET/POST /schedules`、`POST /{id}/run`、`GET /{id}/runs`、`PATCH /notifications/{id}` |
| 外部数据库代理 | `/api/v1/db-proxy` | 3 | `POST /test`、`POST /query`、`GET /tables` |
| 系统设置与隐私 | `/api/v1/settings` | 3 | `GET/PUT /privacy-mode`、`GET /settings` |

### 5.1 统一响应信封

```json
{ "code": 0, "message": "ok", "data": { }, "request_id": "..." }
```

### 5.2 业务错误码（锁定）

| code | 含义 |
|---|---|
| 0 | 成功 |
| 4010 | 未配置 LLM Provider |
| 4020 | 上游 LLM 调用失败 |
| **4030** | **被隐私档位阻断（privacy_mode 闸门）** |
| 4040 | 资源不存在 |
| 4090 | 状态冲突（如索引未就绪却发起检索） |
| 4091 | 索引未就绪（`index_status != ready` 或存在未完成文档） |
| 4290 | 限流 |
| 5000 | 服务端内部错误 |

---

## 6. 数据库表清单（锁定）

> 19 张表。SQLite，主键统一 `TEXT` 存 UUID4；所有表含 `created_at`/`updated_at`（UTC 存储，响应转本地）；软删统一 `deleted_at`。

| # | 表名 | 核心字段 | 关键索引 |
|---|---|---|---|
| 1 | `llm_providers` | id, name, base_url, api_key_enc, api_key_hint, default_model, embeddings_supported, is_active | `UNIQUE(name)` |
| 2 | `llm_routes` | id, task_key, primary_provider_id, primary_model, fallback_json | `UNIQUE(task_key)` |
| 3 | `llm_call_logs` | id, provider_id, model, task_key, conversation_id, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, error_code | `(created_at)`、`(provider_id, created_at)`、`(task_key, created_at)` |
| 4 | `conversations` | id, title, dataset_id, knowledge_base_id, summary, message_count, archived_at | `(archived_at, updated_at)` |
| 5 | `messages` | id, conversation_id, role, content, tool_name, tool_payload_json, tokens, llm_call_id | `(conversation_id, created_at)`；FK CASCADE |
| 6 | `memories` | id, scope, conversation_id, dataset_id, kind, content, weight, source_message_id, expires_at | `(scope, conversation_id, weight DESC)` |
| 7 | `knowledge_bases` | id, name, embedding_provider_id, embedding_model, embedding_dim, collection_name, doc_count, chunk_count, index_status, needs_reindex | `UNIQUE(collection_name)` |
| 8 | `kb_documents` | id, kb_id, filename, stored_name, mime, size_bytes, sha256, status, error, chunk_count, page_count, **ingested_mode, ingested_at** | `UNIQUE(kb_id, sha256)`、`(kb_id, status)`、`(ingested_mode)` |
| 9 | `kb_chunks` | id, doc_id, kb_id, seq, content, char_len, token_est, meta_json, embedding_id | `(doc_id, seq)`、`(kb_id, seq)` |
| 10 | `kb_chunk_fts` | 虚拟表：content，`tokenize='trigram'` | FTS5 内建（trigram 可命中中文，**无需 jieba**） |
| 11 | `kb_queries` | id, kb_id, query_text, mode, top_k, hit_chunk_ids_json, latency_ms, feedback | `(kb_id, created_at)` |
| 12 | `datasets` | id, name, source_type, storage_mode, server_table, row_count, column_count, schema_json, sha256 | `(sha256)`、`(storage_mode)` |
| 13 | `dataset_queries` | id, dataset_id, sql_text, sql_hash, row_count, truncated, exec_ms, status, error | `(dataset_id, created_at)` |
| 14 | `schedule_jobs` | id, name, job_type, dataset_id, knowledge_base_id, cron, timezone, params_json, enabled, apscheduler_job_id, last_run_at, next_run_at, last_status | `(enabled, next_run_at)`、`UNIQUE(apscheduler_job_id)` |
| 15 | `schedule_runs` | id, job_id, status, trigger, started_at, finished_at, duration_ms, result_json, error | `(job_id, started_at DESC)` |
| 16 | `notifications` | id, job_id, run_id, level, title, body, read_at | `(read_at, created_at DESC)` |
| 17 | `app_settings` | key(PK), value_json, updated_at | PK |
| 18 | `feature_flags` | key(PK), enabled, rollouts_json | PK |
| 19 | `embedding_probes` | id, provider_id, model, dim, ok, latency_ms, error, checked_at | `(provider_id, checked_at DESC)` |

### 6.1 关键取数口径（写进 repository，防各处口径不一）

- **Token 用量**：仅统计 `status='ok'` 且有 usage 的记录；上游未返回 usage 时该字段为 **NULL 而非 0**（NULL=未知，0=确实为 0，语义必须区分）。
- **知识库分块数**：以 `COUNT(kb_chunks)` 为准，`knowledge_bases.chunk_count` 只是缓存列，写入分块时须同事务更新。
- **索引就绪**：`index_status='ready'` **且** `needs_reindex=false` **且** 无 `status IN ('pending','parsing','chunking','embedding')` 的文档，三者同时满足才允许检索，否则返回 4091。

---

## 7. 页面清单（锁定）

| 页面 | 路由 | 核心组件 | 对应 API | 状态 |
|---|---|---|---|---|
| 概览 Home | `home` | Views.jsx `Home` | `GET /health`、`/capabilities` | 改造 |
| 上传/接入 Upload | `upload` | Views.jsx `Upload` + Workbench.jsx | `POST /datasets`、`/db-proxy/*` | 改造 |
| 数据预览 PreviewView | `preview` | Views.jsx + DataPreview.jsx | — | 改造 |
| 分析看板 Dashboard | `dashboard` | Views.jsx `Dashboard` + EChart.jsx | `POST /llm/chat`、`/conversations/*` | 改造 |
| 图表详情 ChartDetail | `chart` | Views.jsx `ChartDetail` | — | 改造 |
| 数据质量 Quality | `quality` | Views.jsx `Quality` | — | 改造 |
| 分析报告 Report | `report` | Views.jsx `Report` | `POST /reports/render`（F5） | 改造 |
| 定时调度 ScheduleView | `schedule` | ScheduleView.jsx | `/schedules/*`、`/notifications/*` | 改造 |
| 模型接入 SettingsPanel | `settings` | Views.jsx `SettingsPanel` | `/llm/providers`、`/settings/*` | 改造 |
| **知识库（新增）** | `knowledge` | 新增 `KnowledgeView.jsx` | `/knowledge-bases/*` | 新增 |
| **记忆（新增）** | `settings` 内区块 | 新增 `MemoryPanel.jsx` | `/memories/*` | 新增 |
| 浮层：分析工具箱 | — | ChartToolbox.jsx | — | 改造 |
| 浮层：模板库 | — | TemplateLibrary.jsx | — | 改造 |
| 浮层：清洗面板 | — | CleanPanel.jsx | — | 改造 |
| 浮层：问数据 | — | Views.jsx `ChatPanel` | `/llm/chat` | 改造 |
| **全局：命令面板（新增）** | Cmd+K | 新增 `CommandPalette.jsx` | — | 新增 |
| **全局：隐私档位指示器（新增）** | 顶栏常驻 | 新增 `PrivacyIndicator.jsx` | `GET /settings/privacy-mode`、`PUT /settings/privacy-mode` | 新增（**必须是解释入口，非标签**） |
| **全局：双形态状态条（新增）** | 顶栏下方 | 新增 `ModeBanner.jsx` | `GET /health`、`GET /capabilities` | 新增 |
| 设置页：档位区块 | `settings` 第一区块 | `SettingsPanel` 内 | `GET/PUT /settings/privacy-mode` | 新增（含 P1 档位变更历史只读列表） |

---

## 8. 设计 Token（锁定）

> 唯一来源：`src/design-tokens.css`（453 行）。机器可读镜像：`src/design-tokens.json`。前端通过 `main.jsx` import，**组件禁止内联硬编码**。

| 项 | 值 |
|---|---|
| **主色（裁决：保留）** | `--accent: #15795B` 墨绿。浅色对比度 5.13:1、白字压其上 5.36:1，双项过 AA；OKLCH 彩度约 0.10 属低饱和档。**保留理由**：墨绿在数据工具品类稀缺，换蓝紫等于主动向 AI 均值收敛 |
| **色板完整性** | 补全 `--accent-50` → `--accent-900` 11 阶；中性色阶 `--n-0` 至 `--n-1000`；语义色 `--ok`/`--warn`/`--danger`/`--info`（**分离撞色的旧 `--ok`**） |
| **字体** | `--font-body`（正文）、`--font-display`、`--font-mono`（数字）；**删除未加载的 `"Inter"` 声明**，由 Token 接管 |
| **图标库** | `lucide-react ^0.400.0`（**死锁，全项目一套**）；尺寸 16/20/24px（`--icon-sm/md/lg`）；`--icon-stroke` 统一描边 |
| **主题** | 浅色 `:root` + 暗色 `[data-theme="dark"]`，**仅覆盖变量值，零组件样式重写** |
| **对标品牌** | Linear（主）/ Vercel Geist（次）/ Metabase·Grafana·PostHog（领域） |
| **间距** | 严格 4px 网格 |
| **圆角** | 收紧：`.card` 14→**8**、`.toolbox` 16→**12**、`.upload-zone` 14→**12**、`.btn` 10→**6** |
| **阴影** | Linear 式：靠 1px 边框 + 微阴影分层（`--elev-flat/1/2/3/4`），**不靠大阴影** |
| **动效** | 时长 `--dur-instant/fast/base/slow/slower`；缓动 `--ease-standard/out/in-out`；**禁止弹跳缓动** `cubic-bezier(0.68,-0.55,0.265,1.55)` |
| **z-index** | 按 UIUX §3.8 契约重映射（修复 `.topbar`/`.chart-tip-bubble` 同为 20、`.toast`/`.toolbox-mask` 同为 60 的冲突） |
| **断点** | 保留 `--bp-phone` 767 / `--bp-tablet` 1023 |
| **无障碍** | WCAG AA 对比度、全局 `:focus-visible` 环、触控热区 ≥40px、`prefers-reduced-motion` |

### 8.1 门禁边界（重要）

`src/design-tokens.css` 作为**令牌定义层必须持有原始 hex**，因此硬编码颜色门禁的扫描范围**须排除该文件**——否则令牌层无法存在。该边界已写入 CSS 头部与 `design-tokens.json` 的 guard 规则。

---

## 9. 验收标准（锁定 — QA 唯一依据）

> EARS 格式：While/When/If/Where + 系统 + 必须/应该 + 行为。

| 编号 | 功能 | EARS 格式验收标准 | 优先级 |
|---|---|---|---|
| AC-01 | 隐私档位 | While `privacy_mode=strict`，When 请求携带数据集明细或发起 RAG 检索，系统**必须**返回 4030 且不落库、不转发上游 | P0 |
| AC-02 | 隐私档位 | When 用户经 `PUT /settings/privacy-mode` 改档，系统**必须**在 200ms 内使 `GET /capabilities` 派生结果同步变化 | P0 |
| AC-03 | LLM 网关 | If 未配置任何 Provider，When 请求 `POST /llm/chat`，系统**必须**返回 4010 且 `message` 指明配置入口 | P0 |
| AC-04 | LLM 网关 | When 主 Provider 超时或返回 5xx，系统**必须**在 3s 内尝试 fallback，且两条尝试**都**写入 `llm_call_logs` | P0 |
| AC-05 | LLM 网关 | When 任意一次 chat 完成，系统**必须**记录 request_id/model/tokens_in/tokens_out/latency_ms/status；上游未返回 usage 时 token 字段**必须**为 NULL | P0 |
| AC-06 | 密钥安全 | When 查询 `GET /llm/providers` 或 `GET /llm/logs`，响应与日志文件中**必须** grep 不到任何明文 API Key（只出现掩码如 `sk-***abc`） | P0 |
| AC-07 | Text-to-SQL | If 生成的 SQL 含 DDL/DML/多语句，系统**必须**拦截并返回具体拦截原因（哪条规则命中） | P0 |
| AC-08 | Text-to-SQL | When 用户手改 SQL 后重跑，结果**必须**与同语义直接提问一致（同一数据集、同一口径） | P0 |
| AC-09 | Text-to-SQL | While 连续 5 轮追问，系统**必须**保持实体与筛选条件不丢失 | P0 |
| AC-10 | 设计系统 | When 扫描 `src/**/*.{css,jsx,js}`（排除 `design-tokens.css`），硬编码 hex **必须**为 0（`#fff`/`#000` 除外） | P0 |
| AC-11 | 设计系统 | When 扫描全仓，破损 `rgba` 声明**必须**为 0（精确模式 `rgba\([^()]*\),[[:space:]]*0?\.[0-9]+\)`，零误报） | P0 |
| AC-12 | 设计系统 | When 扫描 `src/**/*.{jsx,js}`，emoji 字符**必须**为 0 | P0 |
| AC-13 | 设计系统 | When 扫描全仓，未定义的 `var(--radius)` 引用**必须**为 0 | P0 |
| AC-14 | 设计系统 | When 扫描全仓，弹跳缓动 `cubic-bezier(0.68,-0.55,0.265,1.55)` **必须**为 0 | P0 |
| AC-15 | 双形态 | When 杀掉后端进程，前端**必须**保持全部本地分析能力可用，且状态条明示"本地模式 + 启动指引" | P0 |
| AC-16 | 双形态 | When 后端在线，状态条**必须**展示当前隐私档位；降级能力**必须**有徽标明示，禁止静默降级 | P0 |
| AC-17 | 键盘可达 | When 用户按 Cmd/Ctrl+K，系统**必须**打开命令面板并可按名称跳转全部主视图 | P0 |
| AC-18 | 删除安全 | When 用户触发任何删除操作，系统**必须**弹二次确认后方可执行 | P0 |
| AC-19 | 回归 | When 运行 `npm test`，**必须** ≥156 项全绿；`npm run build` **必须**成功 | P0 |
| AC-20 | 会话持久化 | When 刷新页面或换设备，会话与消息**必须**不丢失 | P1 |
| AC-21 | 记忆可控 | When 用户关闭记忆开关，后续对话**必须**不再注入任何记忆；记忆面板**必须**支持单条编辑与删除 | P1 |
| AC-22 | 调度真实化 | While 浏览器页面关闭，When cron 到点，后端**必须**照常执行任务并写入 `schedule_runs` | P1 |
| AC-23 | 调度容错 | If 同一任务连续 3 次失败，系统**必须**自动置 `enabled=false` 并生成通知 | P1 |
| AC-24 | RAG 降级 | If 当前 Provider 不支持 `/v1/embeddings`，When 发起检索，系统**必须**自动降级为 FTS5 关键词检索，且 UI **必须**显示降级徽标 | P2 |
| AC-25 | RAG 合规 | When 用户上传文档前，UI **必须**明示"文档分块会随 prompt 发给上游模型" | P2 |
| AC-26 | 报告一致性 | When 导出六种格式，同一指标的数值**必须**完全一致（差异为 0） | P1 |
| AC-27 | 色板唯一性 | When 扫描全仓（排除 `design-tokens.css`），**必须**不存在第二套语义色（裸 `rgba()` 形式的 `#3FA66A`/`#C98A2B`/`#C0564B` 等与令牌层不同组的颜色）——**只迁移不清理等于没做** | P0 |
| AC-28 | 隐私可审计 | While 文档以 `standard` 入库后用户切到 `full`，系统的"出本机内容"标记**必须**依据 `ingested_mode`/`ingested_at`（**入库档位**）而非当前档位；且**必须**提供按 `ingested_mode` 的**筛选入口**——只做徽标不给筛选入口不算达标 | P0 |
| AC-29 | 档位可解释 | When 用户看到"被阻断"提示，档位指示器**必须**是可交互的**解释入口**（当前档位 + 为什么不可用 + 去哪改），**禁止**降级为纯标签 | P0 |
| AC-30 | 档位语义边界 | While `privacy_mode=strict`，文档**预览**保持可用（档位语义是禁外传，非禁本地访问）；If 预览路径包含 LLM 调用，该能力**必须**一并禁用 | P1 |
| AC-31 | 档位不做价值编码 | 三档选择器**不得**使用颜色编码区分优劣（`strict` 是默认档不是最差档，配色会引入价值判断） | P1 |

---

## 10. 边界与约束

- 不支持 IE 浏览器（沿用 Vite 默认 target）。
- 响应式断点：767px（手机）/ 1023px（平板）/ 1023px+（桌面）。
- 性能目标：首屏 TTI < 2.5s（4G 中端机）；首屏 bundle ≤ 400KB；15MB/56 万行 CSV 解析 ≤ 9s 不劣化；200MB CSV 不 OOM 且可取消。
- 并发：uvicorn `workers=1`（SQLite + 同进程 APScheduler 的约束，见架构 §12 R5）。
- 单文件 ≤ 300 行（前后端均适用）。
- 部署环境**硬约束**：本机 safe-delete fail-closed，**任何部署脚本不得包含删除步骤**（`rm`/`ri`/`shutil.rmtree`）。
- Vite `build.emptyOutDir: false`（构建前不清理 dist，规避 safe-delete 拦截）。

---

## 11. 内嵌已知坑（从项目记忆拉取）

| 坑 | 技术栈指纹 | 根因 | 修法 |
|---|---|---|---|
| 构建被 safe-delete 拦截 | `vite@5` | `prepareOutDir → emptyDir(dist)` 调 `rmSync`，回收站 COM 不可用 | 已修：`build.emptyOutDir: false` |
| vitest 跑完进程不退 | `vitest@2` | 存在未关闭的 handle（jsdom navigation timer） | 用重定向落盘取结果，不依赖进程退出码；必要时 `--forceExit` 或修 handle |
| 覆盖率启动即中断 | `vitest@2` + `@vitest/coverage-v8` | coverage 启动清 `coverage/` 目录被 safe-delete 拦截 | 已修：`test.coverage.clean: false` |
| npm install 被实时扫描打断 | `npm@10` | 腾讯电脑管家实时扫描致 EPERM，node_modules 部分包 dist 缺失 | `npm pack <pkg>@ver` 取官方 tarball → 解包 → 复制 dist/ |
| 临时文件残留 | 全仓 | 无法删除 | `vite.config.js.timestamp-*.mjs` 等已在 `.gitignore`，不再新增 |
| 批量配色替换误伤 CSS | `css` | `rgba(139,126,200, x)` → `rgba(28, 124, 99), x)`，左括号丢失，声明被静默丢弃 | 本次修复 20 处；后续配色替换**必须**用 Token 变量，禁止批量改 hex |

---

## 12. 端到端验证步骤（Spec 锁定的最后一项）

```bash
# ---------- 前端基线 ----------
cd E:/workbuddyapp/数据分析agent/data-analysis-agent

# 1. 单测（必须 ≥156 全绿）
npx vitest run 2>&1 | tail -20

# 2. 构建（必须成功）
npm run build

# 3. 门禁扫描（必须全部为 0）
grep -rnP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{27BF}\x{1F680}-\x{1F6FF}]' src/ --include=*.jsx --include=*.js | wc -l          # 期望 0
grep -rnP 'rgba\([^()]*\),[[:space:]]*0?\.[0-9]+\)' src/styles.css | wc -l                                                  # 期望 0
grep -rn 'var(--radius)' src/styles.css | wc -l                                                                              # 期望 0
grep -rnP 'cubic-bezier\(0\.68,\s*-0\.55' src/ | wc -l                                                                       # 期望 0

# ---------- 后端 ----------
cd backend
C:/Users/hui_2/.workbuddy/binaries/python/versions/3.13.12/python.exe -m venv .venv
.venv/Scripts/pip install -r requirements-core.txt

# 4. 启动（必须打印 "Uvicorn running on http://127.0.0.1:8000"）
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 5. 核心成功流：健康检查 + 能力派生
curl -s http://127.0.0.1:8000/api/v1/health
# 断言：{"code":0,...,"data":{"status":"ok",...}}
curl -s http://127.0.0.1:8000/api/v1/capabilities
# 断言：含 privacy_mode=strict、rag.enabled=false（strict 档下）

# 6. 关键错误流：未配 Provider
curl -s -X POST http://127.0.0.1:8000/api/v1/llm/chat -H "Content-Type: application/json" -d '{"task_key":"text_to_sql","messages":[{"role":"user","content":"hi"}]}'
# 断言：{"code":4010,...} 且 message 指明配置入口

# 7. 关键错误流：strict 档下被隐私闸门阻断
curl -s -X POST http://127.0.0.1:8000/api/v1/knowledge-bases -H "Content-Type: application/json" -d '{"name":"kb1"}'
# 断言：{"code":4030,...}

# 8. 密钥不泄露
curl -s http://127.0.0.1:8000/api/v1/llm/providers | grep -c 'api_key_enc\|sk-' 
# 断言：0
```

---

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-09-25 | Spec v2.0 初版生成 | 用户确认 4 项决策（FastAPI 后端全责 / Linear 式设计 / 4 类功能改进全选） | 全项目 |
| 2026-09-25 | 修正 PRD 引用的"94 项单测"为 **156 项** | PRD 引用了 README 的旧数字，实测基线为 14 文件 / 156 项 | AC-19、F3 验收 |
| 2026-09-25 | 修正架构文档任务书中的 Python 路径 | 托管路径含一层 `versions\`：`...\binaries\python\versions\3.13.12\python.exe`（实测 Python 3.13.14） | §4 运行时锚定、§12 验证步骤 |
| 2026-09-25 | 补充 `build.emptyOutDir: false` 约束 | 本机 safe-delete 拦截 `emptyDir(dist)`，导致构建必然失败 | §10 边界、§11 已知坑 |
| 2026-09-25 | 折入 PRD v2.4 三处裁定 + 一处勘误 | PM 裁定：① 档位选择器落位（设置页第一区块 + 顶栏常驻指示器）**批准**，但指示器必须是"解释入口"不是标签；② 档位变更历史**做但列 P1**（只读列表不新起视图 / 仅存本地不上报 / 与埋点同源不共用存储）；③ Token 清单格式不变，但**验收口径由计数改为不变量** | 新增 AC-27~AC-31；`kb_documents` 增 `ingested_mode`/`ingested_at`；F3 验收口径改写 |
| 2026-09-25 | 新增硬验收：第二套语义色板清零 | 设计师发现代码中存在**第二套未文档化的语义色板**（9 处裸 `rgba()`：`#3FA66A`/`#C98A2B`/`#C0564B`，与令牌层 `--success/--warn/--danger` 不是同一组颜色）。这是"颜色看着不统一"的真正根因——与架构师 4030 载荷重复定义**同构：同一语义存在两套真相** | AC-27 |
| 2026-09-25 | 修正 F3 验收口径：计数 → 不变量 | 设计师首轮报硬编码色值 72 处，逐行清点后更正为 54 处（32 处属旧令牌块整块删除、15 处属白黑例外）。若验收写"迁移 72 处"，核对者只找到 54 个点会误判漏改 18 处。**计数会随代码变化失效**——明天新增一处彩色，"迁移了 54 处"仍为真但已违规 | AC-10 / F3 验收 |
| 2026-09-25 | P2-4 落地：新增内部任务键 `chat_reply`（会话 autoRespond 应答） | 会话编排需要一个对话应答任务键；openapi TaskKey 枚举已同步追加（增量变更，不影响既有键） | openapi.yaml TaskKey、backend/schemas/llm.py |
