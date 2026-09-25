"""数据访问层。

规则：只做存取，不含业务分支；禁止 import services；
禁止跨模块直连（service A 不得直连 repository B，应调 service B）。

本波：llm_repo / settings_repo。
后续波次按资源追加：conversation_repo / memory_repo / knowledge_repo /
dataset_repo / schedule_repo / vector_repo（vector_repo 是唯一允许 import chromadb 的文件）。
"""

from app.repositories import llm_repo, settings_repo

__all__ = ["llm_repo", "settings_repo"]
