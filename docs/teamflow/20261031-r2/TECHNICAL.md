# 技术方案 · R2-1 成员名塌缩修复（20261031-r2）

- 基线：`docs/teamflow/20261030-r1-auto-team-plugin`（本方案**取代**其 AC-17 的成员名形态：名字形态变了，恢复语义不变）
- 分支：`feat/auto-team-plugin`（原地修改，不切分支/不 rebase）
- 结论一句话：把 `memberNameFor` 从「纯归一化」改成「**先编码身份段（roleId+taskId 的确定性短哈希）再归一化**」，并在 `dispatchReady` 派发前对全计划任务名做**两两唯一断言**（撞名 → `errors` + 新码 `MEMBER_NAME_COLLISION`、不 spawn、不留 pending），配套单测 ≥4 例与三支独立探针；peer 声明与技能正文运行期探针同轮补齐。

## 1. 缺陷根因（已核代码）

| 断点 | 位置 | 现状 | 后果 |
|---|---|---|---|
| 名字算法抹掉身份 | `src/host/team/dispatch.ts:103` `memberNameFor(task: PlanTask): string` | 只做 `toLowerCase()` + `[^a-z0-9]+ → '-'` + 去首尾 `-` + `slice(0, HOST_MEMBER_NAME_MAX)` | `dev/登录流程` 与 `dev/注册接口` 都归一成 `dev`；`dev/Login_Flow` 与 `dev/login-flow` 都成 `dev-login-flow` |
| 名字唯一取值点 | `src/host/team/dispatch.ts:245` `const name = memberNameFor(task)` | 无任何唯一性校验 | 同角色第二、第三个就绪任务被宿主重名拒绝 → 任务永久 `pending` |
| 宿主不兜底去重 | `src/host/config.ts:78` `HOST_MEMBER_NAME`、`:81` `HOST_MEMBER_NAME_MAX = 48` | 只校验字符集与长度，**不去重** | 重名失败表现为 `TEAM_MEMBER_EXISTS`，被吞成静默 pending |
| 测试只测「单个合法」 | `test/dispatch.test.ts:374/393/420` | 只断言「一个名字合法」，并把旧形态 `dev-t1` 写死 | 「合法 ≠ 唯一」这一检测面缺失（上一轮漏检根因） |

## 2. 数据模型与存储

**不改存储版本**：`RunState` v2（`version/plan/plannedAt/messages/bindings/routeAudits`）与 `runs/<runId>.json` 布局完全不变，`RUN_STATE_VERSION` 不变。

语义变化只有一处，且**不新增字段**：

| 字段 | 变化 | 说明 |
|---|---|---|
| `bindings[].name` | 值域形态变化（`dev-t1` → `dev-t1-4f2k9a`） | 仍然只是「显示名 + 宿主检索键」；恢复、审计、消息路由**一律按 `binding.taskId`**，不解析名字格式 |
| `bindings[].taskId` / `.roleId` / `.memberId` | 不变 | 恢复幂等仍以 `taskId` + `memberId` 判定 |
| `DispatchResult.errors[]` | 新增可出现的 `code: 'MEMBER_NAME_COLLISION'` | 只活在内存结果与 `ActResult.notices`，**不落盘**（与现有 errors 一致，不污染 RunState） |

新增类型（`src/shared/types.ts`，仅扩联合类型）：

```ts
export type RejectionCode =
  | 'NOT_ENABLED' | 'NO_PLAN' | 'PLAN_ALREADY_DISPATCHED' | 'ROLE_UNAVAILABLE'
  | 'MODEL_UNRESOLVABLE' | 'ROUTE_DRIFT' | 'CONCURRENCY_FULL' | 'NOT_FOUND'
  | 'NO_CALLER' | 'BAD_REQUEST'
  | 'MEMBER_NAME_COLLISION'          // ← 本轮新增：成员名冲突，拒绝派发
```

`bridge.ts` 无需改逻辑：`act('dispatch')` 在「无 started + errors 非空 + 无 skipped」分支里已 `reject(first.code ?? 'BAD_REQUEST', first.error)`，errors 的 code 直接透传；notices 已逐条渲染 `<taskId> 失败：<error>`。扩联合类型即可让面板 `rejected.code` 与断言同时拿到新码。

## 3. 关键契约：成员名算法（`src/host/team/dispatch.ts`）

设计取舍（对齐 PRD 的三处建议）：**可读段 ≤20 字/段 + 6 位短哈希，总长恰为 48 上限**；哈希覆盖完整原始 `roleId\0taskId`，**截断永不裁哈希**。

