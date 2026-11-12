# r21 QA 报告：需求修订并入既有 run（merge-replan）

- 任务：t3「QA 与门禁」；上游 t1（宿主侧合并闸门）、t2（客户端表达）均已过门禁；下游 t4（补宿主投影字段）。
- 执行者：qa-t3（QA 测试工程师）；日期：2026-11-10。
- 写域：`test/**`、`lib/**`、本任务夹。**未改动 `src/**`**（缺陷只报不改，见 §4）。
- 结论：三段门禁全绿，新增 63 个用例（62 pass + 1 skip，skip 为已确认缺陷 D1 的待修用例）；发现缺陷 1 条（D1）、确认宿主投影缺口 2 处（t4 范围）；真机复验未做，留给队长（§6）。

## 1. 门禁证据

| 命令 | 退出码 | 证据尾部 |
|---|---|---|
| `pnpm typecheck` | **0** | `> tsc --noEmit`（无输出即通过） |
| `pnpm test` | **0** | `ℹ tests 1011 / pass 1010 / fail 0 / skipped 1 / duration_ms 6654.67` |
| `pnpm build` | **0** | `lib/client.js 533.76 kB │ gzip: 130.67 kB`；`lib/index.js 522.64 kB │ gzip: 174.92 kB`；两次 `✔ Build complete` |
| `node --input-type=module -e "await import('./lib/index.js')"` | **0** | 无输出 |
| `node --input-type=module -e "await import('./lib/client.js')"` | **0** | 无输出（`window.__ModuleLoader__` 守卫生效） |
| `npm pack --dry-run` | 0 | 含 `lib/index.js`（522.6kB）、`lib/client.js`（533.8kB）、`cordis.patch.yml`（646B） |

说明：`test` 基线在 AGENTS.md 里写的是 484 例，r17–r21 的其它测试已把它推到 1011 例；本次新增 63 例已全部计入。`lib/client.js`、`lib/index.js` 由本次 `pnpm build` 重建（`git status` 显示两者为 M）。

## 2. 新增用例清单（共 63 例）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/r21-revise-plan.test.ts` | 23（22 pass + 1 skip） | `revisePlan` 纯逻辑：goal 追加段、任务更新/追加/作废、指纹判重、校验拒绝、终态计划闸门、maxConcurrent 夹取、revisions 只增、输入不可变 |
| `test/r21-plan-tool.test.ts` | 13（13 pass） | `auto_team_plan` 工具面：created/revised/appended 三 mode、不传 revise 永不并入、activeRunId 提示、显式 runId/终态/别会话/不存在闸门、无 run 时退化新建、零写入判据 |
| `test/r21-bridge-revise.test.ts` | 10（10 pass） | `bridge.revise`：stopping 先落盘再中断、中断失败不假报、三种修订文案、通知成功/失败与账本、下游 blocked、全作废收口 terminated+finishedAt+termination、runs 目录逐字不变 |
| `test/r21-client-view.test.ts` | 17（17 pass） | 客户端纯函数：`planGoalOf` 切分与 mergedText、11 态成员徽标中文、`memberStatusTitleOf`、`memberCardChipOf`、历史 run 用时与宿主 `runDurationOf` 逐字一致、terminationText |
| `test/r21-harness.ts` | — | 真实 store/bridge 的共享夹具（**必须 `bridge.setEnabled` 开开关**，否则工具早退 NOT_ENABLED） |

## 3. AC → 可执行判定对照

