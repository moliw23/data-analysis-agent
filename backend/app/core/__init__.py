"""核心基础设施：配置 / 日志 / 安全 / 异常 / 隐私策略 / 中间件。

规则：core/ 不得依赖 models/ 或 services/（保持依赖方向 api -> services -> repositories -> models/core）。
"""

__all__: list[str] = []
