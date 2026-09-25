"""F0 隐私档位 —— 判定的唯一真相源（docs/02-架构.md §7.4）。

三档语义一句话：strict = 不出本机的功能全关。
  strict   默认。后端只做 LLM 代理 + 会话/记忆元数据；知识库入库与检索、
           服务端数据集与 SQL 全部阻断。
  standard 额外允许 RAG 知识库（建库 / 上传 / 重新嵌入 / 重建索引 / 检索）。
  full     额外允许数据集明细上传到服务端并执行只读 SQL。

三类消费点（一个策略对象、三类消费点，单靠 dependency 覆盖不了）：
  ① 路由级闸门   api/deps.py::require_privacy(capability)          —— 挂在 routes
  ② 请求体级闸门 schemas/*.py 的 model_validator + services 二次校验 —— 按 body 字段判定
  ③ 能力派生     routes/health.py 读 derive_capabilities()          —— 与闸门同源

依赖方向约束：本模块只依赖 core/config.py 的档位值，**不得** import models/ 或 services/。
被阻断数据计数由 service 计算后经参数注入（见 privacy_service.blocked_counts）。

硬规则：档位判定的唯一真相源是本文件的 CAPABILITY_GATES。
任何其他文件禁止写 "privacy_mode ==" 或字面量档位元组；
`require_privacy(...)` 必须传 capability 键，由本模块内部查表。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from app.core.errors import PrivacyBlockedError

# ---- 档位定义（唯一枚举）----
PRIVACY_MODES: tuple[str, ...] = ("strict", "standard", "full")
DEFAULT_PRIVACY_MODE = "strict"

# ---- 闸门映射的唯一真相源（docs/02-架构.md §7.4.5）----
# 键：capability；值：允许该能力的全部档位集合
CAPABILITY_GATES: dict[str, tuple[str, ...]] = {
    "kb_ingest": ("standard", "full"),
    "kb_search": ("standard", "full"),
    "server_dataset_register": ("full",),
    "server_sql": ("full",),
}

# 4030 文案：每个 capability 一条，前端也可用 capability 键自选模板
CAPABILITY_MESSAGES: dict[str, str] = {
    "kb_ingest": "当前隐私档位为 {mode}，知识库入库（建库 / 上传 / 重新嵌入 / 重建索引）已停用。切换到 {allowed} 档后可继续。",
    "kb_search": "当前隐私档位为 {mode}，知识库检索已停用（检索命中片段会随 prompt 发往上游）。切换到 {allowed} 档后可继续。",
    "server_dataset_register": "当前隐私档位为 {mode}，不允许以服务端存储方式登记数据集。切换到 {allowed} 档后可继续。",
    "server_sql": "当前隐私档位为 {mode}，服务端数据集明细与只读 SQL 已停用。切换到 {allowed} 档后可继续。",
}

SETTING_PATH = "/api/v1/settings/privacy-mode"

_BLOCKED_COUNT_KEYS: tuple[str, ...] = (
    "server_datasets",
    "knowledge_bases",
    "kb_documents",
)


def normalize_mode(mode: str | None) -> str:
    """非法/缺失档位一律回落 strict（fail-closed）。"""
    if mode in PRIVACY_MODES:
        return mode  # type: ignore[return-value]
    return DEFAULT_PRIVACY_MODE


def _allowed_text(modes: tuple[str, ...]) -> str:
    return " 或 ".join(modes)


@dataclass(frozen=True)
class ProbeState:
    """真实探测结果（与档位无关的客观事实），用于能力派生。"""

    db_available: bool = True
    vector_available: bool = False
    embeddings_available: bool = False
    scheduler_available: bool = False
    llm_configured: bool = False


class PrivacyPolicy:
    """单一判定真相源。全部判定方法、4030 载荷、能力派生都由 CAPABILITY_GATES 派生。"""

    def __init__(self, mode: str | None) -> None:
        self.mode = normalize_mode(mode)

    # ---------------- 闸门判定 ----------------
    def allows(self, capability: str) -> bool:
        """按 capability 键判档。未知 capability 一律拒绝（fail-closed）。"""
        gates = CAPABILITY_GATES.get(capability)
        if gates is None:
            return False
        return self.mode in gates

    def required_modes(self, capability: str) -> list[str]:
        """可放行该操作的全部档位集合（非仅最小档位）。"""
        return list(CAPABILITY_GATES.get(capability, ()))

    # 语义化包装（供 §7.4.2 三类消费点调用，不直接比较档位字符串）
    def allows_kb_ingest(self) -> bool:
        return self.allows("kb_ingest")

    def allows_kb_search(self) -> bool:
        return self.allows("kb_search")

    def allows_server_dataset_register(self) -> bool:
        return self.allows("server_dataset_register")

    def allows_server_sql(self) -> bool:
        return self.allows("server_sql")

    def allows_external_db(self) -> bool:
        """显式裁定：目标为用户自指定数据库，凭证与结果均不落服务端，三档全放行。"""
        return True

    # ---------------- ③ 能力派生（与闸门同源） ----------------
    def derive_capabilities(self, probe: ProbeState | None = None) -> dict[str, Any]:
        p = probe or ProbeState()
        kb_ingest = self.allows_kb_ingest()
        kb_search = self.allows_kb_search()
        server_sql = self.allows_server_sql()
        server_register = self.allows_server_dataset_register()
        # rag 需同时满足：向量库可用 且 档位允许知识库
        rag_enabled = bool(p.vector_available and kb_ingest)
        semantic = bool(p.embeddings_available and kb_search)
        return {
            "privacy_mode": self.mode,
            "llm_proxy": True,
            "conversation_persistence": True,
            "external_db_proxy": True,
            # 嵌套视图（Spec §12 / 任务书验收口径）
            "rag": {
                "enabled": rag_enabled,
                "ingest_allowed": kb_ingest,
                "search_allowed": kb_search,
                "vector_available": bool(p.vector_available),
                "semantic_search": semantic,
            },
            "dataset": {
                "local_storage_allowed": True,
                "server_storage_allowed": server_register,
                "server_sql_allowed": server_sql,
            },
            "knowledge": {
                "ingest_allowed": kb_ingest,
                "search_allowed": kb_search,
            },
            "embedding": {
                "available": bool(p.embeddings_available),
                "probed": bool(p.embeddings_available),
            },
            "scheduler": bool(p.scheduler_available),
            # 扁平别名（openapi Capabilities 字段，保持向后兼容）
            "rag_enabled": rag_enabled,
            "semantic_search": semantic,
            "embeddings_available": bool(p.embeddings_available),
            "server_sql": server_sql,
        }

    # ---------------- 4030 载荷 ----------------
    @staticmethod
    def blocked_counts(counts: Mapping[str, int] | None = None) -> dict[str, int]:
        """字段恒存在，无被阻断数据时为 0（降级不删除数据）。"""
        src = counts or {}
        return {k: int(src.get(k, 0)) for k in _BLOCKED_COUNT_KEYS}

    def blocked_payload(
        self, capability: str, counts: Mapping[str, int] | None = None
    ) -> dict[str, Any]:
        return {
            "current_mode": self.mode,
            "required_modes": self.required_modes(capability),
            "capability": capability,
            "setting_path": SETTING_PATH,
            "blocked_by_downgrade": self.blocked_counts(counts),
        }

    def blocked_message(self, capability: str) -> str:
        tpl = CAPABILITY_MESSAGES.get(capability, "当前隐私档位不允许该操作。")
        return tpl.format(
            mode=self.mode,
            allowed=_allowed_text(CAPABILITY_GATES.get(capability, ())),
        )

    def raise_if_blocked(
        self, capability: str, counts: Mapping[str, int] | None = None
    ) -> None:
        """受控端点统一入口：被阻断即抛 4030（带可执行指引）。"""
        if self.allows(capability):
            return
        raise PrivacyBlockedError(
            self.blocked_message(capability),
            data=self.blocked_payload(capability, counts),
        )
