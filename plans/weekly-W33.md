# 周报 — ai-chat 第 33 周（2026-08-10 ~ 08-16）

> 补录说明：QA 审计 NCR-003 整改（2026-08-15）。iter-1 全迭代发生于本周五 08-15 当天（01:04 立项 → 10:34 发布完成），当日未按 planning.md §3 产出周报，特此补录。iter-2（计划、设计基线、开发、验证、QA 审计）同样发生于 08-15 同日，本版周报由 NCR-iter2-001 整改更新为覆盖全周两个迭代。数据来自 git log 与项目文档，无手编。

## 本周完成

### iter-11（08-16，T0~T3 + R2 修订 + QA 整改完成，待 CEO Code Review 过目后复盘关闭）

- **CHG-006 基线 v4**（req-baseline-v4）：上线前体验对齐，新增 REQ-026~029（CEO 点名 7 项 + 审计补充 7 项，参考 DeepSeek）；iter-11 计划批准（方案 A Σ10，REQ-029 排 iter-12）
- **T0 design-iter-11 已基线**：8 项定夺定案（⑤设置弹窗按 CEO R1 指示拆分左侧分区导航；R1 修复列表项「···」换行）；REQ-017 顶栏按钮条款随基线改写；走查清单 49 条 + 通用下拉菜单交互规格专章
- **T1 REQ-026 侧栏重构已实现并验证**：utils/timeGroup（今天/昨天/近 7 天/更早，跨零点单测）+ DropdownMenu 通用组件（外点吞击/Esc 回焦/键盘矩阵/互斥/滚动关闭/z-40）+ SessionListItem 单行化菜单化（grid 三列根治换行）+ TheSidebar 分组渲染/账户区菜单/rail 56px 收起持久化
- 测试：前端 vitest **236/236（26 文件，+27）** + guard:style + 生产构建通过；后端未动（119/119）
- 走查：design-iter-11 §7.2 清单 1~22 条逐条留档（plans/iter-11-verify.md；真实浏览器实测 = 本地后端注册用户走全链路；走查 10 属 T2；1 项已接受偏差：宽度过渡动画以模板切换实现）
- 开发中修复真缺陷 1 个：DropdownMenu 外点吞击误吞另一菜单的触发点击（需点两次才切换）→ 放行 `.dd` 内点击，互斥一步完成（走查 22 混开用例暴露）
- **T2 REQ-027 消息流与顶栏已实现并验证**：去全部头像（DOM 级）+ 用户气泡 avatar-bg 浅色化（亮 13.2:1/暗 10.0:1 双主题实测）+ 顶栏整块移除（「模型：未设置」误导消失、REQ-017 顶栏按钮条款落地）+ 导出迁列表「···」菜单（真实下载 + 空会话 toast 取证）
- 测试（T2 后）：前端 vitest **240/240（26 文件，+4）** + guard:style + 生产构建（CSS -1.5kB）
- 走查（T2）：§7.2 清单 23~36 + 走查 6 复验闭环，逐条留档（iter-11-verify.md T2 段，零偏差；真实消息流式经统一 key 代理实测）
- **T3 REQ-028 设置弹窗化已实现并验证**：720px 左导航五分区弹窗（方向键切分区/切分区不丢状态）+ 未保存条件拦截（提示词/改密 dirty，z-120 确认层）+ locateAdv 分区直达 + 三关闭方式焦点回落；「只改容器不改逻辑」——settings-form 全量 24 用例弹窗下零改动通过
- 测试（T3 后）：前端 vitest **247/247（26 文件，+7）** + guard:style + 生产构建
- 走查（T3）：§7.2 37~40 + 定夺⑥留档（iter-11-verify.md T3 段）；浏览器实测含 1280px 下 720px 规格值、外观全局联动、未保存双路径、草稿重开清零
- T3 修复 2 缺陷：DropdownMenu focus() 引发滚动自吞（侧栏滚动态下账户菜单开即被关，preventScroll 修复）；设置草稿跨开关残留（v-if 卸载重建兑现「关闭将丢失」+ 焦点回落同步化）
- **R2 修订（CEO 试用反馈两条）**：账户区整行拉满「···」靠右（.dd flex:1，DEF-026）+ 设置弹窗固定高度 560px（不随分区内容跳变，参考 DeepSeek；design-iter-11 R2 登记）；提交 f577531
- **QA 审计（retros/qa-audit-iter-11.md）：有条件通过 4 NCR**，CEO 定夺「全部整改」：
  - NCR-001 缺陷登记 → DEF-022~027 补登（含整改中新发现 DEF-027：档案编辑模态缺 Esc，已修复）
  - NCR-002 走查尾段 → iter 末整体走查补齐 §7.2 43~49 + iter-2 走查 15 场景复跑（auth 端到端实测闭环）+ 设计稿条 37 R2 同步
  - NCR-003 spec 同步 → REQ-003/004/005/007/012/013/016/026/027/028 涉及页面与正文口径 10 处补更
  - NCR-004 Code Review → iter-11 全量 review 材料已产出（见下节），待 CEO 过目；iter-9/10 追溯 review 材料一并产出待 CEO 处置
  - 补证：T1/T2/T3 提交均含 RTM+周报+verify（QA 预警的「第 7 次失守」不成立）；OBS-4 推送销账（tag 均在远端）
