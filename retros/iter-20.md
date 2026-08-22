# 复盘报告 — ai-chat iter-20（2026-08-22）

> 迭代定位：移动端主界面适配（CHG-014，req-baseline-v11）——REQ-049/050/051 抽屉化/弹窗全屏/触摸交互；七期 agent 路线收官后首个产品形态迭代。
> 四问与 Code Review 材料 CEO 已认可（2026-08-22「认可，复盘」）。本报告为 G4 草稿：改进项 A/B/C 提案待 CEO 批准后落制度。

## 数据回顾（自动收集）

- 任务：计划 3 个（T1 设计基线 + T2 主对话面与触摸 + T3 弹窗全屏与走查收口），完成 3 个，砍 0，新增 0；spike（容器耦合风险证伪）计划内登记
- 复杂度：计划 Σ6 = M2+M2+M2 不顶格 vs 实际交付 T1 fb0b667 / T2 34636f0 / T3 6faf427 全按定级完成——**偏差 0%，连续十五轮零偏差**
- 缺陷：新增 1（DEF-039 热区 inset 方向反——契约测试与实现同源错，真实 Chrome 走查捕获，当轮修复三处同步 6faf427）；locateAdv flash 存量修正（OBS-3 范围内加法，三处留痕非 DEF）
- QA 审计：有条件通过——3 NCR + 4 OBS（retros/qa-audit-iter-20.md）：001 CHG-014 清单第 7 项未回填（台账滞后第 7 代，**v1.4.18 A 新制度首轮复发**）/ 002 T2/T3 提交标题禁项（含命中 regex 仍入库）/ 003 T2 五件套滞后一代 + 三道 pre-commit 机检整体未触发（Claude Code hook 环境旁路）。CEO 定夺「全部按建议整改」（d6c50e0）：清单回填 + 草稿行删除 + **门禁迁本仓 git hooks（pre-commit.sh + commit-msg.sh 安装至 .git/hooks/）+ dry-run 四例实证**（坏标题拒×2 / 合规放行 / 代码无周报拒 / staged 空放行）；OBS-1 恒真子断言顺手删除
- Code Review：三问全过 + NCR-iter20-CR-001（新门禁自身整批豁免洞——`--no-verify` 整批绕过全部检查，per-file 精准豁免修复 eb5deb3）+ 6 非阻塞取舍留档 weekly-W34
- 测试基线：vitest 378→411（+33 纯新增，既有 378 零改写——spike 证伪容器耦合 + diff 证实双背书）+ pytest 347 零改动复跑 + 生产构建通过 + guard:style 通过；走查 38 PASS/0 FAIL（真实 Chrome 双断点双主题，几何断言 boundingRect/elementFromPoint 实值）
- 提交链：cc35b8f（CHG-014）/ 00362d3+c9759c8（计划）/ fb0b667（T1，tag design-iter-20）/ 34636f0（T2）/ 6faf427（T3，tag 面 req-baseline-v11 在案）/ d6c50e0（QA 整改）/ eb5deb3（CR 修复）全部推送 GitHub

## 四问

### 1. 做对了什么

1. **桌面零回退四重机械保障**：媒体查询全带上界（CSS 级隔离）+ CSS 属性级删除为零（34636f0^..6faf427 src/ diff 证实）+ E 组走查（桌面形态真实 Chrome 复验）+ 378 存量复跑零改写——「不伤存量」从口号变成 diff 级证据链，QA 评「近三轮最扎实」。移动端适配类需求可整段复用此口径。
2. **设计基线前置 + 真实浏览器几何断言**：T1 六定夺全按推荐（CHG-013 定夺⑦兑现）；走查 38 条落到 boundingRect/elementFromPoint 实值（条 29 sidebar.w==264 / 条 25 外扩点 hitTag / 条 16 rect 375×812@0,0），非 jsdom 空转——「适配即几何」的验收范式成立。
3. **DEF-039 正面案例**：契约测试与实现同源错（MobileCssContract 逐字匹配了方向写反的体例，jsdom 无布局引擎不设防）由真实 Chrome hit-test 当轮捕获当轮修，发现—修复—登记—复验链完整——教训直接孵化改进 C（见下）。
4. **RTM 收口 v1.4.16 A 首次干净通过**：移动端面行随 6faf427 同批全要素收口（该防线 iter-17/18 两连发后立，本轮首次全量首过）。
5. **门禁环境无关化首例落地**：NCR-003 根因（Claude Code hook 环境旁路）当轮处置即迁 git hooks + dry-run 实证，v1.4.17「机检存在 ≠ 机检生效」教训从「上线时点实证」推进到「环境无关挂载」——待制度化推广（改进 B）。

