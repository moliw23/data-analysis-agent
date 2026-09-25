# ADR-001：后端技术栈选型（FastAPI 单体 + SQLite + ChromaDB）

## Status

Accepted（2026-09-25）

## Context / Background

### 决策驱动力

项目 `data-analysis-agent` 当前是**纯前端 SPA**（React 18.3 + Vite 5 + ECharts 5.5 + alasql 4.18 + Zustand 4.5），核心卖点是「原始数据不出本机」。现有两个越界点：

1. `src/llmProvider.js` 把 LLM API Key **明文存 localStorage**（键 `data-agent.llm.config`），任意 XSS 即可窃取；且每次调用无日志、无计量、无法按任务路由不同模型。
2. `src/schedule.js` 是演示级调度（`setInterval`，关页面即停），`server/db-proxy.mjs` 是 96 行 Node 原生 http 脚本、无 SQL 校验、需另起进程与另装 `mysql2`/`pg`。

用户需求已明确四类后端职责：① LLM 网关与密钥托管 ② 会话与记忆管理 ③ RAG 知识库检索 ④ 数据服务与任务调度。

### 约束条件（真实环境实测）

| 约束 | 实测事实 | 来源 |
|---|---|---|
| 操作系统 | Windows 11 | 用户声明 |
| 无容器习惯 | 不使用 Docker | 用户声明 |
| Python 可用 | 托管 Python 3.13.14（`C:\Users\hui_2\.workbuddy\binaries\python\versions\3.13.12\python.exe`，pip 26.1.2，venv 可用）；备选 anaconda Python 3.12.7 | 本机实测 |
| Node 可用 | Node 22，`vite build` 已成功产出 `dist/` | 本机实测 |
| **禁用删除** | 本机安全策略拦截任何文件删除，回收站 COM 不可用 | 用户声明 |
| 前端不换框架 | React 保持不动，仅做视觉重设计 | 用户拍板 |
| 部署形态 | 后端托管 `dist/`，单端口访问 | 用户拍板 |
| 已有同类经验 | `E:\workbuddyapp\数据\job-tracker` 已用 FastAPI + SQLite + APScheduler + 单端口托管 dist 跑通 | 读码确认（`backend/app/main.py`、`db/session.py`、`run.py`、`requirements.txt`） |
| 简历目标 | JD 提及 LangChain；需体现 RAG / Agent 工程能力 | `docs/简历评估-项目剖析.md` |

### 需要决策的问题

1. Web 框架与运行时：FastAPI（已拍板）还是自建 Node 服务？
2. ORM：SQLAlchemy 2.x / SQLModel / 原生 sqlite3？
3. 向量存储：ChromaDB / faiss-cpu + SQLite / pgvector？
4. Embedding：OpenAI 兼容 HTTP 接口 / 本地 sentence-transformers / Ollama？
5. 文档切分：langchain-text-splitters / 自研递归切分？
6. 会话记忆：SQLite 表 / LangGraph checkpoint / Redis？
7. 调度：APScheduler 3.x / APScheduler 4.x / Celery？
8. 前端产物托管：StaticFiles + SPA fallback / 独立静态服务器？

---

## Decision

采用 **Python FastAPI 单体服务**，所有状态落在**进程内可管理的本地文件**（SQLite + ChromaDB 持久化目录），不引入任何需要独立进程或容器的中间件。

### 分层决策

