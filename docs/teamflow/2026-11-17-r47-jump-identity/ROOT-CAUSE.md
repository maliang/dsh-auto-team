# r47 · 多任务卡时「跳错 / 跳不动」根因诊断（只读）

- 任务：t1（诊断，只读，不改产品代码）
- 数据：`~/.dsh/auto-team/runs/` 三份真实 run（只读取，**未写入**）
- 探针：`logs/teamflow/run-mwkdk94v-zoe/scripts/jump-probe.ts`（真实 `RunsStore` + 真实 `createBridge` + 真实 `bridge.snapshot()` + `buildRunDetail` + 逐入口 `memberJumpOf`）
- 证据原文：`logs/teamflow/run-mwkdk94v-zoe/jump-probe.real.txt`（真实 run）、`jump-probe.synth2.txt`（合成退役变体）
- 采样时刻：2026-11-17 15:42:47

## 0. 结论速览（两个症状 = 两条独立根因，都修在「身份解析」而不是点击链）

| 症状 | 根因 | 位置 | 实测证据 |
|---|---|---|---|
| ①「任务会串」：点 A 任务的行/卡片，进的是 B 任务的成员会话 | `memberForRole()` 在 `taskId` 无绑定时**静默回退**到「同角色 running / 最近活跃」成员 | `src/client/viewmodel.ts:3295`，回退在 `:3303-3309` | 19 任务 run 中 **9 个未派发任务全部 `available:true`**，且都指向别人的成员（t6/t12/t14/t16/t19 → `331ea9ad` 即 t7 的后端成员；t3/t9 → `49118c09` 即 t15 的 QA 成员） |
| ①（第二通道）「角色卡永远只到一个人」 | 角色卡只传 `role.activeTaskId`，而它是**该角色任务序列里第一个 running（否则第一个 gate）**，不是「被点的那张卡」 | `src/shared/role-view.ts:105`、`:118-121`；`src/client/views/RoleCard.tsx:75-79` | backend 有 7 个任务（t1,t6,t7,t12,t14,t16,t19），`activeTaskId` 恒为 `t7`；frontend 的 `activeTaskId=undefined` 但卡片仍 `available:true` 并跳到 `4f67e786`（t2 的成员） |
| ②「跳不动」：点任务卡里的角色名没任何跳转 | 任务卡 meta 行里的「角色」是**纯 `<span>`**，且整块包在展开按钮 `<button data-task-toggle>`（`TaskTable.tsx:88-90`）里 —— 点它只会展开/收起任务详情，不会导航 | `src/client/views/TaskTable.tsx:134`（`<span data-task-role>`），容器 `:88` | 源码零 `onClick`/`role`/`tabIndex`；`TasksTab.tsx:235` 的 `<RoleGrid>` 在任务列表**上方**，任务卡内部没有第二个可点角色卡 |
| ②（真·丢身份）已退役/复用成员的任务永远无成员可跳 | `membersOf()` 丢掉 `retired === true && stoppedAt === undefined` 的 binding；此后旧任务只能靠 `task.memberId` 的 legacy 兜底，而兜底行**名称/状态已失真** | `src/host/bridge.ts:1272`、legacy 兜底 `:1310-1324` | 真实三份 run 里 `retired` 全为 `undefined` → 该过滤**一次都没生效**（不是本次事故的直接原因）；合成退役变体（标 `retired` + 清 `task.memberId`）立刻出现 `t1 WRONG(串到别的任务)`、`t2/t4 LOST(有成员却跳不动)` |

**一句话根因**：**「任务 → 成员」是一个一对多关系（一个角色 N 个任务、一个成员可被多个任务复用），但投影层把它压成了单值**——`MemberView.taskId` 只有一个（`bridge.ts:1300` 附近）、`RoleView.activeTaskId` 只有一个（`role-view.ts:118`）——于是任何一次按压都必须靠「回退」猜，猜中就串、猜不中就跳不动。

---

## 1. 方法与可复现性

照 `test/r32-qa-regression.test.ts` 的既有做法，**不起真宿主**：

