"""业务逻辑层。

规则：禁止 `from fastapi import Request/Response`；禁止返回 HTTPException
（统一抛 core.errors 的业务异常）；跨模块协作走 service，不跨层直连对方 repository。

本波：llm_service（网关）/ provider_service（供应商）/ privacy_service（F0 档位）。
后续波次追加：conversation_service / memory_service / ingestion_service /
retrieval_service / embedding_service / chunking_service / dataset_service /
schedule_service / notification_service。
"""

from app.services import llm_service, privacy_service, provider_service

__all__ = ["llm_service", "privacy_service", "provider_service"]
