# iter-20 验证登记 — 移动端主界面适配（REQ-049/050/051）

> 台账（v1.4.17 B 五件套之 verify）：T2 段按 T2 交付回报与 spike 决策整理（34636f0 已推送）；T3 段为本轮交付（验收对照 / 走查结果 / 几何断言口径 / 回归收口 / 实现级决策）。测试计数全部机器采集（铁律 5）。

## T2 段 — 主对话面 + 触摸交互（REQ-049 + REQ-051，34636f0）

### 1. 首步 spike 结论（原 T0 职能，实现级决策登记——沿 iter-19 T0 体例）

1. **matchMedia mock 方案定案**：jsdom v25 未实现 `window.matchMedia`；新建 `src/composables/useMediaQuery.ts`（断点/hover 判定全部带界 max-width / hover:none；matchMedia 不可用兜底 false = 桌面口径，既有 378 用例零回退）。测试模拟 = `vi.stubGlobal('matchMedia', q => ({ matches: map[q], ... }))`（vitest 标准手段）。
2. **布局/模板分工口径**：布局形态切换一律 CSS 带界媒体查询（桌面规则面零触碰）；JS 消费面（useMediaQuery）仅用于模板/DOM 内容级切换（抽屉 rail 抑制、placeholder/hint 触控口径）。
3. **抽屉键隔离断言口径**：开合态 = App 本地 ref，不写 localStorage 任何键；`mm-sidebar-collapsed` 读写点零触达（MobileShell.spec 专项 + 走查条 6 键集前后比对双承载）。
4. **焦点细则（走查定夺项）**：抽屉展开后焦点不强制移入（入口钮 `aria-expanded` 承载状态语义，遮罩/Esc/选中三径关闭）；`:focus-visible` 焦点环 `--c-focus-ring` 沿用——T3 走查条 28 实测 PASS 定案（focus-visible 命中 + 3px 焦点环 rgb(51,112,255,.12)）。
5. **hover:none 常显落法**：`@media (hover: none)` 单处规则（SessionListItem/MessageBubble/ComposerBox 各一），零 JS 分叉；与 hover:hover 天然互斥。

### 2. T2 验收对照（REQ-049 验收 1/2/4/5/6/7 + REQ-051 验收 1~5）

- vitest 378 → **399**（+21：MobileShell/MobileCssContract/ComposerTouch/useMediaQuery 四 spec），既有零改动。
- 几何像素面（验收 1/2/4 的 boundingRect 级）由 T3 走查脚本承载（jsdom 无布局引擎，登记降级面于 T3 §3）。
- **T3 走查对 T2 成品面的复验全 PASS**：条 1~15/23~28（含 DEF-039 热区修正，见 T3 §5）。

## T3 段 — 设置弹窗全屏化 + 断点走查 + 全局回归收口（REQ-050 + 收口）

### 1. 首步冒烟（计划风险③闭环）

既有 settings-form.spec 28 + settings.spec 15 用例在全屏容器形态下先跑：**43/43 全绿、零改写**。根因：全屏化为纯 CSS 带界媒体查询（`@media (max-width: 480px)`），jsdom 不应用媒体查询，`.settings-mask/.settings-modal/.sm-nav/.sm-pane/.modal` 类名与 DOM 形状零变化——「容器选择器耦合」候选风险证伪，登记于 SettingsMobileCssContract.spec「验收 4 容器兼容面」两用例机器背书。

### 2. REQ-050 实现（验收条款对照表）

| 验收 | 实现 | 机器背书 | 走查条 |
|---|---|---|---|
| 1. ≤480px 弹窗宽 100vw 高 100vh（DOM 断言） | `.settings-modal` 媒体查询内 `position:fixed; inset:0; width:100vw; height:100vh; max-width/height:none; border:none; radius:0; box-shadow:none; animation:none`（全屏无浮层投影） | SettingsMobileCssContract.spec「容器全屏」 | 条 16（rect 375×812@0,0 + radius 0 + shadow none 实测） |
| 2. 全屏态单滚动（无双重滚动） | 表单列 `.sm-pane` 唯一 `overflow-y:auto`（基线原样）；导航条 `overflow-y:hidden`（横滚为正交轴向）；弹窗根 `overflow:hidden` 基线 | spec「单滚动」 | 条 17（pane=auto/nav=hidden + 文档无横向溢出） |
| 3. 内容不横向溢出视口 | 控件 `min-width:0`/`box-sizing` 沿现状；导航横滚收纳六分区 | 同上 | 条 17（scrollWidth ≤ innerWidth） |
| 4. 既有 settings 全量用例全屏容器下全绿 | 逻辑零改动（登出/改密/校验/Esc 链零触碰） | settings-form 28 + SettingsMobileCssContract 12 全绿（§1 冒烟） | 条 19/19b |
| 5. >480px 弹窗 720px 零变化 | 媒体查询带界，桌面规则面零触碰（spec「桌面 720 零变化」断言 720/560/168/440 全属性在块外原样保留） | spec「桌面 720 分栏」 | 条 22（w=720/radius 12/nav 168/column 实测） |
| 6. 「前往高级设置」定位全屏态复验 | showPane 增加 `scrollIntoView({block/inline:'nearest'})`（纵列零滚动桌面零变化）+ **顺带修正 flash 丢失**（见 §6 决策 3） | spec「locateAdv 直达」三用例 | 条 21（分区直达 + flash + 导航滚动至目标钮可见，模式卡 .link-adv 真实路径） |

二级弹窗同口径（设计 §4）：SettingsForm 内嵌档案编辑/未保存确认 `.modal` + ConfirmModal + DeleteAccountModal 各自 `@media (max-width:480px)` 全屏化（100vw×100vh/radius 0；桌面 440/360/420px 基线块外保留）——走查条 20 实测 375×812 全屏 + Esc 先关最上层（外层保持，DEF-027 口径复验）。

