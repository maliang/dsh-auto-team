# r16 验收报告 — 改代码自动组队 / 左栏可达 / 角色列与任务编号

验收：产品经理（验收负责）｜日期：2026-11-04｜分支 `feat/auto-team-plugin`，基线 `fe4e807`（本轮改动未提交）

## 1. 结论与独立复核

实现完整、门禁全绿、架构与蓝图一致，未发现功能性代码缺陷。但本需求两个 P0 的最终判据都是真机行为：**「开关打开后队长对改代码任务自动 plan→dispatch」在真机上一次也没有被观测到**，左栏 AC-8 也未在用户宿主 54058 上验证。按 PRD AC-22 的规则，这些项只能如实标「未验证」，不能算通过。故本次为**有条件通过**：代码可交付，真机证据与收口提交补齐后再转通过。

我独立复跑（不依赖 QA/dev 自述）：

| 项 | 结果 |
|---|---|
| `pnpm -s typecheck` | exit 0 |
| `pnpm -s test` | **756/756 pass**（≥706） |
| `node test/r16-mutation-probes.mjs` | **7/7**（每条原样绿→单点变异红） |
| 产物新鲜度 | `find src -newer lib/index.js` = 0、client = 0 |
| 双 import | `IMPORT_INDEX_OK` / `IMPORT_CLIENT_OK` |
| `npm pack --dry-run` | `lib/index.js` 453.9kB、`lib/client.js` 433.9kB、`cordis.patch.yml` 646B |
| 依赖/形状 | `dependencies {}`、无 `workspace:`；QA counts 14/14、imports 726 个 0 缺失 |
| 工作树 | 38 项（27 M + 11 ??，含 `lib/` 双产物与 r16/r15 文档）；`AGENTS.md` 未改；memory 为同主题替换 |
| 视觉抽检 | `r16-tasks.png` / `r16-after-glyph-click.png`：80 环、01/02/03 列、t1–t4、角色卡 chip；点击后主区项目库单 surface，无遮挡/溢出 |

## 2. 逐条验收

| AC | 结论 | 证据与说明 |
|---|---|---|
| AC-1 | ✅ 通过 | 契约探针 A1–A4：三工具 + `enabled`、算/不算路径清单、必要句齐全、无会话级断言、段落 1556 字符 ≤2600；三个工具描述同步；变异 [AC-1] 红 |
| AC-2 | ⏳ 未验证 | 需真实队长模型会话；54058 需登录 cookie（QA 侧 401），profile 安装只有主 agent 可做。已按 AC-22 记录阻塞原因，无 mock |
| AC-3 | ⏳ 未验证 | 同上（OFF 对照组 3/3 无法驱动） |
| AC-4 | ⏳ 未验证 | 同上（纯问答轮） |
| AC-5 | ⏳ 未验证 | 同上（明确叫停轮） |
| AC-6 | ✅ 通过 | B1–B3：已派发返回 `ok/accepted/dispatching/alreadyDispatched`，零 `act`、零 `autoDispatch`；连调两次成员/binding/任务状态不增；缺 runId/未启用仍拒绝；变异 [AC-6] 红 |
| AC-7 | ✅ 通过 | B4：autoDispatch 永不 resolve 时 <500ms 返回；`test/dispatch-nonblocking.test.ts` 保留；受理分支无 `await spawn` |
| AC-8 | ⚠️ 部分 | 51890 默认宽度 3/3、可见 surface 恰 1、`data-last-open-result=main`、`pointer-events=auto`；**54058 与 56px 收起态未执行** |
| AC-9 | ⚠️ 部分 | 单测 watchdog 端到端 + 静态 C13（逐字提示、main 可见守卫、唯一内联容器、不双开）；真机实际降级路径未构造（未用 CSS 隐藏伪造） |
| AC-10 | ⚠️ 部分 | 根因链成立：`src/client/styles.ts:3148` 的 `pointer-events:none` 掐断原生 click → `PanellistEntry` 内联 `pointerEvents:'auto'` + onClick 调 `openLibrary` → `src/client/LibraryPage.tsx:625` 回写真实 surface；但 AC-10 要求的侧栏宽度/main 注册结果/mainArea 可用性/构建·旧 scope 四项探针值未逐项记录，54058 未验证 |
| AC-11 | ✅ 通过 | 真机 80×80、`stroke-width 8`、文本 3/4、dash 213.628/offset 53.4071（=C/4）；`scrollWidth=clientWidth=623`；999/999 不截断、0/0 无 NaN；变异 [AC-11] 红 |
| AC-12 | ✅ 通过 | 真机 3 列 `01/02/03` + 角色名 + `×2/×1/×1`（和=4）、节点按 `roleId` 落列；零任务角色不出列；变异 [AC-12a]/[AC-12b] 红 |
| AC-13 | ✅ 通过 | 节点首行 `tN`=task id、标题可读、状态胶囊；角色名仅在列头 `[data-flow-stage-name]`；单测 `test/r16-flow-canvas.test.ts:255` 锁主标签 |
| AC-14 | ✅ 通过 | 真机 2 条列间箭头（首条实线 + solid marker，次条虚线 4px,3px + dashed marker）、3 条任务边、图例区分实/虚 |
| AC-15 | ✅ 通过 | 100px 拖动→100px、重置→0、4px 阈值、列头可拖；50 节点 60 帧 avg 16.67ms / p95 16.8ms |
| AC-16 | ✅ 通过 | 真机 3 张卡 chip 集合/顺序 = 计划顺序（architecture t1,t2；testing t3；implementation t4）；变异 [AC-16] 红 |
| AC-17 | ⚠️ 部分 | chip 文本严格 `tN`、title/aria 含「t1 · 已通过」、done `rgb(34,197,94)` ≠ running `rgb(65,118,230)`、5 tone 单源；**浅/深色两主题截图未提供** |
| AC-18 | ⚠️ 部分 | C14：两 surface 同 `RoleGrid` + 同 `buildRunDetail`，纯函数派生；**320px 面板与抽屉的逐字深比较未执行** |
| AC-19 | ✅ 通过 | 仅新增 2 类可选字段 `RoleUsageView.taskRefs?`、`FlowNodeView.roleId?`；页签 3 / PanelAction 21 / 路由 4 / RejectionCode 13 / kind 9 / TaskStatus 13 / 工具 8 / `setInterval` 1 不变；旧 v3 夹具回退 |
| AC-20 | ✅ 通过 | 第 1 节全部门禁：typecheck 0、756/756、双产物新鲜、双 import、pack 3 件、无新增依赖、`.gitignore` 结论在 QA 报告 |
| AC-21 | ⚠️ 部分 | 7/7 原绿变异红，但清单与 PRD 指定的 7 条不完全一致：缺 AC-7（回退 await spawn）与 AC-13（主标签回角色名）单列探针，环变异改 radius 28 而非 CSS 64px；对应断言由单测兜底（P3） |
| AC-22 | ⚠️ 部分 | 51890 真机 CDP 23/23（profile 克隆 + `file:` 安装一致）；AC-2~5 与 AC-8 54058/收起态未验证并给阻塞原因，无 mock——合「如实标注」，但证据不完整 |
| AC-23 | ✅ 通过 | 100 run 冷 1.48ms / 热 0.00ms（同一对象不重算）；50 节点 p95 16.8ms |
| AC-24 | ⚠️ 待收口 | 文档齐、memory 同主题替换（r13 ⑤ 左栏 glyph 兜底）+ 新增 r16 自动组队行、`AGENTS.md` 未动、无宿主 `docs/<role>/`；**单笔提交与 `git clean` 未执行**（38 项未提交），commit hash 缺失 |

