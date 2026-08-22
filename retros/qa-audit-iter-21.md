# QA 审计报告 — ai-chat iter-21（2026-08-22）

> QA 员工（subagent）只读审计产出；git/环境取证由主会话代核（见文末「主会话补证」节）。

## 结论：有条件符合（2 项不符合）

iter-21 的工程交付面（需求规格、设计基线、计划纪律、测试覆盖、台账数字一致性）质量扎实：REQ-052/CHG-015 全要素在案且三方数字（verify / 周报 / RTM）严格互证，测试断言面实测抽查属实（test_usage_api 13 例、UsagePane.spec 12 例逐条核对），实现级决策与既有用例改写映射登记完备。**但 CHG-015 落地核对清单第 5/6 项未回填且三处台账声称「全勾闭环」——同型病连续第三轮复发，且 v1.4.19 专设的回填机检因符号面漏洞未生效。**

## 不符合项清单

| 编号 | 违反条款 | 证据（文件路径） | 整改建议 | 状态 |
|------|---------|----------------|---------|------|
| NCR-iter21-001 | requirements.md §3 第 5 条（v1.4.10 制度 A）+ v1.4.18 A（CHG 清单回填入提交防漏核对）+ v1.4.19 A；**同型第三轮复发**（iter-19 NCR-001 → iter-20 NCR-001 → 本轮） | `requirements/changes.md` L37-38：CHG-015 落地核对清单第 5 项（design/proto 同步）、第 6 项（iter-21 计划起草）仍为 ☐ 未回填——而两事项实际均已交付（proto/index.html L665 占位示意在案；plans/iter-21.md 已批准在案）。同时 `plans/iter-21-verify.md`、`plans/weekly-W34.md` iter-21 节、`requirements/rtm.md` REQ-052 行三处均声称「CHG-015 落地核对清单 6 项全勾闭环」——声明与文件实态不符，台账失实 | 当轮两行整改：changes.md 第 5/6 项回填 ✅ 并注明交付证据（proto L665 / 计划 d612956）；三处「全勾闭环」表述以 changes.md 实际回填为准收口 | 待整改 |
| NCR-iter21-002 | v1.4.19 A「CHG 清单回填机检化（git hooks 台账门禁 C）」——**机检存在 ≠ 机检生效**（iter-20 NCR-002/003 同族教训重演） | `scripts/hooks/pre-commit.sh` L52：台账门禁 C 仅匹配 `grep '⬜'`——CHG-015 清单使用「☐」符号即完全旁路（CHG-014 用「⬜ 待」可被拦，CHG-015 换符号后机检静默失效）。NCR-iter21-001 之所以能入库，此为直接技术原因 | 门禁 C 匹配模式扩为 ⬜/☐/待 三符号并集（或反向校验：CHG 节内清单行必须全 ✅）；修后 dry-run 实证（沿 v1.4.17 教训口径） | 待整改 |

## 观察项（不构成违规，但值得注意）

1. **OBS-1（上轮 OBS-4 M40 复验触发条件）**：iter-21 文档均无 M40/search 复验留档；主会话代核 backend/.env 无 SEARCH/TAVILY 配置 → **触发条件未出现，无需动作**（主会话补证 4）。
2. **OBS-2（vitest 新增低于预估带宽）**：计划 T3 预估 +15~20，实际 +12（pytest 13 在带宽内）。断言面抽查覆盖完整，无缺口迹象，仅记录预估偏差。
3. **OBS-3（走查 PASS 数与清单条数不同源）**：设计清单 28 条 vs 脚本报 32 PASS / 2 N/A——PASS 数含子条件细分。非断言面缩水（验收对照逐条有承载），建议后续脚本输出与清单编号做对照表。
4. **OBS-4（零 DEF 声明自洽）**：defects.md 末条 DEF-039，与「iter-21 零新增 DEF」一致。

## 符合面摘要（证据索引）

