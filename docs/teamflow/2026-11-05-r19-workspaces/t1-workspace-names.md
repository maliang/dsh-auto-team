# T1：左栏项目名改用宿主工作区标题（r19 workspace names）

日期：2026-11-05
写域：`src/host/adapters.ts`、`src/host/index.ts`、`src/host/library.ts`、`src/host/tools.ts`、
`test/workspace-names.test.ts`（新建）、`test/library-project.test.ts`（未改）、`test/library.test.ts`（未改）、
`test/tools.test.ts`、`test/adapters.test.ts`
**未触碰**：`src/host/bridge.ts`、`test/bridge.test.ts`（并行任务在写）。

## 1. 真机证据（问题现场）

用户原话：左侧「自动团队」主界面里的左侧栏目应该显示类似 `tuoluojiang`、`nengtan`，
而不是 `desktop`、`tmp`。

真机 library 现状（桌面宿主 profile `~/.dsh/profiles/desktop`）：

| 项目桶 | run 数 | 桶路径 |
|---|---|---|
| `desktop` | 13 | `/Users/maliang/.dsh/profiles/desktop` |
| `tmp` | 1 | 某个 `/private/tmp` 下的临时目录 |
| 历史运行（未记录工作区） | 4 | —（无 `project` 的旧 run） |

同时宿主的 `workspaceRegistry` 里其实存着用户自己的命名，例如
`nengtan → /Users/maliang/Documents/develop/guangdahehui/nengtan`、
`tuoluojiang → /Users/maliang/Documents/develop/guangdahehui/oa/tuoluojiang`，
但左栏一个都没显示。

## 2. 宿主机理（形态已核，来自 app.asar）

- 服务名 **`workspaceRegistry`**：`Service.inject = ['storageDomain','sessionPersistence']`；
  插件侧只能作为**可选服务**读取（不能写进 entry 的 `inject`，否则整条 entry 变 required）。
- `registry.list()` **同步**返回实体数组，顺序 = 持久顺序；实体字段是 **getter**：
  - `id`：实体 id；
  - `path`：**canonical 绝对路径**；
  - `title`：用户可改的工作区标题（这里才是 `nengtan` / `tuoluojiang` 的来源）；
  - `sessionIds`：该工作区名下的会话 id，**宿主已按会话 header 的 canonical cwd 过滤**，
    因此可以把「`project` 写歪的老 run」按 sessionId 映射回真实工作区。
- 服务可能不存在（headless / 旧宿主）→ 本插件必须降级到旧行为。

## 3. 两处叠加根因

1. **写入端**：`auto_team_plan` 落盘时 `project: deps.workspace`（原 `src/host/tools.ts:311`），
   而 `deps.workspace` = `options?.workspace ?? process.cwd()`（`src/host/index.ts:105`）。
   桌面宿主里 `apply()` 启动时的 cwd 是 profile 目录，于是 13 次 run 全被写进
   `project = /Users/maliang/.dsh/profiles/desktop`。
2. **展示端**：`src/host/library.ts` 的 `projectNameOf()` 只取路径 basename，
   完全不知道宿主里有用户命名的工作区标题。

## 4. 修复

### 4.1 写入端：`project = 会话 cwd`（`src/host/tools.ts:334`）

```
const workspace = workspaceFor(deps, sessionId)   // 会话 cwd → registry 反查 → 装配兜底
...
...(workspace === undefined ? {} : { project: workspace })
```

- `ToolsDeps.workspaceOf?: (sessionId) => string | undefined`（`src/host/tools.ts:71`）由装配层注入；
- `workspaceFor()`（`src/host/tools.ts:143`）对 `workspaceOf` 做 fail-open：**抛错/空串 → 回退
  `deps.workspace`**，一次计划落盘不会因为宿主读不到工作区而失败；
- `deps.workspace` 的语义改成「兜底工作区」，注释同步更新（不再是唯一来源）。

装配层（`src/host/index.ts:519`）：

```
workspaceOf: (sessionId) => {
  const own = sessionWorkspace(sessionId)                 // agent.session.header.cwd 优先
  if (own !== undefined) return own
  return workspaces().find((e) => e.sessionIds.includes(sessionId))?.path  // 注册表反查
}
```

### 4.2 展示端：registry 索引 + 标题优先（`src/host/library.ts:435`）

`groupProjects()` 先建两张索引：`byPath`（`resolve()` 归一）与 `bySession`。
每个 summary 的有效工作区按优先级取：

1. `summary.project` 命中 `byPath` → 用 registry 实体（**project 命中优先**，
   已记录正确路径的 run 不许被 sessionId 映射拉回旧工作区）；
2. 否则 `bySession.get(summary.sessionId)`（`project` 写成 profile 目录的老 run）；
3. 都没有 → 沿用 `summary.project`（旧行为：basename 展示；空 = 历史桶）。

- 桶 key = **解析后的 path**（`bucketKeyOf`，`src/host/library.ts:419`）：同一工作区的
  「旧 run（project=profile）」与「新 run（project=workspace path）」合并成一个桶；
- `ProjectBucket` 增加 `title?: string`；`projectViewOf` 的名称
  （`src/host/library.ts:509`）为 `bucket.title ?? projectNameOf(bucket.path)`；
