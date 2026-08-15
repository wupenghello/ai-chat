# QA 审计报告 — ai-chat iter-6（2026-08-16，迭代关闭前审计）

审计对象：`projects/ai-chat`，iter-6 全迭代（CHG-004 需求变更全流程 + 计划/设计/开发/测试）。
审计基准：`process/`（v1.4.3 生效后首个完整迭代）+ 项目 `tailoring.md`。取证方式：文件读取 + `.git/refs/tags`、`.git/logs/HEAD` 只读快照。

## 结论：有条件符合（6 项不符合）

符合面（有证据支撑）：CHG-004 链路完整（暂缓池移出 → 澄清 8 项定案 → 影响评估逐项 → CEO 批准标记 → tag `req-baseline-v3`（=79ca168）存在 → spec/RTM/暂缓池同步）；迭代计划质量高（复杂度判定依据齐全、新栈拍脑袋值如实标注、排除项 8 条、风险 4 条、过渡态三处显式登记）；设计基线 `design-iter-6`（=777d22e）先于 UI 开发落 tag，7 项澄清全部定案固化；后端新栈满足 development.md §5（ruff=lint 等价物，已登记 tailoring）与 testing.md 服务端最低要求（`backend/Makefile` 的 `make check` = ruff + pytest；uv.lock 独立）；前端 117 条用例逐文件清点精确吻合、后端 36 条（17 auth + 16 sessions + 3 dev）吻合；iter-6 六个开发提交全部关联 REQ 编号；tailoring 项目类型扩展登记及时；iter-5 复盘遗留 useTheme 单测转 iter-7 已登记。

## 不符合项清单

| 编号 | 违反条款 | 证据 | 严重级 | 整改建议 | 状态 |
|------|---------|------|--------|---------|------|
| NCR-iter6-001 | 铁律 2 强制机制失效；development.md §7（v1.4.3 样式门禁进提交钩子）；G2 对新栈后端无覆盖 | `.claude/hooks/pre-commit-guard.sh` 第 36-38 行：`run_guard` 后无条件 `exit 0`，第 39-45 行 guard:style 拦截块为死代码从未执行；且钩子对 monorepo 只跑根目录 `npm test`（第 23-27 行），`backend/Makefile` 的 `make check` 从不进门禁——iter-6 含后端代码的提交实际只被前端测试把门 | 严重 | 组织级修复（company-os 侧）：删除提前 `exit 0`，package.json 与 Makefile 并存时两者都跑。审计员已等价复扫当前代码树（无被漏拦的实际违规），故定级严重而非致命 | 开放 |
| NCR-iter6-002 | design.md §2；铁律 1 | 实现与 design-iter-6 基线多处偏差且无变更登记。功能性：① §4.1/§1.2 的 401 闭环要求到达 `/login?redirect=…` 时显示 warning banner「登录已过期」——LoginView 仅在提交失败时设 banner，401 跳转到达不显示（main.ts hook 只 push 路由）；② §3 错误映射表「空值/用户名已占用=字段行内」——实现全走表单 banner；③ 定案 7「全部密码字段提供显隐」——确认密码字段无眼睛按钮。承诺机制：④ §6.1 触控口径 16px 输入字号（防 iOS 聚焦缩放，≤480px 承诺的实现机制）——实现 14px。视觉参数：⑤ 加载态「保持实底主色+spinner+登录中…」→ 灰底 disabled+「请稍候…」无 spinner；⑥ 规则 hint 常驻 → placeholder；⑦ 字段距/卡片内距/按钮尺寸字号字重/副标题/autofocus 偏差；⑧ §2.1 注「服务端密码上限 128 字符」后端未实现 | 严重 | 二选一并留痕：回基线修复（建议至少 ①②④⑤ 为必改——① 关系 REQ-006/020 验收路径、④ 关系 spec 兼容条款承诺）；其余按 design.md 登记变更（注明理由与 CEO 批准）后可保留 | 开放 |
| NCR-iter6-003 | testing.md §5（完整走查不允许抽查、每项留档）；项目 iter-1~5 惯例（iter-N-verify.md） | iter-6 新增 UI 无走查记录：plans/ 无 iter-6-verify.md；design-iter-6 §7.2 的 27 条清单无逐条打勾留痕。若走过完整走查，NCR-iter6-002 多项偏差应当被当场发现——推断未按 27 条对照执行 | 一般 | G4 前对照 design-iter-6 §7.2 完成 27 条完整走查（DOM 实测口径，含亮暗双态），产出 iter-6-verify.md；偏差逐条登记 | 开放 |
| NCR-iter6-004 | planning.md §3（v1.4.3：周报开发完成即产出）；development.md §3（Code Review 记录入周报、CEO 过目） | 开发完成提交 bcf4a03（2026-08-16 00:03）后周报未产出：plans/weekly-W33.md 无 iter-6 章节；iter-6 全量 Code Review 无记录。iter-5 复盘改进项 C 正是为杜绝此模式（iter-1/2/4 三次前科）——v1.4.3 首个迭代即复发 | 一般 | 立即产出 iter-6 周报（含测试汇总 117/36、技术债小节、Code Review 记录并请 CEO 过目落痕），作为 G4 前置 | 开放 |
| NCR-iter6-005 | requirements.md §4（迭代收尾时 RTM 必须与实际代码一致） | 基线 v3 改写后存量行未更新口径：REQ-014 行描述仍为旧口径、状态「已验证」——而 v3 正文验收已改为「浏览器检索不到任何 key」，当前代码 key 仍存 localStorage（已登记过渡态，iter-7 收口），该行状态对新验收标准不成立且无注记；REQ-007 行同理未注记新映射达成情况；REQ-001/002 的「代理架构下复验」无注记 | 一般 | G4 前更新存量行：状态改为「已验证（基线 v1 口径）→ v3 验收待 iter-7 复验」类明确口径，与过渡态登记对齐 | 开放 |
| NCR-iter6-006 | requirements.md §3；design.md §1；铁律 4 | CHG-004 影响评估（changes.md L35）明确「design/proto：需新增登录/注册/账号管理原型与管理后台原型」——实际 proto 全文无相关内容、无 CHG-004 注记；登录/注册原型改由 design-iter-6 承载，此偏离未登记理由；spec REQ-020「涉及页面」字段未同步 | 一般 | 补登记：changes.md CHG-004 下补记「proto 由 design-iter-6 承载；REQ-021/025 原型随 iter-8 设计」及理由，同步 spec 涉及页面字段 | 开放 |

