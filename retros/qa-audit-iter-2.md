# QA 审计报告 — ai-chat iter-2（2026-08-15）

- 审计人：QA 审计员（AI 员工，独立于项目开发，向 CEO 汇报）
- 审计范围：iter-2 全迭代（c3037d4/T2 → ad44e73/DEF-002 关闭；设计基线 a192146），开发完成、待复盘关迭代（G4 前置审计）
- 审计基准：process/ v1.3（planning.md、design.md、development.md、testing.md §5）+ projects/ai-chat/tailoring.md + 铁律 5 条
- 取证限制声明：本次为只读审计（Read/Glob/Grep），**无法执行 git**。提交顺序与 tag（a192146 基线 → c3037d4 开发）以委派方外部验证为准，并以下列仓库内文档交叉印证：plans/iter-2.md 任务表"设计先行"约定、design/iter-2/index.html 第 6 节"开发自 tag 后解锁"、src/components/ComposerBox.vue:121 注释"design-iter-2 已基线"、RTM 头注。文档间无矛盾。

## 结论：有条件通过（3 项不符合，其中 1 项中严重度须在关迭代前整改）

主干流程合规且证据扎实：计划五要素齐备、容量 Σ10 与复盘建议一致；设计零新增令牌声明经逐值核对属实（#D93025/#646A73 为 iter-1 基线 `--c-danger`/`--c-text-2`，#B7251C 见 iter-1 稿 170/234 行，#F2F3F5 见 72/127/266 行）；24 条走查 1:1 全覆盖不抽查；tailoring 承诺的两条集成用例真实落地（挂载完整 App.vue + mock IndexedDB/网络层，`src/__tests__/integration.spec.ts`）；RTM 抽查两条"已验证"均与代码对应；DEF-001 根因记录与 collect.sh 修复注释、metrics/data.csv 第二行（tag 计数 4 正确）三方互证；DEF-002 关闭有 CEO 决策留痕。问题集中在**周报/review 体系再次未运转**（恰是 NCR-003 整改承诺的首次兑现机会）。

## 不符合项清单

| 编号 | 不符合事实 | 违反条款 | 证据 | 严重度 | 建议处置 |
|------|-----------|---------|------|--------|---------|
| NCR-iter2-001 | iter-2 开发已全部完成，但周报体系未运转：① `plans/weekly-W33.md` 内容停留在 iter-1（"进行中"表仍列 DEF-001 待办、集成用例待办——实际均已完成，状态滞后于事实且未更新）；② iter-2 无任何 code review 记录，而 W33 周报明确承诺"**iter-2 起按制度执行**：每迭代至少一次全量 review，CEO 亲自过目，记录追加到当次周报"；③ 36/36 测试结果无周报载体；④ 技术债未销账（W33 登记 4 项中"collect.sh 绕行""Markdown 渲染"2 项状态已变） | planning.md §3（周五周报）；development.md §3（review 进周报）、§6（技术债记账）；testing.md §4（迭代末测试结果汇总进周报）；且属 iter-1 NCR-003 关闭承诺的首次兑现即失守 | `plans/weekly-W33.md`（全文仅覆盖 iter-1）；`plans/iter-2-verify.md`（36/36 无周报落点）；项目内检索"review"仅命中 iter-1 文档 | 中 | 关迭代（复盘）前补 iter-2 周报内容：review 记录（或如实说明+CEO 确认）、36/36 测试汇总、技术债销账。**此项整改完成前建议 CEO 不批准 G4 关闭** |
| NCR-iter2-002 | 设计稿文件状态自相矛盾：第 6 行 title"iter-2 设计稿（**待基线** design-iter-2）"、第 168 行 badge"状态：**待 CEO 评审** → 通过后打 design-iter-2 基线"，与第 6 节基线声明（第 462 行）"**已获 CEO 批准基线（design-iter-2 tag）**"直接矛盾——基线后头部状态未更新。仅凭文件本体无法判定基线状态，需依赖 RTM 头注与外部 tag 验证佐证。与 iter-1 NCR-005（spec.md 状态行过期）同类复发 | design.md §2 基线管理（基线后改动/状态应可追溯）；qa-audit-iter-1 NCR-005 整改精神（"iter-2 顺手核查其余文档头部状态字段"——恰未执行到新产出文档） | `design/iter-2/index.html:6`、`:168` vs `:462` | 低 | 基线后将 title/badge 更新为"已基线"；复盘时把"文档头部状态随基线/发布动作同步更新"列入自查清单 |
| NCR-iter2-003 | 走查第 16 条（REQ-010 停止时效）：验收硬指标为"点击停止后 **200ms 内**停止渲染"（plans/iter-2.md T2 验收、设计稿 2.1），取证却为"实测 **<300ms**（含脚本 setTimeout 下限）"——测量手段下限高于验收阈值，现有证据**不能证明** ≤200ms 达标。披露诚实但证据不足 | testing.md §2 准出（测试全绿+验收有据）；development.md §1（验收标准即完成标准） | `plans/iter-2-verify.md:27`；`plans/iter-2.md:18`；`design/iter-2/index.html:279`（200ms 硬指标） | 低 | 补一条构造性证据：单测断言 `stopGeneration()` 调用后同步 abort、后续 delta 不再写入 DOM（同步路径即 <200ms 的充分证明），复测后更新 verify 记录 |