```ts
const READABLE_MAX = 20          // 每段可读字符上限
const HASH_LEN = 6               // 短哈希位数
const NAME_BUDGET = HOST_MEMBER_NAME_MAX - HASH_LEN - 1   // 48 - 6 - 1 = 41

/** 归一化：只用于「可读段」，不承担身份编码。 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, READABLE_MAX)
    .replace(/-+$/g, '')
}

/** FNV-1a 32 位 → base36 取末 6 位。纯算术，跨进程/跨平台确定。 */
export function shortIdentityHash(raw: string, len = HASH_LEN): string {
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(len, '0').slice(-len)
}

/** 成员名 = 可读段(role)-(task)-<身份短哈希>；签名与原实现一致，调用方全部零改动。 */
export function memberNameFor(task: PlanTask): string {
  const hash = shortIdentityHash(`${task.roleId}\u0000${task.id}`)
  const head = [slugify(task.roleId), slugify(task.id)].filter((part) => part !== '').join('-')
  const base = head === '' ? 'member' : head
  const trimmed = base.length > NAME_BUDGET ? base.slice(0, NAME_BUDGET).replace(/-+$/g, '') : base
  return `${trimmed === '' ? 'member' : trimmed}-${hash}`
}
```

边界表（`HOST_MEMBER_NAME` 为 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，上限 48）：

| 输入 (roleId / id) | 输出 | 长度 |
|---|---|---|
| `dev` / `t1` | `dev-t1-x7k2m4` | 13 |
| `dev` / `登录流程`、`dev` / `注册接口` | `dev-<h1>`、`dev-<h2>`（必须不同） | 10 |
| `dev` / `Login_Flow`、`dev` / `login-flow` | `dev-login-flow-<h1>`、`dev-login-flow-<h2>`（必须不同） | 20 |
| `dev` / 40 个 `x` | 可读段截到 20 → `dev-xxxxxxxxxxxxxxxxxxxx-<h>` | 33 |
| `r`×40 / `x`×40 | 20 + 1 + 20 + 1 + 6 | **48（上限）** |
| `###` / `###` | `member-<h>`（旧行为是裸 `member`，见 §7） | 13 |

为什么不是「先归一化再补哈希」：`roleId` 与 `id` 各自独立先编码，才不会出现「两个中文 id 归一后同为空、再拼同一段」的塌缩；哈希的输入是**原始字符串**，与可读段是否被截断无关，因此两个 40 字长 id 只要原始不同名字就必不同（反面目标 ③ 的正面覆盖）。
为什么不用自增序号消歧：序号取决于派发顺序 / 列表位置，恢复后顺序可能变，重绑会翻倍（反面目标 ②）。
代价（如实记录）：纯中文 id 的可读段必然为空，名字形如 `dev-4k2m9a`，肉眼认不出是哪个任务 —— 该问题由**面板/消息里始终带任务标题与 taskId** 承担（`bridge` 的 capsule 与 `messages` 均含 `taskId`/`title`），不靠名字自解释；这也是宿主字符集（`[a-z0-9-]`）下的唯一可行解，禁止为「好看」而放弃可核验的身份段。

## 4. 唯一性断言与错误契约

```ts
export interface NameCollision { name: string; taskIds: string[] }

/** 全计划任务名 + 未退役 binding 名 做两两比对；只在 ≥2 个不同 taskId 共享同一 name 时判冲突。 */
export function memberNameCollisions(
  tasks: PlanTask[],
  options: { nameOf?: (task: PlanTask) => string; reserved?: Array<{ taskId: string; name: string }> } = {},
): NameCollision[]
```

`dispatchReady` 内：

```ts
// DispatchDeps 新增一个可选注入口（默认即 memberNameFor，生产装配无需改）
memberNameFor?: (task: PlanTask) => string

const nameOf = deps.memberNameFor ?? memberNameFor
const reserved = next.bindings
  .filter((binding) => binding.retired !== true)
  .map((binding) => ({ taskId: binding.taskId, name: binding.name }))
const collisions = memberNameCollisions(next.plan.tasks, { nameOf, reserved })
const collisionOf = (taskId: string) => collisions.find((item) => item.taskIds.includes(taskId))

// 逐个任务的 spawn 前（位于「角色/模型预校验」之后、「buildPrompt」之前）
const name = nameOf(task)
const collision = collisionOf(taskId)
if (collision) {
  errors.push({
    taskId,
    code: 'MEMBER_NAME_COLLISION',
    error: `成员名冲突：${collision.name} 同时属于任务 ${collision.taskIds.join('、')}；本次不派发（请修改任务 id 或角色，系统不会自动改名）`,
  })
  continue            // 不 spawn、不写 binding、不改 status → 任务保持 pending，但错误可见
}
```

