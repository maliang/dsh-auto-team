# 技术方案 · 成员名撞名：确定性序号消歧（r3）

> 基线依赖：`docs/teamflow/20261031-r2/`
> 取代：`docs/teamflow/20261031-r2#AC-4`（撞名 → 写 `MEMBER_NAME_COLLISION` 停派、任务留 pending）
> 目标：撞名从「报错停派」改为「确定性追加 `-2`/`-3` 序号后**继续派发**」，只换名字不停任务；每次真消歧恰好一条 notice。
> 改动面：3 个源文件（`team/dispatch.ts`、`bridge.ts`、`index.ts`）+ 1 个单测文件 + 2 个探针脚本。**无持久化变更**。

## 0. 架构判断（先结论）

| # | 判断 | 依据 |
|---|---|---|
| 1 | 消歧必须是**纯函数 + 循环前一次性分配**，不能边派边算 | 现在 `dispatchReady` 已在循环前算 `memberNameCollisions`（`src/host/team/dispatch.ts:264-268`），并把「循环前算完」写进注释：边派边算会让「谁先被派」决定谁撞名，恢复后顺序变化 → 重绑翻倍。消歧只能继承这个性质。 |
| 2 | 名字总长预算不能动，只能动**可读段** | `memberNameFor` 产出的名字恰好 48 = 可读段 41 + `-` + 6 位哈希（`NAME_BUDGET = HOST_MEMBER_NAME_MAX - HASH_LEN - 1`，`dispatch.ts:109`）。尾部再拼 `-2` 直接越界 → 症状从「重名」变成「名字非法」、任务照样不动。哈希段是 AC-3 确定性的地基，**逐字保留**。 |
| 3 | 「占用」= 全计划任务的本名 ∪ 未退役 binding 名 ∪ 宿主现存成员名 | 只挡计划内重名挡不住 R2-1 的真实症状；只挡 binding 名挡不住「无 binding 的同名成员」。三者取并集，宁可多跳一个号。 |
| 4 | 消歧结果**不进持久化**，每轮重算 | `RunState` / `RUN_STATE_VERSION` / `MemberBinding` 一个字都不改。重新派发只要占用集合一致，名字就一致（确定性），这才是 AC-3「恢复不翻倍」的实现方式；落盘反而会引入迁移与版本升级。 |
| 5 | notice 走 `DispatchResult.renamed` → `DispatchOutcome.renamed` → `notices` 的既有管道 | `bridge` 已有 `notices` 机制（`src/host/bridge.ts` 的 `act('dispatch')`），工具与面板已经原样透出（`tools.ts`、`client/viewmodel.ts` 零改动）。新增字段是唯一需要穿透的两层投影：`bridge.DispatchOutcome` 与 `index.ts` 的 `dispatch` 端口——**漏掉后者，notice 永远到不了面板**。 |
| 6 | 旧符号 `memberNameCollisions` / `NameCollision` 删除 | 其语义（撞名 = 错误）正是本次被取代的契约，留着会诱导下一次改动回退。已 grep 确认全仓零引用（除 `dispatch.ts:264-268` 自身调用），`test/` 与归档探针均不 import。 |

## 1. 数据模型与存储

### 1.1 新增运行时类型（不落盘）

`src/host/team/dispatch.ts` 内定义并导出（不放进 `src/shared/types.ts`：shared 只放跨 host/client 的形状，这个是宿主内部编排细节）：

```ts
/** 一次派发中「名字被占用 → 改用带序号名」的记录，供 bridge 转成面板 notice（AC-5）。 */
export interface RenameRecord {
  taskId: string
  /** 本名：memberNameFor(task) 的结果，即未消歧时该任务的确定性名。 */
  base: string
  /** 本次实际使用的名字（= base 或 base 的可读段压缩 + 序号）。 */
  final: string
}

/** 单个任务的名字分配结果。 */
export interface NameAssignment {
  taskId: string
  base: string
  final: string
  /** 0 = 用本名；2..99 = 追加的序号；null = 序号空间耗尽（不可派发，走 MEMBER_NAME_COLLISION 兜底）。 */
  suffix: number | null
  /** true = 该名字来自本任务既有的未退役 binding（沿用，不递增，也不产生 notice）。 */
  reused: boolean
}
```