- 桶 `path` 改用解析后的路径，项目记忆目录 / 项目详情路径随之指向真实工作区；
- `bucketFor(deps.workspace)` 仍保底当前工作区（客户端已有 0 次运行过滤，不会显示）；
- 历史桶语义不变：**无 project 且无会话映射**才进「历史运行（未记录工作区）」；
- `knownWorkspaces()`（记忆白名单，`src/host/library.ts:141`）补入 registry 工作区路径：
  老 run 按 sessionId 映射后桶路径已变成真实工作区，若不认它，点项目记忆会 403。

### 4.3 新增可选服务与降级（`src/host/adapters.ts`）

- `OPTIONAL_SERVICES` 增加 `'workspaceRegistry'`（唯一登记处，`src/host/adapters.ts:182`），
  **不写进** `src/host/index.ts` 的 `inject`（`host-contract.test.ts` 断言两者互斥）；
- `OptionalServiceMap.workspaceRegistry = { list?(): unknown }`（`:236`）；
- `HostWorkspaceEntry { id?; path; title?; sessionIds: string[] }`（`:240`）；
- `readWorkspaces(ctx)`（`:267`）：
  - 服务缺失 / `list` 缺失 / `list()` 抛错 / 返回非数组 → `[]`，**绝不抛**；
  - 逐项读 getter；单条实体读字段抛错只跳过该条；
  - `title` 非空才带；`sessionIds` 只保留字符串并去重；`path` 非空字符串才收；
  - 读取口用 `readServiceQuietly` 而不是 `optionalService`：项目列表与记忆白名单每次装配都会
    读一次，服务真缺失时 `optionalService` 会按缓存周期反复刷 warn ——
    `test/wire.test.ts` 的「装配过程不应有告警」正是这条回归（首版用 `optionalService` 实测判红）。
- 装配层 `const workspaces = () => readWorkspaces(ctx)`（`src/host/index.ts:222`）**惰性现读**：
  注册表可能晚于 `apply` 激活，不在启动时快照。

## 5. 测试清单

新增 `test/workspace-names.test.ts`（8 例）：

1. 两个会话分别映射到 `tuoluojiang` / `nengtan`，run.project 是 profile 垃圾路径 →
   两个项目，`name` = 工作区标题、`path` = 工作区路径；
2. 最根因场景（project=`profiles/desktop` + sessionId 映射）→ 用户看到 `tuoluojiang`，
   `desktop` 桶不再吞 run；
3. 同一工作区两条 run（旧 run project=profile、新 run project=`<workspace>/` 带尾斜杠）
   → 合并成一个桶，`runs=2`；
4. registry 缺失 → 退回 basename（`/work/x` → `x`）；
5. `project` 是未注册目录（`/private/tmp`）→ basename `tmp`，不吞掉；
6. 无 project 且无会话映射 → 仍是历史桶；
7. project 命中优先于 sessionId 映射（不把写对的 run 拉回旧工作区）；
8. 项目记忆按解析后的 canonical path 读取（`deps.projectMemories` 参数断言，
   不出现带尾斜杠的原始串）。

`test/tools.test.ts` 新增 3 例：`workspaceOf` 存在 → `project`=会话 cwd；返回
undefined/空串 → 回退 `deps.workspace`；`workspaceOf` 抛错 → 不崩且回退。

`test/adapters.test.ts` 新增 4 例：服务缺失/无 list → `[]`；`list` 抛错/非数组 → `[]`；
getter 实体（title 空不带上、sessionIds 去重且过滤非字符串）；缺 path / path 非字符串 /
单实体读字段抛错 → 跳过该条其余照常。

既有 `test/library.test.ts`、`test/library-project.test.ts` 未改一行（默认没有 `workspaces`，
旧断言全部保持通过）。

## 6. 门禁输出

```
$ pnpm typecheck
tsc --noEmit            # exit 0（无输出）

$ node --test test/workspace-names.test.ts test/library.test.ts \
    test/library-project.test.ts test/tools.test.ts test/adapters.test.ts
ℹ tests 89
ℹ suites 0
ℹ pass 89
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
# exit 0
```

附加回归（本任务相关、全仓除 `test/bridge.test.ts` 外 871 例）：
`node --test $(ls test/*.test.ts | grep -v test/bridge.test.ts)` → **tests 871 / pass 871 / fail 0**；
`node --test test/host-contract.test.ts` → 13/13（`optionalService` 字面量集合 ===
`OPTIONAL_SERVICES`、`inject` 仍精确 4 项）。
`test/bridge.test.ts` 未运行、未修改（并行任务在写）。

## 7. 未真机验证声明

本任务**未**在真实桌面宿主上重启或截图验证。理由：仓库工作区正被其它并行任务修改
（`bridge.ts` 等），本任务只允许改上述写域，无法执行「安装到 profile + 重启宿主 + 点开左栏」的
真机流程；本次证据全部来自：

- 宿主机理（`workspaceRegistry` 服务名、`list()` 实体 getter、`sessionIds` 过滤）来自已核的
  app.asar 事实；
- 行为由单测用伪造 registry 覆盖（含真机根因形态：project=profile 目录 + sessionId 映射）。

真机复核时应看到：左栏不再出现 `desktop`（0 次运行被客户端过滤），改出现 `nengtan` /
`tuoluojiang`；仍需确认的两点：① 用户改过名的工作区标题是否即时反映（本实现每次现读，
`/library` 有 5s 缓存）；② 旧 run 按 sessionId 映射是否覆盖全部 13 次（取决于宿主
`sessionIds` 是否含这些历史会话）。
