#!/usr/bin/env bash
# 提交标题格式门禁（制度 v1.4.12 三条硬禁 + v1.4.14 C 机检）——git hooks 版。
# NCR-iter20-003 整改：与 pre-commit.sh 同批从 Claude Code hook 迁入（环境无关）。
# 安装：cp scripts/hooks/commit-msg.sh .git/hooks/commit-msg && chmod +x .git/hooks/commit-msg
set -u
title=$(head -1 "$1" 2>/dev/null | tr -d '\r')
[ -n "$title" ] || exit 0
if ! printf '%s' "$title" | grep -qE '^(feat|fix|refactor|test|docs|chore|exp)(\([^)]+\))?: .+'; then
  echo "提交被拒绝：标题类型前缀不合法（须 feat|fix|refactor|test|docs|chore|exp，格式「类型: 一句话实际改动」）——制度 v1.4.12。标题：$title" >&2
  exit 1
fi
if printf '%s' "$title" | grep -qE '——|全绿|全过|passed|走查 [0-9]+|[0-9]+ */ *[0-9]+ *P'; then
  echo "提交被拒绝：标题含禁项（「——」串接，或测试计数与验证结果）——制度 v1.4.12 / v1.4.14 C（NCR-iter20-002 处置承载）。标题：$title" >&2
  exit 1
fi
exit 0