## 观察项（不构成违规，但值得记录）

1. **NCR-004 整改承诺无法本次核验**："iter-2 起提交带 REQ 编号、fix 关联缺陷编号"是行为承诺，本次无 git 权限，且项目文档中无任何 iter-2 提交哈希引用可交叉验证（DEF-003~009 均引用的是 iter-1 提交号）。建议 CEO 抽查 `git log c3037d4..ad44e73` 或列入下次审计必查项。
2. **T1/T4 无 REQ 编号**：planning.md v1.3 §1 要求每任务"对应 REQ 编号"，T1 挂"复盘改进项 C"、T4 挂"DEF-001"，追溯链完整但字面不符。建议制度明确"流程基础设施任务"的合法映射写法（复盘时提）。
3. **tailoring.md 头部制度版本停留在 v1.2**，iter-2 实际按 v1.3 执行（估算条款）。追加裁剪均有日期可追溯，不构成违规，建议下次触碰该文件时同步版本行。
4. **REQ-008 端到端取证降级**：请求体浏览器侧抓取失败，走查 4/11 以单测替代（verify"遗留观察"节如实声明），RTM 备注与实际一致——处理透明，风险可接受；建议下个迭代任一次真实 API 调用时顺手抓一次请求体补证。
5. **度量数据判定为机器采集**：`metrics/data.csv` 两行（17/25 commits、1/4 tags）格式与 `collect.sh` 输出语句逐字段一致；4 个 tag 与实际（req-baseline-v1、design-iter-1、v0.1.0、design-iter-2 均在 7 天窗口内）吻合；DEF-001 根因（`git for-each-ref` 无 `--since`，退出码 129）在 defects.md、脚本注释、csv 可写性三处互证，无手编迹象。铁律 5 符合。
6. **DEF-002 处置路径合规**：计划原文为"充好后补做"，实际由 CEO 决策改为"不充值、不补验、接受 REQ-014 部分达成"，决策记录（含依据）在 defects.md，RTM 同步备注——缺陷处置权在 CEO，链路完整，不需变更记录（非需求变更）。
7. iter-1 NCR-001 整改效果验证：集成用例正是为拦"CEO 试用才发现"级别的集成路径 bug 而设，本轮两条用例断言粒度（真实组件树、DOM 断言、切会话状态恢复）达到了 tailoring 承诺的目的——上轮观察项 5 的关切已闭环。

## 上一轮 NCR（qa-audit-iter-1）闭环状态表