硬约束（AC-4）：

1. **派发前**算一次（不是边派边算），保证「先到先得」这种顺序依赖不存在。
2. 冲突任务**不进入 `running`**、不写 binding、不调 `spawn`。
3. 每条冲突 error 必含**冲突名**与**全部冲突任务 id**（可核验、可定位）。
4. 已退役 binding 的名字不参与保留集（退役 = 该名字可回收）。
5. 自身 live binding 的同名不算冲突（同一个 taskId 去重），因此「幂等续跑」路径完全不受影响。
6. 生产路径下默认算法不该产生冲突 —— 断言是**兜底层**；只有注入 `deps.memberNameFor` 的测试才会触发，从而证明「兜底真的会停派」。

## 5. API 设计（无新增路由，仅错误码语义扩展）

三路由保持不变：`GET /api/auto-team?op=snapshot`、`GET ?op=memory`、`POST /api/auto-team`（`{sessionId, action}`）。7 个 `auto_team_*` 工具不变。

| 接口 | 参数 | 返回 | 本轮差异 |
|---|---|---|---|
| `POST /api/auto-team` `action.type='dispatch'` | `{ type:'dispatch', runId? }` | `Result<ActResult>`；`data.notices[]` 逐条 `<taskId> 失败：…`；若「无 started + 有 errors + 无 skipped」则 `data.rejected = { code:'MEMBER_NAME_COLLISION', message }` | 新增该拒绝码；`data.snapshot` 不变（冲突任务仍显示 pending + 计划校验失败提示） |
| `action.type='resume'` | `{ type:'resume', runId? }` | 不变 | 重绑仍按 `binding.taskId`，与名字形态无关 |
| `GET ?op=snapshot` | `sessionId` | `PanelSnapshot`（capsule/任务/成员/消息/审计） | 不变；成员名以新形态出现在 `members[].name` 与消息 `to` |
| 工具 `auto_team_dispatch` | `{ runId? }` | 与 HTTP 同一 `bridge.act` | 同上，共用一条实现（避免「工具能、面板不能」） |

面板消费约定不变：组件只读 `snapshot`，`rejected`/`notices` 由既有提示条渲染（`src/client/api.ts` 解一次 `{data,error}` 包）。

## 6. 前端组件与页面拆分（无新增组件）

本轮**不新增页面/组件**，只有三处显示值的语义扩展，均在既有边界内：

| 现有组件/模块 | 位置 | 本轮变更 |
|---|---|---|
| 活动面板成员列 / 任务胶囊 | `src/client/viewmodel.ts` + 既有面板组件 | 成员名出现 `dev-t1-x7k2m4` 形态（宽度自适应、不截断成 `dev`）；任务标题与 taskId 已并列展示，承担可读性 |
| 提示条 | 传输层 `rejected`/`notices` | 冲突时显示 `任务 t2 失败：成员名冲突：dev-… 同时属于任务 t1、t2；本次不派发…` |
| 记忆页 / 角色页 | 既有 | 不变 |

状态管理：`PanelSnapshot` 结构与轮询（前端 2s `/ snapshot`）不变；无新增全局状态，无新增 store，未引入任何 client→host import（`src/shared` ← 单向）。

## 7. 关键实现点与边界