1. `createHarness()`（`test/r21-harness.ts`）建临时目录 + 真实 `RunsStore` + 真实 `createBridge()`；
2. 把真实 run JSON 用 `writeFileSync` **拷进临时 runs 目录**（真实 `~/.dsh/auto-team/runs` 全程只 `readFileSync`）；
3. `bridge.snapshot(plan.sessionId)` → `buildRunDetail({ snapshot })` 得到面板真正渲染的 `tasks / roles`；
4. 对每个任务调 `memberJumpOf({kind:'task', roleId, taskId}, members)`，对每个角色卡调 `memberJumpOf({kind:'role', roleId, taskId: role.activeTaskId}, members)`（与 `TaskTable.tsx:356/389`、`RoleCard.tsx:75` 传参逐字一致）；
5. 「期望成员」= 该任务在 `bindings[]` 里最后一条的 `memberId`；`none` = 该任务从未派发。

复跑：

```bash
node logs/teamflow/run-mwkdk94v-zoe/scripts/jump-probe.ts            # 真实盘面
SYNTH_RETIRE=2 node logs/teamflow/run-mwkdk94v-zoe/scripts/jump-probe.ts   # 合成退役变体
```

> 样本说明：`run-mwkd2uby-fn2` 是**仍在推进的活 run**（第一次读取 15 任务/4 bindings，采样时 19 任务/6 bindings，文件 mtime 15:42）。下表数字带采样时刻，复跑会有出人。`run-mwkci8us-fn2`（6 任务/5 成员）、`run-mwiu4yru-fn2`（6 任务/6 成员，已 terminated）作对照。

### 1.1 `membersOf()` 实测行（`run-mwkd2uby-fn2`，一个成员一行）

```
c6e0da84 backend-t1-b23i6m-3      role=backend   taskId=t1    status=done
4f67e786 frontend-t2-s3ub6p-3     role=frontend  taskId=t2    status=done
52b67f42 docs-t4-flv1ti-3         role=docs      taskId=t4    status=done
331ea9ad backend-t7-bm2pkk        role=backend   taskId=t7    status=running
49118c09 qa-t15-hnx5sp            role=qa        taskId=t15   status=running
ae8a6d5f dev-t17-hz7oqk           role=dev       taskId=t17   status=running
```

19 个任务只投影出 6 个成员行 —— 13 个任务的 `taskId` 在快照里**根本不存在**，这正是回退的地基。

### 1.2 逐任务 `memberJumpOf`（`run-mwkd2uby-fn2`）

| 任务 | 角色 | 状态 | 期望成员 | 实际解析 | 判定 |
|---|---|---|---|---|---|
| t1 | backend | done | c6e0da84 | c6e0da84 | OK |
| t2 | frontend | done | 4f67e786 | 4f67e786 | OK |
| t3 | qa | done | none | **49118c09** | PHANTOM（跳到 t15 的 QA 成员） |
| t4 | docs | done | 52b67f42 | 52b67f42 | OK |
| t5 | reviewer | pending | none | — | no-member |
| t6 | backend | pending | none | **331ea9ad** | PHANTOM（跳到 t7 的后端成员） |
| t7 | backend | running | 331ea9ad | 331ea9ad | OK |
| t8 | frontend | pending | none | **4f67e786** | PHANTOM |
| t9 | qa | pending | none | **49118c09** | PHANTOM |
| t10 | docs | pending | none | **52b67f42** | PHANTOM |
| t11 | reviewer | pending | none | — | no-member |
| t12 | backend | pending | none | **331ea9ad** | PHANTOM |
| t13 | reviewer | cancelled | none | — | no-member |
| t14 | backend | blocked | none | **331ea9ad** | PHANTOM |
| t15 | qa | running | 49118c09 | 49118c09 | OK |
| t16 | backend | waiting | none | **331ea9ad** | PHANTOM |
| t17 | dev | running | ae8a6d5f | ae8a6d5f | OK |
| t18 | reviewer | pending | none | — | no-member |
| t19 | backend | pending | none | **331ea9ad** | PHANTOM |

`→ WRONG=0 PHANTOM=9`

注意 `actionText` 仍然是**该任务自己的标题**（例：t6 按钮写「子智能体 · 整合：把本轮改动做成本地提交… →」），也就是说按钮外观 100% 指向 t6，点下去打开的却是 t7 的会话 —— 用户视角就是「任务会串」。

对照样本：
- `run-mwkci8us-fn2`（6 任务 5 成员，t6 未派发）→ `WRONG=0 PHANTOM=1`（t6 跳到 t1 的后端成员）；
- `run-mwiu4yru-fn2`（6 任务 6 成员，1:1）→ `WRONG=0 PHANTOM=0`。**单任务/1:1 的 run 测不出这个 bug**，这就是既有单测全绿的原因。

### 1.3 逐角色卡 `memberJumpOf`（`RoleCard.tsx:75` 传参）