| 层 | 决策 | 版本锚定 | 核心理由 |
|---|---|---|---|
| 运行时 | CPython（**独立 venv**，不污染 conda base） | `>=3.12,<3.14` | 本机 3.13.14 与 3.12.7 均可用；上限 <3.14 防未验证版本 |
| Web 框架 | **FastAPI** | `fastapi>=0.115,<1.0` | 用户已拍板；ASGI 原生 async 适配 LLM 流式转发；自动生成 OpenAPI 3.1 作为前后端契约；与 `job-tracker` 同栈可复用经验 |
| ASGI 服务器 | uvicorn（`[standard]`） | `uvicorn[standard]>=0.30,<0.60` | SSE 流式需要 httptools/websockets 扩展 |
| 数据校验 | Pydantic v2 + pydantic-settings | `pydantic>=2.9,<3.0`、`pydantic-settings>=2.4,<3.0` | 实测 `pydantic_core` 有 84 个 cp313-win_amd64 预编译轮子，**无需 C++ 编译器** |
| ORM | **SQLAlchemy 2.0.x**（否决 SQLModel） | `sqlalchemy>=2.0.36,<2.1` | 2.0.x 是文档/教程/社区答案最成熟的一线；刻意避开刚发布的 2.1.0。模型与校验解耦，允许 `schemas/` 与表结构独立演化（本项目必需）；与 `job-tracker` 同栈 |
| 数据库 | **SQLite（标准库内建）** + WAL | 随解释器（实测 3.53.1 / 3.45.3） | 单机单用户，零外部服务；FTS5 的 `trigram` 分词器是本项目关键词检索的基础 |
| 向量库 | **ChromaDB PersistentClient** | `chromadb>=1.0,<2.0`（实测 1.5.9 有 `cp39-abi3-win_amd64` 轮子） | 零外部服务、进程内嵌、预编译轮子无需编译器、LangChain 生态默认搭配、JD 认知度高 |
| Embedding | **OpenAI 兼容 `POST /v1/embeddings`**，复用用户已有 baseUrl + apiKey | 自建代理，无新依赖 | 零新增依赖、零本地算力、用户零额外配置 |
| 文档切分 | **langchain-text-splitters**（自定义中文分隔符） | `langchain-text-splitters>=1.0,<2.0`（实测 1.1.2） | JD 明确提及 LangChain；中文断句靠传入 `。！？；` 分隔符解决；隔离在 `chunking_service.py` 内可原地替换 |
| 会话记忆 | **SQLite 三表（conversations / messages / memories）+ 滚动摘要** | — | 完全可控，可精确实现上下文预算裁剪；零新增依赖 |
| 调度 | **APScheduler 3.x**（否决 4.x） | `apscheduler>=3.10,<4.0`（实测 3.11.3） | PyPI 实测 4.x **全部为 `4.0.0a1`~`a6` alpha，无正式版**；3.x 状态 `Production/Stable`，`job-tracker` 已在用 |
| 密钥加密 | cryptography（Fernet） | `cryptography>=43,<51`（实测 50.0.1 有 cp311-abi3-win 轮子） | 主键落库加密，密钥文件与 DB 分离，实现"拖走 DB 也拿不到 Key" |
| HTTP 客户端 | httpx | `httpx>=0.27,<0.29` | 异步调上游 LLM/embeddings；1.0 尚未发布 |
| 上传与解析 | python-multipart + pypdf + python-docx | `>=0.0.9,<0.1` / `>=5.0,<7.0` / `>=1.1,<2.0` | 全部纯 Python 轮子 |
| 前端托管 | **`StaticFiles` + 404 兜底返回 `index.html`** | — | 单端口；深链接可用；`index.html` 强制 `no-cache` |
| 进程模型 | **`workers=1` 单进程** | — | Chroma 官方明确"非进程安全"；APScheduler 也必须单进程 |

**明确拒绝引入的技术**：Docker、PostgreSQL、Redis、Celery、LangGraph、Alembic、sentence-transformers、PyTorch、jieba、独立 Nginx。

### 隐私闸门（`privacy_mode`）的实现结构决策

`privacy_mode` 已立为 P0 横切功能项，验收要求「绕过前端直接打接口，确认 `strict` 下上传被拒」。**裁定其实现结构为「一个策略对象、三类消费点」，而非「一个 FastAPI dependency」**：

| 判定类型 | 例子 | 能否被路由级 dependency 覆盖 | 落点 |
|---|---|---|---|
| 路由级 | 上传文档、重建索引 | **能** | `api/deps.py::require_privacy(*allowed)` |
| 请求体级 | `POST /datasets` 的 `storageMode=server`；`POST /schedules` 引用的资源 | **不能**（dependency 无法按 body 字段有条件放行） | Pydantic `model_validator` + service 二次校验 |
| 能力声明派生 | `GET /meta/capabilities` 的 `rag` / `server_sql` | **不能**（dependency 不管响应体） | `routes/health.py` 读同一策略对象 |

统一真相源为 `core/privacy.py` 的 `PrivacyPolicy`。**特别地，调度任务从 APScheduler 后台线程进入、不经过 HTTP 路由，路由级 dependency 对其完全无效**，故 `schedule_service` 执行前必须自行校验一次。约束：`core/privacy.py` 不得 import `models/` 或 `services/`（否则 `core/` 反向依赖上层，违反分层依赖方向）；`grep -rn "privacy_mode ==" app/` 只应命中该文件一处。

`privacy_mode` 的读写经 `GET/PUT /api/v1/settings/privacy-mode` 暴露（`PUT` 需 `X-Local-Confirm`）。档位阻断统一返回 `code=4030`，与"忘了带确认头"的 `4010` 严格区分：`4030` 补头无效，前端必须引导切档位且**禁止自动重试**。降级（`full`/`standard` -> `strict`）**不删除任何既有数据**（本机安全策略禁止删除，删用户数据也不该是切档位的副作用），仅阻断后续访问，并由 `blocked_by_downgrade` 计数如实告知影响面。