| 编号 | 整改承诺 | 闭环证据（本次核查） | 状态 |
|------|---------|---------------------|------|
| NCR-001 | 7 项缺陷补录 + DEF 前缀入 tailoring | `plans/defects.md` DEF-003~009 均标注"补录"+原修复提交号；tailoring.md 追加裁剪第 3 行 | 已闭环 ✓ |
| NCR-002 | 原型/设计稿同步 CHG-001 + 制度防护 | proto/index.html:988/1023/1170、iter-1 稿：467/475 均已改"切换不中断"并注明 CHG-001；changes.md 补记；process v1.3.1 | 已闭环 ✓ |
| NCR-003 | 补 W33 周报；iter-2 起周五固定产出 | 周报已补 ✓；但 **iter-2 当周未延续**（见 NCR-iter2-001）——形式闭环、执行复发 | 形式闭环，执行复发 → 转新 NCR |
| NCR-004 | iter-2 起提交带 REQ 编号 | 无 git 无法核验，文档亦无佐证 | 待核验（观察项 1） |
| NCR-005 | spec.md 状态行修正 | spec.md 第 3/4 行已一致（已基线 + 指向 changes.md） | 已闭环 ✓ |
| NCR-006 | 时间描述以 git 为准 | iter-1-verify.md:4/:52 已改"凌晨 02:47~02:54"并注明依据 | 已闭环 ✓ |

## 关键通过项摘录（正面证据）

- 计划五要素全齐（`plans/iter-2.md`：每任务有复杂度判定依据——类比/拆解均具体、验收标准可测）；容量 Σ = M2+L3+M2+M2+S1 = 10，与复盘建议"Σ ≤ 10（M=2/L=3 计）"精确一致；"不做清单"3 项有取舍记录（REQ-009 砍掉有 CEO 拍板留痕）、风险 3 条均有应对。
- 走查 24/24 全覆盖：verify 记录与设计稿第 3 节逐条 1:1 对应（含第 19/20 边界实测撞上、第 21 集成自动化断言），符合 testing.md v1.3"完整走查不允许抽查"。
- RTM 抽查：REQ-008 → `settings.spec.ts:61-77` + `client.spec.ts:88`（30 轮 system 保留）；REQ-010 → `composer.spec.ts:31-50` + `sessions.spec.ts:119-166` + 集成用例 #2；实现落点（`ComposerBox.vue` stop 按钮、`MessageBubble.vue` stopped 胶囊、`sessions.ts:79` stopGeneration、`sessions.ts:163-164` system 居首）全部实存。

**处置建议汇总**：NCR-iter2-001 为关迭代卡点（补周报 + review 记录后可关闭）；NCR-iter2-002/003 可随复盘一并整改。整改完成后由 CEO 批准 G4 关闭，本报告三项 NCR 计入项目 NCR 台账跟踪至关闭。

---

## 主会话补证（2026-08-15，QA 无 git 权限的两项由主会话代核，CEO 可复核）

- **观察项 1 / 上轮 NCR-004 核验：已兑现 ✓**。`git log c3037d4..ad44e73` 全部 5 个提交（ad44e73 DEF-002、e0c1f86 REQ-008/010、fb2c2f0 DEF-001、0aa9278 T1、186a140 REQ-008）+ 范围起点 c3037d4（REQ-010）——每个提交均带 REQ/DEF/T 编号，行为承诺兑现。
- **设计基线 tag 外部验证：design-iter-2 存在，创建日期 2026-08-15 ✓**（`git tag -l --format='%(refname:short) %(creatordate:short)'`）。

## NCR 处置登记（跟踪至关闭）

CEO 决策（2026-08-15）：三项全部整改。

| 编号 | CEO 处置决策 | 整改记录 | 状态 |
|------|-------------|---------|------|
| NCR-iter2-001 | 整改 | weekly-W33.md 更新为覆盖 iter-2（周报内容 + 37/37 测试汇总 + 技术债销账 + 全量 review 记录）；CEO 过目确认随 G4 批准登记 | 整改完成，待 CEO 确认 |
| NCR-iter2-002 | 整改 | design/iter-2/index.html title（第 6 行）与 badge（第 168 行）更新为"已基线" | 已关闭 |
| NCR-iter2-003 | 整改 | sessions.spec 新增"停止时效构造性证明"用例（stopGeneration 同步 abort，37/37）；iter-2-verify.md 第 16 条取证更新 | 已关闭 |
