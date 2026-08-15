.PHONY: check test lint

# 一键检查（process/testing.md「服务端项目」最低要求）：lint + 全部测试
check:
	uv run ruff check .
	uv run pytest -q

test:
	uv run pytest -q

lint:
	uv run ruff check .
