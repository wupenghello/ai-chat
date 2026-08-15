# QA 审计报告 — ai-chat iter-4（2026-08-15，归档）

审计人：QA 审计员（AI 员工，独立于项目开发，向 CEO 汇报）
审计范围：iter-4 全流程产物（req-baseline-v2 + CHG-002/003 + DEF-011 + REQ-015/016/019）至迭代末尾
审计基准：process/ v1.3.3 + tailoring.md + 铁律 5 条

## 结论：有条件符合（5 项 NCR + 5 观察项 + 6 项 git 类主会话补证）

核心代码实现与 design/iter-4 一致；REQ-015/016/019 均有真实测试证据。但 G4 关闭前置件存在硬缺口（周报含 Code Review、视觉走查），另有 DEF-011 记录失真、proto 未同步等问题。**G4 当时不可关闭**——以下 NCR 已于同日全部整改（见 weekly-W33.md 处置表）。

## 不符合项（均已整改，2026-08-15）

| 编号 | 严重度 | 问题 | 整改 |
|------|--------|------|------|
| NCR-iter4-001 | 高 | 周报无 iter-4 章节 + Code Review 缺失 | weekly-W33.md 补 iter-4 章节 + 全量 Code Review（重点 CHG-003 数据层：branches 深拷贝无引用环、toggleVersion 定位无歧义、generation 纪元防竞态、搜索高亮文本插值防注入），CEO 过目确认 |
| NCR-iter4-002 | 中 | 视觉走查记录缺失（无 iter-4-verify.md） | 补 plans/iter-4-verify.md（28 条，DOM 实测 + 单测，含偏差登记） |
| NCR-iter4-003 | 低 | RTM REQ-019 设计列标「待同步」但设计稿已同步 | 改「已同步」；RTM 头测试数 76→79 一并修正 |
| NCR-iter4-004 | 中 | DEF-011 处置记录失真（描述被 CHG-003 推翻的两行结构中间态） | 追加 CHG-003 覆盖说明，中间态 DOM 数据标注作废、关联 CHG-003 |
| NCR-iter4-005 | 中 | design/proto 未同步 CHG-003（原型维度重演 NCR-002 教训） | proto 输入区同步单排顶对齐 + 保留范围理由写入头部；CHG-003 影响评估补 proto 评估（含整改补记） |

## 观察项及处置

1. 测试总数口径（RTM 头 76 vs 实际 79）→ 已修正 RTM 头为 79/79（npm test 复核通过）。
2. REQ-015 测试数标注口径（复制用例归属）→ 实质覆盖充足，口径留复盘讨论。
3. spec.md 头「最后更新」未反映 CHG-002/003 → 已修正为 CHG-001/002/003。
4. 令牌命名漂移（design-system 用 --c-danger、实现用 --c-error，值同为 #D93025）→ iter-1 沿用至今非本迭代引入，转复盘评估统一。
5. 搜索框样式与设计稿偏差（#F2F3F5 底/透明描边 vs surface+border+focus 光晕）→ 已对齐实现（TheSidebar.vue），iter-4-verify.md 第 25 条按整改后口径。

## 主会话补证结果（git 类，2026-08-15 核验）

| 项 | 结论 |
|----|------|
| G1 design-iter-4 tag 先于 T2/T3 开发提交 | ✓（tag=fa42cfc，先于 d638658/28a2fed；T1 DEF-011 不依赖新设计稿，先于 tag 属计划内并行） |
| G2 tag 后设计稿增量提交已登记变更 | ✓（226d217 单笔，CHG-003 变更记录承载） |
| G3 提交关联 REQ/DEF 编号 | ✓（11 个提交全部含 REQ/DEF/CHG 编号） |
| G4 生产构建通过 | ✓（vue-tsc -b + vite build，CHG-003 最终态） |
| G5 测试 79/79 | ✓（npm test 复核） |
| G6 提交时序无事后补文档嫌疑 | ✓（CHG-003 代码先于文档同步提交，周报整改按 NCR 流程补录并留痕） |
