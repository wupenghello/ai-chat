# QA 审计报告 — ai-chat iter-7（2026-08-16，G4 关闭卡点审计）

> 审计执行：qa 员工（subagent，只读）；主会话补证 4 项（运行时复现/提交落位/key 检索/db 权限）已回填（见文末）。
> 审计基准：process/ v1.4.4（走查进任务验收 A / 实现后自查 B / 修复不豁免登记 C 首个完整迭代）+ 项目 tailoring.md。

审计对象：`projects/ai-chat`（独立 git 仓库），iter-7 全迭代（2026-08-16，T0~T3）。
取证方式：文件读取 + `.git/refs/tags`、`.git/logs/HEAD` 只读快照（同 iter-6 先例）+ 测试用例静态清点 + 代码走读。

## 结论：有条件符合（3 项不符合）

符合面（有证据支撑）：提交链完整且全关联编号——reflog 快照：63b6b4d（计划，CEO 批准 Σ10）→ 50ef5d1（T0 设计基线）→ 3fad772（T1 [REQ-023]）→ ad8fe6a（T2 [REQ-014/018]）→ dcfafcd（T3 [REQ-022]）；`design-iter-7` tag 存在且指向 50ef5d1，先于全部 UI 开发提交（design.md §2）；迭代计划质量高（复杂度判定依据含校准基线、排除项 7 条、风险 3 条、Σ10 守恒、范围调整 CEO 决策留档备选方案）；v1.4.4 A 条落地——T0/T2 验收含「design-iter-7 走查清单留档」、T1/T3「不适用」原文注明，T2 走查 26 条逐条留档（23 ✅ + 3 ⏸，⏸ 均为基线自身标注 iter-8 的条目，非漏查）；铁律 4 两处偏离登记完整且经代码核销——tailoring 追加裁剪 2 行（T1 过渡态三口径：proxy.py 无 `provider` 字段、sessions store 仅调 `streamChatViaProxy`、settings store 仅存 systemPrompt，三项与「已收口」声明一致；T2 存量上云「计划与基线冲突按基线执行」有 spec REQ-018 + design-iter-7 §2.3 双重定案支撑）；测试声明静态复核精确吻合——前端 17 个 spec 文件清点 140 条 `it/test`、后端 65 个 `def test_` + 参数化展开 4 = 69，与 verify 声明 140/140、69/69 逐一对上；密钥安全专项通过——`.gitignore` 覆盖 `.env`/`.env.*`（白名单 `.env.example`），`backend/.env` 与 `.env.example` 三变量占位在位，全项目（除依赖目录）`sk-` 模式检索 0 命中，`backend/app` 无任何 print/logging/logger 输出点，profiles.py 全部响应经 `mask_key()` 只回掩码，proxy.py 上游请求头全新构造不透传 Cookie、quota 检查位注释预留（REQ-024 iter-8）；GLM 不补验 CEO 决策（2026-08-16）三处落档完整（defects.md DEF-002 处置更新、iter-7-verify T1 表、rtm.md REQ-014/018 行）；NCR-iter6-005 过渡态注记已在 REQ-001/002 行明确销账；iter-6 审计 6 条 NCR 复查全部关闭在位；门禁钩子 NCR-iter6-001 整改后版本经复读确认无提前 `exit 0`、前后端门禁并存（company-os `a6b0114`）。

## 不符合项清单

| 编号 | 违反条款 | 证据 | 严重级 | 整改建议 | 状态 |
|------|---------|------|--------|---------|------|
| NCR-iter7-001 | requirements.md §4（迭代收尾时 RTM 必须与实际代码一致） | `requirements/rtm.md` L31 REQ-023 行：实现列停留在「iter-7 T1 承载（计划已批准 2026-08-16）」、测试列「待设计」、状态「未开始」——而 T1 已完成并验证（test_proxy.py 16 用例在库、iter-7-verify.md T1 段全绿、同表 REQ-014/018 行及 RTM 头部均记 iter-7 T1/T2 完成）。同一张表部分行更新、本迭代 P0 主需求行漏更；RTM 不一致连续第二迭代出现（iter-6 NCR-005 同条款） | 一般 | G4 前更新该行：实现（proxy.py/client.ts 换源）、测试（test_proxy 16 + client.spec 代理组）、状态→「已验证（v3 口径，iter-7 T1）」并注 quota 联动 iter-8；复盘加防复发措施（任务收尾提交时同步 RTM 行） | 已整改（2026-08-16，RTM REQ-023/REQ-022 行更新），待复盘确认 |
| NCR-iter7-002 | planning.md §3（v1.4.3 周报开发完成即产出）；development.md §3（全量 Code Review 入周报、CEO 过目）；§6（技术债记账） | `plans/weekly-W33.md` 止于 iter-6 章节，「下周计划」（L193-195）仍把 iter-7 列为未来事项；iter-7 章节缺失、全量 Code Review 无记录、技术债小节无处落（本次审计发现的技术债见观察项 2）。T3 提交 dcfafcd（2026-08-16）后开发已完成。同类失守第 5 次（iter-1/2/4/6/7），v1.4.3 专为杜绝此模式立的条款连续两迭代复发 | 一般 | G4 前补 iter-7 章节：测试汇总（前端 140/140、后端 69/69 + ruff、走查 26 条）、技术债小节（含观察项 2）、全量 Code Review 记录 + CEO 过目落痕；复盘必须给出新的机制性改进（「固定后置动作」已被证明无触发即失守，第 5 次复发应升级处置） | 已整改（2026-08-16，周报章节+Code Review+技术债，CEO 过目待办），待复盘确认 |
| NCR-iter7-003 | testing.md §3（v1.4.4 C：当场修复不豁免登记，必须补 DEF 编号与修复提交号）；testing.md §5（走查偏差登记为缺陷） | `plans/iter-7-verify.md` T2 走查 15 及「过程中发现并处置」节：上游 401 气泡重试按钮未按基线隐藏，当场改 `v-if="kind !== 'auth'"`（`src/components/ErrorBubble.vue` L23-24 现状为证），自称「沿 v1.4.4 修复即登记口径，本表留痕」——但登记位置应是 `plans/defects.md`（C 条原文），verify 表内留痕≠DEF 登记；defects.md 无对应条目（iter-7 仅 DEF-015）。v1.4.4 C 条首个迭代即执行走样（与 DEF-014 教训同型） | 一般 | 补登记 DEF-016（偏差描述、严重级一般、修复落点提交号回填——主会话补证已确认含于 ad8fe6a）；复盘明确口径：「登记」一律落 defects.md，verify 表仅是走查证据 | 已整改（2026-08-16，DEF-016 补登记+DEF-015 提交号回填），待复盘确认 |

