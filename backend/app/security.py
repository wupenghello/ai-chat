"""密码哈希与会话 token：bcrypt 加盐哈希；token 原值只出现在 Cookie，库内存 SHA-256。"""

import hashlib
import secrets

import bcrypt

# REQ-020（CHG-004 定稿）：最短 8 位；上限 128（design-iter-6 §2.1，防超长 DoS 输入）
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
# 用户名规则（CEO 定 2026-08-15，随 design-iter-6 基线批准）：2~32 字符，
# 允许中文/字母/数字/_/-；前端（T2）与这里必须同一口径
USERNAME_PATTERN = r"^[A-Za-z0-9_\-一-鿿]{2,32}$"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def password_meets_complexity(plain: str) -> bool:
    """密码复杂度（design-iter-9 定案，CEO 2026-08-16 拍板）：至少含一个字母（a-zA-Z）+ 一个数字。

    长度（8~128）由 PASSWORD_MIN/MAX_LENGTH 承担，本函数只判断字符构成；
    中文等非 ASCII 字符不算「字母」，避免「密码123456」这类仅中文+数字通过。
    """
    has_alpha = any("a" <= c.lower() <= "z" for c in plain)
    has_digit = any(c.isdigit() for c in plain)
    return has_alpha and has_digit


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
