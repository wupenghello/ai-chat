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


@lru_cache
def get_settings() -> Settings:
    return Settings()