`src/host/bridge.ts` 的 `DispatchOutcome` **用结构化内联类型、不 import dispatch.ts 的类型**（与现状 `DispatchOutcome` 完全自持的风格一致，也让 T2 可以与 T1 并行开发，不产生类型依赖）：

```ts
export interface DispatchOutcome {
  started: string[]
  skipped: Array<{ taskId: string; reason: string }>
  errors: Array<{ taskId: string; error: string; code?: RejectionCode }>
  /** 本轮因名字被占用而改名的任务；缺省/空数组 = 没有改名（AC-5）。 */
  renamed?: Array<{ taskId: string; base: string; final: string }>
}
```

### 1.2 持久化

**零变更**。`RunState`、`RUN_STATE_VERSION`、`MemberBinding`、`runs/*.json` 都不动；`RejectionCode` 里的 `'MEMBER_NAME_COLLISION'` **保留**（降级为「序号空间耗尽」这一兜底路径的可观测码，语义不变：只作 `errors[].code` 与 `ActResult.rejected.code`）。因此无需迁移、老 run 文件照旧可读。

### 1.3 名字预算（不变式）

| 量 | 值 | 位置 |
|---|---|---|
| `HOST_MEMBER_NAME_MAX` | 48 | `src/host/config.ts:81` |
| `HASH_LEN` | 6 | `dispatch.ts:101` |
| `NAME_BUDGET` | 41（= 48 − 6 − 1） | `dispatch.ts:109` |
| `NAME_SUFFIX_MAX`（新增） | 99 | `dispatch.ts` |
| 带 `-99` 时新的可读段预算 | 38（= 48 − 6 − 1 − 3） | 由 `withNameSuffix` 现算 |

不变式：**任何最终名 `length ≤ 48` 且匹配 `HOST_MEMBER_NAME`（`config.ts:78`），且 6 位身份哈希在最终名中逐字出现**。

## 2. API 设计（宿主内部纯函数，无 HTTP 路由变更）

HTTP/工具层零新增：`GET/POST /api/auto-team` 的动作集合、`auto_team_*` 工具的参数与返回形状都不变，只是 `notices` 数组里多了消歧提示。

### 2.1 `withNameSuffix(base, suffix): string`（新增，纯函数）

```ts
export function withNameSuffix(base: string, suffix: number): string
```

- `suffix` 非正整数 → 原样返回 `base`（防呆）。
- 直接拼 `base + "-" + suffix`，长度 ≤ 48 就返回（**绝大多数情况，零改动**）。
- 超 48 时按 `/-([a-z0-9]{6})$/` 从 `base` 切出哈希段：
  `budget = 48 - 6 - 1 - tail.length`，只截可读段 `readable.slice(0, budget)` 再去尾 `-`；可读段为空则用 `'member'`；返回 `${trimmed || 'member'}-${hash}${tail}`。
- 切不出哈希段（测试注入的桩名，如 `dev-dup`）→ 退化为 `base.slice(0, 48 - tail.length)` 去尾 `-`。
- 已知边界：注入桩名自身必须合法（不含 `--`、不以 `-` 结尾）；真实路径的 `memberNameFor` 由 `slugify` 保证。

### 2.2 `allocateMemberNames(tasks, options): Map<string, NameAssignment>`（新增，纯函数）

```ts
export interface AllocateOptions {
  /** 取名端口，缺省 memberNameFor（测试注入桩用）。 */
  nameOf?: (task: PlanTask) => string
  /** 未退役 binding：{ taskId, name }。同 taskId 的项视为「沿用」。 */
  reserved?: Array<{ taskId: string; name: string }>
  /** 宿主现存成员名（含没有 binding 的同名成员）；不可得时传 []。 */
  hostNames?: string[]
  /** 序号上限，缺省 NAME_SUFFIX_MAX(99)；仅在穷尽性测试里调小。 */
  maxSuffix?: number
}

export function allocateMemberNames(
  tasks: PlanTask[],
  options: AllocateOptions = {},
): Map<string, NameAssignment>
```

算法（**一次算完，与派发循环无关，不写任何状态**）：

