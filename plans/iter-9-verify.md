# iter-9 验证与走查记录 — T2（REQ-021 前端账号管理 UI，2026-08-16）

> 走查口径：对照 design-iter-9 §7.2 清单（23 条）中 T2 范围逐条取证。
> **取证环境说明**：组件级 DOM 断言（vitest 挂真实 Pinia，仅 mock backend）+ store 单测全量覆盖；
> 视觉观感项（亮暗对照、focus 环、过渡动画）列为待浏览器复核——见文末「待浏览器复核」。
> 测试终态：**前端 vitest 206/206（23 文件，+21 新增）+ 后端 pytest 117/117（改密/注销 9 用例 + 复杂度 3 用例）+ 生产构建（vue-tsc+vite）通过 + guard:style 通过**。

## §7.2 清单 T2 范围逐条取证（23 条）

| # | 期望（摘要） | 取证 | 结果 |
|---|------------|------|------|
| 1 | 「账号」区块置于「供应商档案」后、页尾；正文白底 --c-surface | SettingsForm 模板：`section-label「账号」` 位于对话设置之后（页尾）；主内容区白底 = App.vue `.main{background:var(--c-surface)}` | ✅ |
| 2 | 改密旧密码字段 label 13px/500 text-1、输入 36px r-md 16px、focus 主色描边+焦点环 | SettingsForm 复用 `.field-label`/`.input`（16px 字号、focus 主色+焦点环），settings-form.spec「必填缺失」覆盖字段存在 | ✅ |
| 3 | 旧密码错误：仅旧字段红描边 + 行内「旧密码错误」，改对即消除 | settings-form.spec「旧密码错误（后端 400）」：`inputs[0].classes() 含 invalid` + 文本含「旧密码错误」 | ✅ |
| 4 | 新密码不达强度：行内「新密码至少 8 位，需包含字母与数字」 | settings-form.spec「新密码不足 8 位」+「纯数字/纯字母」2 用例（前端含字母+数字校验，与后端升级后同口径） | ✅ |
| 5 | 新密码=旧密码：行内「新密码不能与旧密码相同」 | settings-form.spec「新密码=旧密码」（old/new 均 ≥8 位才可触发，与后端同序） | ✅ |
| 6 | 两次不一致：确认字段红描边 + 行内「两次输入的密码不一致」 | settings-form.spec「两次不一致」 | ✅ |
| 7 | 必填缺失：空必填项红描边 + 行内「必填：请输入…」，不入库 | settings-form.spec「必填缺失」三项全断言 + `changePassword` 零调用 | ✅ |
| 8 | 密码显隐：行尾眼睛按钮切换 input type | DeleteAccountModal.spec「密码显隐」+ SettingsForm 3 字段各带眼睛按钮（复用 LoginView eye 图标） | ✅ |
| 9 | 提交按钮「更新密码」36px primary-solid 白字 | SettingsForm `.pwd-submit`（宽 100% + `.btn.btn-primary` 实底白字）；settings-form.spec 成功用例触发 | ✅ |
| 10 | 改密成功反馈：成功横幅「密码已更新，除当前设备外其他设备已退出登录」+ 深底 toast + 表单清空 | settings-form.spec「成功」：表单清空 + 文本含「密码已更新」+ toast variant=success | ✅ |
| 11 | 注销入口危险区：danger-l 底 + danger 描边/文字 + 危险实底按钮 | SettingsForm `.danger-zone`/`.dz-title`/`.dz-desc`（`--c-danger-l`/`--c-danger`）+ `.dz-btn` 实底 | ✅ |
| 12 | 注销模态标题 17px/600「注销账号？」、正文 14px text-2 明示范围、动作右对齐 | DeleteAccountModal.spec「标题/正文」：`.modal-title` 文本 + 含「全部云端数据/不可恢复」 | ✅ |
| 13 | 模态密码二次确认 label 13px text-2 + 输入 36px + 眼睛显隐 | DeleteAccountModal `.field-label`/`.field-input` + `.eye-btn`；spec「密码显隐」 | ✅ |
| 14 | 永久注销按钮危险实底、密码空 disabled | DeleteAccountModal.spec「密码为空 disabled」：`disabled` 属性断言 | ✅ |
| 15 | 二次确认不匹配：行内「密码不正确，账号与数据未发生任何变更」，不删除 | settings-form.spec「密码不匹配」：error 回填 + `user` 不变 + 模态仍开 | ✅ |
| 16 | 生成中分支：警告条「注销前将自动终止生成」+ 终止生成不打断取消 | DeleteAccountModal.spec「生成中」+ settings-form.spec「生成中注销」：`abortAllGenerations` spy 被调 | ✅ |
| 17 | 注销成功：清除本地会话/凭据 → 跳 /login（空表单）+ 深底绿 toast「✓ 账号已删除，再见」 | settings-form.spec「注销成功」：`deleteAccount` 调用 + `clearPendingOps` + `auth.user=null`（Root 监听跳登录）+ toast variant=success；LoginView 挂 AppToast 承接 | ✅ |
| 18 | 模态遮罩 --c-mask / 面板 surface + r-lg + shadow-3 | DeleteAccountModal `.overlay`/`.modal`（`--c-mask`/`--c-surface`/`--shadow-3`） | ✅ |
| 19 | 亮暗双态无亮色残留、对比度 | 全部新样式走 `var()` 语义令牌（guard:style 通过 = 无裸色值/自引用）；暗色由 App.vue 全局 `[data-theme=dark]` 覆盖 | ✅（结构）/ 待浏览器复核（观感） |
| 20 | 主题持久化（localStorage + .15s 过渡） | 不适用：REQ-017 既有能力，本迭代未改动 useTheme（视觉反转仅换「哪里用哪个令牌」，未动持久化机制） | ✅（不适用） |
| 21 | 铁律5 样件数据（前端不落地明文） | 不适用：改密/注销明文密码仅上传后端，前端不持久化（后端验旧密/哈希更新/级联删除全由后端处理） | ✅（不适用） |
| 22 | 移动端 / 强度计 / 冷却期不适用注明 | 不适用：设置页桌面优先不做窄屏断点；密码强度用行内文案不做指示条；冷却期/导出不在范围（spec 最小口径） | ✅（不适用） |
| 23 | 基调变更：侧栏灰 --c-bg + 正文白 --c-surface | TheSidebar `.sidebar{background:var(--c-bg)}` + App.vue `.main{background:var(--c-surface)}`；侧栏宽 264px（CEO 定「保持 264px」，design R2 已修订对齐） | ✅ |

