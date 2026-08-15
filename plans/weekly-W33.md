# 周报 — ai-chat 第 33 周（2026-08-10 ~ 08-16）

> 补录说明：QA 审计 NCR-003 整改（2026-08-15）。iter-1 全迭代发生于本周五 08-15 当天（01:04 立项 → 10:34 发布完成），当日未按 planning.md §3 产出周报，特此补录。iter-2（计划、设计基线、开发、验证、QA 审计）同样发生于 08-15 同日，本版周报由 NCR-iter2-001 整改更新为覆盖全周两个迭代。数据来自 git log 与项目文档，无手编。

## 本周完成

### iter-1（08-15 凌晨~上午，已关闭）

git 提交 18 个，T0~T7 全部完成：

- 立项、需求基线（req-baseline-v1，14 条 PRD + 交互原型）、设计基线（design-iter-1）
- T1 脚手架（Vue3+Vite+TS 模块化分层）、T2 设置页、T3 流式客户端 + 20 轮上下文、T4/T5 对话界面与会话管理、T6 IndexedDB 持久化
- T7 集成验证两轮：真实流式冒烟（DeepSeek）+ CEO 试用反馈 4 项修复 + DOM 完整视觉走查
- 需求变更 CHG-001（切换不中断，后台继续生成）
- v0.1.0 发布（GitHub Pages，线上冒烟 6/6，CEO 批准）
- 复盘（retros/iter-1.md）+ QA 审计（retros/qa-audit-iter-1.md）+ 全部 NCR 整改

### iter-2（08-15 午后~晚间，开发完成，待复盘关闭）

git 提交 8 个（a192146~d689761），T0~T4 全部完成（Σ=10，容量守恒）：

- T0 设计基线（design-iter-2，5 项待澄清 CEO 逐条定夺）
- T1 集成路径自动化用例 2 条（tailoring 改进项 C 兑现）
- T2 REQ-010 停止生成（三态按钮 + stopped 状态 + 中性胶囊）
- T3 REQ-008 系统提示词（全局单一，CEO 拍板；组装恒居首位不受 20 轮截断）
- T4 DEF-001 修复（根因：git for-each-ref 无 --since，129 为用法错误码非 SIGHUP；度量采集恢复全自动）
- DEF-002 关闭（CEO 决策不充值 GLM、不补验，REQ-014 接受部分达成）
- 24 条走查全过（plans/iter-2-verify.md，DOM 实测 + 真实 DeepSeek 流式）
- QA 审计（retros/qa-audit-iter-2.md，有条件通过）+ 三项 NCR 整改（见下）

测试结果（迭代末汇总，testing.md §4）：**iter-2 末 37/37 通过**（单测 35 + 集成 2）、跳过 0；走查 24/24（不抽查）。

### iter-3（08-15 下午~晚间，开发完成，待 QA 审计 + 复盘关闭）

git 提交 4 个（37ee268~fba475e），T0~T4 全部完成（Σ=9，容量 10 内）：

- T0 设计基线（design-iter-3，6 项待澄清 CEO 逐条定夺，新增令牌 #4CC38A 已批准）
- T1 REQ-009 会话自动命名（titleOf 超 20 字省略号 + renamed 标记防手动改名被覆盖）
- T2 REQ-011 Markdown 渲染与代码复制（markdown-it + DOMPurify 净化，代码块深底+语言标签+复制按钮）
- T3 REQ-012 会话重命名（双击/铅笔行内编辑，Enter 保存/Esc 取消/失焦保存）
- T4 REQ-013 会话导出（顶栏导出按钮，转 Markdown 下载，空会话 toast）
- 顺手修 iter-2 遗留类型缺口：PersistedMessage.status 补 'stopped'
- 28 条走查全过（plans/iter-3-verify.md，DOM 实测 + 单测）
- QA 审计（进行中，qa 员工后台运行）

测试结果（迭代末汇总）：**iter-3 末 62/62 通过**（单测 58 + 集成 2 + 组件 8，较 iter-2 的 37 新增 25）、跳过 0；走查 28/28（不抽查）。

### iter-4（08-15 晚间，开发完成 + CHG-003 迭加，QA 审计 5 NCR 整改中）

git 提交 11 个（2c3a243 起），T0~T3 全部完成（Σ=9）+ CEO 试用反馈 CHG-003 三处打磨：

- 需求基线 req-baseline-v2（CHG-002：新增 REQ-015~018 + DEF-011；CHG-003：REQ-019 版本切换等）
- T0 设计基线（design-iter-4，6 项待澄清 CEO 全按默认；CHG-003 后增量同步）
- T1 DEF-011 输入框修复（原两行回基线，后被 CHG-003 覆盖为单排顶对齐）
- T2 REQ-015 消息编辑与重新生成（generation 纪元防竞态）
- T3 REQ-016 会话搜索（标题/正文命中 + 主色高亮 + 空态）
- CHG-003：输入区按钮与 textarea 同排顶对齐、消息操作栏（复制/修改 icon-only + hover + tooltip）、REQ-019 版本切换（‹ 1/2 › 箭头计数器，forkId/branches 深拷贝归档）
- design-iter-4 与 design/proto 均已按 CHG-003 增量同步（NCR-iter4-005 整改）
- 28 条走查全过（plans/iter-4-verify.md，DOM 实测 + 单测，NCR-iter4-002 整改补录）
- QA 审计：5 NCR（见下方处置表）