1. **恢复幂等不受影响**：`liveBinding`/`resumeRun`/`applyReceipt` 全部按 `taskId`（必要时 `memberId`）匹配，`bindings[].name` 只是显示值 → AC-3 的「确定性」由「纯函数 + 原始串哈希」保证：同 `(roleId,id)` 任何进程任何时刻同值。
2. **不做名字格式解析**：任何代码都不得用正则从 `name` 反推 taskId（否则形态一变就崩）。审计写入用 `taskId`。
3. **截断规则**：只裁可读段，`NAME_BUDGET = 41 = 48-6-1`，裁完二次去尾 `-`，哈希永远保留 6 位；`NAME_MAX` 引用 `HOST_MEMBER_NAME_MAX` 字面量（`src/host/config.ts` 注释要求实现与测试同源），禁止硬编码 48。
4. **空段兜底**：两段都归一为空时用 `member` 前缀，保证 `^[a-z0-9]+(-[a-z0-9]+)*$` 恒成立（不能出现 `-xxxxxx` 这种以 `-` 开头的名字）。
5. **大小写与分隔符**：`Login_Flow` 与 `login-flow` 可读段相同、哈希不同 → 满足 AC-1 的同时不让「只是大小写差异的 id」看起来像同一个任务。
6. **哈希稳定性**：FNV-1a 用 `charCodeAt` + `Math.imul`，无 locale、无 `Intl`、无 `crypto` 依赖（不许换成随机/时间相关的实现）。
7. **旧断言按新契约更新（不放宽）**：
   - `test/dispatch.test.ts:420` `memberNameFor(t1/dev) === 'dev-t1'` → 改为「`startsWith('dev-t1-')` + 长度/字符集 + 与 `memberNameFor` 同输入恒等」；
   - `test/dispatch.test.ts:393-397` `makeTask('###',{roleId:'###'}) === 'member'` → 改为 `^member-[0-9a-z]{6}$`；长 id 断言保留「长度 ≤ 48 + 满足 `HOST_MEMBER_NAME` + 与另一个长 id 不同」；
   - `test/dispatch.test.ts:194` `spawned[0].name === 'dev-t2'` → 改为 `=== memberNameFor(makeTask('t2'))`（仍验证「重建沿用确定性名字」）；
   - `test/wire.test.ts:278/303` 与 `:325`（listener 夹具名）→ 一律改为从 `h.spawned[0]?.name` 取值派生，不再写死。
8. **技能正文探针需要真值入口**：`buildPrompt` 原本是 `src/host/index.ts:90` 内 `apply()` 闭包，探针 import 不到 → 把函数体抽到纯模块 `src/host/team/member-prompt.ts`，`index.ts` 只保留一行委托：

```ts
// src/host/team/member-prompt.ts
export interface MemberPromptDeps { memoryFor(goal: string): { text: string; truncated: boolean } }
export function buildMemberPrompt(input: PromptInput, deps: MemberPromptDeps): string

// src/host/index.ts（apply 内）
function buildPrompt(input: PromptInput): string {
  return buildMemberPrompt(input, { memoryFor: (goal) => bridge.memoryFor(goal) })
}
```

   抽取后 `index.ts` 里 `composeSkillPrompt` 与 `describeRoute` 的 import 可能变成未使用，必须一并删除（`strict` 下虽不报 unused，但 lint 语义与可读性要求）。
9. **peer 声明**（AC-8）：`package.json` 的 `peerDependencies` 补 7 个 `dsh.client.inject` 包，版本一律 `"*"`（profile 实测只查到 `@deepseek-ai/cosmokit 1.8.6`、`schemastery 3.18.5`，7 个 `dsh-client-*` 无版本可查，写死范围会变成假事实），并在 `peerDependenciesMeta` 里逐个 `{ "optional": true }`；`dependencies` 保持不存在或为空（断言按 `dependencies ?? {}` 处理）；`react ^18.2.0` 与其 optional 保留。
10. **提交纪律**：`feat/auto-team-plugin` 原地、单笔提交（代码 + `lib/` 双产物 + `docs/teamflow/20261031-r2/`），提交后不再动文件；`.gitignore` 追加 `*.tgz`、`pnpm-debug.log*`，不得忽略 `lib/`。

## 8. 测试策略

### 8.1 单测（`node --test test/*.test.ts`，基线 146，目标 ≥150）