- 整改后测试：前端 247/247 + guard + 构建 + 后端 119/119 复跑全绿
- 下一步：CEO Code Review 过目（NCR-004 闭环）→ 复盘关闭（G4，含三项流程改进候选：缺陷/偏差登记入提交防漏核对、Code Review 入 G4 核对、CHG spec 同步项入变更落地核对）

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

### iter-6（08-15 深夜 ~ 08-16 凌晨，开发完成 + QA 审计 6 NCR 整改）

git 提交 10 个（777d22e~bcf4a03 + 整改中），T0~T3 全部完成（Σ10，**新技术栈 Python/FastAPI 首迭代**）：

- 需求基线 req-baseline-v3（CHG-004：账号体系+自建后端，8 项澄清定案 + monorepo 仓库布局决策）
- T0 设计基线 design-iter-6（登录/注册页，7 项澄清 CEO 定夺；侧栏底栏登出入口 = iter-1~5 基线唯一增量）
- T1 backend/ FastAPI 骨架（uv + ruff + SQLite 带版本迁移 v1/v2 + 注册/登录/登出/me + HttpOnly Cookie SameSite=Lax + SSE echo 形态验证）+ Docker Compose 容器化验收
- T2 登录/注册页 UI + 路由守卫（未登录一律跳登录、回跳、防 open redirect、401 失效跳转）+ 任意 401 失效钩子
- T3 服务端会话存储核心（迁移 v2 复合主键 (user_id,id) + PUT 整档 LWW）+ 前端数据层换源（db/persistence.ts 同接口替换 idb，IndexedDB 降级为迁移源零写入）
- QA 审计（retros/qa-audit-iter-6.md，6 NCR）整改：①company-os 提交钩子死代码 + BSD sed 静默放行双 bug 修复（顺带发现）②登录页 8 处设计偏差（功能 5+1 项回基线、视觉 2 类登记接受）③27 条完整走查④本章节+Code Review ⑤RTM 存量行口径注记⑥proto 承载偏离登记
- 27 条完整走查（plans/iter-6-verify.md，DOM 实测，走查中再抓出并修复 5xx 未挂重试按钮）

测试结果（迭代末汇总，整改后终值）：**前端 120/120 通过**（16 文件，auth 7/LoginView 17/守卫 6/persistence 5 等）、**后端 pytest 37/37**（auth 18/sessions 16/dev 3）、ruff clean、跳过 0；走查 27 条：26 过 + 1 占位（REQ-024 限频，iter-8）；guard:style 通过；生产构建（vue-tsc + vite）通过。

**技术栈首迭代校准数据**（复盘用）：T1 实际 = L 估算（吻合）；T2 实际 < M（复用既有表单模式充分）；T3 后端半侧 < L 前端半侧 ≈ M；总体 Σ10 估算 vs 实际——无砍范围、无延期，新栈 ramp-up 未构成阻塞（<2 天阈值远未触及）。

### iter-7（08-16，开发完成 + QA 审计 3 NCR 整改）

git 提交 5 个（63b6b4d 计划 / 50ef5d1 T0 设计 / 3fad772 T1 / ad8fe6a T2 / dcfafcd T3 + 整改中），T0~T3 全部完成（Σ10）：

- T0 design-iter-7 设计基线（高级设置双模式 + 4 项技术定夺 CEO 拍板 + §7.2 走查清单 26 条——v1.4.4 首次设计稿内置清单）
- T1 REQ-023 流式代理端到端（统一 key 零配置真实 DeepSeek 流式打通、首块额外延迟为负、错误映射 §3.1 定稿、REQ-001/002/007 复验销账 NCR-iter6-005；DEF-015 sqlite 线程绑定偶发 500 修复）
- T2 REQ-014/018 密钥与档案迁服务端（db v3 profiles 表 + 掩码下发 + 0600 + 编辑不回显 + KeyModeCard 双态 UI；走查 26 条留档，走查 15 偏差当场修复=DEF-016；多设备一致/回退/无效 key 引导实测）
- T3 REQ-022 断网暂存与自动重试（persistence 暂存队列 LWW 压缩 + 三触发按序重放 + 「部分更改未同步」提示；断网→恢复→第二设备逐字可见闭环实测）
- GLM 自填模式 CEO 决策（2026-08-16）不补验，延续 DEF-002 口径——DeepSeek 实测承载
- QA 审计（retros/qa-audit-iter-7.md，3 NCR + 8 观察项）整改：①RTM REQ-023 行漏更②本章节+Code Review+技术债③DEF-016 补登记；**Code Review 整改执行中发现并修复 DEF-017（重放出队竞态，严重）**