| # | 验收点 | 判定（断言） | 结果 |
|---|---|---|---|
| AC-1 | 同会话重复 plan、不传 revise → 新建而非并入 | 第二次 plan `mode==='created'`、`runId` 与首次不同、盘上 run 数 2、首个 run 字节不变 | ✅ |
| AC-2 | created 时若已有在跑 run，返回 activeRunId 提示 | `activeRunId === 首个 runId`；`note` 命中 `/还有在跑的 run/` 与 `/revise=true/` | ✅ |
| AC-3 | `revise=true` 缺省并入最近的非终态 run | `runId` 不变、盘上 run 数仍 1、`autoDispatch` 的 runId 同一；更早的 terminated run 在场时仍挑 live run | ✅ |
| AC-4 | 显式 `revise` 指向终态 run → 拒绝且零写入 | `ok===false`、`code==='BAD_REQUEST'`、错误含 `已终止，不能再并入需求修订`、`snapshotRuns()` 前后 deepEqual、未触发 autoDispatch | ✅ |
| AC-5 | 新需求追加进 goal，保留原目标 | `goal` 命中 `/\n\n## 需求修订（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n/`，且以原 goal 开头；`revisions` 只增不删（seed 1 条 → 2 条） | ✅ |
| AC-6 | 三种返回 mode 可区分 | created / revised（有 goal 或更新作废）/ appended（仅追加任务）各有用例 | ✅ |
| AC-7 | 在跑成员收到直达消息（作废 / 已修订 / 未受影响） | 三 member 各 running：正文分别命中 3 种模板；账本 3 条成员消息 + 1 条 `captain→user` notice，且成员消息在前 | ✅ |
| AC-8 | 通知失败不吞证据 | 单 member `send→{ok:false}`：`notified` 2 人、`notifyFailed` 含 `{name,error}`、账本无该成员消息、notice 含 `修订通知失败` | ✅ |
| AC-9 | stopping 先落盘，再发中断；失败保持 stopping | interrupt 回调内 `store.load()` 已见 `{stopping:true}` 且任务 `cancelled`；失败后 binding 仍 `stopping:true`、快照 status `stopping`、notice 含 `成员停止失败` | ✅ |
| AC-10 | 停止成功 → retired + stoppedAt，不再通知 | binding `retired:true`、`stoppedAt:NOW`、`'stopping' in binding===false`；快照 status `stopped`、`canResume:true`；`sent` 为空 | ✅ |
| AC-11 | 下游转 blocked 且带等待原因 | `t2` → `blocked`、`waitingOn:['t1']`、`waitReason:'上游 t1 已在需求修订中作废'`；隔代 `t3` 保持 pending | ✅ |
| AC-12 | 最后一批任务全作废 → run 收口 terminated | `plan.status==='terminated'`、盘上 `finishedAt:NOW`、`termination={reason:'需求修订后本次运行已无待执行任务',kind:'superseded'}`；`store.list()` 的 `terminationReason` 同步 | ✅ |
| AC-13 | 终态任务不能被作废 | done/skipped/cancelled 作废 → BAD_REQUEST，runs 目录逐字不变 | ✅ |
| AC-14 | 客户端能看出「合并」 | `planGoalOf` 切出「原始目标」+「需求修订（时刻）」段、`mergedText==='已并入 run-9'`、`revisionCountText`/`latestRevisionText` 正确 | ✅ |
| AC-15 | 成员状态 11 态都有中文，stopping/stopped 不混淆 | 11 个 MemberStatus 的 `memberStatusBadge().text` 互不相同、无英文回显；stopping `停止中`、stopped `已停止`、waiting `等待写域` | ✅ |
| AC-16 | 旧 run 用时与宿主逐字一致（r18 遗留） | 客户端 `runSummaryRowOf` 与宿主 `runDurationOf` 在 5 种场景下 `{text,state}` deepEqual；缺 plannedAt 两边都 `不可得`，不拿 createdAt 顶上 | ✅ |
| AC-17 | 历史列表显示终止原因 | `terminationReason` 非空才写 `terminationText`，无原因时字段不存在 | ✅ |
| AC-18 | 工具面不扩张 | 仍是 8 个工具 | ✅ |

## 4. 缺陷

### D1（阻断 AC「终态任务拒绝被更新」，未修复，src 不在本任务写域）

- **症状**：`revisePlan` 允许把 `status:'done'`（以及 skipped/cancelled）的既有任务改标题/验收，改完状态仍是 `done`，于是「已验收的任务」内容被悄悄替换，而审计上仍显示已通过。实测：

  ```
  $ node --input-type=module -e "...revisePlan(planWithDoneTask, {tasks:[{id:'t1',...}]}, 2)"
  {"ok":true,"mode":"revised","updated":[{"id":"t1","title":"新目标",...,"status":"done","revisedAt":2,"revisionNote":"需求修订"}]}
  ```

