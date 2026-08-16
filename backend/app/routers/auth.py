"""认证 API：注册 / 登录 / 登出 / 当前用户（REQ-020，iter-6 T1 全量）。

- 密码 bcrypt 哈希加盐，任何响应/日志不出明文
- 会话 token 经 HttpOnly Cookie（SameSite=Lax，2026-08-15 CEO 定案）传递，前端零 token 管理
- 登录失败统一「用户名或密码错误」，不区分用户名不存在与密码错误（不泄露账号存在性）
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator

from app import quota
from app.config import Settings, get_settings
from app.db import DatabaseDep
from app.security import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    USERNAME_PATTERN,
    hash_password,
    new_session_token,
    password_meets_complexity,
    token_hash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_USERNAME_RE = re.compile(USERNAME_PATTERN)


class Credentials(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_rule(cls, v: str) -> str:
        if not _USERNAME_RE.fullmatch(v):
            raise ValueError("用户名需为 2~32 字符，仅限中文、字母、数字、下划线、连字符")
        return v

    @field_validator("password")
    @classmethod
    def password_rule(cls, v: str) -> str:
        if len(v) < PASSWORD_MIN_LENGTH:
            raise ValueError(f"密码最短 {PASSWORD_MIN_LENGTH} 位")
        if len(v) > PASSWORD_MAX_LENGTH:
            raise ValueError(f"密码最长 {PASSWORD_MAX_LENGTH} 位")
        if not password_meets_complexity(v):
            raise ValueError("密码需包含字母与数字")
        return v


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool = False


class LoginBody(BaseModel):
    """登录凭据：密码只做上限校验（防超长 DoS），不做最小长度/复杂度校验。

    登录时格式不合法与密码错误统一 401「用户名或密码错误」，不泄露密码规则
    （区别于注册/改密的格式校验——那里密码由用户新设，须校验强度）。
    """

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_rule(cls, v: str) -> str:
        if not _USERNAME_RE.fullmatch(v):
            raise ValueError("用户名需为 2~32 字符，仅限中文、字母、数字、下划线、连字符")
        return v

    @field_validator("password")
    @classmethod
    def password_max_rule(cls, v: str) -> str:
        if len(v) > PASSWORD_MAX_LENGTH:
            raise ValueError(f"密码最长 {PASSWORD_MAX_LENGTH} 位")
        return v


def _now() -> datetime:
    return datetime.now(UTC)


def _issue_session(response: Response, conn, user_id: int, settings: Settings) -> None:
    """签发会话：原始 token 进 Cookie（HttpOnly），库内只存 SHA-256。"""
    token = new_session_token()
    expires = _now() + timedelta(hours=settings.session_ttl_hours)
    with conn:
        conn.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), user_id, expires.isoformat()),
        )
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def get_current_user(
    request: Request, conn: DatabaseDep, settings: Annotated[Settings, Depends(get_settings)]
) -> UserOut:
    """受保护端点共用依赖：Cookie 中的 token → 库内有效会话 → 用户；否则 401。"""
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    row = conn.execute(
        """
        SELECT u.id, u.username, u.banned, u.is_admin, s.expires_at
        FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
        """,
        (token_hash(token),),
    ).fetchone()
    if row is None or datetime.fromisoformat(row["expires_at"]) < _now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已过期，请重新登录")
    if row["banned"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账号已被封禁")
    return UserOut(id=row["id"], username=row["username"], is_admin=bool(row["is_admin"]))


CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    body: Credentials,
    request: Request,
    response: Response,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    # REQ-024 注册限频：每 IP 每自然日（先查后计，被拒请求不计数）
    ip = request.client.host if request.client else "unknown"
    if not quota.register_try_consume(conn, ip, settings.register_ip_daily_limit):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, quota.REGISTER_LIMITED)
    username_key = body.username.lower()
    exists = conn.execute(
        "SELECT 1 FROM users WHERE username_key = ?", (username_key,)
    ).fetchone()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "用户名已存在")
    # REQ-020 主流程：注册成功直接登录（签发会话）；首个注册用户自动成为管理员（REQ-025）
    with conn:
        cursor = conn.execute(
            "INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)",
            (body.username, username_key, hash_password(body.password)),
        )
        conn.execute(
            "UPDATE users SET is_admin = 1 WHERE id = ? "
            "AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)",
            (cursor.lastrowid,),
        )
        row = conn.execute(
            "SELECT id, username, is_admin FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    user = UserOut(id=row["id"], username=row["username"], is_admin=bool(row["is_admin"]))
    _issue_session(response, conn, user.id, settings)
    return user


@router.post("/login")
def login(
    body: LoginBody,
    response: Response,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    row = conn.execute(
        "SELECT id, username, password_hash, banned, is_admin FROM users WHERE username_key = ?",
        (body.username.lower(),),
    ).fetchone()
    # 统一错误文案：用户名不存在与密码错误不可区分
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    if row["banned"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账号已被封禁")
    user = UserOut(id=row["id"], username=row["username"], is_admin=bool(row["is_admin"]))
    _issue_session(response, conn, user.id, settings)
    return user


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    """幂等：有会话则删除（token 立即失效），无会话也返回成功。"""
    token = request.cookies.get(settings.cookie_name)
    if token:
        with conn:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash(token),))
    response.delete_cookie(key=settings.cookie_name, path="/")
    return {"detail": "已登出"}


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    return user


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def new_password_rule(cls, v: str) -> str:
        if len(v) < PASSWORD_MIN_LENGTH:
            raise ValueError(f"密码最短 {PASSWORD_MIN_LENGTH} 位")
        if len(v) > PASSWORD_MAX_LENGTH:
            raise ValueError(f"密码最长 {PASSWORD_MAX_LENGTH} 位")
        if not password_meets_complexity(v):
            raise ValueError("密码需包含字母与数字")
        return v


class DeleteAccountBody(BaseModel):
    password: str


@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    request: Request,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
    user: CurrentUser,
) -> dict[str, str]:
    """改密（REQ-021）：验证旧密码 → 更新哈希 → 除当前设备外其他会话 token 失效。

    spec 主流程：除当前设备外的其他设备会话 token 全部失效
    （当前设备保持登录，design-iter-9 定夺①）。
    """
    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
    if row is None or not verify_password(body.old_password, row["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "旧密码错误")
    if body.new_password == body.old_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "新密码不能与旧密码相同")
    token = request.cookies.get(settings.cookie_name)
    with conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), user.id),
        )
        if token:
            conn.execute(
                "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?",
                (user.id, token_hash(token)),
            )
        else:
            conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user.id,))
    return {"detail": "密码已更新"}


@router.post("/delete-account")
def delete_account(
    body: DeleteAccountBody,
    response: Response,
    conn: DatabaseDep,
    settings: Annotated[Settings, Depends(get_settings)],
    user: CurrentUser,
) -> dict[str, str]:
    """注销（REQ-021）：密码二次确认 → 删除账号及全部云端数据（级联）→ 登出。

    auth_sessions / chat_sessions / profiles / usage_daily 均 ON DELETE CASCADE（db.py 迁移），
    删除 users 行即级联清除全部云端数据；PRAGMA foreign_keys=ON 由 connect() 开启。
    """
    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "密码不正确，账号与数据未发生任何变更")
    with conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user.id,))
    response.delete_cookie(key=settings.cookie_name, path="/")
    return {"detail": "账号已删除"}
