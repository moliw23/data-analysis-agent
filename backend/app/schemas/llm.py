"""LLM 网关请求/响应模型。

taskKey 枚举与前端 4 个钩子一一对应，不可自由扩展（docs/02-架构.md §6.2）。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# task_key 唯一枚举（前端钩子 + 后端内部任务）
TASK_KEYS: tuple[str, ...] = (
    "plan_analysis",
    "narrate_insights",
    "parse_question",
    "text_to_sql",
    "memory_summarize",
    "chunk_enrich",
    "report_narrate",
    "chat_reply",  # P2-4 内部任务：会话 autoRespond 应答（openapi TaskKey 已同步追加）
)

TaskKey = Enum("TaskKey", {k: k for k in TASK_KEYS}, type=str)

Role = Literal["system", "user", "assistant", "tool"]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Role
    content: str


class ResponseFormat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["json_object", "text"] = "json_object"


class LlmChatRequest(BaseModel):
    """POST /api/v1/llm/chat 的请求体。"""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    task_key: TaskKey = Field(alias="taskKey")  # type: ignore[valid-type]
    messages: list[ChatMessage] = Field(min_length=1)
    response_format: ResponseFormat | None = Field(default=None, alias="responseFormat")
    temperature: float = Field(default=0.2, ge=0, le=2)
    timeout_ms: int = Field(default=15000, ge=1000, le=300000, alias="timeoutMs")
    conversation_id: str | None = Field(default=None, alias="conversationId")


class Usage(BaseModel):
    """NULL 表示上游未返回 usage，与 0 语义不同。"""

    promptTokens: int | None = None
    completionTokens: int | None = None
    totalTokens: int | None = None


class LlmChatResult(BaseModel):
    content: str
    mode: Literal["llm", "mock"] = "llm"
    providerId: str | None = None
    model: str | None = None
    usage: Usage = Field(default_factory=Usage)
    latencyMs: int = 0
    attempts: int = 1


class ProviderCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    base_url: str = Field(alias="baseUrl", min_length=1)
    api_key: str = Field(alias="apiKey", min_length=8)
    model: str = Field(min_length=1)


class ProviderUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str | None = Field(default=None, max_length=100)
    base_url: str | None = Field(default=None, alias="baseUrl")
    api_key: str | None = Field(default=None, alias="apiKey", min_length=8)
    model: str | None = None
    is_active: bool | None = Field(default=None, alias="isActive")


class ProviderView(BaseModel):
    """apiKey 只返回掩码，永不含明文（AC-06）。"""

    id: str
    name: str
    baseUrl: str
    model: str
    apiKeyHint: str = ""
    isActive: bool = True
    embeddingsSupported: bool | None = None
    createdAt: datetime | None = None


class ProviderTestRequest(BaseModel):
    probe: list[Literal["chat", "embeddings"]] = Field(
        default_factory=lambda: ["chat", "embeddings"]
    )


class ProbeResult(BaseModel):
    ok: bool
    latencyMs: int | None = None
    error: str | None = None
    dim: int | None = None


class LlmRouteIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    task_key: TaskKey = Field(alias="taskKey")  # type: ignore[valid-type]
    primary_provider_id: str | None = Field(default=None, alias="primaryProviderId")
    primary_model: str | None = Field(default=None, alias="primaryModel")
    fallback: list[dict[str, Any]] = Field(default_factory=list)


class RoutesUpdate(BaseModel):
    items: list[LlmRouteIn]


class LlmCallLogView(BaseModel):
    id: str
    requestId: str | None = None
    taskKey: str | None = None
    providerId: str | None = None
    model: str | None = None
    status: str = "ok"
    promptTokens: int | None = None
    completionTokens: int | None = None
    totalTokens: int | None = None
    latencyMs: int | None = None
    errorCode: str | None = None
    errorMessage: str | None = None
    createdAt: datetime | None = None


class UsageItem(BaseModel):
    key: str
    promptTokens: int | None = None
    completionTokens: int | None = None
    totalTokens: int | None = None
    calls: int = 0


class EmbeddingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_id: str | None = Field(default=None, alias="providerId")
    model: str | None = None
    input: list[str] = Field(min_length=1, max_length=128)


class EmbeddingsResult(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int
    usage: Usage = Field(default_factory=Usage)
