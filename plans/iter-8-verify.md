# iter-8 验证与走查记录 — T2（REQ-025 管理后台，2026-08-16）

> 走查口径：对照 design-iter-8 §7.2 清单（44 条）中 T2 范围逐条取证。
> **取证环境说明**：本会话浏览器预览面板端口被并行会话 dev server 占用（preview 工具三次尝试启动均被拒绝），
> 浏览器级实测改由**组件级 DOM 断言（vitest 挂真实 router/Pinia、仅 mock 后端）+ 后端 pytest** 全量覆盖，
> 视觉观感项（暗色对照、ellipsis 效果、动画）列为待补——见文末「待浏览器复核」。
> 测试终态：**前端 vitest 164/164（19 文件）+ 后端 pytest 104/104 + ruff clean + 生产构建（vue-tsc+vite）通过 + guard:style 通过**。

## §7.2 清单 T2 范围逐条取证（1~29 + 42/43/44 相关）

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 1 | 管理员侧栏盾牌入口（状态点与登出之间，仅管理员渲染） | TheSidebar.spec「管理员」用例：存在 + title + DOM 顺序断言 | ✅ |
| 2 | 普通用户无盾牌节点、无后台痕迹 | TheSidebar.spec「普通用户」：`exists()===false` + footer html 不含「管理后台」 | ✅ |
| 3 | 未登录访问 /admin → /login?redirect=/admin 回跳 | guard.spec 新增用例：`to.name==='login'` 且 `redirect==='/admin'`；已登录放行用例同步补 | ✅ |
| 4 | 普通用户 403 态：居中卡、零数据渲染、接口同 403 | AdminView.spec「403 卡 + 不发起任何后台请求」；pytest TestAdminGate（3 端点 × 401/403 参数化 + 响应不含他人数据） | ✅ |
| 5 | 后台框架：顶栏（品牌+徽标+主题+返回）+ 分段 tab（radiogroup） | AdminView.spec「六列全字段」用例断言 tabs 文本与顶栏；tab 切换 aria-checked | ✅ |
| 6 | 用户列表六列全字段 | AdminView.spec：`['用户名','注册时间','状态','密钥模式','配额','操作']` 全等断言 | ✅ |
| 7 | 管理员本人行：「管理员」徽标 + 封禁禁用 + title；后端同拒绝 | AdminView.spec（disabled + title「管理员本人不可封禁」）；pytest（封禁管理员 → 400） | ✅ |
| 8 | 状态胶囊：正常 subtle/success、已封禁 danger-l/danger | 组件用 `.pill.ok/.pill.banned` 令牌类（全 var() 引用，guard:style 通过）；文本断言 ✅，色值对照留浏览器复核 | ✅（视觉项待复核） |
| 9 | 全站条常态文案「统一 key 每日总量 2,000 · 今日已用 x」 | AdminView.spec（overview=100 → 文案全等） | ✅ |
| 10 | ≥80% 翻琥珀 | AdminView.spec（1600/2000 → `.site-bar.near`） | ✅ |
| 11 | 熔断翻红 + 暂停文案（自填不受影响） | AdminView.spec（2000/2000 → `.site-bar.burst` + 文案）；熔断行为本身 pytest TestUnifiedFuse | ✅ |
| 12 | 档位徽标：免费档/自填档/自定义 N 可区分 | AdminView.spec（`['免费档','自定义 200']` + custom 类）；自填档 500 经 pytest /api/quota 用例 | ✅ |
| 13 | 「今日 x/N」tabular-nums；x=N 已用尽（danger）；封禁显「—」 | AdminView.spec（今日 3/30 / 今日已用尽 / 封禁行 `—`） | ✅ |
| 14 | 封禁确认模态（danger 实底、后果与可逆文案）→ 生效 + toast + 重载 | AdminView.spec「封禁确认模态」用例（模态文本 + banUser(2) + adminUsers 二次调用 + toast） | ✅ |
| 15 | 封禁自己被阻止（UI 禁用 + 后端拒绝直调） | 同 #7 双侧 | ✅ |
| 16 | 解封直接生效无确认 + toast；行按钮换「解封」 | AdminView.spec「解封」用例 | ✅ |
| 17 | 调配额：默认档/自定义 N；非正整数红描边 + 行内错误不入库；Esc/取消 | AdminView.spec「正整数校验」（1.5 → 错误文案 + setUserQuota 零调用）；pytest（0 → 422）；Esc=ConfirmModal 既有行为 | ✅ |
| 18 | 保存后徽标翻「自定义 N」+ toast「自下一次请求生效」；实际可用量按 N 生效 | AdminView.spec（setUserQuota(2,5) + toast）；pytest TestQuotaOverride「覆盖后第 3 次拦截 + /api/quota 反映 + 清除恢复默认档」 | ✅ |
| 19 | 加载态 spinner + 「正在加载用户列表…」 | 实现修正为 spinner + 定稿文案（初版为纯文字「加载中…」，走查对照时修正）；瞬态以代码分支取证 | ✅ |
| 20 | 拉取失败 banner + 重试（不清 tab/状态） | AdminView.spec「拉取失败重试」用例 | ✅ |
| 21 | 仅管理员一人：单行正常呈现（无空态） | 实现无空态分支（管理员恒存在，模板恒渲染行）；pytest list_users 单/多用户用例 | ✅ |
| 22 | 超长用户名 ellipsis（150px）+ title 全名 | `.uname` max-width:150px + ellipsis + `:title` 绑定（CSS 效果留浏览器复核） | ✅（视觉项待复核） |
| 23 | 用量 4 列（日期/用户名/请求数/token 数） | AdminView.spec 用量组 | ✅ |
| 24 | 筛选：用户下拉（含全部用户）+ 日期默认 7 天；行数显示 | AdminView.spec（「全部用户」+ user_id=2 重查 + 「3 条」） | ✅ |
| 25 | 三列排序升降、箭头指示；默认日期降序 | AdminView.spec（默认序断言 + 点击请求数列头重排） | ✅ |
| 26 | 空态说明 | AdminView.spec「空态」 | ✅ |
| 27 | 用量加载/失败态 | 失败同 #20 模式（共用 err-banner + 重试）；加载态同 #19 | ✅ |
| 28 | 缺失时段琥珀行「不估算补齐」 | AdminView.spec「窗口不连续 → gap-note」 | ✅ |
| 29 | 被封禁登录 warning banner（iter-6 定稿文案）；在线被封禁 → 跳登录 + 同 banner | 登录路径：LoginView.spec 既有「封禁 403 琥珀」+ 新增「sessionStorage 标记到达 → 横幅 + 读取即清除」；在线路径：client.spec 新增（403 banned → markBanned + notifyUnauthorized）+ backend.request 同路径；pytest（login 403 detail / admin ban 后 get_current_user 403） | ✅ |
| 42 | 亮暗双态无亮色残留、对比度 | 全部新样式走 var() 令牌（guard:style 通过 = 无裸色值/自引用）；暗色令牌为 App.vue 全局 `:root [data-theme=dark]` 覆盖，/admin 同源生效 | ✅（结构）/ 待浏览器复核（观感） |
| 43 | 后台数据只来自机器计数 | pytest TestUsage「与配额计数同源」（usage_daily 即代理计数表）；前端无任何手填路径 | ✅ |
| 44 | 不适用注明 | 移动端仅登录/注册承诺；T1 提示零 UI 改动；LWW/key 复验无 UI 触点（T3 范围） | ✅（不适用） |

