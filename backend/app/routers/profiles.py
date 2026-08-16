"""供应商档案 API —— REQ-018（iter-7 T2）：档案迁服务端 + 掩码下发。

- key 明文仅入库（SQLite，受保护由可验收条款承载，design-iter-7 定夺②），
  任何响应只回掩码（sk-****后4位）——明文绝不下发前端
- 模式判定（设计稿 §1 定稿）：存在 is_active 档案 = 自填模式；无 = 统一 key 模式。
  「设为当前」= activate（切换，档案数据不动）；「回退统一密钥」= 清除 is_active（档案保留）
- 当前生效档案不可删除（前端禁用 + 后端 409 双保险）；编辑时 key 可空 = 沿用原值
"""

import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from app.db import DatabaseDep
from app.routers.auth import CurrentUser

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


def mask_key(key: str) -> str:
    """列表/编辑处显示的服务端掩码（design-iter-7 §2.1：sk-****后4位）。"""
    tail = key[-4:] if len(key) > 4 else ""
    return f"sk-****{tail}"


class ProfileOut(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    api_key_masked: str
    is_active: bool


class ProfileIn(BaseModel):
    name: str
    base_url: str
    model: str
    api_key: str = ""  # 编辑时可空 = 沿用原值（安全：已存 key 不回显，见模态设计）

    @field_validator("name", "model")
    @classmethod
    def nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("必填项不能为空")
        return v.strip()

    @field_validator("base_url")
    @classmethod
    def base_url_rule(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not v.startswith(("http://", "https://")):
            raise ValueError("base_url 必须以 http(s):// 开头")
        return v


def _out(row) -> ProfileOut:
    return ProfileOut(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        model=row["model"],
        api_key_masked=mask_key(row["api_key"]),
        is_active=bool(row["is_active"]),
    )


def _own_row(conn, user_id: int, profile_id: str):
    """取本人的档案行；不存在/属他人统一 404（不泄露他人档案存在性）。"""
    row = conn.execute(
        "SELECT * FROM profiles WHERE id = ? AND user_id = ?", (profile_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "档案不存在")
    return row


@router.get("")
def list_profiles(user: CurrentUser, conn: DatabaseDep) -> list[ProfileOut]:
    rows = conn.execute(
        "SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at", (user.id,)
    ).fetchall()
    return [_out(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_profile(body: ProfileIn, user: CurrentUser, conn: DatabaseDep) -> ProfileOut:
    if not body.api_key.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "API Key 必填（添加时）")
    row = (
        uuid.uuid4().hex,
        user.id,
        body.name,
        body.base_url,
        body.model,
        body.api_key.strip(),
    )
    with conn:
        cur = conn.execute(
            """
            INSERT INTO profiles (id, user_id, name, base_url, model, api_key)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            row,
        )
    created = conn.execute("SELECT * FROM profiles WHERE rowid = ?", (cur.lastrowid,)).fetchone()
    return _out(created)


@router.put("/{profile_id}")
def update_profile(
    profile_id: str, body: ProfileIn, user: CurrentUser, conn: DatabaseDep
) -> ProfileOut:
    _own_row(conn, user.id, profile_id)
    key = body.api_key.strip()
    with conn:
        if key:
            conn.execute(
                """
                UPDATE profiles SET name = ?, base_url = ?, model = ?, api_key = ?,
                    updated_at = datetime('now') WHERE id = ? AND user_id = ?
                """,
                (body.name, body.base_url, body.model, key, profile_id, user.id),
            )
        else:  # key 留空 = 沿用原值（design-iter-7 §2.2 编辑模态）
            conn.execute(
                """
                UPDATE profiles SET name = ?, base_url = ?, model = ?,
                    updated_at = datetime('now') WHERE id = ? AND user_id = ?
                """,
                (body.name, body.base_url, body.model, profile_id, user.id),
            )
    return _out(_own_row(conn, user.id, profile_id))


@router.delete("/active")
def clear_active(user: CurrentUser, conn: DatabaseDep) -> dict[str, str]:
    """回退统一密钥：清除当前生效（档案保留、可再启用），下一次请求生效（REQ-014 主流程 4）。
    注意必须声明在 DELETE /{profile_id} 之前，否则 "/active" 会被路径参数吞掉。"""
    with conn:
        conn.execute(
            "UPDATE profiles SET is_active = 0 WHERE user_id = ? AND is_active = 1", (user.id,)
        )
    return {"detail": "cleared"}


@router.delete("/{profile_id}")
def delete_profile(profile_id: str, user: CurrentUser, conn: DatabaseDep) -> dict[str, str]:
    row = _own_row(conn, user.id, profile_id)
    if row["is_active"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "当前生效的档案不可删除，请先切换到其他档案或回退统一密钥"
        )
    with conn:
        conn.execute("DELETE FROM profiles WHERE id = ? AND user_id = ?", (profile_id, user.id))
    return {"detail": "deleted"}


@router.post("/{profile_id}/activate")
def activate_profile(profile_id: str, user: CurrentUser, conn: DatabaseDep) -> dict[str, str]:
    """设为当前生效档案（进入自填模式）。同一事务内先清旧再生效，保证每用户至多一个。"""
    _own_row(conn, user.id, profile_id)
    with conn:
        conn.execute(
            "UPDATE profiles SET is_active = 0 WHERE user_id = ? AND is_active = 1", (user.id,)
        )
        conn.execute(
            "UPDATE profiles SET is_active = 1, updated_at = datetime('now') "
            "WHERE id = ? AND user_id = ?",
            (profile_id, user.id),
        )
    return {"detail": "activated"}