```
backend   tasks=[t1,t6,t7,t12,t14,t16,t19] activeTaskId=t7 期望=331ea9ad 实际=331ea9ad
frontend  tasks=[t2,t8]                     activeTaskId=undefined 期望=none 实际=4f67e786
qa        tasks=[t3,t9,t15]                 activeTaskId=t15 期望=49118c09 实际=49118c09
docs      tasks=[t4,t10]                    activeTaskId=undefined 期望=none 实际=52b67f42
reviewer  tasks=[t5,t11,t13,t18]            activeTaskId=undefined 期望=none 实际=— 不可跳
dev       tasks=[t17]                       activeTaskId=t17 期望=ae8a6d5f 实际=ae8a6d5f
```

`frontend`/`docs` 两行是最干净的证据：**卡片没有 activeTask，判定却仍说“可跳”并给了一个成员**（因为 `taskId=undefined` 直接走「角色最近成员」分支）。

---

## 2. 四问逐条回答

### Q1：`membersOf()` 里一个成员挂多条 binding（复用）时，面板那行的 `taskId` 是谁？点「另一个任务」会不会跳到它？

**取「优先级最高的那一条 binding」的 `taskId`**，不是全部。`src/host/bridge.ts:1249 membersOf()`：

```ts
const priorityOf = (binding) => {
  if (binding.stopping === true) return 3
  if (binding.stoppedAt !== undefined) return 2
  const task = taskById.get(binding.taskId)
  if (task && (task.status === 'running' || task.status === 'gate' || task.status === 'interrupted')) return 1
  return 0
}
```

`chosen: Map<memberId, binding>`（`bridge.ts:1266-1284`）每 memberId 只留一条，`>=` 比较使**同级取后出现的**（bindings 是追加序 = 最近一条）。最终投影给客户端的 `MemberView.taskId` 只有一个值（`bridge.ts:1294-1302`）。

后果：
- 成员被 t1 用过、又复用给 t7 → 面板那行 `taskId` 只会是 `t7`（running 优先级 1 > t1 的 0），**t1 的 taskId 在客户端投影里彻底消失**；
- 点 **t1** 的行 → `memberForRole(members,'backend','t1')` 按 taskId 找不到绑定 → 落到 running 分支 → 如果当前恰好还是这个复用成员（t7 running），**看起来跳对了**；一旦它已结束/又有新成员，就跳到别人 —— 即"能不能跳对取决于时序"。
- 实测：`run-mwkd2uby-fn2` 里 t1 与 t7 用不同 memberId（`c6e0da84` / `331ea9ad`），所以 t1 仍 OK；一旦复用就退化成上面那种时序赌。

### Q2：`memberForRole` 在「taskId 无匹配」时会不会回退到同角色任意 running 成员？是不是「任务会串」的直接原因？

**会，而且是直接原因。** `src/client/viewmodel.ts:3295-3311`：

```ts
const list = members.filter((m) => m.roleId === roleId)
if (list.length === 0) return undefined
if (typeof taskId === 'string' && taskId !== '') {
  const bound = list.filter((m) => m.taskId === taskId)      // :3303
  if (bound.length > 0) return latestMemberOf(bound)
}
const running = list.filter((m) => m.status === 'running')    // :3306  ← 回退 1
if (running.length > 0) return latestMemberOf(running)
return latestMemberOf(list)                                   // :3309  ← 回退 2
```

`taskId` 无命中时**没有 `undefined` 出口**，一定会给出一个同角色成员。实测 9 个 PHANTOM：

- `t6/t12/t14/t16/t19`（backend，全部未派发）→ `331ea9ad`（t7 的成员，正在跑）；
- `t3`（qa，**已经 done**）→ `49118c09`（t15 的成员，正在跑）；
- `t9`（qa，pending）→ `49118c09`；`t8`→`4f67e786`；`t10`→`52b67f42`（t2/t4 的成员）。

`t3` 这行特别能说明问题：一个**已完成**的任务按钮显示「可跳」，点开是另一个**正在跑**的同角色成员 —— 用户看到的正是「点第二个任务卡进了别人的会话」。

### Q3：角色卡只传 `role.activeTaskId`，一个角色 5 个任务时点角色卡只能到哪一个？用户说的「第二个任务卡下方的角色卡」在 DOM 里是哪个组件？

**① 只能到「该角色任务序列里第一个 running」，没有 running 就第一个 gate，都没有就 null，然后走 Q2 的角色级回退。**