1. `base[taskId] = nameOf(task)`，按 `tasks` 顺序；同 taskId 重复出现只算一次（防御）。
2. `taken`：未退役 binding 名 ∪ `hostNames`。
3. `byBase`：`base 名 → taskId[]`（用于「不抢他人本名」）。
4. 逐任务（稳定顺序）：
   - 本任务有未退役 binding → `{ final: binding.name, suffix: 0, reused: true }`，**不再消耗候选**（该名已在 `taken` 里）。
   - 否则候选序列 = `base`、`withNameSuffix(base, 2..maxSuffix)`；候选可用 ⇔
     `!taken.has(C) && (C === base || byBase.get(C) 中不存在 ≠ 本任务 的 taskId)`。
     第二个条件是 AC-4：「A 的 `-2` 候选等于 B 的本名」必须跳过，除非候选就是自己的本名（同 base 的多任务由 `taken` 顺序裁决）。
   - 命中则 `taken.add(C)`、记 `suffix`；全部候选被占 → `{ final: base, suffix: null }`（不可派发）。
5. 返回 `Map`（按 `Map` 迭代顺序即稳定顺序，便于断言）。

确定性与幂等性由「输入集合相同 → 输出相同」保证：无时间、无随机、无状态读取。

### 2.3 `dispatchReady` 契约变更（`src/host/team/dispatch.ts`）

```ts
export interface DispatchResult {
  state: RunState
  started: string[]
  skipped: Array<{ taskId: string; reason: RejectionCode | 'ALREADY_RUNNING' }>
  errors: Array<{ taskId: string; error: string; code?: RejectionCode }>
  /** 新增：本轮真消歧的任务（AC-5）。 */
  renamed: RenameRecord[]
}
```

- 4 处 `return`（`:221` NO_PLAN、`:250` ready 空、`:255` CONCURRENCY_FULL、`:418` 正常结束）补 `renamed`（前三处为 `renamed: []` 或已收集的数组）。
- 循环前（替换 `:262-268`）：

```ts
const nameOf = deps.memberNameFor ?? memberNameFor
const reserved = next.bindings
  .filter((binding) => binding.retired !== true)
  .map((binding) => ({ taskId: binding.taskId, name: binding.name }))
// 宿主名单不可得（listMembers 抛错）时只能依赖计划名 + binding 名，与既有 liveness 同样的保守策略。
const hostNames = members === null ? [] : members.map((member) => member.name)
const names = allocateMemberNames(next.plan.tasks, { nameOf, reserved, hostNames })
const renamed: RenameRecord[] = []
```

- 步 d（替换 `:342-355`）：不再「撞名即停派」，改为查分配结果：

```ts
const assignment = names.get(taskId)
if (!assignment || assignment.suffix === null) {
  errors.push({
    taskId,
    code: 'MEMBER_NAME_COLLISION',
    error: `成员名冲突：${assignment?.base ?? nameOf(task)} 的序号候选（-2…-${NAME_SUFFIX_MAX}）全部被占用；本次不派发（请修改任务 id 或角色）`,
  })
  continue
}
const name = assignment.final
```

- 步 e 内 `started.push(taskId)` 之后追加 notice 收集：

```ts
const reusedName = next.bindings.some((b) => b.taskId === taskId && b.name === name)
if (assignment.suffix !== null && assignment.suffix > 0 && !reusedName) {
  renamed.push({ taskId, base: assignment.base, final: name })
}
```

  两个抑制条件都必须存在：`suffix > 0`（本名不算消歧）与 `!reusedName`（沿用它自己带序号的老 binding → 重建/重试不重复 notice，AC-5）。
- 删除 `memberNameCollisions` 与 `NameCollision`（`dispatch.ts:167-196`）。
- `DispatchDeps.memberNameFor` 的注释从「验证会报 MEMBER_NAME_COLLISION 而不是 spawn（AC-4）」改为「验证消歧序号（AC-4/AC-7）」。

### 2.4 `bridge.act('dispatch')` 的 notice（`src/host/bridge.ts`）

在 `errors` 循环之后、`notices.unshift('已创建 N 个成员…')` 之前追加：

```ts
for (const rename of outcome.renamed ?? []) {
  const title = state.plan.tasks.find((task) => task.id === rename.taskId)?.title
  notices.push(
    `任务「${title ?? rename.taskId}」(${rename.taskId}) 的成员名 ${rename.base} 已被占用，已改用 ${rename.final} 派发`,
  )
}
```

notice 文案含 taskId、原候选名、最终名（AC-5 三要素）。顺序：`已创建 N 个成员…`（unshift 在最前）→ 消歧提示 → 跳过/失败。`state` 是派发前的快照，标题查找用它即可（派发不会改 title）。