测试结果（迭代末汇总，整改后终值）：**前端 141/141 通过**（17 文件，+pending-sync 10 用例/settings 系服务端源重写）、**后端 pytest 69/69**（+test_profiles 16 + test_proxy 16 改写）、ruff clean、跳过 0；走查 26 条：23 过 + 3 占位（iter-8 基线自标注）；生产构建（vue-tsc + vite）通过；密钥安全四处检索（git 全量历史/工作区/docker 日志/dist）0 命中；db 文件 0600。

### iter-8（08-16，已关闭 G4 过）

- 计划已批准（ca77880，Σ10 = M×2+L×2）：REQ-024 配额（T1）+ REQ-025 管理后台（T0/T2）+ 存量迁移（T3）；REQ-021 与全链路 Compose/v0.5.0 发布挪 iter-9；配额初值定案 30/500/2000（CHG-004「后续待定」销账）
- **T1 REQ-024 用量配额与滥用防护（完成）**：backend/app/quota.py + 迁移 v4（usage_daily 粒度 (day,user_id,mode)——档位联动、同日切模式不重复给量；register_log 注册限频）；注册限频每 IP 每日 3；每用户按日配额（免费档 30/自填档 500，文案分模式）；统一 key 全站熔断 2000/日（503 次日恢复）；「配额不足不抵达上游」pytest seen 取证 + ai-chat.quota 日志留痕；stream_options.include_usage → token 落库（供 REQ-025 用量列表）；GET /api/quota 口径端点（KeyModeCard「每日 — 次」参数化，T2 前端接入）；浏览器提示经 §3.1 定稿零 UI 改动接入
- **T2 REQ-025 管理后台（完成）**：后端 admin 路由（403 门禁/用户列表/封禁解封/按用户配额覆盖/按日用量聚合/全站条）+ 迁移 v5（quota_override + 存量库最早用户补标管理员）+ register 首用户引导；前端 AdminView（design-iter-8 §1 全触点：六列/三态全站条/封禁确认模态/调配额正整数校验/用量筛选排序缺失标注/403 卡）+ /admin 路由守卫 + 侧栏盾牌入口仅管理员渲染 + 在线被封禁跳登录带横幅（走查 29）+ KeyModeCard 额度行参数化（REQ-014 走查 2 兑现）；§7.2 走查清单 T2 段逐条留档（plans/iter-8-verify.md——浏览器观感项待复核：预览端口被并行会话占用，组件级 DOM 断言 + pytest 全量背书功能）
- **T3 存量迁移收口（完成）**：stores/migration.ts（登录后检测旧 IndexedDB 会话 + 旧 localStorage 档案字段；会话导入跳过云端已有 id 新增不覆盖、PUT 幂等可取消、失败重试去重续传；档案 POST 新增、重试按名称+地址+模型去重、完成清除本地旧字段保留 systemPrompt——REQ-014 全量口径 store 级销账；会话完成设 30 天清除键，到期 maybePurge 整库删）+ MigrationBanners.vue（参数化单组件 ×2，双条堆叠独立状态机，文案设计稿定稿逐字）+ App 挂载检测；LWW 两设备并发用例补验（pytest，iter-6 挂账）；走查 30~41 留档（iter-8-verify.md T3 段）
- T0 design-iter-8 设计稿（完成，已基线）：设计师员工产出（e6a8772 草案）→ CEO 评审批准（2026-08-16，四项定夺全按推荐定案）→ tag design-iter-8（3277086 落徽标）。覆盖：管理后台（用户列表/封禁/调配额/用量列表/403 门禁/全站配额条）、存量会话迁移入口全状态机、存量档案上云提示条；§7.2 走查清单 44 条（T2/T3 实现对照自查）；全令牌产出零新增

测试结果（任务级）：**后端 pytest 105/105**（+test_admin 19 +两设备 LWW 1）、**前端 vitest 185/185**（+AdminView 17/TheSidebar 2/守卫 2/client 1/LoginView 1/KeyModeCard 2/migration 13/MigrationBanners 8——原 141）；ruff clean、生产构建、guard:style 全过；走查清单 44 条全量留档见 plans/iter-8-verify.md（浏览器观感项已闭账 puppeteer 30/30）。