- **需求**：spec REQ-052 编号/用户故事/主流程/异常分支/验收 7 条齐备；头部基线沿革含 v12；CHG-015 含影响评估（Σ6）、六定夺、CEO 批准、落地核对清单在案（唯回填问题见 NCR-001）。RTM REQ-052 行与用量面行同 verify 互证。
- **设计**：design-iter-21 状态头已基线 + §9 零令牌自查 + v1.4.19 C hit-test 豁免登记；index.html 高保真稿在案；spec 指针回填；proto L665 示意同步。
- **计划**：估算依据/排除项 6 条/风险 4 条/串行口径/ISO 周头部自检/容量校准表齐备；Σ6 与 CHG-015 一致。
- **台账**：四件套 + 五件套齐全；pytest 360 / vitest 423 / 走查 32/0/2 + 复跑 38/0 三处数字一致；T2-1 五项 / T3-1 四项实现级决策齐登；改写映射（vitest 3 处 + walkthrough-20 条 18）在册；测试计数机器采集声明在案。
- **测试**：test_usage_api 13 例覆盖验收 1~5 后端面；UsagePane.spec 12 例覆盖 U1~U16 逐字与四分支态。
- **偏离**：walkthrough-21 拦截模拟与 2 条 N/A 均已登记 verify T3-1（合规）；未见未登记偏离。
- **上轮闭环**：qa-audit-iter-20 三项 NCR 整改在案；OBS-4 → 本报告 OBS-1（条件未触发）。
- **复盘**：iter-1~20 共 20 件齐全；iter-21 待 G4 属正常。

## 主会话补证（2026-08-22，git/环境取证）

1. **串行时序 ✅**：design-iter-21 基线 25af07d（19:23:56）→ T2 代码 6fd44a4（19:32:50）→ T3 代码 f3e998b（20:34:15）——设计基线严格先于全部开发提交（v1.4.15 串行纪律实证）。
2. **tag 存在性 ✅**：req-baseline-v12（a0eddde）与 design-iter-21（25af07d）本地与远端（git ls-remote）均在案。
3. **五件套同批 ✅**：6fd44a4 含代码（proxy/telemetry/test_usage_api）+ verify + 周报 + RTM（defects.md 零变更 = 当轮零 DEF，制度口径「如有 DEF 同批」合规——非 iter-20 NCR-003 滞后同型）；f3e998b 同构齐批。
4. **OBS-1 判定 ✅**：backend/.env 无 AI_CHAT_*SEARCH*/TAVILY* 配置——M40 复验触发条件未出现，留档「条件未触发、无需动作」。
5. **门禁实态**：.git/hooks/pre-commit 与 scripts/hooks/pre-commit.sh 逐字节一致（本仓挂载生效）——但匹配面漏洞属实（NCR-002 成立）；修补后 dry-run 随整改提交实证。
6. **运行时背书**：iter-21 三笔提交均经 pre-commit 全量门禁实跑（vitest 423 / pytest 360 / ruff / style-guard 全绿）后入库——运行时数字采信提交时点机器输出。

## 关闭记录（2026-08-22 CEO「全部当轮整改」）

| 编号 | 整改动作 | 证据 | 状态 |
|------|---------|------|------|
| NCR-iter21-001 | changes.md CHG-015 清单第 5/6 项回填 ✅ + 交付证据注明（proto 6c048cf / 计划 d612956） | requirements/changes.md L37-38（本批提交） | ✅ 已关闭 |
| NCR-iter21-002 | 台账门禁 C 未勾符号匹配扩为 ⬜/☐/◻ 并集（清单行锚定 `^\s*\d+\.\s*[符号]`，散文提及不误伤）+ 同步 .git/hooks/pre-commit + dry-run 三态实证（①☐ 未勾拦 ②全勾放 ③⬜ 未勾拦） | scripts/hooks/pre-commit.sh L48-60（本批提交） | ✅ 已关闭 |

OBS 处置：OBS-1 经主会话代核 4 判定「触发条件未出现」（backend/.env 无 search 配置），留档无需动作；OBS-2/3/4 留档（OBS-3 对照表建议转复盘候选）。
