FROM python:3.12-slim

# uv 仅用于按 lockfile 精确安装依赖（与本地开发同一份 uv.lock）
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH" \
    AI_CHAT_DB_PATH=/data/ai-chat.db

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
