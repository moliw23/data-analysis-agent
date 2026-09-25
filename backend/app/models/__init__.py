"""模型汇总导入 —— 保证 Base.metadata.create_all 能看到全部表。

本波（P2-1 + P2-2）实际启用 6 张表：
  llm_providers / llm_routes / llm_call_logs / app_settings / feature_flags / embedding_probes
后续波次按需在此追加（conversation / knowledge / dataset / schedule），
新增列必须可空或有默认值（§12 R7）。
"""

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin
from app.models.llm import LlmCallLog, LlmProvider, LlmRoute
from app.models.settings import AppSetting, EmbeddingProbe, FeatureFlag

# 后续波次预留（本波不建表）：
#   from app.models.conversation import Conversation, Message, Memory
#   from app.models.knowledge import KnowledgeBase, KbDocument, KbChunk, KbQuery
#   from app.models.dataset import Dataset, DatasetQuery
#   from app.models.schedule import ScheduleJob, ScheduleRun, Notification

__all__ = [
    "AppSetting",
    "Base",
    "EmbeddingProbe",
    "FeatureFlag",
    "LlmCallLog",
    "LlmProvider",
    "LlmRoute",
    "SoftDeleteMixin",
    "TimestampMixin",
    "UuidPkMixin",
]
