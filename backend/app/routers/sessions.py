"""会话 CRUD API —— iter-6 T3 实现，此处仅预留模块位（含认证门禁示范路由）。"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