详细闸门矩阵见 `docs/02-架构.md` §7.4。**其中一处为显式裁定而非遗漏**：`POST /api/v1/db-proxy/query` 在三档下**均放行**——其目标是用户自指定数据库、凭证与结果均不落服务端，属"用户自己的数据出口"而非"我们的存储"。

### 目录与代码组织决策

后端采用强制分层：`api/routes/`（只做 HTTP 装配）→ `services/`（业务逻辑）→ `repositories/`（数据访问）→ `models/` + `core/`。

硬规则（出现即不合格）：单文件 ≤ 300 行（不含空行注释）；`app/main.py` 只装配且 ≤ 100 行；路由处理器内禁止直接操作数据库；service 层禁止 import `Request`/`Response`；**只有 `repositories/vector_repo.py` 允许 `import chromadb`**。

前端：不换框架；新增 `src/backend/` 适配层；**`src/llmProvider.js` 的全部公开签名一字不改**，内部按"后端可用性"路由，以保住现有 94 项测试。图标库锁定 `lucide-react ^0.400.0`，全项目唯一，不使用 emoji 作功能图标。

---

## Consequences

### 正面

1. **密钥安全质变**：API Key 默认不再落在浏览器；后端 Fernet 加密落库，密钥文件独立于 DB；`GET` 接口只返回掩码；日志加脱敏 filter。消除了原设计最主要的实际安全短板。
2. **AI 调用可审计**：每次调用落 `llm_call_logs`，含 taskKey / provider / model / prompt_tokens / completion_tokens / latency_ms / status。用户可自查"发出了什么、花了多少"，这在改造前完全不可能。
3. **多模型路由能力**：`llm_routes` 按 taskKey 分配模型（如 `text_to_sql` 用推理强的模型、`narrate_insights` 用便宜的模型），并支持 fallback。这是"AI 产品"区别于"套壳工具"的真实工程点。
4. **RAG 与调度真实可跑**：知识库真正做文档解析、中文分块、向量检索与三层漏斗；调度在浏览器关闭后仍运行并把结果推回。
5. **零外部服务**：用户只需 `pip install` + `python run.py`，不装数据库、不装 Docker、不装 Redis。这是本决策最重要的地方性适配。Windows 友好度满分。
6. **经验复用**：`job-tracker` 的 `main.py` 装配顺序坑、`run.py` 的 `workers=1` 约束、SQLite WAL 配置、`StaticFiles` 托管方式全部可直接复用，显著降低实施风险。
7. **前端零回归风险**：保持 `llmProvider.js` 签名不变 + 新增而非改写适配层，现有 94 项测试继续有效。后端离线时前端 9 视图与全部本地分析能力不受影响。

### 负面 / 代价（诚实列出）

1. **ChromaDB 依赖重**：31 个依赖，含 `onnxruntime`/`grpcio`/`kubernetes`/`opentelemetry`，安装体积约 250–400MB。**缓解**：分层 requirements（core 与 rag 分离），RAG 装失败不影响后端其他能力；`import chromadb` 包在 try/except，失败则 `capabilities.rag=false` 并降级到 FTS5 关键词检索。
2. **语义检索可能名存实亡**：大量"OpenAI 兼容"服务不提供 `/v1/embeddings`。**缓解**：provider 连通性测试强制同时探 chat 与 embeddings，结果落 `embedding_probes` 表；建库时若探针失败立即警告并默认关键词模式；**禁止静默降级**，响应 `mode` 字段与 UI 徽标都要暴露。
3. **单进程模型无法横向扩展**：Chroma 非进程安全 + APScheduler 单进程，导致不能加 worker、不能多实例。**接受**：本项目是单机单用户工具，扩展性不在需求内。未来若需扩展，Chroma 必须切 `HttpClient` 独立部署，这已写入风险清单 R5。
4. **SQLAlchemy 2.0 而非 2.1**：主动放弃最新版。代价是少数新特性不可用，收益是踩坑概率显著下降。对本项目（简单 CRUD + 少量聚合）无影响。
5. **不用 Alembic 的技术债**：`create_all` 只能建表不能加列。**缓解**：`core/db.py` 实现轻量迁移（`PRAGMA table_info` 检测缺失列后 `ALTER TABLE ADD COLUMN`），并强制"新增列必须可空或有默认值"。真正需要多环境同步时再补 Alembic。
6. **多了一个常驻进程**：用户需先启动后端再使用 AI 与 RAG 功能。**缓解**：完整降级路径——后端离线时前端自动切回 localStorage 直连模式，本地分析能力 100% 可用；顶部状态条明确提示。
7. **隐私卖点被精确化而非消失**：原「原始数据不出本机」需改写为「**分析明细不出本机 · AI 调用可断可审可换本地模型 · 出本机仅限用户显式上传的知识库**」。这不是本次改造造成的退步（LLM 调用本身就出本机），而是把原本隐含不可审计的事实变成可配置、可审计的显式设计。同时提供 `privacy_mode` 三档（`strict` 默认 / `standard` / `full`）让用户自定边界。
8. **部署脚本受限**：本机拦截文件删除，所有"重建/清理/重置"必须走软删或 API 逻辑重建，不能依赖 `rm`/`rmtree`。**已写入硬约束**：部署脚本中出现任何删除命令即视为不合格。