## 观察项（不构成违规，但值得注意）

1. **T3 断网验收口径注记未入 tailoring**：iter-7-verify T3 对 REQ-022「断网状态下完成的一轮对话」按「断网窗口内会话更改（含刚完成轮次）暂存不丢」取证（AI 回复需上游在线，属架构事实）——解读合理且已透明留档，建议补一行进 tailoring 或 spec 澄清，防 iter-8 复验收口径漂移。
2. **死代码未记技术债（development.md §6）**：`src/api/client.ts` L116-165 直连版 `streamChat`（含 `ApiClientConfig.apiKey` 与 client.spec 5 条旧用例）在 T2 后无任何生产调用方（sessions.ts 仅用 `streamChatViaProxy`），tailoring「自填直连分支已删除」按调用路径口径成立，但函数本体成死代码且未登记——随 NCR-002 整改的周报技术债小节补记，iter-8 定夺删除或保留。
3. DEF-015 处置写「iter-7 T1 提交」未回填具体提交号（应为 3fad772）——testing.md §3 要求精确引用，建议补齐。
4. T2 过程中 SettingsForm.saveProfile 早退缺陷由 settings-form.spec 在提交前暴露并修复（TDD 内环，未进入任何基线），verify 透明记录——建议复盘固化边界口径：提交前测试暴露≠交付缺陷，无需 DEF（与 C 条互补）。
5. T1 性能取证「首块额外延迟为负」（连接池复用 TLS）结论反直觉但证据链可复现（scripts/proxy_smoke.py 两轮对比在库）；iter-8 全链路 Compose 后部署形态变化，建议复测一次。
6. **组织级**：lifecycle.md「迭代末固定动作顺序：复盘 → QA 审计」与 iter-1 起一贯实践（QA 审计 → 整改 → 复盘确认关闭；registry.md 亦按此描述）不一致，该偏离从未登记——建议下次制度修订时二选一（改文本或改实践）。
7. **组织级**：`process/README.md`「当前版本：v1.4」落后 CHANGELOG（已至 v1.4.4，该文件当前另有未提交修改）——随下次 CEO 批准的制度提交更正。
8. RTM 状态标签口径不一：REQ-020 行「已实现」与其验证证据（120/120+37+27 条走查+E2E）不相称（iter-6 遗留）；REQ-022 行「已实现（待 QA 审计）」可随本审计结果更新——随 NCR-001 整改顺带统一。

## 上一轮（iter-6）NCR 关闭状态复查

001 → company-os `a6b0114` + 钩子文件复读确认（无提前 exit 0、前后端并存、BSD sed 修复注释在位）：**已关闭，维持有效**。002 → changes.md 澄清定案 10 + LoginView.spec 清点 17 用例（含整改后再增 3 口径吻合）：**已关闭**。003 → plans/iter-6-verify.md 在库（27 条）：**已关闭**。004 → weekly-W33.md iter-6 章节 + Code Review CEO 过目落痕 2026-08-16：**已关闭**（但同型失守本迭代复发，见 NCR-iter7-002）。005 → RTM REQ-001/002 销账注记在位、REQ-007/014 v3 注记完整：**已关闭**（RTM 一致性以新形态复发，见 NCR-iter7-001）。006 → changes.md 澄清定案 9 + spec REQ-020 涉及页面字段同步：**已关闭**。

## 主会话补证（2026-08-16 回填，全部通过）

1. **运行时复现**：`cd backend && make check` = ruff clean + **69/69**；`npx vitest run` = **140/140**；`npm run build`（vue-tsc + vite）= **通过**。与全部静态清点声明吻合。
2. **提交落位核验**：`git status` 工作区**干净**——iter-7 全部文档（verify/tailoring/RTM/defects）已分别随 3fad772 / ad8fe6a / dcfafcd 提交落位；走查 15 修复（ErrorBubble.vue `v-if`）**确认含于 ad8fe6a**（`git show ad8fe6a --stat` 命中）——NCR-003 维持原判（仅登记缺失），不升级为 §1.4 偏离。
3. **git 全量历史 key 检索**：`git grep $(git rev-list --all)` = **0 命中**（verify「四处 0 命中」声明复核通过）。
4. **运行态**：`docker exec` 复核 `/data/ai-chat.db` = **-rw-------（0600）**（REQ-014 受保护条款⑤复核通过）。

## G4 关闭前置清单（本审计之后仍缺）

1. NCR-iter7-001/002/003 整改（RTM REQ-023 行更新；周报 iter-7 章节 + Code Review + CEO 过目；DEF-016 补登记）；
2. retros/iter-7.md 复盘产出（plans/iter-7.md「实际结果」回填；周报第 5 次复发的机制改进项是复盘必答题）；
3. 生产构建通过记录留痕（本审计补证 1 已运行时佐证）。