### 2.5 `index.ts` 端口投影（易漏点）

`src/host/index.ts:110-125` 的 `dispatch` 端口必须补一行 `renamed: result.renamed`，否则 `bridge` 拿不到改名记录、面板永远安静——这是本次唯一「编译通过但功能静默失效」的位置。

## 3. 前端组件与页面拆分

**零改动**。`notices: string[]` 的渲染链路已存在：

| 层 | 位置 | 本次改动 |
|---|---|---|
| 工具返回 | `src/host/tools.ts` 各 handler 的 `notices: result.notices` | 无 |
| HTTP 面板 | `bridge.act()` 返回的 `ActResult.notices` | 无（数据源多一条字符串） |
| 客户端视图 | `src/client/viewmodel.ts:378-414` 读 `payload.notices` | 无 |

因此 AC-5 完全靠「宿主侧把 notice 塞进既有数组」实现，不新增组件、不新增页面、不新增样式（也就不碰宿主 token 与 `font:` 简写那条铁律）。

## 4. 状态管理

- 名字分配是**每轮派发重算的派生态**，不进入 `RunState`，不进客户端 store，不进 `PanelSnapshot`。
- 面板可见状态变化只有两处，均由既有机制承载：任务状态 `pending → running`；成员列表新增一条。改名本身不产生新状态字段（这正是「只换名字不停任务」在数据层面的含义）。
- 客户端无状态机改动：`PanelAction.dispatch` 的请求/响应形状不变。

## 5. 关键实现点与边界（逐条对应 AC）

| 边界 | 处理 | AC |
|---|---|---|
| E1 自己占着自己 | 同 taskId 的 `reserved` 项 → `reused: true`，直接用 binding 名、不递增；重试/恢复名字恒定 | AC-3② |
| E2 不抢他人本名 | 候选可用性第二条件：候选是别的任务的 base 就跳过（除非候选 = 自己的 base） | AC-4 |
| E3 48 上限 | 只压可读段；哈希段逐字保留；`-99` 时可读段预算 38；空可读段退 `member` | AC-2 |
| E4 顺序敏感 | 循环前一次算完，与 `ready` 顺序无关；`ready` 变化不影响已分配名字 | AC-3① |
| E5 宿主名单不可得 | `members === null` → `hostNames = []`，仍有 binding 名 + 计划名兜底，不阻断派发 | AC-1 |
| E6 退役 binding | 不在 `reserved` 里 → 名字可复用（成员已死，同名重建是正确行为） | AC-3③ |
| E7 多任务同名 | 稳定顺序 → `base`、`base-2`、`base-3` | AC-1/AC-7 |
| E8 序号耗尽 | `-2…-99` 全占 → `suffix: null` → 一条 `MEMBER_NAME_COLLISION`（可观测、不静默）；任务落 errors，不是 pending 黑洞 | AC-6 |
| E9 notice 抑制 | 仅 `suffix > 0` 且非沿用旧名时入 `renamed`；同轮多次派发不重复 | AC-3/AC-5 |
| E10 失败侧无 notice | `renamed` 只在 `spawn` 成功后 push；角色缺失/模型不可解析/spawn 失败都不产生 | AC-5/AC-6 |
| E11 并发耗尽 | `CONCURRENCY_FULL` 的 skipped 不写名字、不写 binding、不改 status（分配本身不落状态） | AC-6 |
| E12 计划内重复 taskId | 分配阶段去重，不让同一任务吃掉两个号 | 防御 |

另外两处**必须留意但不必改**的相邻逻辑：

- 步 b（`:295-331`）在循环内把死 binding 标记 retired，但 `reserved` 已在循环前快照。分配阶段把「同 taskId 的 reserved」判为 `reused`，所以「退役后同名重建」两条路径结果一致，不会出现 `-2` 变 `-3`。
- `resumeRun` 只按 `binding.name` / `memberId` 找成员，不重新取名 → 消歧后的名字被 binding 记住，恢复期不参与分配。

## 6. 测试策略

### 6.1 单测（`test/dispatch.test.ts`，现状 155 例全绿 → 目标 ≥ 160）

**改写**（旧契约两条，`test/dispatch.test.ts:508`、`:539`）：