### 3. 走查结果（scripts/e2e-walkthrough-20.mjs，真实 Chrome + 真实后端）

- **38 PASS / 0 FAIL**（另 2 条 N/A 交叉引用项不计：条 31 全局回归 = 本节 §4 机器数字；条 19b = vitest 411）。截图 10 帧：`/tmp/e2e20/shots/`（01 桌面 720 弹窗 ~ 09 生成后终态）。
- 覆盖 design-iter-20 §7.2 全部 31 条：A 抽屉态 1~9 / B 收窄态 10~15 / C 弹窗全屏 16~22 / D 触屏 23~28 / E 桌面零回退 29~31；四象限 = 768/480 双断点 × 亮暗双主题（抽屉开态/弹窗全屏态均各留浅暗截图）+ 触屏常显态。
- 服务形态：uvicorn 8814（/tmp 独立库 + 统一 key 进程环境注入）+ vite 5180；账号 walkthrough-mobile（首注册 admin）；回合内容全由真实事件流渲染（铁律 5）。

**几何断言口径（T2 登记的降级面全部真实 Chrome 承载）**：boundingRect 实值——抽屉 264/min(80vw,264)=256@320、顶条 48、入口钮 44×44、遮罩 rgba(31,35,41,.4)/rgba(0,0,0,.55)、弹窗 inset 0 = 375×812、二级弹窗同口径、发送钮 44/36、停止钮 44、热区外扩点 elementFromPoint 命中本体（DEF-039 修正后 hitTag=dd-trigger/action-btn）、正文列宽 = 视口 100%、气泡 92%、padding 12px。

**触屏仿真口径（实现级决策 4）**：`page.setViewport({isMobile:true, hasTouch:true})` 设备仿真 → Chrome 报告 `hover:none`（设计稿「设备仿真/视口调整」口径内）；实测本机 Chrome 的 CDP `Emulation.setEmulatedMedia` hover 特性已不生效（matchMedia 不翻转）——不硬凑，设备仿真承载并在此登记。

**文案逐字**：M44「打开会话列表」（aria-label/title，条 8）、M45「输入消息」（placeholder，条 15）、存量 hint/placeholder 桌面逐字（条 30，hint 为状态机文案——本环境 search 未配置命中 M41 合法保留态，条 14 口径 = 闲置「Enter 发送…」不渲染 + M40/M41/生成中保留）。

### 4. 全局回归收口（机器数字）

| 门槛 | 结果 |
|---|---|
| 后端 pytest（零改动复跑背书） | **347/347 passed**（collect 347；纯前端迭代零后端文件改动） |
| 前端 vitest | **411/411 passed**（399 存量零改写 + 12 新增 SettingsMobileCssContract） |
| guard:style | 通过（无令牌自引用、无未豁免裸色值——零新增令牌） |
| 生产构建 | 通过（vue-tsc -b + vite build，dist 产出正常） |
| 走查 | 38 PASS / 0 FAIL（§3） |
| 既有用例改写映射 | **为零**（计划唯一候选 = 设置弹窗容器耦合，spike 证伪——§1） |

### 5. 缺陷登记

- **DEF-039**（当轮发现当轮修复，plans/defects.md）：T2 触屏 44px 热区 `::after` inset 方向写反（`calc((44px - 100%)/2)` 正值向内收缩 → 实际 12×12/4×4），真实 Chrome hit-test 捕获；三处改 `calc((100% - 44px)/2)` + MobileCssContract.spec 契约同步 + 走查条 25a/25b 复验 PASS。桌面（hover:hover）零影响。
- 走查脚本首轮其余 FAIL 均为脚本断言问题（rail 键值 '1'/选择器 .item/hint 状态集/B 组空会话/puppeteer hover 白名单），零产品面，随脚本迭代闭合不逐条入 DEF。

### 6. 实现级决策登记（T3）

1. **导航横切落法**：`.sm-body` 断点内转 `flex-direction:column`，`.sm-nav` 转 row + `overflow-x:auto`（定夺⑤）；分区钮样式（36px 高/选中 primary-l）原样平移零变化，`role=tablist`/方向键切换沿现状（走查条 18 ArrowRight 实测）。
2. **全屏态入场动画**：`animation:none`（720px 浮层的 scale(0.98) 入场对全屏容器无意义；遮罩层 smask-in 保留 DOM 零逻辑改动）。
3. **locateAdv flash 丢失修正（存量缺陷顺手修复，REQ-050 验收 6 范围内）**：`watch(open,{immediate})` 在 setup 期 `showPane('adv')` 时 `watch(pane)` 尚未注册 → 挂载即开路径（App v-if + open+locateAdv 同帧）flash 高亮丢失——将 `watch(pane)` 注册移至 watch(open) 之前；vitest 新增断言（flash 出现）+ 走查条 21 复验。
4. **触屏仿真口径**：见 §3（设备仿真承载 hover:none）。
5. **二级弹窗全屏落点**：ConfirmModal/DeleteAccountModal/SettingsForm 内嵌 .modal 三处各自媒体查询（组件自治，不经全局样式渗透）——overlay `align-items:stretch` + modal 100vw×100vh/radius 0/`overflow-y:auto`（长表单纵向滚动）。

### 7. 台账交叉

- RTM：REQ-049/050/051 实现/验收列已收口 + 全局回归基线移动端面行（新计数 411/347 + 走查 PASS）。
- 周报：plans/weekly-W34.md iter-20 节（T1~T3）。
- 缺陷账：DEF-039。