测试结果（迭代末汇总）：**iter-4 末 79/79 通过**（较 iter-3 的 62 新增 17）、跳过 0；走查 28/28（不抽查）；生产构建通过（G4 硬前置）。

### iter-5（08-15 深夜，开发完成，QA 审计进行中）

git 提交 8 个（8da31fe 起），T0~T3 全部完成（Σ8）+ 开发后修复：

- T0 design-system tokens v1.3（暗色令牌整节，CEO 预授权批准）+ design-iter-5 基线（7 项待澄清按预授权默认定夺）
- T1 全组件裸色值 token 化（新增 14 个中性/实底/焦点环令牌）+ --c-error→--c-danger 命名统一
- T2 REQ-017 暗色主题（[data-theme=dark] 根覆盖 + 顶栏/设置页双入口 + localStorage 持久化）
- T3 REQ-018 多供应商档案（旧单套配置自动迁移 + 档案列表/模态 + 一键切换 + 侧栏当前档案标签）
- DEF-012：设置页样式失效两根因（样式写 </style> 外 + 令牌自引用），CEO 试用发现，064e393 修复
- 17 条走查（plans/iter-5-verify.md，computed style 断言口径）

测试结果（迭代末汇总）：**iter-5 末 84/84 通过**（新增 5 档案用例）、跳过 0；走查 17/17（不抽查）；生产构建通过。

## 进行中与阻塞

| 任务 | 状态 | 阻塞原因 / 需要的决策 |
|------|------|---------------------|
| iter-5 QA 审计 | 进行中 | qa 员工后台运行中 |
| iter-5 复盘 + G4 关闭 | 待办 | QA 报告 + NCR 处置后走四问 |
| v0.4.0 发布 | 待 CEO 决策 | G4 关闭后走 /mm-release |

（iter-3 相关阻塞项已随 QA 报告出件销账；iter-2 遗留阻塞与 DEF-001/002 已关闭。）

## 计划偏差

iter-2 计划当日完成，无延期。容量 Σ=10 全部交付；REQ-009 按计划砍至 iter-3。
iter-3 计划当日完成，无延期。容量 Σ=9 全部交付（≤10 上限）；无砍范围、无新增范围。

## Code Review 记录（development.md §3）

- **iter-1**：未做独立全量 review，如实说明（见上版记录）：27/27 单测 + 两轮浏览器实测 + QA 审计 RTM 抽查 + 复盘检查 + CEO 试用与发布审批覆盖。
- **iter-2（本次执行，NCR-iter2-001 整改）**：全量 review 于 2026-08-15 执行，范围 `c3037d4..ad44e73` + 审计整改提交（生产代码 6 文件：sessions/settings store、ComposerBox/MessageBubble/SettingsForm/App，测试 4 文件）。发现与结论：
  - 状态机核对：stopRequested 标记生命周期（设置→消费→finally 清除）无残留路径；"停止瞬间流恰好结束"竞态下落位为正常完成态（走查 19 实测撞上并正确处理）
  - 持久化核对：systemPrompt 与 API 配置合并写入同一 JSON，save/clearKey/saveSystemPrompt 三入口均走统一 persist()，无互相覆盖窗口
  - 组装核对：system 前置仅非空时注入；30 轮截断用例保住首位（client.spec）
  - 无新发现缺陷；37/37 测试与 24 条走查为旁证
  - **CEO 过目确认：2026-08-15，已过目变更范围与 review 记录，确认**（G4 前置条件满足）
- **iter-3（本次执行）**：范围 `37ee268..fba475e`（生产代码：sessions store、SessionListItem/MessageBubble/App、utils/markdown/export，测试 5 文件）。发现与结论：
  - 状态机核对：renamed 标记生命周期（createSession 初始化 false → renameSession 置 true → send 仅 !renamed 时自动命名）无残留；空标题 rename 提前返回不误置
  - 安全核对：markdown-it html:false + DOMPurify 双层净化；代码块复制按钮为受控注入 HTML（class 选择器，无内联事件），XSS 用例（script/img/javascript:）全过
  - 依赖核对：新增 markdown-it/dompurify 为纯前端运行时依赖，不偏离"纯前端直连"架构
  - 导出核对：文件名 sanitize + Blob 下载，空会话短路返回 false
  - 无新发现缺陷；62/62 测试与 28 条走查为旁证
  - **CEO 过目确认：待 CEO 过目**（G4 前置条件）