### iter-9（08-16，已关闭 G4 过；v0.5.0 暂缓待服务器）

- 计划已批准（0a93326，Σ8 = M×4）：REQ-021 账号管理（T0 设计/T1 后端/T2 前端）+ T3 全链路 Compose/自部署文档/技术债收口；v0.5.0 发布走 iter-9 末
- T0 design-iter-9 设计稿（已基线）：账号管理原型 + 视觉基调变更（正文白底 + 侧栏灰底，CEO 拍板参考 DeepSeek 管理页）；4 项定夺全按推荐定案；§7.2 走查 23 条
- T1 REQ-021 后端改密/注销（完成）：change-password（旧密码验证→更新哈希→其他设备 token 失效）+ delete-account（密码二次确认→DELETE users 级联清全数据）；密码复杂度 CEO 定夺升级「8~128 且含字母+数字」（CHG-005）
- T2 REQ-021 前端账号管理 UI（完成）：SettingsForm 账号区 + DeleteAccountModal 强确认 + 视觉基调反转（侧栏灰 --c-bg / 正文白 --c-surface）
- T3 全链路 Compose + 自部署文档 + 技术债收口（完成）：frontend nginx 托管 dist/ + 反代 /api（实跑 healthy）；docs/deploy.md；.env.example 补配额四变量（QA 观察项 3 销账）；直连死代码删除（QA 观察项 5 销账）；跨零点 token 归属修复（Code Review 观察项①销账）

测试终态：**前端 vitest 201/201**（23 文件）+ **后端 pytest 118/118** + ruff clean + 生产构建 + guard:style 全过。

### iter-10（08-16，清理收口，开发完成 T1~T3，待 QA 审计 + 复盘）

- 计划已批准（fafa487，Σ4 = M+S+S）：T1 技术债三项 + T2 spec hygiene 14 条 + T3 Compose 首块延迟复测；无需求类任务（基线 v3 已全部达成）
- T1 技术债三项（完成）：settings.boot() 失败重试（bootFailed 标记 + 档案区失败态重试按钮，iter-7 Code Review 观察项销账）；auth_sessions 过期行惰性清理（随签发事务 DELETE，iter-5 QA 观察项销账）；useTheme 单测 +6（iter-5 观察项销账）
- T2 spec「涉及页面」hygiene（完成）：14 条全部更新与 RTM 一致，残留 0（iter-9 QA 观察项 5 销账）
- T3 Compose 首块延迟复测（完成）：稳态 -19ms ≤500ms 达标 + nginx SSE 直通验证（iter-7 Code Review 观察项 5 销账，plans/iter-10-verify.md）

测试终态：**前端 vitest 209/209**（+8）+ **后端 pytest 119/119**（+1）+ ruff clean + 生产构建全过。

## 进行中与阻塞

| 任务 | 状态 | 阻塞原因 / 需要的决策 |
|------|------|---------------------|
| iter-8 T0~T3 | 全部完成 | 已关闭（G4 过，浏览器观感 puppeteer 30/30 闭账，见 retros/iter-8.md） |
| iter-8 QA 审计 + Code Review | 完成 | 审计 5 NCR 全整改；Code Review CEO 已过目（2026-08-16） |
| iter-8 复盘 + G4 关闭 | 已关闭 | G4 过，复盘落制度 v1.4.6（提交防漏核对），见 retros/iter-8.md |
| iter-9 T0~T3 | 已关闭 | G4 过，复盘落制度 v1.4.7，见 retros/iter-9.md；v0.5.0 暂缓待服务器 |
| iter-10 T1~T3 | 全部完成 | 待 QA 审计 + 复盘（清理收口小迭代，见上方 iter-10 章节） |

（iter-7 已关闭 G4 过，6+3 NCR 全部复查关闭；v0.4.0 已发布。）

## 计划偏差

iter-2 计划当日完成，无延期。容量 Σ=10 全部交付；REQ-009 按计划砍至 iter-3。
iter-3 计划当日完成，无延期。容量 Σ=9 全部交付（≤10 上限）；无砍范围、无新增范围。
iter-8 计划当日完成，无延期。容量 Σ10 全部交付（偏差 0%，连续第三迭代）；计划内砍范围仅既定的 REQ-021/Compose/v0.5.0 挪 iter-9；执行顺序 T1 先于 T0 基线（T1 无 UI，不违反设计先行约束——QA 观察项 1，后续计划措辞改「涉及 UI 的开发任务」）；计划外新增：设计 R1/R2 修订（CEO 走查反馈）、DEF-019 修复（Code Review）、LoginView 补提交（审计补证）、浏览器走查闭账（NCR 整改）——均随复盘补账。

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
  - **CEO 过目确认：2026-08-15，已过目确认**（G4 前置条件满足；NCR-iter5-004 整改落痕）