| 位置 | 旧断言 | 新断言 |
|---|---|---|
| `:508` 注入取名端口撞名 | `started=[]`、spawned 0、errors 2、两条 pending、bindings 0 | `spawned` 名字 `['dev-dup','dev-dup-2']`、`started.length=2`、`errors=[]`、两条 `running`、`renamed.length=1`（第二条） |
| `:539` 与未退役 binding 同名 | errors 1、任务仍 pending | spawned `['dev-dup-2']`、`errors=[]`、任务 `running`、既有 binding `name/retired` 不变 |

**新增（≥ 7 例）**：

1. `withNameSuffix` 纯函数：短名直接拼、48 边界（`memberNameFor(超长中文 id)` + `-2` → `length ≤ 48`、`HOST_MEMBER_NAME.test`、`includes(hash)`）、`-99` 预算、空可读段退 `member`。
2. `allocateMemberNames` 确定性：同一输入连调两次 `deepEqual`；顺序不同（交换任务顺序）时**同名集合不变**（仅归属可能不同）。
3. AC-4 不抢本名：`nameOf: t1→'dev', t2→'dev-2'`，且 t1 的 base 被占（再多一个任务 `t0→'dev'` 已完成占名）→ t1 得 `'dev-3'`（跳过 `'dev-2'`）、t2 保 `'dev-2'`。
4. 三任务恒同名 → `base`、`base-2`、`base-3`，顺序与 `plan.tasks` 一致。
5. 真实算法：两个中文 id 任务都 `started`、名字两两唯一且均 ≤ 48（AC-10 不塌缩的派发侧对照）。
6. 重试不重复 notice：连续两次 `dispatchReady`，第二次 `renamed` 为空、名字不递增、`bindings.length` 不变。
7. 成员死亡后重建：把成员从 `listMembers` 摘掉再派 → 仍用 `-2`（不递增到 `-3`），且 `renamed` 为空。
8. 穷尽性：`maxSuffix: 2` + 3 个恒同名任务 → 至少一条 `MEMBER_NAME_COLLISION`，且每个 ready 任务都落在 `started ∪ skipped ∪ errors` 里（无静默 pending）。

### 6.2 探针（真实链路，`logs/teamflow/tf-mvvok3wc-x0sezk/scripts/`）

归档源：`/Users/maliang/.dsh/teamflow/ws-dsh-auto-team-20702aa5/logs/tf-mvvjakqn-xhhc7s/scripts/`。**这是同一个共享 scripts 目录的延续，缺覆盖就原地扩展，不重建。**

| 脚本 | 动作 | 判据 |
|---|---|---|
| `qa-collision-probe.mjs` | 复制过来，保留 C1~C5 语义，**新增 C6/C7** | C6：注入恒同名桩 → `started` 两条、spawn 到的名字为 `base`/`base-2`、`errors` 空、`renamed.length === 1`；C7：未退役 binding 占名 → 新任务以 `-2` 派发、`errors` 空、既有 binding 不动。**项数 ≥ 7、全 PASS、exit 0**（AC-8） |
| `qa-review-probe.mjs` | 复制过来，**翻转 R6** | R6 旧断言（`MEMBER_NAME_COLLISION` + 不 spawn + 留 pending）在旧契约下才成立，新契约下必然变红；改为「以 `-2` 派发、`errors` 空、任务 `running`、ghost binding 名称未变」。其余项（R1~R5）逐字不动 |
| `qa-reverify-probe.mjs` | **不动** | 9/9 项数不变；若某项因新契约变红，说明真回归，**不许放宽断言**（AC-10） |

探针共用的 spawn 桩（`qa-collision-probe.mjs` 里的 `taken: Set` 模拟宿主 `TEAM_MEMBER_EXISTS`）在新契约下不能误当判据：消歧由**分配阶段**保证，桩只需要「重名就拒绝」这一既有行为即可。

### 6.3 全量门禁（AC-9，交付前逐条实跑并贴输出）

```bash
pnpm typecheck                                  # 0 error
pnpm test                                       # ≥160 全绿（现状 155）
pnpm build                                      # lib/index.js + lib/client.js
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run                              # 含 lib/index.js、lib/client.js、cordis.patch.yml
node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-collision-probe.mjs        # ≥7 项 PASS, exit 0
node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-review-probe.mjs           # 全 PASS, exit 0
node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-reverify-probe.mjs         # 9/9 PASS, exit 0
```

## 7. 任务拆分（3 路并行 → 1 路收口）