## 偏差注记（#1/#3 已定夺销账；#2/#4 已按既有实现）

1. **新密码强度口径（走查 #4）—— 已定夺销账（CEO 2026-08-16「升级为含字母+数字」）**：后端 `security.password_meets_complexity`（至少一个 a-zA-Z 字母 + 一个数字）落地于 register + 改密；login 分离 `LoginBody` 不校验复杂度（格式不合法与密码错误统一 401）。前端 SettingsForm 改密校验同步「含字母+数字」。前后端与 design 文案一致。
2. **分区 label 字号（走查 #1）**：design 为 `settings-section-label` 13px/600 text-2；既有代码 `SettingsForm` 分区统一用 `.section-label`（14px/600 text-1），「账号」区块沿用既有 `.section-label` 保持一致，未按 design 改字号。
3. **侧栏宽度（走查 #23）—— 已定夺销账（CEO 2026-08-16「保持 264px」）**：design-iter-9 R2 修订侧栏宽 232px → 264px（对齐 iter-1 实现基线）；实现沿用 264px 未改。
4. **改密成功 toast 文案（走查 #10）**：design 为「✓ 密码已更新」（绿）+「其他设备已退出登录」（白）双色；T2 简化为整条 success 绿「✓ 密码已更新，其他设备已退出登录」（AppToast `variant='success'` 全绿）。与注销 toast「✓ 账号已删除，再见」形态一致。

## 附带交付（REQ-021 联动）

- `backend.ts` 新增 `changePassword` / `deleteAccount` 两调用（`ApiBackendError` 文案透传）。
- `auth.clearSession()`：注销成功清除本地凭据（不调后端 logout），Root 登录态监听完成跳 `/login`。
- `toast` 新增 `variant:'success'`（`--success-on-dark #4CC38A` 绿字）；`LoginView` 挂 `AppToast` 承接「账号已删除」落登录页 toast（原 AppToast 在 App.vue，跳登录后卸载）。
- `sessions.abortAllGenerations()`：注销前终止全部生成中会话（标注 stopped）。
- `db/persistence.clearPendingOps()`：注销后清本地暂存同步队列，防止已删账号未同步更改在下一账号登录后重放泄漏。

## 待浏览器复核（视觉观感，非功能）

- 亮暗双态下侧栏灰/正文白分层观感（走查 19/23）、focus 焦点环、眼睛按钮 hover、模态遮罩/阴影观感。
- 真机注销流程：改密后其他设备 401（后端 T1 已覆盖）、注销后登录页 toast 呈现。