- **iter-4（本次执行，NCR-iter4-001 整改）**：范围 `2c3a243..HEAD`（生产代码：sessions store / idb、ComposerBox、MessageBubble、MessageList、TheSidebar、SessionListItem、App，测试 4 文件），重点审 CHG-003 数据层。发现与结论：
  - 版本分支核对：branches 归档/互换均 JSON 深拷贝——无响应式代理入 IndexedDB（DEF-003 同类风险规避）、无引用环（新旧分支互指仅经 forkId 字符串而非对象引用）、persist 可序列化
  - toggleVersion 核对：findIndex 按 forkId 定位分支头，仅分支首消息携带 forkId，定位无歧义；互换后两侧 forkId/forkIndex 保留，可反复切换（单测往返断言）
  - 竞态核对：generation 纪元（编辑中断时递增）确保旧 generate 的 finally 不清掉新控制器；epoch 不匹配时仅跳过清理、persist 照常执行，无状态丢失路径
  - XSS 核对：搜索高亮用 segments 文本插值渲染（非 v-html），标题/命中片段不可注入
  - 无新发现缺陷；79/79 测试与 28 条走查为旁证
  - **CEO 过目确认：2026-08-15，已过目确认**（NCR-iter4-001/004 整改落痕）
- **iter-5（本次执行）**：范围 `8da31fe..HEAD`（生产代码：settings store、App.vue 令牌根、useTheme、SettingsForm/TheSidebar 等 11 组件 token 化、测试 2 文件）。发现与结论：
  - 档案数据核对：旧格式迁移幂等（profiles 为空才迁移、activeProfileId 一致性守卫）；removeProfile 当前生效双保险（UI 禁用 + store 拒绝）；save() 兼容路径无档案时创建首个并自动生效
  - 主题核对：useTheme 单例 + localStorage try/catch（隐私模式降级本次会话）；切换只动根 data-theme，组件零感知
  - token 化核对：残留裸色值仅「实底白字」与「深底白色叠层」两类（走查留档口径）；--c-danger 命名族与 v1.3 文档一致
  - **风险如实说明**：CSS 类改动 vitest 不覆盖——DEF-012 两根因均漏过测试；修复后以 computed style 断言走查补齐（iter-5-verify.md），建议流程改进入复盘
  - **CEO 过目确认：2026-08-15，已过目确认**（NCR-iter5-004 整改落痕）