## 3. 架构一致性（M3 必查）

- 蓝图 14 个模块/接口点落地，未重建第二套：`RoleTaskRef`/`taskRefs?`/`roleId?`（`src/shared/types.ts:491`）；宿主投影（`src/host/library.ts:311`、`:361`）；客户端同源（`src/client/viewmodel.ts:1718`）；角色列单点派生 `flowLayoutOf`（`FlowCanvas.tsx:26`，组件不读 `node.column`）；surface 判定单源 `visibleLibrarySurface`（`slots.ts:622` 被 `Panel.tsx:147/160`、`LibraryPage.tsx:625` 共用，无第二份 querySelector）；幂等确认只在工具层（`src/host/tools.ts:91`），未改 bridge 的 admission 语义；零新依赖、零新路由、双端 taskRefs 由 deepEqual 锁死。
- 偏差 3 条均为 P3、不动结构：死选择器 `[data-flow-dot]`（QA-1）、`FLOW_STAGE_HEIGHT` 未接线且 CSS 硬编码 32px（QA-2，双断言仍在）、变异探针清单与 AC-21 有差（QA-3）。**无需架构返工**。

## 4. 遗留与关闭条件

**阻塞（转「通过」前必须完成）**

1. **AC-2/3/4/5 真机**：主 agent 在 54058 安装当前构建，跑 ON 改代码 3 轮、OFF 3 轮、纯问答 1 轮、明确叫停 1 轮；记录 session id/日志/时间戳，判据按 PRD。这是本需求的核心承诺，目前唯一未证项。
2. **AC-8 / AC-10 54058**：宽态与 56px rail 各点 3 次，断言 `data-last-open-result ∈ main|event|error`、可见 surface ≤1；补齐侧栏宽度、main 注册、mainArea 可用性、构建/旧 scope 四项探针值，或按差异清单在 54058 复跑。
3. **AC-9 真机**：实际降级路径点一次（主区不可用 → 右栏内联 + 逐字「主区不可用，已在右栏打开」+ 不双开）。
4. **AC-17 / AC-18**：浅/深色截图各一张；320px 面板与抽屉的 chip 文本、`data-task-id`、status、tone、title/aria 深比较。
5. **AC-24 收口**：单笔提交（`src/`、`test/`、`lib/` 双产物、本任务夹、r15 `meta.json`），`git status` clean，报告回填 commit hash 与 756 门禁数。

**非阻塞（P3，可顺手修）**：QA-1 删 `[data-flow-dot]` 死规则；QA-2 让 CSS 引用 `FLOW_STAGE_HEIGHT` 或删常量并保留双断言；QA-3 补 AC-7/AC-13 两条探针，使清单与 AC-21 逐条对齐。

## 5. 验收意见

交付物在代码层完整、可测、可回滚：双产物新鲜、756 测试、双端派生同源、左栏单 surface 协议与幂等派发都有独立探针与变异保护；架构蓝图落地无分叉，未发现重复实现或 adapter 漂移。问题不在实现，而在**证据边界**：两个 P0 的最终判据都是真机行为，本轮只在 51890 上验证了 UI 与点击路径，54058 与真实队长会话因凭据/安装边界无法由 QA 子代理执行。按 PRD AC-22，未验证被如实记录、未用 mock 冒充——这应保留为明确的人工补测，不应在验收报告里改写成通过。

验收结论：⚠️ 有条件通过