- **iter-4（本次执行，NCR-iter4-001 整改）**：范围 `2c3a243..HEAD`（生产代码：sessions store / idb、ComposerBox、MessageBubble、MessageList、TheSidebar、SessionListItem、App，测试 4 文件），重点审 CHG-003 数据层。发现与结论：
  - 版本分支核对：branches 归档/互换均 JSON 深拷贝——无响应式代理入 IndexedDB（DEF-003 同类风险规避）、无引用环（新旧分支互指仅经 forkId 字符串而非对象引用）、persist 可序列化
  - toggleVersion 核对：findIndex 按 forkId 定位分支头，仅分支首消息携带 forkId，定位无歧义；互换后两侧 forkId/forkIndex 保留，可反复切换（单测往返断言）
  - 竞态核对：generation 纪元（编辑中断时递增）确保旧 generate 的 finally 不清掉新控制器；epoch 不匹配时仅跳过清理、persist 照常执行，无状态丢失路径
  - XSS 核对：搜索高亮用 segments 文本插值渲染（非 v-html），标题/命中片段不可注入
  - 无新发现缺陷；79/79 测试与 28 条走查为旁证
  - **CEO 过目确认：待 CEO 过目**（G4 前置条件）
- **iter-5（本次执行）**：范围 `8da31fe..HEAD`（生产代码：settings store、App.vue 令牌根、useTheme、SettingsForm/TheSidebar 等 11 组件 token 化、测试 2 文件）。发现与结论：
  - 档案数据核对：旧格式迁移幂等（profiles 为空才迁移、activeProfileId 一致性守卫）；removeProfile 当前生效双保险（UI 禁用 + store 拒绝）；save() 兼容路径无档案时创建首个并自动生效
  - 主题核对：useTheme 单例 + localStorage try/catch（隐私模式降级本次会话）；切换只动根 data-theme，组件零感知
  - token 化核对：残留裸色值仅「实底白字」与「深底白色叠层」两类（走查留档口径）；--c-danger 命名族与 v1.3 文档一致
  - **风险如实说明**：CSS 类改动 vitest 不覆盖——DEF-012 两根因均漏过测试；修复后以 computed style 断言走查补齐（iter-5-verify.md），建议流程改进入复盘
  - **CEO 过目确认：待 CEO 过目**（G4 前置条件）


## QA 审计与 NCR 处置（iter-2）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| NCR-iter2-001 | 周报/review 体系未运转 | 整改：本版周报补 iter-2 全部内容 + 全量 review 记录（CEO 过目确认 2026-08-15，见 Code Review 节） | 已关闭 |
| NCR-iter2-002 | 设计稿头部状态与基线声明矛盾 | 整改：title/badge 更新为"已基线" | 已关闭 |
| NCR-iter2-003 | 停止时效 200ms 取证不足 | 整改：补同步 abort 构造性证明单测（37/37 含此用例），verify 记录更新 | 已关闭 |

## QA 审计与 NCR 处置（iter-4，2026-08-15）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| NCR-iter4-001 | 周报无 iter-4 章节 + Code Review 缺失 | 整改：本版周报补 iter-4 全部内容 + 全量 Code Review 记录（重点 CHG-003 数据层，见 Code Review 节） | 待 CEO 过目 |
| NCR-iter4-002 | 视觉走查记录缺失 | 整改：补 plans/iter-4-verify.md（28 条，DOM 实测 + 单测，含偏差登记与 NCR 观察项 5 整改口径） | 已整改，待 QA 复查 |
| NCR-iter4-003 | RTM REQ-019 设计列标「待同步」 | 整改：改「已同步」；RTM 头测试数 76→79 同步修正 | 已整改 |
| NCR-iter4-004 | DEF-011 处置记录失真 | 整改：追加 CHG-003 覆盖说明，中间态 DOM 数据（712px/686px 等）标注作废、关联 CHG-003 | 已整改 |
| NCR-iter4-005 | design/proto 未同步 CHG-003 | 整改：proto 输入区同步单排顶对齐，操作栏/版本切换不在 P0 原型范围的保留理由写入头部；CHG-003 影响评估补 proto 评估（含整改补记） | 已整改 |

## 技术债登记

| 位置 | 内容 | 原因 | 状态 |
|------|------|------|------|
| 消息区 | interrupted/stopped（中断/停止）消息无重试入口，需发新消息继续 | 与基线一致（重试仅绑定错误气泡） | 保留（iter-3 评估） |
| 全局 | 窄视口（<768px）无响应式 | spec 明确 MVP 不承诺 | 保留（需求变更时） |
| ~~渲染~~ | ~~AI 回复纯文本渲染，Markdown 源码可见~~ | ~~REQ-011（P1）iter-2 容量不足未排入~~ | **已销账（08-15）**：iter-3 T2 实现 Markdown 渲染（markdown-it + DOMPurify） |
| ~~metrics~~ | ~~collect.sh 需人工绕行（DEF-001）~~ | ~~根因未明~~ | **已销账（08-15）**：根因查明并修复，采集恢复全自动 |

## 下周计划

- iter-5 复盘 + G4 关闭（QA 5 NCR 已整改，Code Review 待 CEO 过目）→ v0.4.0 发布（待 CEO 决策）
- 基线 v2 需求（REQ-001~019）全部达成；后续新能力走需求变更（暂缓池：账号/RAG/联网搜索/用量统计等）
- iter-6 候选：useTheme 单测补齐（QA 观察项 4）、令牌自引用扫描脚本化进提交门禁（观察项 3）
