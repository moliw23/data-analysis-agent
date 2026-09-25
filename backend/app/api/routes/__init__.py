"""路由注册表。

后续波次新增端点时：在自己的 routes/<resource>.py 里建 router，
然后在下面的 ROUTERS 列表追加一项即可 —— 不要改 app/main.py（避免多人改同一文件）。

顺序无关（各 router 前缀互不重叠），但保持"基础设施 -> 业务"的阅读顺序。
"""

from app.api.routes import datasets, health, knowledge, llm, settings

ROUTERS = [
    health.router,
    settings.router,
    llm.router,
    knowledge.router,
    datasets.router,
    # 后续波次追加：
    #   conversations.router, memories.router,
    #   schedules.router, notifications.router, db_proxy.router,
]

__all__ = ["ROUTERS"]
