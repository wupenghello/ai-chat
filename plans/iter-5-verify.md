# iter-5 验证与走查记录（2026-08-15）

- 自动化测试：**84/84 通过**（iter-5 新增 5：settings.spec 档案 4 用例 + settings-form.spec 重写后 4 用例中新增 1）
- 生产构建：`npm run build`（vue-tsc -b + vite build）通过，含 064e393 修复后最终态
- 走查方式：DOM 实测 + **computed style 断言**（iter-4 复盘教训：不能只看类名存在）
- 走查环境：dev server（Vite 5173）+ 既有 IndexedDB 数据 + 旧版单套 API 配置（迁移用例）
- 走查基线：design-iter-5（已基线，7 项待澄清 CEO 预授权按默认定夺）

## 走查结果

### T1 token 化 + 命名统一

| # | 结果 | 取证 |
|---|------|------|
| 1 全仓库裸色值清零 | ✅ | grep 审计：组件样式仅剩 `#fff`（实底白字）与深底白色叠层两类合法保留；App.vue 命中均为 :root/[data-theme] 令牌定义区 |
| 2 --c-error→--c-danger 统一 | ✅ | 全组件引用同步；`--c-danger` 在 :root 与暗块均有定义（含 solid 族） |
| 3 亮色外观不变（回归） | ✅ | body #F5F6F7、侧栏 #FFFFFF、会话标题 #1F2329——与 v0.3.0 亮色一致（DOM 实测） |
| 4 令牌自引用清零 | ✅ | 正则 `--x: var(--x)` 扫描 App.vue 无命中（064e393 修复项） |

### T2 暗色主题（REQ-017）

| # | 结果 | 取证 |
|---|------|------|
| 5 顶栏主题按钮 icon-only ghost | ✅ | DOM：.theme-btn 32×32、title 随态切换（切到浅色/切到深色） |
| 6 切换即时生效 | ✅ | 点击后 html[data-theme=dark]，body #131417、侧栏 #1E2026、标题 #E6EAF0——精确命中 tokens v1.3 |
| 7 设置页「外观」segmented 双入口同步 | ✅ | DOM：.seg-btn 浅色/深色，.on 态与 html data-theme 一致；同一 localStorage key |
| 8 持久化 | ✅ | localStorage ai-chat-theme=dark，刷新后 data-theme=dark、body 仍 #131417 |
| 9 设置页深色适配 | ✅ | 卡片 #1E2026、描边 #33363E（computed style 实测） |
| 10 模态遮罩 | ✅ | .modal-mask computed rgba(31,35,41,0.4)（令牌 --c-mask 生效，064e393 修复项） |
| 11 对比度 | ✅ | 构造性：暗色正文 #E6EAF0/@#1E2026 = 13.5:1、弱化 4.6:1（tokens v1.3 对照表，CEO 批准值） |

### T3 多供应商档案（REQ-018）

| # | 结果 | 取证 |
|---|------|------|
| 12 旧单套配置自动迁移 | ✅ | DOM：旧 DeepSeek 配置 → 档案「deepseek-chat@api.deepseek.com」成为当前生效 |
| 13 档案列表 + 当前标记 + 删除边界 | ✅ | DOM：.profile-item（名称/摘要/当前生效徽标）、当前档案删除按钮 disabled |
| 14 添加模态（名称必填校验） | ✅ | settings-form.spec：空名称行内错误不持久化；DOM：完整填写保存成功 |
| 15 设为当前切换 + 侧栏联动 | ✅ | DOM：切换 GLM 后 .p-current 移动、侧栏 .profile-tag 变「GLM」 |
| 16 生成中切换旧档案跑完 | ✅ | 构造性：generate() 开始时锁定 config 快照，中途切换只影响下次请求（CHG-002 语义） |
| 17 清除当前档案密钥 | ✅ | settings-form.spec：确认后 config.apiKey undefined、localStorage 无残留 |

## 开发后修复（064e393）走查

- 设置页「外观/档案/模态」三块样式恢复：卡片 12px 圆角白底、档案项 1px 描边 8px 圆角、.theme-seg inline-flex、模态 420px + 遮罩（computed style 全断言）。
- 根因与教训见提交说明；「UI 验证必须断言 computed style」已列 iter-5 复盘输入。

## 偏差登记

- 无未处置偏差。测试环境预览面板一度 0×0 视口导致测量伪影（模态 48px），非产品缺陷，已在排查中确认。
