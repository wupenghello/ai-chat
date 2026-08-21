# 复盘报告 — ai-chat iter-18（D1 deep-research 子代理 + SSE 心跳）

> 日期：2026-08-21 · G4 关闭复盘 · CEO 四问结论「认可，A+B 落制度 v1.4.17」
> 输入：plans/iter-18.md（计划）/ git log（实际，94e5d4e..0ec0549 全部推送 GitHub）/ weekly-W34.md iter-18 节 / defects.md（DEF-038）/ retros/qa-audit-iter-18.md

## 1. 做对了什么（可固化的习惯）

1. **T0 取证三连一次定稿零返工**：research prompt R2、心跳 20s、护栏 16 步 + 900s 全部「取证即定死」→ T2 直接落 config/常量，全迭代无一处因取证不足返工；nginx 三组实测（默认 60s 断连/心跳保活/部署 300s 现状）还修正了心跳价值口径（「不依赖部署配置的鲁棒性」）。
2. **「随测项挂账 → 收口」闭环模式**：T0 因无 Tavily key 如实登记三项随测（沿 DEF-002 先例）→ key 到位后一次走查全收（[n] 对应真实来源/字数 2705≤3000/质量不编造三 PASS）——环境受限项挂账优于硬凑。
3. **故障下的核验纪律（v1.4.14 B）**：T3 agent 与 Code Review agent 两次 API 402 中断，均「亲跑核验/恢复续跑后采信」而非口头采信——T3 四道门槛与 Code Review 三问结论均在核验后落地，制度在故障场景依然有效。
4. **不顶格决策兑现**：Σ9 留的余量 1 实际吸收了 QA 整改 + DEF-038 处置 + key 击穿回退三项计划外工作，全迭代零延期——「默认不顶格」再获一例正面证据。

## 2. 哪里卡住了（根因）

1. **NCR-001：v1.4.16 A 首战失守**（RTM 全局回归基线行 D1 面漏收口）——更新 REQ 三行时漏基线行，「台账/版本类滞后」第 5 代复发。根因一致：**收尾登记动作无触发机制、靠记忆**——制度条文 + 计划明文承诺（iter-18.md L36）仍未转化为执行动作。
2. **NCR-002：周报失守第 11 次，且这次是机检旁路（实证在案）**——复盘时 dry-run 坐实：hook 周报门禁段自 v1.4.14 加入以来**从未真正生效**：hook 进程 cwd 固定 company-os，测试门禁靠遍历 projects 找 Makefile 正常工作，而周报门禁的 `git diff --cached` 在 company-os 执行、拿到空 staged → 静默跳过（staged 含 backend 文件 + make check 332 passed + exit 0 放行的完整证据链）。**机检存在 ≠ 机检生效——未实证验证过的门禁是摆设**。
3. API 余额 402 两次中断 agent（外部依赖，处置有效但打断节奏）；`.env` 真实 key 击穿 7 个「key 缺失」测试分支（环境副作用疏忽，铁律 2 hook 正确拦截兜底，回退 + 走查脚本改进程环境优先）。

## 3. 流程改进（CEO 批准「A+B 落制度 v1.4.17」）

| # | 改进 | 落点 |
|---|------|------|
| A | **hook 仓库定位修复 + 门禁生效面实证**：裸 git commit 时遍历候选仓库（company-os 自身 + projects/*），取 staged 非空者为提交目标再执行全部门禁（顺带修正测试门禁前端面同样失真的问题——此前 npm test 从未在 ai-chat 仓库上跑过）；**新门禁上线必须以 dry-run 实证生效**（周报门禁 4 个迭代的摆设教训） | .claude/hooks/pre-commit-guard.sh + process/development.md §2（v1.4.17） |
| B | **台账五件套 + 收口类提交机检**：任务完成四件套（周报/缺陷账/verify/提交）扩为「+RTM 行同步」五件套；走查脚本类文件（scripts/e2e-walkthrough-*，迭代收口任务标志）staged 时必须同批含 requirements/rtm.md——治「REQ 行已收口而基线行仍留待执行」的异步半更新态（NCR-001/iter17-002 同型两连发） | process/development.md §1 + guard 脚本（v1.4.17） |

CHANGELOG 记录：process/CHANGELOG.md v1.4.17 条目；ai-chat tailoring.md 版本行同批升 v1.4.17（v1.4.16 A ②）。

## 4. 估算校准

- 本迭代：计划 Σ9（S1+M2+L4+M2 不顶格）vs 实际 Σ9（T0~T3 全按定级完成）——**零偏差，连续第十三轮**。
- 容量校准：Σ≤10 维持；不顶格决策下余量 1 吸收三项计划外工作（QA 整改/DEF-038/key 回退）零延期——「默认不顶格、顶格需三条理由」口径维持不动，本期为该口径第二例正面证据（首例 iter-14）。
- 墙钟：CHG-012 批准 → 计划批准 → T0~T3 → QA 审计 → Code Review 全链单日完成（2026-08-21），含两次 agent API 中断恢复。

## 5. 迭代关闭记录

- 基线 v9 全量达成：REQ-045（P0）/ REQ-046（P0）/ REQ-047（P1）已验证（走查 41 PASS/0 FAIL）。
- 回归基线：pytest 312→332 + vitest 364→378 + 走查 41 PASS/0 FAIL（DEF-038 改规格处置后），功能性删除为零，D1 面全期收口。
- QA 审计：有条件通过（2 NCR 当轮整改闭环 c6d473a + 2 OBS 处置 + 主会话补证 7 项全过）。
- Code Review：CEO 认可（三问结论 + 5 条非阻塞取舍留档 weekly-W34.md）。
- 缺陷：DEF-038 当轮闭环（改规格对齐 DOM，CEO 定夺）；无未关闭缺陷。
- 提交与 tag：94e5d4e..0ec0549 全部推送 GitHub（tag req-baseline-v9 / design-iter-18 远端在案）。
- 七期路线进度：A1→A2→B1→B2→C→**D1 ✅**→D2，下一候选 D2 hooks（可与移动端搭班，走 CHG）。