文件边界不相交即并行；T2 因采用结构化内联类型、不 import T1 的新类型，可与 T1 真并行。

| 任务 | 文件（owns） | 只读 | 交付判据 |
|---|---|---|---|
| **T1 消歧算法 + 单测** | `src/host/team/dispatch.ts`、`test/dispatch.test.ts` | `src/host/config.ts`、`src/shared/types.ts`、`src/host/store.ts` | `withNameSuffix` / `allocateMemberNames` / `NAME_SUFFIX_MAX` / `NameAssignment` / `RenameRecord` 按 §2.1-2.3 落地；`DispatchResult.renamed` 四处 return 齐全；删除 `memberNameCollisions`；单测按 §6.1 改写 2 例 + 新增 ≥7 例，`node --test test/dispatch.test.ts` 全绿且总数 ≥160 |
| **T2 装配与 notice** | `src/host/bridge.ts`、`src/host/index.ts` | `src/host/team/dispatch.ts`（只读契约）、`src/host/tools.ts`、`src/client/viewmodel.ts` | `DispatchOutcome.renamed?` + `act('dispatch')` push 文案（含 taskId/原候选名/最终名）+ `index.ts` 投影 `renamed: result.renamed`；`pnpm typecheck` 该文件 0 错 |
| **T3 探针更新** | `logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-collision-probe.mjs`、`.../qa-review-probe.mjs` | `src/host/team/dispatch.ts`、归档源脚本 | C1~C5 + C6/C7（≥7 项）PASS、exit 0；R6 翻转；`qa-reverify-probe.mjs` 不改 |
| **T4 交付自查 + 门禁 + 入库（串行在 T1~T3 之后）** | `lib/index.js`、`lib/client.js`（构建产物）；其余源码仅当 T1~T3 收工后可代改修 | 全部 | §6.3 八条命令逐条实跑贴输出；`grep -n 'lib/' .gitignore` 复核 `lib/` 未被忽略；`git status --porcelain -uall` 确认只含预期文件；**在 `feat/auto-team-plugin` 原地单笔提交**（`git commit -m "feat: 成员名撞名改为确定性 -2/-3 序号消歧并继续派发（r3）"`），commit 后不再改任何文件 |

**git 约束（PRD 工程约束，逐字继承到任务里，不得丢）**：

1. 分支：原地 `feat/auto-team-plugin`，**不新建分支**。
2. **单笔提交**：源码 + 单测 + `lib/` 构建产物 + 本任务夹文档一次提交；T4 提交后禁止再动文件。
3. `lib/` 必须入库，`.gitignore` 不忽略 `lib/`（T4 复核）。
4. 所有产物只写 `docs/teamflow/20261031-r3-collision-name-suffix/`、`logs/teamflow/tf-mvvok3wc-x0sezk/` 与产品源码；不写宿主 `docs/<role>/`，不在项目根散落日志。

## 8. 验收对照（AC → 实现 → 验证）

| AC | 实现点 | 验证 |
|---|---|---|
| AC-1 撞名即消歧并继续派发 | §2.2 分配 + §2.3 步 d | 单测 1/2/4；探针 C4/C6 |
| AC-2 ≤48 且合法、只压可读段 | `withNameSuffix` | 单测 1（48 边界 + 正则 + 哈希包含） |
| AC-3 确定性/不递增/恢复不翻倍 | 循环前一次分配 + `reused` | 单测 2/6/7 |
| AC-4 不抢他人本名 | 候选可用性第二条件 | 单测 3；探针 C7 |
| AC-5 每次消歧恰好一条 notice | `renamed` + bridge 文案 + 抑制条件 | 单测 1 号案例断言 `renamed.length`；探针 C6 |
| AC-6 无静默 pending | `suffix: null` → `errors`；并发/角色路径不变 | 单测 8 |
| AC-7 单测改写 + ≥155 全绿 | §6.1 | `pnpm test` 输出贴进 QA-REPORT |
| AC-8 探针 ≥7 项不弱化 | §6.2 | 探针实跑输出 |
| AC-9 全量门禁 | §6.3 | 八条命令输出 |
| AC-10 不回归 R2 | 正常路径零改动；reverify 不碰 | `qa-reverify-probe.mjs` 9/9 |
| AC-11 QA/ACCEPTANCE 产出 | QA 阶段负责 | 本夹文件齐全 |