- **根因**：`src/host/plan/plan.ts:217` 声明了 `const REVISION_FROZEN_STATUSES = new Set(['done','skipped','cancelled'])`，但全文件再无任何引用（`grep -n REVISION_FROZEN_STATUSES src/host/plan/plan.ts` 仅 1 条命中）；更新分支（约 `src/host/plan/plan.ts:427-462`）只校验 `title/roleId/acceptance`，没有检查 `existing.status`。而同文件 `plan.ts:279` 的注释明确承诺「终态任务拒绝被更新」——注释与实现不一致。
- **复验命令**：

  ```bash
  cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
  node --input-type=module -e "
  import { revisePlan } from './src/host/plan/plan.ts'
  const plan = { runId:'r', sessionId:'s', goal:'g', status:'running', createdAt:1, plannedAt:1, maxConcurrent:3,
    tasks:[{id:'t1',title:'旧目标',roleId:'dev',acceptance:'true',status:'done',dependsOn:[],writeScopes:[],createdAt:1}], revisions:[], bindings:[], messages:[] }
  const out = revisePlan(plan, { tasks:[{id:'t1',title:'新目标',roleId:'dev',acceptance:'exit 0'}] }, 2)
  console.log(JSON.stringify({ ok: out.ok, status: out.ok && out.plan.tasks[0].status }))
  "
  # 期望（修复后）：ok=false 且状态不变；实际：ok=true 且 status 仍 'done'（内容已被替换）
  ```

- **建议修改**（交 t4/宿主负责人）：更新分支命中 `REVISION_FROZEN_STATUSES.has(existing.status)` 时拒绝，错误文案建议 `任务 ${id} 已 ${existing.status}，不能再修订`；同时把已 skip 的用例 `test/r21-revise-plan.test.ts` ›「revisePlan：已完成任务不允许被更新（待 D1 修复）」取消 skip 即可拿到回归保护。

## 5. 未覆盖 / 待补（t4 范围，QA 不越界改 `src/host`）

1. **`MemberView` 缺 `stopping` / `stoppedAt`**（`src/shared/types.ts:326-354`）。当前快照只能给 `status`，面板无法显示「停止中已持续多久」「确认停止于何时」，也无法对 stopping 做超时提示。t3 的断言因此只钉 `status==='stopping'|'stopped'` 与 binding 层 `stopping/stoppedAt`，**未**覆盖视图字段（字段尚不存在）。
2. **`TaskDetailView` / `library.taskDetailOf` 缺 `revisedAt` / `revisionNote` / `cancelledAt` / `cancelReason`**。任务卡目前能从 `status` 看出「已取消」，但看不到「为什么被作废、修订说明是什么」；t2 已实测确认。t3 只在 plan/bridge 层验证这些字段已落盘，未覆盖视图投影（投影函数尚未输出）。
3. **`REVISION_FROZEN_STATUSES` 未生效**（D1）——修复后用现有 skip 用例回归，无需新写。
4. 未覆盖 `src/client/**` 的 React 组件渲染（`PlanPage`/任务卡/成员卡/历史列表）：本任务只测纯函数（无需 DOM），组件层断言留待真机或后续组件测试。

## 6. 未验证项（必须由队长真机复验）

以下均无法在 `node --test` 里证明，不能以「构建通过」代替：

1. **面板计划页 / run 头的「追加需求」段与「已并入 <runId>」标记真实渲染**（存在性、折叠、长文本换行、样式 token）。
2. **任务卡 / 成员卡的 `停止中`、`已停止`、`已取消`、`等待写域` 徽标**在真实面板宽度下不被截断、tone 颜色正确。
3. **真实宿主的 `interruptMember` 端口**：t3 用 fake interrupt/send 验证了「先落盘再中断」与失败分支；生产端 watcher 的停止对账（stopping → stopped）时序未验证。
4. **真实会话下 `auto_team_plan(revise:true)` 端到端**：工具调用 → bridge → autoDispatch → 面板刷新（含 `activeRunId` 提示文案）。
5. **旧 run 在历史列表的终止原因展示**（`terminationText` 的样式与截断）。
6. **client bundle 在宿主 HMR/刷新后生效**：需在真实宿主确认页签与新徽标出现（本项目历史上有「构建全绿、页签永不出现」的真机坑）。
7. 本报告 §4 的 D1 在修复前的真机表现（是否会出现「已通过」任务被替换）——建议修复后一并在真机复验。

## 7. 复验指引

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
pnpm typecheck && pnpm test && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
node --test test/r21-revise-plan.test.ts test/r21-plan-tool.test.ts \
          test/r21-bridge-revise.test.ts test/r21-client-view.test.ts
```

单独复跑 r21 四件套时也必须走仓库根（`test/r21-harness.ts` 以临时目录作 store 根，不依赖 cwd，但从归档目录跑 `pnpm` 会因找不到 package.json 假红）。
