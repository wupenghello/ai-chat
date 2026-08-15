# iter-4 验证与走查记录（2026-08-15）

- 自动化测试：**79/79 通过**（逻辑单测 + 组件挂载 + 集成路径，iter-4 新增 17 条：sessions.spec 编辑/版本切换 5、search.spec 5、MessageBubble.spec 编辑/操作栏/版本 7），`npm test` 全绿
- 生产构建：`npm run build`（vue-tsc -b + vite）通过——含 CHG-003 单排顶对齐后的最终态（G4 硬前置）
- 走查方式：DOM 实测优先（preview 工具读取真实 DOM 计算样式/几何断言），不抽查
- 走查环境：dev server（Vite 5173）+ 既有 IndexedDB 数据
- 走查基线：design/iter-4 第 4 节清单（26 条）+ CHG-003 最终实现
- 补录说明：本记录为 QA 审计 NCR-iter4-002 整改补录——开发过程中的 DOM 实测证据散见于各提交说明，现按触点归档成文

## 走查结果（按触点，CHG-003 最终态）

### 触点一：输入区（DEF-011 + CHG-003 最终态）

| 序号 | 结果 | 取证方式 |
|------|------|---------|
| 1 发送/停止按钮与 textarea 同排，顶部对齐首行 | ✅ | DOM 实测：`.composer-main` 存在且含按钮；`.ta` 与 `.send` 顶边同为 y=707（getBoundingClientRect） |
| 2 textarea padding-top 7px 使首行与 36px 按钮视觉居中 | ✅ | DOM：`getComputedStyle(.ta).paddingTop = "7px"`；按钮高 36px |
| 3 容器 12px 均等 padding + shadow-1 + 12px 圆角 | ✅ | DOM：padding "12px"、box-shadow `0 1px 2px rgba(31,35,41,.06)`、radius 12px |
| 4 focus 主色描边 + 3px 光晕 | ✅ | CSS 与稿一致（:focus-within border-color #3370FF + box-shadow 0 0 0 3px rgba(51,112,255,.12)） |
| 5 底部 hint 弱化（12px 灰、margin-top 6px） | ✅ | DOM：hint 存在于 `.composer` 内 `.composer-main` 之外；composer.spec（生成中/非生成中两态文案） |
| 6 字号 14px/1.6 | ✅ | DOM：fontSize "14px"、lineHeight "22.4px" |
| 7 生成中停止按钮原位替换 + hint 文案切换 | ✅ | composer.spec（generating 态 .stop 出现、可点、hint 切换「AI 回复生成中…」） |

### 触点二：消息操作栏（CHG-003）

| 序号 | 结果 | 取证方式 |
|------|------|---------|
| 8 按钮 icon-only（无内联文字） | ✅ | DOM：`.action-btn` textContent 为空串 |
| 9 hover 图标出 title tooltip | ✅ | DOM：`.action-btn[title="复制"]` 存在；修改按钮 title/aria-label="修改" |
| 10 复制/修改默认 opacity 0，hover 消息才显示 | ✅ | DOM：getComputedStyle(.action-btn).opacity = "0"；CSS `.msg-col:hover .action-btn { opacity: 1 }` |
| 11 按钮 24px 方形 icon | ✅ | DOM：width "24px" |
| 12 仅用户消息有「修改」，AI 只有「复制」 | ✅ | DOM：用户消息 action-row 按钮文案 [复制,修改]，AI 消息 [复制]；MessageBubble.spec |
| 13 复制点击不抛错（剪贴板降级） | ✅ | MessageBubble.spec（trigger click resolves） |

### 触点三：版本切换（REQ-019）

| 序号 | 结果 | 取证方式 |
|------|------|---------|
| 14 编辑后旧分支归档、可切换找回 | ✅ | sessions.spec：editAndRegenerate 后 toggleVersion 切到旧分支（内容/状态断言）、再切回新分支 |
| 15 ‹ 1/2 › 左右箭头 + 计数器常显 | ✅ | MessageBubble.spec：forkId 时 [aria-label=上一版本/下一版本] 存在、.version-count="1/2"、点击 emit toggleVersion；CSS `.version-nav .action-btn { opacity: 1 }` |
| 16 无 fork 不显示版本导航 | ✅ | MessageBubble.spec（无 forkId 时不存在）；DOM：现有会话无 .version-nav |
| 17 branches 随会话持久化（刷新不丢） | ✅ | 构造性：branches 为 Session 持久化字段（persist 全量 JSON 深拷贝），深拷贝归档无引用环（JSON.stringify 可序列化） |

### 触点四：消息编辑（REQ-015）

| 序号 | 结果 | 取证方式 |
|------|------|---------|
| 18 点击修改进入编辑态、回填原文 | ✅ | DOM 实测：.edit-ta value=原消息文本；MessageBubble.spec |
| 19 编辑面板主色描边 + 3px 光晕 + 12px 圆角 | ✅ | DOM：border 1px solid rgb(51,112,255)、boxShadow rgba(51,112,255,.12) 0 0 0 3px、radius 12px |
| 20 「将删除其后 N 条」提示，N=0 降级 | ✅ | DOM 实测：hint「其后 1 条回复将被删除」；MessageBubble.spec（2 条/仅重新生成两态） |
| 21 空文本保存禁用；取消/Esc 退出 | ✅ | MessageBubble.spec（disabled + cancel 退出编辑态） |
| 22 Enter 确认、Esc 取消、中文输入法不误触 | ✅ | 实现 onEditKey isComposing 守卫（同 ComposerBox 范式，composer.spec 旁证） |
| 23 编辑点后消息被替换、历史保留、上下文正确 | ✅ | sessions.spec 2 用例（编辑第 1 轮/中间轮次，请求体断言） |
| 24 生成中编辑中断当前生成、旧 finally 不清新控制器 | ✅ | sessions.spec（generation 纪元用例） |

### 触点五：会话搜索（REQ-016）

| 序号 | 结果 | 取证方式 |
|------|------|---------|
| 25 搜索框（新建按钮下、列表上）+ 清除按钮 | ✅ | DOM：.search-box 存在、placeholder="搜索会话"、clear 按钮出现/消失随输入 |
| 26 实时过滤：标题命中优先 + 关键词主色高亮 + 正文命中片段 | ✅ | DOM 实测：搜「代码」→ 2 项（标题命中「Markdown 代码块测试」列首 + 正文命中「测试持久化路径」带片段）、mark.hl×2；search.spec |
| 27 无匹配空态 / 空关键词恢复完整列表 | ✅ | DOM 实测：「无匹配会话」+0 项；清除后 6 项恢复、clear 按钮消失 |
| 28 损坏会话不拖崩搜索 | ✅ | search.spec（corrupted → null，不炸）；实现侧 messages 恒为数组（init 已兜底） |

## 偏差登记

- 搜索框初版背景 #F2F3F5/透明描边与设计稿（surface + border + focus 光晕）有偏差（QA 观察项 5）——**已于 NCR 整改时对齐**（TheSidebar.vue 改为 surface + c-border + 3px 光晕），本表第 25 条按整改后口径。
- T1 期间 DEF-011 曾按「两行结构回基线」走查（712px/686px 等数据），该中间态已被 CHG-003 覆盖作废，见 defects.md DEF-011 覆盖说明。