### 后续必须跟进的决策（不在本 ADR 范围）

| 编号 | 主题 | 说明 |
|---|---|---|
| ADR-002 | 前端 `src/store.js`(686 行) 与 `src/components/Views.jsx`(706 行) 拆分方案 | 已超 300 行硬规则，登记为技术债，本轮不重构 |
| ADR-003 | 视觉重设计令牌体系（去 AI 化） | 由设计师主导；约束：无紫色到粉色渐变、无硬编码颜色、图标统一 lucide-react |
| ADR-004 | 会话记忆的向量化检索 | 当前用 SQL 排序足够（记忆量级几十到几百条）；若增长到千级再评估向量化 |
| ADR-005 | 前端测试体系扩展 | 现 94 项以引擎与组件为主，缺 `src/backend/` 覆盖与"后端离线降级"验收测试 |

---

## 参考资料（全部为联网实测，非推测）

| 来源 | 核实内容 |
|---|---|
| PyPI JSON API / simple index（2026-09-25 实测） | fastapi 0.141.1；uvicorn 0.53.0；pydantic 2.13.5；sqlalchemy 2.1.0（2.0.x 线最高 2.0.54）；apscheduler 3.11.3（4.x 仅 `4.0.0a1`~`a6`）；chromadb 1.5.9；langchain-text-splitters 1.1.2；httpx 0.28.1；python-multipart 0.0.32；cryptography 50.0.1；pypdf 6.19.0；python-docx 1.2.0；sqlmodel 0.0.47 |
| Wheel 可用性实测 | `chromadb-1.5.9-cp39-abi3-win_amd64.whl` 存在；`pydantic_core` 有 84 个 cp313-win_amd64 轮子；`cryptography-50.0.1-cp311-abi3-win_amd64.whl` 存在；`faiss_cpu-1.15.1-cp310/cp311-win_amd64.whl` 存在 |
| Chroma 官方 Cookbook（Deployment Patterns） | `chromadb.PersistentClient(path=...)`；`get_or_create_collection(name, embedding_function=None, metadata={"hnsw:space":"cosine"})`；`upsert(ids, documents, embeddings, metadatas)`；`query(query_embeddings, n_results, where, include)`；**"Chroma is thread-safe but not process-safe"**；collection 名称规则 3–63 字符、首尾小写字母或数字 |
| Chroma 依赖树实测 | 31 个依赖，含 onnxruntime / grpcio / kubernetes / opentelemetry-sdk |
| 本机实测 | 托管 Python 3.13.14 + SQLite 3.53.1 + venv 可用 + pip 26.1.2；anaconda Python 3.12.7 + SQLite 3.45.3；FTS5 `tokenize='trigram'` 中文检索命中 |
| 项目内既有实现 | `job-tracker/backend/app/main.py`（路由先于 mount 注册）、`db/session.py`（SQLite WAL 与 `check_same_thread=False`）、`run.py`（`workers=1` 注释）、`requirements.txt` |
| 专家包知识库 | `references/architecture/mvp-stack.md`、`rag-knowledge-base.md`、`ai-agent-patterns.md`、`01-standards/code-organization.md` |

> 注：知识库 `rag-knowledge-base.md` 的 MVP 默认推荐为 pgvector + HNSW，其前置假设是"已有 PostgreSQL 业务库"。本项目不满足该假设且用户明确要求零外部依赖，故**不采纳该默认值**。选型服从项目约束，不服从模板默认。

---

## Related ADRs

- 本 ADR 为后端栈的**伞形决策**，下述子决策已在本文件内一并裁定：ORM（SQLAlchemy 2.0.x）、向量库（ChromaDB）、Embedding 方案（OpenAI 兼容 HTTP）、切分库（langchain-text-splitters）、会话记忆（SQLite 表）、调度（APScheduler 3.x）、前端托管（StaticFiles + SPA fallback）。
- 待立：ADR-002（前端超限文件拆分）、ADR-003（设计令牌）、ADR-004（记忆向量化）、ADR-005（前端测试扩展）。
- 上游文档：`docs/02-架构.md`（技术架构设计 v1.0）。
- 契约文件：`docs/api/openapi.yaml`。