### 2. 哪里卡住了

1. **NCR-iter20-001（CHG-014 清单第 7 项未回填，「台账滞后」第 7 代）**：根因 = **记忆型防线对高频动作结构性无效**——v1.4.18 A 上轮专设、本轮首轮复发，与 iter-19 完全同型（单点单行 + 交叉声明三处在案）。连续两代同型复发证明：此类回填必须机检化，条文再细也拦不住「提交时想不起来」。
2. **NCR-iter20-003（五件套 T2 滞后一代 + 三道机检整体未触发）**：根因 = **门禁挂载面环境耦合**——守卫挂 company-os `.claude/settings.json` PreToolUse，提交在无该 hook 执行面的环境完成即全部静默旁路；比 iter-18「cwd 失源」更深一层（环境级旁路）。v1.4.17 只覆盖上线时点 dry-run，未覆盖执行环境切换后的持续生效性。周报失守第 12 代、首次为「机检在而环境不跑」形态。
3. **NCR-iter20-002（标题禁项，含「走查 38」字面命中 regex 仍入库）**：非独立根因——同 NCR-003 门禁未触发的表征之一；已随门禁迁 git hooks 承载（历史不回改，沿 iter-15 口径）。

### 3. 流程要改什么（改进项 A/B/C 提案，待 CEO 批准）

**A. CHG 落地核对清单回填机检化**（治 NCR-iter20-001）

- 根因：回填动作靠记忆（v1.4.18 A 条文形态），连续两代同型复发（iter-19 立、iter-20 犯）——该家族最后一块记忆型防线。
- 落法（推荐①）：并入 `projects/ai-chat/scripts/hooks/pre-commit.sh` 新增台账门禁 C——staged 含 `requirements/changes.md` 时扫描该文件：任一清单行状态列含「⬜ 待」且其所属 CHG 条目已标「已批准」→ 拒绝提交并提示回填行号。**推荐理由**：与既有三道门禁同挂载点（git hooks，环境无关）、触发条件客观（staged 文件 + 状态字面量）、误报面小（「待」状态行本就不应随提交存在）；比「提交防漏核对」条文面多一层机械兜底，两者并存。
- 备选②：仅扩 development.md §1 第 6 条核对子项（加「changes.md ⬜ 行扫描」）——不推荐单独使用，正是本轮证明无效的形态；可作为机检的条文引用面。
- 制度落点：process/development.md §2（机检面）增一条 + §1 第 6 条对应引用；ai-chat guard 脚本实现 + dry-run 实证沿本轮先例。
- 工作量：S1（脚本 ~30 行 + dry-run 四例 + CHANGELOG/tailoring 版本行）。

**B. 门禁环境无关化推广（company-os 制度化）**（治 NCR-iter20-003 根因）

- 根因：门禁挂 Claude Code hook，环境切换即整体旁路——机检的生效性不应依赖某个会话工具的执行面。
- 落法（推荐）：process/development.md §2 门禁条目升级口径——**所有项目仓库门禁以本仓 git hooks 为准（.git/hooks/ 或 core.hooksPath 安装），Claude Code hook 降级为冗余层（存在不依赖、失效不察觉即事故）**；新项目接入 checklist 增「门禁安装 + dry-run 实证」一步；既有项目（本组织现只 ai-chat + company-os 自身）随下一迭代顺手迁移。
- 制度落点：process/development.md §2（门禁挂载口径）+ process/lifecycle.md 或 README 项目接入面（如适用）；CHANGELOG 记 v1.4.19。
- 工作量：S1（制度条文 + ai-chat 已落首例可整段引用；company-os 自身守卫迁移 + dry-run 另计 S0.5）。

