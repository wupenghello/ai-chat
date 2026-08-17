"""应用配置：环境变量读取（前缀 AI_CHAT_），默认值面向本地开发/本地 Docker 部署。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_CHAT_", env_file=".env")

    db_path: str = "ai-chat.db"
    # 会话 token 有效期（小时）；改密/注销的主动失效见 REQ-021（iter-8）
    session_ttl_hours: int = 24 * 7
    # 同源部署（Vite dev proxy / 反代）下 Cookie 无需 Secure；上 HTTPS 后置 1（iter-7/8 部署时处理）
    cookie_secure: bool = False
    cookie_name: str = "ai_chat_session"
    # 统一 key 模式三变量（design-iter-7 定夺①）：.env 提供，不入 git；key 为空 = 部署未配置
    unified_key: str = ""
    unified_base_url: str = "https://api.deepseek.com"
    unified_model: str = "deepseek-chat"
    # REQ-024（iter-8 T1）配额初始默认值——CEO 拍板 2026-08-16 随 iter-8 计划定案；
    # 管理员按用户覆盖随 REQ-025（iter-8 T2）落地，本层为默认档；0 = 该项不限
    register_ip_daily_limit: int = 3  # 每 IP 每自然日注册数上限
    quota_free_daily: int = 30  # 免费档（统一 key 模式）每用户每日对话回合数（CHG-007 REQ-034）
    quota_self_daily: int = 500  # 自填 key 档每用户每日对话回合数
    unified_daily_total: int = 2000  # 统一 key 全站每日回合总量（熔断，次日恢复）
    # iter-13 T1（CHG-007 REQ-030/031）：agent 回合三护栏与工具网关参数——
    # 定夺值随 design-iter-13 基线定案（2026-08-17 CEO「全部按推荐」）：步数 10 / 单步 120s / 32 KiB
    agent_max_steps: int = 10  # 单回合最大上游调用步数（验收用例以小值注入压测）
    agent_step_timeout: float = 120.0  # 上游单步超时（秒）；工具超时按各工具声明（演示工具 2s）
    tool_result_limit: int = 32 * 1024  # 工具结果大小上限（字节），超限截断并追加标注
    # iter-14 T2（CHG-007 REQ-035 / design-iter-14 §7）：Tavily 搜索 key——backend/.env 注入
    # （AI_CHAT_SEARCH_KEY，与统一 key 三变量同法）；空 = 未配置 → search 工具不注册
    # （admin 开关状态可存，key 与开关分离，design §6.1）；不入 git/日志/响应体
    search_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
