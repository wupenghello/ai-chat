#!/usr/bin/env bash
# 样式门禁（iter-5 复盘改进 B，CEO 批准 2026-08-15）
# 1) 令牌定义自引用（--x: var(--x)）——DEF-012 根因二
# 2) 组件裸色值（除白字 #fff/#ffffff 与深底白色叠层 rgba(255,…) 外）——DEF-013/iter-5 verify 口径
set -euo pipefail
fail=0

# 1) 令牌自引用（全 src 扫描）
refs=$(grep -rnE '\-\-[a-z0-9-]+:\s*var\(\s*\-\-[a-z0-9-]+\s*\)' src/ 2>/dev/null || true)
if [ -n "$refs" ]; then
  echo "✗ 令牌自引用（定义处值不能引用自身）：" >&2; echo "$refs" >&2; fail=1
fi

# 2) 组件裸色值（src/components，允许 #fff/#ffffff 与 rgba(255,… 白色叠层））
# 先剥离注释（/* … */ 单行）再扫，避免注释中的示例色值误报
naked=$(grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/ 2>/dev/null \
  | sed -E 's:/\*[^*]*\*/::g' \
  | sed -E 's/:[0-9]+:$/__STRIPPED__/' | grep -v '__STRIPPED__' \
  | grep -v '#fff\b' | grep -v '#ffffff\b' | grep -v 'rgba(255' | grep -v 'rgb(255' || true)
if [ -n "$naked" ]; then
  echo "✗ 组件裸色值（应改用语义令牌；白字/白色叠层除外）：" >&2; echo "$naked" >&2; fail=1
fi

[ "$fail" -eq 0 ] && echo "style-guard 通过（无令牌自引用、无未豁免裸色值）"
exit "$fail"
