"""模型汇总导入 —— 保证 Base.metadata.create_all 能看到全部表。

当前启用 9 张表：
  llm_providers / llm_routes / llm_call_logs / app_settings / feature_flags / embedding_probes
  conversations / messages / memories（P2-4）
后续波次按需在此追加（knowledge / dataset / schedule），
新增列必须可空或有默认值（§12 R7）。
"""

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin
from app.models.conversation import Conversation, Memory, Message
from app.models.knowledge import FTS_DDL, KbChunk, KbDocument, KbQuery, KnowledgeBase
from app.models.llm import LlmCallLog, LlmProvider, LlmRoute
from app.models.settings import AppSetting, EmbeddingProbe, FeatureFlag

# 后续波次预留（本波不建表）：
#   from app.models.dataset import Dataset, DatasetQuery
#   from app.models.schedule import ScheduleJob, ScheduleRun, Notification

__all__ = [
    "AppSetting",
    "Base",
    "Conversation",
    "EmbeddingProbe",
    "FTS_DDL",
    "FeatureFlag",
    "KbChunk",
    "KbDocument",
    "KbQuery",
    "KnowledgeBase",
    "LlmCallLog",
    "LlmProvider",
    "LlmRoute",
    "Memory",
    "Message",
    "SoftDeleteMixin",
    "TimestampMixin",
    "UuidPkMixin",
]