| 用例 | 文件 | 断言要点 |
|---|---|---|
| 中文 id ×2 唯一 | `test/dispatch.test.ts` | `dev/登录流程` vs `dev/注册接口`：两名字不等、均不 `=== 'dev'`、均满足 `HOST_MEMBER_NAME` 且 ≤48 |
| 大小写/分隔符 ×2 | 同上 | `Login_Flow` vs `login-flow`、`t1` vs `T1` 两两不等且可读段相同（证明哈希在起作用） |
| N=5 两两唯一 | 同上 | 同角色 5 个任务 id（混合中文/拉丁/长 id）→ `new Set(names).size === 5`，且都满足字符集 |
| 48 边界 + 合法性 + 确定性 | 同上 | `r×40 / x×40` → 长度 `=== HOST_MEMBER_NAME_MAX`、匹配 `HOST_MEMBER_NAME`、末 6 位为该身份哈希；同输入两次调用恒等 |
| 撞名不 spawn（计划内） | 同上 | `deps.memberNameFor = () => 'dev-dup'` + 两个就绪任务 → `started=[]`、`spawned.length===0`、`errors.length===2` 且 `code==='MEMBER_NAME_COLLISION'`、两个任务仍 `pending`、`bindings.length===0` |
| 撞名不 spawn（与既有 binding 同名） | 同上 | 计划内 `t2` 与未退役 binding（`t1`）同名 → `t2` 报冲突、`t1` 不受影响 |
| 技能正文进 prompt | `test/member-prompt.test.ts`（新） | 内置 `dev`（`skillIds=['implementation','testing']`）→ prompt 含两段技能正文特征句 |
| 无技能角色不含 | 同上 | `skillIds=[]` 的自建角色 → prompt 不含该特征句 |
| 记忆截断提示 | 同上 | `memoryFor` 返回 `truncated:true` → prompt 含截断提示行 |

（用例数 146 + 6 + 3 = 155，满足 AC-5 的 ≥150；旧断言更新不算新增，不得靠删用例凑数。）

### 8.2 探针（项数守恒是关键）

| 探针 | 位置 | 要求 |
|---|---|---|
| 碰撞探针 | `logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs`（从上一轮归档复制，路径深度相同） | **5/5（C1~C5）**，项数不变；C5 的 `one !== 'dev'` 继续成立 |
| 复验探针 | 同目录 `qa-reverify-probe.mjs` | **9/9 且项数不变**；仅把硬编码旧名 `dev-t1`（`:188/:189/:204`）换成 `spawned.at(-1)?.name` 派生值，不增删任何 check |
| 技能正文探针（新，独立文件） | 同目录 `qa-skill-prompt-probe.mjs` | **2/2**：真实 `createBridge` + 真实 `dispatchReady`（`buildPrompt` 走 `buildMemberPrompt`）+ 真实 `spawn` 捕获 prompt；① 内置 `dev` 的 prompt 含技能正文特征句；② 对照角色（`skillIds: []`）不含该句 |
| peer 声明校验（新） | 同目录 `check-peer-decls.mjs` | 7 个 inject 包全在 `peerDependencies`、`peerDependenciesMeta[p].optional === true`、`dependencies` 内 `@deepseek-ai/*` 为 0 |

技能正文探针骨架（要点，非全文）：

```js
const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir: join(dir, 'skills'), now: () => NOW })
roles.seed()
const spawned = []
const bridge = createBridge({
  store, roles,
  memoryRoots: { publicDir: join(dir, 'mem-public'), projectDir: join(dir, 'mem-project') },
  dataRoot: join(dir, 'data'),
  dispatch: (state) => dispatchReady(state, {
    store, roles, listMembers: async () => [],
    spawn: async (input) => { spawned.push(input); return { ok: true, memberId: `m-${input.name}` } },
    buildPrompt: (input) => buildMemberPrompt(input, { memoryFor: () => ({ text: '', truncated: false }) }),
    now: () => NOW,
  }),
  resume: async () => ({ started: [], skipped: [], errors: [] }),
  applyReceipt: async () => ({ ok: false }),
  sendMessage: async () => ({ ok: true }),
  gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
  hostConcurrency: () => ({ limit: 8, source: 'host' }),
  now: () => NOW,
})
await bridge.act('S', { type: 'toggle', enabled: true })
store.save(planState)                       // 计划已落盘，act('dispatch') 只需 runId 匹配
await bridge.act('S', { type: 'dispatch', runId: 'run-skill' })
// ① 含技能正文；② 换 roleId='plain'（skillIds: []）重跑，断言不含
```

两项必须**互相可区分**：把 `composeSkillPrompt` 去掉 → ① 红；把技能对所有人注入 → ② 红。

### 8.3 全量门禁（AC-11，提交前全绿）

```bash
pnpm -s typecheck                                   # 0 错
pnpm -s test 2>&1 | grep -E 'ℹ (tests|pass|fail)'    # tests ≥150 / fail 0
pnpm -s build && ls -l lib/index.js lib/client.js    # 双产物 mtime 晚于 src
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs
node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-reverify-probe.mjs
node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-skill-prompt-probe.mjs
node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/check-peer-decls.mjs
```

## 9. 任务拆分（按文件边界，可并行）

依赖图：`T1 → T4`、`T1,T2 → T5`、`T1..T5 → T6`；`T2`/`T3` 与 `T1` 无文件交集，可并行。