`src/shared/role-view.ts:93-124`：

```ts
if (task.status === 'running' && running === undefined) running = task   // :100
if (task.status === 'gate' && gate === undefined) gate = task            // :101
const active = running ?? gate                                            // :105
if (active !== undefined) { view.activeTaskId = active.id; ... }          // :118-121
```

`src/client/views/RoleCard.tsx:75-79`：

```tsx
const jump = memberJumpOf(
  { kind: 'role', roleId: role.roleId, taskId: role.activeTaskId },
  members,
  { label: roleJumpLabelOf(role.name), taskTitle: role.activeTaskTitle },
)
```

实测：backend 7 个任务 → `activeTaskId=t7`（第一个 running），t1（done）、t6/t12/t14/t16/t19（未派发）永远点不到；frontend/docs 全无 running/gate → `activeTaskId=undefined`，但卡片仍 `available:true` 跳到 t2/t4 的成员 —— **角色卡在语义上从来不代表"某一张任务卡"**。

**② DOM 归属（关键）：用户点的那张「角色卡」不是 `RoleGrid`，而是任务卡里的角色名 chip，它根本不可点。**

- `src/client/tabs/TasksTab.tsx:235`：`<RoleGrid roles={detail.roles} members={members} tasks={detail.tasks} onJump={onJump} />` —— 在 `TaskOverview`（任务列表，`:236`）**之前**渲染，也就是说角色卡在任务列表**上方**，不在任务卡「下方」。
- 任务卡「下方显示的」角色是 `src/client/views/TaskTable.tsx:134`：

```tsx
<span data-task-line="meta">
  <span data-task-role title={`角色：${row.roleName}`}>
    {row.roleName}
  </span>
```

  这段位于展开/收起按钮 `<button ... data-task-toggle>`（`TaskTable.tsx:88-90`）**内部**，`<span data-task-role>` 自身无 `onClick` / `role` / `tabIndex` / `cursor`。点它的效果 = 点标题行 = 展开/折叠详情，**不会导航**。
- 真正可跳的入口只有两个：任务行右侧 `<button data-task-open-member>`（`TaskTable.tsx:160-175`，`onClick={() => onJump(jump)}`）与流程图节点（`FlowCanvas.tsx:335`）。

**结论**：用户说的「第二个任务卡下方的角色卡」= 任务卡 meta 行的 `data-task-role` chip（不可交互的展示文本）。它「跳不动」不是判定错了，而是**从来没接过判定**。如果他点的是 RoleGrid 的卡，则落进 Q3① 的 `activeTaskId` 语义错位。

### Q4：已收口/已退役任务，`membersOf()` 是否把成员行过滤掉了？会不会让「旧任务的按钮」永远无成员可跳？

**过滤存在但（本次真实数据里）没生效；一旦生效就会同时制造"跳不动"和"跳错"。**

`src/host/bridge.ts:1272`：

```ts
for (const binding of state.bindings) {
  if (binding.retired === true && binding.stoppedAt === undefined) continue   // :1272
  ...
}
```

- **真实三份 run**：`run-mwkd2uby-fn2` / `run-mwkci8us-fn2` / `run-mwiu4yru-fn2` 的 binding 里 `retired` 字段**全部不存在**（`None`），`stoppedAt` 也不存在 → `:1272` 一次都没命中。所以**不是本次事故的直接原因**（如实记录，避免误判）。
- **合成变体 `SYNTH_RETIRE=1`**（只把已终态任务的 binding 标 `retired:true`）：成员行被过滤后，`bridge.ts:1310-1324` 的 legacy 兜底（`task.memberId` 有值但没 binding）会把这些成员**重新加回来**，但名字与状态已失真：

```
c6e0da84 后端工程师        role=backend  taskId=t1  status=done   ← 原本是 backend-t1-b23i6m-3
4f67e786 前端工程师        role=frontend taskId=t2  status=done
52b67f42 技术文档工程师    role=docs     taskId=t4  status=done
```

  （名称退化成**角色名**，`stoppedAt`/`stopping`/停滞字段全丢。）
- **合成变体 `SYNTH_RETIRE=2`**（标 `retired` **且**清掉 `task.memberId`，即成员只被 binding 记录）：旧任务立刻断粮，两个症状同时出现：

