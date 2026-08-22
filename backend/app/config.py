"""应用配置：环境变量读取（前缀 AI_CHAT_），默认值面向本地开发/本地 Docker 部署。"""

from functools import lru_cache

from pydantic import field_validator
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
    # CHG-009/REQ-036（iter-15 T2）：产品人设 = system[0] 静态前缀内容物，跨全部用户全部请求
    # 字节恒定（T0 中性默认稿 CEO 审签定稿，全文留档 plans/iter-15-verify.md T0 §4）；
    # 空 = 回退基线 v5 单 system 形态（回归锚点）。多行值在 .env 以双引号包裹
    product_persona: str = ""
    # CHG-009/REQ-038 单价三变量（定夺⑥：admin 只读、成本口径仅计统一 key 模式）：单位
    # 元/百万 token（DeepSeek 计价口径）；None = 未配置 → 成本不估算并提示（不造数，铁律 5）
    price_input: float | None = None
    price_output: float | None = None
    price_cache_hit: float | None = None
    # CHG-010/REQ-039（iter-16 T2）三级压缩管道参数——默认值即 T0 取证定死值
    # （plans/iter-16-verify.md T0 §2/§3：阈值 = 0.75Y 取整千位，Y=9909/9943 两轮一致；
    # 微参数定夺⑨定案 K=2 / R=5 / 摘要超时 30s）；.env 可覆盖，口径定稿
    compact_threshold: int = 7000  # 自动压缩阈值：上一回合 step=1 tokens_prompt 实测值超之即压缩
    snip_keep_recent_tools: int = 2  # 一级 snip K：仅最近 K 条 tool 消息保留结果全文
    compact_recent_turns: int = 5  # 二级 compact R：压缩后保留最近 R 轮全文
    summary_timeout: float = 30.0  # 摘要调用独立超时护栏（秒，不占回合单步 120s 口径）
    # CHG-011/REQ-042（iter-17 T2）用户长期记忆参数——默认值即 T0 取证定死值
    # （plans/iter-17-verify.md T0 §3/§4：上限收紧 30×150 字为体量复核实测定案；
    # 微参数 N=4 / X=10 分钟 / 扫描间隔 60s 论证定死）；.env 可覆盖
    memory_min_turns: int = 4  # 抽取触发轮数下限 N：低于 N 轮的会话不触发抽取
    memory_silence_minutes: int = 10  # 静默窗口 X：距最近回合 ≥ X 分钟视为「会话后」
    memory_scan_interval: float = 60.0  # 常驻扫描间隔（秒）
    memory_max_entries: int = 30  # 记忆条目上限（T0 体量复核定案，原拟稿 50）
    memory_entry_max_chars: int = 150  # 单条记忆字符上限（T0 体量复核定案，原拟稿 200）
    memory_extract_timeout: float = 30.0  # 抽取调用独立超时护栏（沿 summary_timeout 同值定案）
    # CHG-012/REQ-046（iter-18 T2）deep-research 双护栏——默认值即 T0 取证定死值
    # （plans/iter-18-verify.md §3：真实研究回合实测 3~5 步 / 22~27s，16 步 + 900s
    # 维持，定夺⑥授权内零调整）；.env 可覆盖，验收用例以小值注入压测
    max_research_steps: int = 16  # research 步数硬上限（独立于普通回合 10）
    research_total_timeout: float = 900.0  # research 回合总时长护栏（秒；到顶 reason='time_limit'）
    # CHG-012/REQ-045（iter-18 T2）SSE 心跳间隔——T0 本地 nginx 反代实测定档 20s
    # （plans/iter-18-verify.md §2：默认 60s 配置静默流 60.0s 断连、20s 心跳 100s 完整
    # 存活）；非法值 ≤0 由使用方兜底默认 20.0（保守方向，不拒启动）
    heartbeat_interval: float = 20.0
    # CHG-013/REQ-048（iter-19 T2）生命周期事件 hooks——部署者级配置（定夺④）：
    # 注册面为部署侧代码静态注册（app/hooks.py register_hook，main.py 留示例注释），
    # hooks_enabled 仅为部署者免改码停用而设（注册表空即无操作，机制惰性）；
    # hook_timeout 独立超时护栏（T0 定档 5.0s，1~30s 授权内——plans/iter-19-verify.md T0-3）
    hooks_enabled: bool = True
    hook_timeout: float = 5.0

    @field_validator("price_input", "price_output", "price_cache_hit", mode="before")
    @classmethod
    def _empty_price_is_none(cls, v: object) -> object:
        # .env「留空 = 未配置」契约（backend/.env.example 同批口径）：空串按 None 处理，
        # 不经 pydantic float 解析（DEF-040：空串曾致启动崩溃）
        return None if v == "" else v


@lru_cache
def get_settings() -> Settings:
    return Settings()