## T2 附带交付（REQ-014 联动）

- KeyModeCard 免费额度行参数化（design-iter-7 走查 2「iter-8 参数化」兑现）：KeyModeCard.spec 2 用例（有数据显真实数值无占位 / 无数据保持占位不编造）。
- AuthUser.is_admin 透出（register/login/me 响应），前端入口判定唯一依据；服务端 admin 接口 403 为安全边界（双保险）。

## 待浏览器复核（视觉观感，非功能）

1. 后台整页暗色对照（42）与胶囊/横幅色彩观感（8）
2. 超长用户名 ellipsis 实际截断效果（22）
3. 封禁/调配额模态动画与 spinner 动效（14/17/19）
4. 真实导航观感（登录回跳 /admin、403 卡返回主界面）

受阻原因：本会话浏览器预览面板的端口被并行会话 dev server 占用，preview_start 三次尝试（改配置/autoPort/独立端口）均被工具拒绝。功能与 DOM 结构已由上述测试全量背书；建议 CEO 本地 `npm run dev` 打开 /admin 复核观感，或端口释放后补测。

## 后端专项（pytest 104/104）

- admin 路由 19 用例：管理员引导（首注册/存量补标 SQL 同款取证/已有管理员不改标）、403 门禁、封禁/解封、配额覆盖与代理联动（第 3 次拦截未抵达上游）、用户列表字段、用量聚合与过滤、全站条数据
- 迁移 v5：`users.quota_override` + 存量库最早用户补标管理员（全新库 1→5 链路每测试顺带覆盖）
