# 数据分析 Agent · 本地服务后端

> Python FastAPI 单体。**LLM 网关 + 隐私档位闸门** 是本服务的两个核心职责；
> 数据计算仍在前端浏览器内的 `engine/` 完成——后端只做转发与记账，不做计算。

## 启动

```bash
cd backend

# 1) 建虚拟环境（用托管解释器，不要污染 conda base）
"C:/Users/hui_2/.workbuddy/binaries/python/versions/3.13.12/python.exe" -m venv .venv

# 2) 安装依赖（分两层：core 必装；rag 可选，装失败会自动降级为关键词检索）
.venv/Scripts/pip install -r requirements-core.txt
.venv/Scripts/pip install -r requirements-rag.txt    # 可选

# 3) 开发模式（双端口：前端 Vite 5173 代理 /api 到 8000）
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4) 生产模式（单端口：FastAPI 托管 ../dist，访问 http://127.0.0.1:8000 即是完整应用）
#    先在前端目录 npm run build，再启动本服务即可，无需额外配置。
```

## 环境变量（`.env`，首次启动自动生成 `APP_SECRET_KEY`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_DB_PATH` | `backend/data/app.db` | SQLite 文件路径（WAL 模式） |
| `APP_SECRET_KEY` | 自动生成 | Fernet 密钥，用于加密落库 API Key。**丢失后已存密钥无法解密** |
| `APP_LOG_LEVEL` | `INFO` | 日志级别 |
| `APP_LOG_FILE` | `backend/logs/app.log` | 结构化日志落盘路径；留空则只输出到控制台 |
| `APP_CORS_ORIGINS` | `http://127.0.0.1:8000` | 开发期跨域白名单 |

## 端点清单（本波已交付）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查 + 各子系统就绪状态 |
| GET | `/api/v1/capabilities` | **按当前隐私档位派生**的能力矩阵（前端据此显隐功能） |
| POST | `/api/v1/llm/chat` | LLM 网关主入口（按 `task_key` 路由，主备熔断） |
| GET/POST | `/api/v1/llm/providers` | 供应商列表（**只返回掩码**）/ 新增 |
| GET/PUT/DELETE | `/api/v1/llm/providers/{id}` | 详情 / 更新 / 软删 |
| POST | `/api/v1/llm/providers/{id}/test` | 连通性测试 |
| GET/PUT | `/api/v1/llm/routes` | 按 `task_key` 的路由与兜底配置 |
| GET | `/api/v1/llm/logs` | 调用日志（分页） |
| GET | `/api/v1/llm/stats` | Token 用量统计 |
| GET/PUT | `/api/v1/settings/privacy-mode` | 隐私档位读写 |
| POST/GET | `/api/v1/knowledge-bases*`、`/api/v1/datasets*` | **闸门 stub**：仅承接隐私档位判定，业务实现见后续波次 |

## 隐私档位（F0，核心设计）

| 档位 | 语义 | 知识库(RAG) | 服务端数据集/SQL |
|---|---|---|---|
| `strict`（默认） | 不出本机的功能全关 | 阻断 | 阻断 |
| `standard` | 额外允许文档入库与检索 | 放行 | 阻断 |
| `full` | 再放开数据集明细上传 | 放行 | 放行 |

- **单一真相源**：`app/core/privacy.py` 的 `CAPABILITY_GATES`。其他文件禁止出现字面量档位比较。
- **三类消费点**：路由级 dependency / 请求体级校验 / `capabilities` 派生——三者同源。
- **被阻断时统一返回 `code=4030`**，载荷含 `current_mode` / `required_modes` / `setting_path`，前端可直接据此给出"去哪改"的指引。
- **提权保护**：修改档位、写入密钥等敏感操作必须带 `X-Local-Confirm: true` 请求头，否则返回 `4011`。
- **fail-closed**：未知 capability、非法档位值一律拒绝，回落 strict。

## 安全

- API Key 用 **Fernet** 加密存 `llm_providers.api_key_enc`，接口只返回掩码（`sk-***abc`）。
- 响应与日志中**禁止出现明文密钥**（有测试保证）。
- Token 统计口径：只计 `status='ok'` 且至少一个 token 字段非 NULL 的记录；上游未返回 usage 时字段存 **NULL 而非 0**（NULL=未知，0=确实为 0，语义区分有测试保证）。

## 测试

```bash
.venv/Scripts/python -m pytest tests -q     # 54 项，全绿
```

覆盖：统一响应信封（成功/4010/4030/4040/4011/422 六类，含 422 不漏出 FastAPI 默认 `{"detail":...}`）、4030 真闸门、capabilities 三档派生与同源性、4010 拒绝文案含配置入口、密钥掩码不泄漏、Token NULL≠0 语义与统计口径。

## 目录结构与分层约束

```
app/
  main.py           只装配，零业务
  db.py             engine / sessionmaker / PRAGMA(WAL, busy_timeout, foreign_keys) / create_all
  api/routes/       HTTP 装配（参数校验 → 调 service → 组装信封）
  services/         业务编排（LLM 路由与熔断 / 档位派生）
  repositories/     纯数据访问，不 commit（提交由 service 编排）
  models/           ORM 表定义        schemas/  Pydantic 请求响应模型
  core/             config / security(Fernet) / errors / logging / middleware / privacy
```

**依赖方向**：`routes → services → repositories → models/core`。禁止跨层（route 直连 repository、repository 调 service）、禁止 service 内出现 `fastapi.Request/Response`。单文件 ≤ 300 行。

## 后续波次预留

- 新增路由模块：在 `app/api/routes/` 建文件，并在 `app/api/routes/__init__.py` 的 `ROUTERS` 列表追加一行，`main.py` 无需改动。
- 待交付：会话与记忆（`/conversations` `/memories`）、RAG 业务实现（当前为闸门 stub）、调度真实化与通知（`/schedules` `/notifications`）。