| 任务 | 产权文件（MODIFY） | 只读 | 内容与验收 |
|---|---|---|---|
| **T1 名字契约 + 唯一断言** | `src/host/team/dispatch.ts`、`src/shared/types.ts` | `src/host/config.ts`、`src/host/store.ts` | 按 §3 实现 `slugify/shortIdentityHash/memberNameFor/memberNameCollisions`；`DispatchDeps.memberNameFor?`；§4 的派发前断言；`RejectionCode` 加 `MEMBER_NAME_COLLISION`。自检：`pnpm -s typecheck` |
| **T2 技能正文 prompt 抽取** | `src/host/team/member-prompt.ts`（新）、`src/host/index.ts`、`test/member-prompt.test.ts`（新） | `src/host/team/dispatch.ts`（`PromptInput`）、`src/host/roles/builtin.ts`、`src/host/bridge.ts`（`describeRoute`）、`test/dispatch.test.ts` | `buildMemberPrompt(input, deps)` 逐行搬运原闭包语义（角色/职责/模型路由/本次任务/验收判定/团队记忆含截断提示/技能）；`index.ts` 改为一行委托并删未用 import；3 个单测（§8.1）。自检：`pnpm -s test` |
| **T3 peer 声明** | `package.json`、`logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/check-peer-decls.mjs`（新） | `package.json` 的 `dsh.client.inject` | 7 个 `@deepseek-ai/dsh-client-*` 进 `peerDependencies: "*"` + `peerDependenciesMeta optional`；`react` 保留。自检：跑 check-peer-decls 期望 `PASS (4 checks)` 之类全绿 |
| **T4 单测更新 + 多任务/边界** | `test/dispatch.test.ts`、`test/wire.test.ts` | `src/host/team/dispatch.ts`、`src/host/config.ts` | §7.7 的旧断言更新（不放宽）+ §8.1 的 6 个新用例（含两个 stub 撞名用例）。自检：`pnpm -s test`，`tests ≥ 152` |
| **T5 探针迁移与技能探针** | `logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs`、`qa-reverify-probe.mjs`、`qa-skill-prompt-probe.mjs`（新） | `src/host/team/dispatch.ts`、`src/host/team/member-prompt.ts`、`src/host/bridge.ts`、`src/host/roles/builtin.ts` | 从归档目录复制 collision/reverify 两支（import 深度 `../../../../src/...` 不变）；reverify 仅替换 3 处 `dev-t1` 字面量为 `spawned.at(-1)?.name`（**项数保持 9**）；新增独立技能探针 2 项。自检：三支探针分别 `5/5`、`9/9`、`2/2` |
| **T6 交付自检 + 构建入库 + 单笔提交** | `.gitignore`、`lib/index.js`、`lib/client.js`（构建产物） | 全部 | `.gitignore` 追加 `*.tgz`、`pnpm-debug.log*`（保留 lib/ 不忽略）；依次跑 §8.3 全部门禁并核对双产物 mtime 晚于 `src/`；`git add -A`（含 `docs/teamflow/20261031-r2/`、`lib/`）→ **单笔** commit（中文提交信息写明 R2-1 修复与 AC 覆盖）→ 提交后不再改文件。**不写 QA-REPORT/ACCEPTANCE**（属后续阶段） |

## 10. 风险与反目标对照

| 反面目标 | 本方案的正面覆盖 |
|---|---|
| ① 探针绿而真实链路仍塌缩 | 名字算法与派发断言都在**真实** `dispatchReady` 里；探针走真实 `createBridge`+`dispatchReady`，不是 mock 副本 |
| ② 靠序号/列表位置消歧 | 哈希输入是 `(roleId, taskId)` 原始串，与顺序无关；恢复按 `taskId` 绑；代码中禁止任何 `-1`/`-2` 序号后缀 |
| ③ 截断吃掉唯一性 | `NAME_BUDGET` 只裁可读段、哈希恒保留；单测显式覆盖两个 40 字长 id 与 48 上限 |
| ④ 名字退化成不可读哈希 | 可读段保留到 20 字（拉丁/数字 id 完全可读）；纯中文 id 的短名限制已在 §3 如实记录，并由面板标题 + `taskId` 承担可读性 |
| ⑤ QA 只换措辞 | 每条 AC 附**可复现命令 + 实跑输出**（QA/验收阶段执行）；本轮的探针项数与文件名写死，禁止改动既有项 |
