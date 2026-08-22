#!/usr/bin/env bash
# 提交门禁（铁律 2）——git hooks 版（环境无关）。
# NCR-iter20-003 整改（2026-08-22 CEO 定夺「全部按建议整改」）：原守卫挂 Claude Code
# PreToolUse hook（company-os/.claude/hooks/pre-commit-guard.sh），非 Claude Code 环境
# 整体旁路（三道机检 iter-20 未触发）。本脚本把同一组检查落到本仓库 .git/hooks/pre-commit，
# 任何环境提交都过同一门禁。检查面与原守卫对齐：测试不过不提交 + 台账四件套/五件套。
# 安装：cp scripts/hooks/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

# —— 测试门禁：前端 vitest + 后端 make check + guard:style（任一失败即拒）——
if ! npm test --silent; then
  echo "提交被拒绝：npm test 未通过（铁律 2：测试不过不提交）。" >&2
  exit 1
fi
if [ -f backend/Makefile ] && grep -qE '^check:' backend/Makefile; then
  if ! make -C backend check; then
    echo "提交被拒绝：backend make check 未通过（铁律 2）。" >&2
    exit 1
  fi
fi
if python3 -c 'import json; s=json.load(open("package.json")).get("scripts",{}); exit(0) if "guard:style" in s else exit(1)' 2>/dev/null; then
  if ! npm run guard:style --silent; then
    echo "提交被拒绝：style-guard 未通过（制度 v1.4.3）。" >&2
    exit 1
  fi
fi

# —— 台账门禁 A（v1.4.14）：代码/测试变更必须同批携带周报条目 ——
staged=$(git diff --cached --name-only 2>/dev/null)
if [ -n "$staged" ] && printf '%s' "$staged" | grep -qE '^(backend/(app|tests)/|src/|scripts/)'; then
  # 走查脚本自身的台账面由门禁 B 承载；hooks 目录安装脚本不触发周报面
  if ! printf '%s' "$staged" | grep -qE '^scripts/hooks/'; then
    if ! printf '%s' "$staged" | grep -qE '^plans/weekly-W[0-9]+\.md$'; then
      echo "提交被拒绝：代码/测试变更未同时暂存周报当迭代条目（plans/weekly-W*.md）——台账四件套机检（v1.4.14 A）。" >&2
      exit 1
    fi
  fi
fi

# —— 台账门禁 B（v1.4.17）：走查脚本 staged 时必须同批含 RTM ——
if printf '%s' "$staged" | grep -qE '^scripts/e2e-walkthrough-'; then
  if ! printf '%s' "$staged" | grep -qE '^requirements/rtm\.md$'; then
    echo "提交被拒绝：走查脚本未同批携带 RTM 行同步（requirements/rtm.md）——台账五件套机检（v1.4.17 B）。" >&2
    exit 1
  fi
fi
exit 0
