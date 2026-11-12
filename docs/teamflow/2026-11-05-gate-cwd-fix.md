# 门禁执行目录修复（t3）

- 日期：2026-11-05
- 状态：已完成
- 结论：`acceptance` 现在跑在**发起动作的会话工作区**（`agent.session.header.cwd`），不再是宿主进程启动目录（真机 `~/.dsh/profiles/desktop`）。取不到会话工作区时回退装配 `workspace`，旧行为保持。

## 1. 症状（修复前）

- 任务回执里的验收命令永远在 `~/.dsh/profiles/desktop` 下执行：仓库相对路径（如 `test -s README.md`、`pnpm test`）`exit 1` 且日志无输出。
- 门禁日志落在 `~/.dsh/profiles/desktop/.auto-team/artifacts/<taskId>.log`，与用户仓库无关。
- 面板「重跑门禁」与工具 `auto_team_receipt` 症状一致——两条入口共用同一个 `BridgeDeps.gate.cwd`。

## 2. 根因

`apply(ctx, options?)` 在宿主启动时只执行一次，`workspace = options?.workspace ?? process.cwd()`；真机未传 `options.workspace`，因此 `process.cwd()` = 宿主 profile 目录。会话自己打开的仓库根只有宿主知道，而修复前没有任何读取口。

宿主已核事实（同宿主 `dsh-plugin-teamflow` 的 `workspaceScopeOf(agent)` 用法）：`ctx.agents.get(sessionId)` 返回 Agent，会话根在 `agent.session.header.cwd`。`agents` 本来就在本插件的 `inject` 里，因此无需新增宿主依赖。

## 3. 修复点（3 处）

### 3.1 `src/host/adapters.ts:155` — 宿主形状的唯一翻译点

```ts
export function sessionWorkspaceOf(agent: unknown): string | undefined
```

从 `agent.session.header.cwd` 读；只接受**非空白字符串**，其余（无 session / 无 cwd / 非字符串 / null）一律返回 `undefined`。同时给 `HostContext.agents` 补上可选读取口 `get?(sessionId: string): unknown`（`src/host/adapters.ts:65`），宿主 API 仍只在这一个文件里出现。

### 3.2 `src/host/bridge.ts:397` — 每次门禁现取目录

`BridgeDeps.gate` 新增可选 `workspaceOf?(sessionId): string | undefined`（`:195`）。`gateContextOf(sessionId)` 的判定顺序：

1. `workspaceOf(sessionId)` 返回非空白路径 → cwd 用它，产物目录用 `projectArtifactsDir(它)`（`<会话工作区>/.auto-team/artifacts`）；
2. 缺失 / 空白 / 抛错 → 回退 `deps.gate.cwd` 与 `deps.gate.artifactsDir`（修复前行为）。

解析异常被吞掉后走回退，门禁失败原因只能是验收命令本身，不会是「找目录时崩了」。

两个门禁调用点都改为按会话解析：

- `case 'receipt'`（任务 `running → done` 的唯一入口）：`src/host/bridge.ts:1682`；
- `case 'updateAcceptance'`（`done` 任务改验收后当场重跑）：`src/host/bridge.ts:1572`。

### 3.3 `src/host/index.ts:204` — 装配接线

```ts
function sessionWorkspace(sessionId: string): string | undefined {
  try {
    return sessionWorkspaceOf(ctx.agents?.get?.(sessionId))
  } catch {
    return undefined
  }
}
```

并在 `src/host/index.ts:437` 传入 `gate: { cwd: workspace, artifactsDir, workspaceOf: sessionWorkspace }`。旧宿主没有 `agents.get` 时返回 `undefined`，自动走回退，不改变既有安装的行为。

## 4. 影响面

- 生效：工具 `auto_team_receipt`、面板 `receipt` / `updateAcceptance`（含 5 类不可逆动作的确认后执行）。
- 产物：门禁日志改落 `<会话工作区>/.auto-team/artifacts/<taskId>.log`；证据里的 `artifacts` 字段同步。
- 不变：项目记忆仍按装配 `workspace` 解析（本次只修门禁）；`updateAcceptance` 对非 `done` 任务仍只改命令、不跑门禁。

## 5. 验证（实际执行）

新增 `test/gate-cwd.test.ts`，4 例：

1. `sessionWorkspaceOf` 形状矩阵：合法 cwd / 无 session / 无 cwd / 空白 / 非字符串 / null / undefined；
2. `receipt` 门禁跑在会话工作区：`pwd > gate-cwd.txt` 落在会话目录、内容等于 `realpath(会话工作区)`、回退宿主目录无该文件、证据 `exitCode === 0` 且 `artifacts === [<会话工作区>/.auto-team/artifacts/t1.log]`；
3. 取不到会话时回退装配 cwd：文件写在回退目录，未解析的会话目录不被凭空写入；
4. `done` 任务改验收后重跑：先拿 `pendingId` 再确认，重跑文件落在会话工作区，证据命令换成本次 `acceptance`。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | 0 | 无输出（tsc 通过） |
| `node --test test/gate-cwd.test.ts` | 0 | 4 pass / 0 fail |
| `pnpm test` | 0 | 764 pass / 0 fail |
| `pnpm build` | 0 | `lib/index.js` + `lib/client.js` |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | 宿主产物可导入 |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | client 产物可导入 |

任务验收命令原样执行：

```bash
test -s docs/teamflow/2026-11-05-gate-cwd-fix.md \
  && node --test test/gate-cwd.test.ts
# exit 0
```

## 6. 风险与后续

- `agents.get` 是宿主已核读口（teamflow 同机用法），但本项目未在第二宿主做真机复跑；旧宿主缺失时走回退，不会崩。
- 项目记忆目录仍是装配 `workspace` 派生，若后续要求也按会话隔离，可复用同一个 `sessionWorkspace` 注入点，但不在本次范围。
- README 的「门禁」节、数据落点、已知限制与变更记录已同步为本修复后的行为。