**C. 几何体例前置 hit-test**（治 DEF-039「契约测试与实现同源错」，QA OBS-2）

- 根因：契约测试逐字匹配体例——体例本身错则测试同源错；jsdom 无布局引擎不设防，错到真实浏览器走查才发现。
- 落法（推荐）：process/design.md §4（设计基线内容要求）增一条——**设计稿中含像素/热区类验收口径（inset/rect/坐标计算体例）的，入设计稿（即 tag design-iter-N 提交）前须过一次真实浏览器 hit-test（可执行样例或最小验证页，证据留 verify）**；testing.md §3 相应补一句「几何类契约测试不得作为体例正确性的唯一来源」。防的是「设计稿带着错体例进入实现」——拦截面比「走查发现」提前两个任务。
- 制度落点：process/design.md §4 新条 + process/testing.md §3 补注；CHANGELOG 记 v1.4.19。
- 工作量：S0.5（纯条文；执行成本在后续 UI 迭代内消化，DEF-039 教训列已登记口径）。

### 4. 估算校准

- 本迭代：计划 Σ6（M2×3 不顶格）vs 实际 Σ6——三任务全按定级交付 + QA 整改 + CR 修复在余量内吸收，偏差 0%。
- 迭代容量校准：**连续十五轮零偏差**；「默认不顶格」第四例正面证据（iter-14/17/18/20）；容量上限 Σ≤10 维持。纯前端三任务并行定级（无 T0、T1 设计基线承担串行职能）经实战验证可复用。

## 里程碑与后续

- req-baseline-v11 全量达成：REQ-049（P0 抽屉化）/ REQ-050（P0 触摸交互）/ REQ-051（P1 弹窗全屏）已验证（走查 38 PASS/0 FAIL）。
- 回归基线：vitest 378→411 + pytest 347 复跑 + 桌面零回退四重保障；DEF-039 当轮闭环，DEF-001~039 全闭环。
- 流程里程碑：门禁环境无关化首例（git hooks + dry-run 实证）；v1.4.16 A 首次干净通过；v1.4.18 B 首战通过；v1.4.18 A 首轮复发 → 催生改进 A（机检化）。
- 遗留观察项：QA OBS-4（走查条 30 search 未配置断至 M41，下轮触配置环境顺手复验 M40）——非承诺项；OBS-2 已升格为改进 C。
- 下一候选：待 CEO 定夺（暂缓池 webhook / 拦截改写 / 子系统事件 + 移动端后续面如有）。

## 度量（iter-20）

| 指标 | 值 |
|---|---|
| 计划/实际复杂度 | Σ6 / Σ6（偏差 0%，连续十五轮） |
| 任务完成率 | 3/3（砍 0 新增 0） |
| 测试 | vitest 378→411（+33 纯新增）/ pytest 347 零改动 / 走查 38 PASS/0 FAIL |
| 缺陷 | 新增 1（DEF-039 当轮闭环）；累计 39 全闭环 |
| QA | 有条件通过 3 NCR + 4 OBS（NCR 全部当轮整改 d6c50e0） |
| Code Review | 三问过 + NCR-CR-001 当轮修（eb5deb3）+ 6 取舍留档 |
| NCR 根因分布 | 机检环境旁路 1 / 记忆型回填失效 1 / 其表征 1 |
| 提交 | 8 笔全推送（cc35b8f..eb5deb3），tag req-baseline-v11 + design-iter-20 |

---

## CEO 批准记录

- 2026-08-22 CEO「认可，复盘」（Code Review 六取舍留档认可 + G4 启动）；复盘呈报后 CEO「全批」= 四问认可 + 改进 A/B/C 全部落制度 **v1.4.19**（A 台账门禁 C 已实现于本仓 scripts/hooks/pre-commit.sh 并 dry-run 实证；B 门禁环境无关化以本仓为首例范本；C design.md §2 + testing.md §4）。iter-20 关闭。