## 观察项（不构成违规）

1. RTM 用例数分解笔误：REQ-020 行写「auth 8/LoginView 14/守卫 5」，实测 auth.spec 7 条、guard.spec 6 条；总数 27 与 117 口径吻合（逐文件清点 16 个 spec 文件共 117 条精确对上）。仅订正数字。
2. tailoring 版本行过期（v1.4.1 → 已按 v1.4.3 实践），建议随整改同步。
3. iter-5 QA 审计报告未归档（5 项 NCR 关闭证据散落可追溯，报告本体缺失），建议补档汇总表。
4. req-baseline-v3 tag 快照不含其后两项补记（monorepo 布局、设计定案 spec 口径）——补记在 changes.md 有记录且注明无需新 CHG，铁律 1 成立；建议下次基线变更时统一重打。
5. backend/README.md L15 陈旧（「sessions.py 当前为模块占位」——T3 已完整实现）。
6. /api/dev/sse-echo、/api/health 在生产容器同样挂载（需登录、echo 上限 20 块，风险低）；iter-7 部署收口时评估 dev 路由按环境裁剪。
7. 生产构建（vue-tsc）尚无 iter-6 留痕——G4 硬性条件，收尾时执行并记录。（已由主会话复核：✓ built，见下）
8. T1 提交粒度较粗（骨架+DB+auth 一个提交）；新栈建议后续拆细。

## 上一轮（iter-5）NCR 状态核对

NCR-iter5-001 → DEF-013 已修复（tokens v1.3.1）：**已关闭**。002 → company-os 提交 89b2e30：**已关闭**。003 → design/iter-5 §定案记录补齐：**已关闭**。004 → weekly-W33 双处落痕：**已关闭**。005 → RTM REQ-018 行注记在位：**已关闭**。iter-5 复盘遗留 useTheme 单测转 iter-7：已在 iter-6.md「本迭代不做」登记：**已登记**。

## 主会话运行时复核（2026-08-16 补录）

- `npm test`：16 文件 **117/117 通过**
- `cd backend && make check`：ruff clean + **36/36 通过**
- `npm run guard:style`：**通过**（无令牌自引用、无未豁免裸色值）
- `npm run build`：vue-tsc + vite **✓ built in 575ms**
- `git status`：工作区干净（仅 data/ 卷目录未跟踪，已在 .gitignore）

## 关闭记录（整改登记，2026-08-16）

CEO 处置决定：6 项全部整改（2026-08-16 AskUserQuestion 确认：001 整改 / 002 功能修复+视觉登记 / 003~006 全部整改）。

| 编号 | 关闭证据 |
|------|---------|
| NCR-iter6-001 | company-os 提交 a6b0114（钩子重写：死代码删除、前后端门禁并存、BSD sed 修复）；负向用例 exit 2 拦截实测、正向（ai-chat 全绿）exit 0 |
| NCR-iter6-002 | 项目仓库提交（本次整改）：①~⑤⑧ 回基线 + 用例（前端 120/120）；⑥⑦ 登记 changes.md CHG-004 澄清定案 10（CEO 批准接受） |
| NCR-iter6-003 | plans/iter-6-verify.md：27 条逐项 DOM 实测留档（26 过 + 1 占位登记）；走查驱动修复 5xx 重试缺口 |
| NCR-iter6-004 | weekly-W33.md iter-6 章节 + Code Review iter-6 全量记录（CEO 过目落痕随复盘确认补记） |
| NCR-iter6-005 | rtm.md REQ-001/002/007/014 v3 过渡态注记 + REQ-020 用例数订正 |
| NCR-iter6-006 | changes.md CHG-004 澄清定案 9（proto 承载偏离 + 理由）；spec REQ-020 涉及页面字段同步 |

观察项处置：1 订正（rtm）；2 tailoring 版本行 v1.4.3；3 retros/qa-audit-iter-5-summary.md 补档；4 下次基线变更统一重打 tag（登记）；5 backend README 已更；6 登记 iter-7 技术债；7 已复核（✓ built，weekly 留痕）；8 复盘跟踪提交粒度。

整改后全量门禁复核（2026-08-16）：前端 vitest 120/120（16 文件）、后端 pytest 37/37 + ruff clean、guard:style 通过、vue-tsc && vite build 通过、工作区干净。**6 NCR 全部整改完毕，待复盘（G4）确认关闭。**
