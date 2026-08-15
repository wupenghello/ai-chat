"""密码哈希与会话 token：bcrypt 加盐哈希；token 原值只出现在 Cookie，库内存 SHA-256。"""

import hashlib
import secrets

import bcrypt

# REQ-020（CHG-004 定稿）：最短 8 位
PASSWORD_MIN_LENGTH = 8
# 用户名规则（CEO 定 2026-08-15，随 design-iter-6 基线批准）：2~32 字符，
# 允许中文/字母/数字/_/-；前端（T2）与这里必须同一口径
USERNAME_PATTERN = r"^[A-Za-z0-9_\-一-鿿]{2,32}$"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        # 库里的哈希不合法（损坏/篡改）——视为校验失败，不向上抛
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