- **iter-6（本次执行）**：范围 `0dbefb2..HEAD`（后端 8 文件：app/{main,config,db,security,routers/*} + tests 4；前端 12 文件：LoginView/Root/router、stores/{auth,sessions}、api/backend、db/persistence、TheSidebar、App、main、vite.config；测试 6 文件）。重点审认证安全与新栈数据层。发现与结论：
  - 认证安全核对：密码 bcrypt 哈希（库内无明文，测试断言兜底）；会话 token 原值仅存于 HttpOnly Cookie，库内存 SHA-256（DB 泄露 ≠ 会话劫持）；过期比较双侧 UTC offset-aware（datetime.now(UTC) ↔ isoformat 含偏移）；登录失败统一文案不泄露账号存在性；401 由统一钩子失效跳转，无循环依赖（store 不 import router）
  - 会话 API 核对：复合主键 (user_id,id) 使跨用户覆盖结构性不可能（优于先查后写的 TOCTOU 写法）；PUT 校验 id 路径一致 + messages 存在性；DELETE 幂等与前端 idb 语义对齐；JSON ensure_ascii=False 原样存取（逐字恢复走查取证）
  - 前端换源核对：persistence.ts 与 idb 接口逐签名等价，store 仅换 import（交互逻辑零改动——既有用例仅改 mock 路径全绿为证）；persist 失败 toast 兜底（断网重试 iter-7 登记）；IndexedDB 零写入（databases() 为空实测）
  - 并发核对：SQLite WAL + 每请求独立连接，无跨线程共享连接；auth_sessions 过期行清理缺失——**低风险遗留**（见技术债：过期会话行仅占空间不构成可滥用凭证，token 原值不可逆推）
  - 边界核对：redirect 防 open redirect（站内相对路径 + 双斜杠拒绝，双端用例）；用户名 regex `一-鿿`（U+4E00-9FFF CJK 统一表意，不含扩展区——与 spec「中文」口径一致，前后端同源同表达式）
  - **风险如实说明**：新栈（FastAPI/uv/Docker）无项目内校准数据，本轮为首个基线；bcrypt rounds 用默认（12），无性能调优；/api/dev/sse-echo 在生产容器可达（需登录、上限 20 块，观察项 6 登记 iter-7 评估）
  - 无新发现缺陷（走查中已当场修复 5xx 重试缺口）；120/120+37/37 测试与 27 条走查为旁证
  - **CEO 过目确认：2026-08-16，已过目确认**（变更范围、review 结论与风险说明；G4 前置条件满足）
- **iter-7（本次执行）**：范围 `63b6b4d..dcfafcd`（后端 6 文件：app/{main,config,db,routers/proxy,routers/profiles} + tests 3；前端 13 文件：api/{client,backend}、stores/{settings,sessions}、db/persistence、SettingsForm/KeyModeCard/ErrorBubble/TheSidebar/EmptyState/App + 测试 5）。重点审密钥路径（迭代风险清单点名）与断网队列并发。发现与结论：
  - 密钥路径专项核对：代理转发请求头全新构造（`build_request` 显式 Authorization+Accept，绝不透传 Cookie/其余头）；profiles.py 全部响应经 `mask_key()`（明文零出口，pytest 逐响应断言）；后端无任何 print/logging 输出点（QA 审计复核同结论）；`.env` 三变量被 .gitignore 覆盖（git 全量历史检索 0 命中）；DB 文件 0600；编辑模态 key 不回显（留空=沿用服务端语义）
  - **发现 DEF-017（严重，已修复）**：暂存队列重放出队 `slice(1)` 与入队竞态——重放某操作的 await 期间同 id 新入队（enqueue 按 id 压缩重排）后，slice(1) 会错删其他待同步会话的操作（数据丢失类）。修复：PendingOp 加单调 seq 身份，出队改按 seq filter 精确移除；回归用例「重放期间同 id 新入队不错删他项」（141/141）
  - 代理错误分支核对：上游 401/403→502 upstream_auth（防与 Cookie 会话 401 混淆触发跳登录，设计稿定稿映射）；429 透传、5xx→502、超时→504、统一密钥缺配→503、流中断补帧——16 用例 + 浏览器断网/无效 key 实测旁证
  - 模式路由/CHG-002 核对：代理每请求读 DB 生效档案（profiles 部分唯一索引保证每用户至多一行 is_active）——生成中切换/回退天然「旧配置跑完、下一请求生效」；activate 同事务先清后置，无中间双活态
  - 前端换源核对：settings store 档案全走后端 API（localStorage 仅 systemPrompt，旧档案字段停读不清留 iter-8 导入——tailoring 登记）；generate 直连分支删除后 `streamChat` 成死代码（登记技术债）
  - 低风险遗留（不构成缺陷）：settings.boot() 失败后本会话不重试（档案列表空至刷新页面）——技术债登记 iter-8 候补
  - **风险如实说明**：性能取证「首块额外延迟为负」依赖共享 AsyncClient 连接池复用 TLS，iter-8 全链路 Compose 部署形态变化后需复测（观察项 5）；GLM 经代理未实测（CEO 决策 DEF-002 延续）
  - 141/141+69/69 测试、26 条走查、QA 审计 4 项主会话补证为旁证
  - **CEO 过目确认：2026-08-16，已过目确认**（变更范围、review 结论与 DEF-017 修复；G4 前置条件满足）


- **iter-8（本次执行）**：范围 `ca77880..d5347e3`（后端 9 文件：app/{config,db,quota,routers/auth,routers/proxy,routers/admin} + tests 3；前端 19 文件：AdminView、migration store、MigrationBanners、api/{backend,client}、router、TheSidebar、KeyModeCard、SettingsForm、App、LoginView、idb + 测试 8）。重点审配额横切面、密钥路径（存量档案上云）、迁移原子性与并发、封禁门禁。发现与结论：
  - **发现 DEF-019（一般，已修复 d5347e3）**：MigrationBanners setup 捕获 store 状态引用，dismiss/knowDone 整对象替换后引用滞留——提示条不从界面消失、重导入进度不刷新；既有测试只断言 store 状态漏过 DOM 层。修复 = kinds 改 computed + DOM 层回归断言
  - 密钥路径核对：存量档案仅在用户显式点击「导入到云端」后 POST 上传（非静默迁移口径落实）；失败态密钥未上传（本地字段原样保留，用例断言）；导入完成即清除本地旧字段（systemPrompt 保留，sk-old 检索不到）；迁移/管理后台全链路无 key 出现在日志与响应
  - 迁移原子性核对：单会话 = 单次 PUT 整档、单档案 = 单次 POST（构造性原子，中断无半条记录）；重试去重双口径（会话按云端 id、档案按名称+地址+模型）；取消即时停止且不设清除键（本地完整保留）
  - 配额核对：先查后计非原子已在代码注释留档（极端并发放过 limit+N，量级无害）；被拦截请求不计数不达上游（pytest seen 取证）；配额覆盖与档位联动经 T2 联动用例背书
  - 观察项（不构成缺陷，登记留痕）：① `record_tokens` 以落库时刻取「今日」，跨自然日零点的流其 token 会 UPDATE 落空（该次请求数已计、token 丢失，影响有界且次日自愈）——iter-9 顺手可修（把 day 在 consume 时传入闭包）；② admin 用户列表 limit_for 每行一次 SELECT（自部署规模无感）；③ register 的 409（用户名已占用）计入限频——视为防刷特性
  - 浏览器观感 6 项待复核（iter-8-verify.md）——本会话预览端口被并行会话占用，QA 审计知悉
  - 185/185 + 105/105 + 构建 + guard:style 为旁证；审计补证阶段另发现并处置 LoginView.vue 未随 T2 提交（git add 清单漏列，补提交 53e6b0a + 全门禁复跑绿——教训进复盘）
  - **CEO 过目确认：2026-08-16，确认过目变更范围、review 结论（DEF-019 修复 + 观察项）与审计报告（G4 前置条件满足）**

## QA 审计与 NCR 处置（iter-2）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| backend auth_sessions | 过期会话行无主动清理（仅占空间，token 原值不可逆推，无安全影响） | iter-6 T1 范围外；Code Review 发现 | iter-7 顺手清（登录时批量 DELETE） |
| backend dev 路由 | /api/dev/sse-echo 在生产容器可达（需登录、上限 20 块） | 风险低（QA 观察项 6） | iter-7 部署收口时评估按环境裁剪 |
| 会话持久化 | 断网时 persist 失败仅 toast，无重试/队列 | REQ-022 细项，计划已排 iter-7 | iter-7 |
| NCR-iter2-001 | 周报/review 体系未运转 | 整改：本版周报补 iter-2 全部内容 + 全量 review 记录（CEO 过目确认 2026-08-15，见 Code Review 节） | 已关闭 |
| NCR-iter2-002 | 设计稿头部状态与基线声明矛盾 | 整改：title/badge 更新为"已基线" | 已关闭 |
| NCR-iter2-003 | 停止时效 200ms 取证不足 | 整改：补同步 abort 构造性证明单测（37/37 含此用例），verify 记录更新 | 已关闭 |

## QA 审计与 NCR 处置（iter-4，2026-08-15）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| NCR-iter4-001 | 周报无 iter-4 章节 + Code Review 缺失 | 整改：本版周报补 iter-4 全部内容 + 全量 Code Review 记录（重点 CHG-003 数据层，见 Code Review 节；CEO 过目确认 2026-08-15） | 已关闭 |
| NCR-iter4-002 | 视觉走查记录缺失 | 整改：补 plans/iter-4-verify.md（28 条，DOM 实测 + 单测，含偏差登记与 NCR 观察项 5 整改口径） | 已整改，待 QA 复查 |
| NCR-iter4-003 | RTM REQ-019 设计列标「待同步」 | 整改：改「已同步」；RTM 头测试数 76→79 同步修正 | 已整改 |
| NCR-iter4-004 | DEF-011 处置记录失真 | 整改：追加 CHG-003 覆盖说明，中间态 DOM 数据（712px/686px 等）标注作废、关联 CHG-003 | 已整改 |
| NCR-iter4-005 | design/proto 未同步 CHG-003 | 整改：proto 输入区同步单排顶对齐，操作栏/版本切换不在 P0 原型范围的保留理由写入头部；CHG-003 影响评估补 proto 评估（含整改补记） | 已整改 |

## QA 审计与 NCR 处置（iter-6，2026-08-16）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| NCR-iter6-001 | 提交门禁钩子死代码 + 后端不进门禁（严重） | 整改：company-os a6b0114——删提前 exit 0、前后端门禁并存都跑；顺带修复 BSD sed 不支持 \s/\S 导致的静默放行（负向用例 exit 2 / 正向 exit 0 实测） | 已整改，待复盘确认 |
| NCR-iter6-002 | 登录页 8 处设计偏差无登记（严重） | 整改：①401 到达显示「登录已过期」②空值/已占用字段行内③确认密码眼睛④480px 输入 16px⑤加载态实底+spinner⑧密码上限 128 均回基线；⑥⑦视觉参数登记偏差接受（changes.md CHG-004 澄清定案 10，CEO 批准） | 已整改，待复盘确认 |
| NCR-iter6-003 | 无完整走查记录 | 整改：plans/iter-6-verify.md——27 条逐项 DOM 实测（26 过 + 1 占位），走查中再修复 5xx 重试缺口 | 已整改，待复盘确认 |
| NCR-iter6-004 | 周报 + Code Review 未产出 | 整改：本章节 + Code Review iter-6 全量记录（CEO 过目落痕见该节） | 已整改，待复盘确认 |
| NCR-iter6-005 | RTM 存量行口径未更新 | 整改：REQ-001/002/007/014 补 v3 过渡态注记（iter-7 复验口径）；顺带订正用例数笔误（观察项 1） | 已整改，待复盘确认 |
| NCR-iter6-006 | proto 承诺未兑现未登记 | 整改：changes.md CHG-004 澄清定案 9 补记（登录/注册原型由 design-iter-6 承载，REQ-021/025 随 iter-8）；spec REQ-020 涉及页面字段同步 | 已整改，待复盘确认 |

观察项处置：1 数字订正（随 005）；2 tailoring 版本行 v1.4.3（已更）；3 iter-5 审计补档 retros/qa-audit-iter-5-summary.md；5 backend README 已更；4/6/7/8 登记 iter-7/复盘跟踪。

## QA 审计与 NCR 处置（iter-7，2026-08-16）

| 编号 | 内容 | 处置 | 状态 |
|------|------|------|------|
| NCR-iter7-001 | RTM REQ-023 行未随完成更新（同条款连续第二迭代） | 整改：该行更新为「已实现并验证（v3 口径，iter-7 T1/T2）」——实现（proxy.py/client.ts）、测试（test_proxy 16 + client.spec 代理组）、quota 注记齐备；REQ-022 状态行同步（观察项 8 顺带） | 已整改，待复盘确认 |
| NCR-iter7-002 | 周报 iter-7 章节 + Code Review + 技术债缺失（同型第 5 次复发） | 整改：本章节 + Code Review iter-7 全量记录（含 DEF-017 发现与修复——review 的直接产出）+ 技术债 2 条新增；CEO 过目落痕待 CEO | 已整改（CEO 过目待办） |
| NCR-iter7-003 | 走查 15 偏差当场修复未落 DEF 登记（v1.4.4 C 条首迭代执行走样） | 整改：DEF-016 补登记（含修复提交号 ad8fe6a 回填）；顺带 DEF-015 提交号补齐（观察项 3） | 已整改，待复盘确认 |

观察项处置：1 T3 断网验收口径注记已补 tailoring（追加裁剪 2026-08-16 第 3 行）；2 直连死代码入技术债（iter-8 定夺）；3 已随 NCR-003 顺带完成；4 复盘固化口径（提交前测试暴露≠交付缺陷）；5 iter-8 部署形态复测；6/7 组织级，随下次制度修订；8 已随 NCR-001 顺带统一 REQ-022 行。主会话补证 4 项（运行时复现 69/69+141/141+构建、提交落位、key 全量检索、db 0600）全部通过并回填审计报告。

## 技术债登记

| 位置 | 内容 | 原因 | 状态 |
|------|------|------|------|
| 消息区 | interrupted/stopped（中断/停止）消息无重试入口，需发新消息继续 | 与基线一致（重试仅绑定错误气泡） | 保留（iter-3 评估） |
| 全局 | 窄视口（<768px）无响应式 | spec 明确 MVP 不承诺 | 保留（需求变更时） |
| ~~渲染~~ | ~~AI 回复纯文本渲染，Markdown 源码可见~~ | ~~REQ-011（P1）iter-2 容量不足未排入~~ | **已销账（08-15）**：iter-3 T2 实现 Markdown 渲染（markdown-it + DOMPurify） |
| ~~metrics~~ | ~~collect.sh 需人工绕行（DEF-001）~~ | ~~根因未明~~ | **已销账（08-15）**：根因查明并修复，采集恢复全自动 |
| api/client.ts | 直连版 `streamChat`（L116-165）+ `ApiClientConfig.apiKey` + client.spec 5 条旧用例：T2 后无生产调用方，成死代码 | QA 审计观察项 2——tailoring「直连分支已删除」按调用路径口径成立，函数本体未删 | iter-8 定夺删除或保留 |
| stores/settings | boot() 失败（断网起页）后本会话不重试，档案列表空至刷新 | iter-7 Code Review 发现（低风险：登录后 Root 重挂载会重跑） | iter-8 候补（进设置页时惰性重拉） |

## 下周计划（iter-8 关闭后口径，2026-08-16 更新）

- iter-9 主线（v0.5.0 收口）：REQ-021 账号管理（改密/注销，随 design-iter-9 设计先行）+ 全链路 Compose 一键起 + 自部署文档 + dev 路由按环境裁剪 + v0.5.0 发布（REQ-014 浏览器复验已提前闭账）；候补：auth_sessions 过期清理、useTheme 单测、直连死代码定夺（随 Compose 收口）、settings.boot() 重试、跨零点流 token 归属顺手修