```
t1  role=backend   status=done  期望=c6e0da84 实际=331ea9ad  WRONG(串到别的任务)
t2  role=frontend  status=done  期望=4f67e786 实际=—         LOST(有成员却跳不动)
t4  role=docs      status=done  期望=52b67f42 实际=—         LOST(有成员却跳不动)
→ WRONG=1 PHANTOM=7
```

**回答**：会过滤；过滤本身不会必然造成"永远无成员可跳"，因为还有 `task.memberId` 这条第二身份源兜着 —— 但这恰恰是问题：**身份有两个来源（`binding.memberId` 与 `task.memberId`），退役/复用让两者分叉**，谁少了谁就丢，谁多了谁就串。legacy 复活出来的行还会把成员名换成角色名，让"跳对了"也看起来不像对的人。

---

## 3. 根因链（为什么用户恰好看到这两个症状）

```
一个角色 N 个任务 + 成员可复用
        │
        ├─ 宿主投影压成单值：MemberView.taskId（bridge.ts:1294-1302，一行一个成员）
        │        └─ 复用/退役后旧任务的 taskId 在客户端不存在
        │                └─ memberForRole 无 taskId 命中 → 回退 running/最新（viewmodel.ts:3303-3309）
        │                        └─ 症状①：任务会串（9/19 实测 PHANTOM，按钮文案仍是自己的标题）
        │
        ├─ 角色聚合压成单值：RoleView.activeTaskId（role-view.ts:105/118）
        │        └─ 一个角色 5+ 任务只有一个"当前任务"，其余任务的角色卡入口不存在
        │                └─ 症状①第二通道：角色卡永远到同一个人 / 无 activeTask 时也"可跳"
        │
        └─ 任务卡内的角色名只是展示文本（TaskTable.tsx:134，无 onClick，且在展开按钮内部）
                 └─ 症状②：点"角色卡"没反应（用户以为它有跳转能力）
```

为什么既有单测全绿：`test/r33-jump-to-member.test.ts` 的夹具都是「1 角色 1 成员」或「显式 bound」的短链（`memberOf()` 固定 `taskId:'t1'`），回退分支只被断言成"回退到 running 是**期望行为**"（`:104-116`），从没有「同角色多任务 + 部分未派发」的形状，也就没暴露"回退把 A 任务的点击解析到 B 任务成员"。

## 4. 修复方向（供 t3 身份投影 / t4 跳转判定，本节不含实现）

1. **身份投影要一对多**：`MemberView` 增加 `taskIds: string[]`（成员挂过的全部 binding taskId，含已退役），`taskId` 仅作"当前/最近"展示字段；跳转判定只认 `taskIds`，不认 `taskId`。
2. **回退必须显式且仅限角色层**：`memberForRole` 在 `taskId` 给定时无命中应返回 `undefined`（→"该任务还没有可跳转的成员"），回退只允许发生在 `kind:'role'` 且 UI 明确表示"该角色最近成员"时。
3. **角色卡不要假装代表某个任务**：`activeTaskId` 只能用于"当前任务"展示；角色卡跳转应走角色层判定，或在卡上列出该角色全部任务的跳转入口（`taskRefs` 已在 `RoleView.taskRefs` 里，只是没有承载跳转）。
4. **任务卡角色名 chip 二选一**：要么接上 `memberJumpOf({kind:'task', ...})` 变成真入口（同时阻止冒泡到 `data-task-toggle`），要么去掉任何可交互暗示并保留 `data-task-open-member` 作为唯一入口。
5. **双源身份收敛**：`binding.memberId` 与 `task.memberId` 只能有一处权威投影；`retired` 过滤后不应让 legacy 兜底行以"角色名 + 重算状态"复活（那会让用户的"跳对了"看上去像跳错了）。

## 5. 未复现 / 存疑（如实记录）

- 我**没有起真宿主**做 DOM 点击复核；症状②的"点了没反应"由源码坐实（`data-task-role` 无任何交互属性，且在展开按钮内部），但没有真机截图。
- 真实三份 run 中 `WRONG=0`、全部是 PHANTOM —— 用户口述的"点第二个任务卡"若发生在**已派发且成员已退役/复用**的盘面，则对应 SYNTH2 的 `LOST/WRONG`；我手上没有这样一份原始 run（真实盘面的 `retired` 均为空），所以这一支只能给出合成证据，标注为推论而非实测。
- `run-mwkd2uby-fn2` 是活 run（采样期间 15→19 任务、4→6 bindings 变化），表内数字以 2026-11-17 15:42:47 的快照为准；复跑数字会变，但 PHANTOM 结构与代码路径不变。
