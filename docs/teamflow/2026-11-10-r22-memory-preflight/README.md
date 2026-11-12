# r22 团队记忆落点修复（project 动态解析 + 历史回填）

## 1. 缺陷与根因

用户报「已在使用的项目都没沉淀下记忆」。

实测证据：

- `~/.dsh/profiles/desktop/.auto-team/memory/` 下确实有 `run-run-mw3o8r92-zoe.md`、`run-run-mw49roh7-j6z.md`、`tuoluojiang-conventions.md`，说明写入本身是通的；
- 但本仓库与 `tuoluojiang` 工作区的 `<workspace>/.auto-team/memory` 都不存在；
- `~/.dsh/auto-team/runs/` 的 27 个 run 里 19 个终态，其中 13 个 `project` 记录的是 `/Users/maliang/.dsh/profiles/desktop`。

根因在 `src/host/index.ts` 的 `apply()`：`memoryRoots.projectDir` 在**装配时刻**用 `options?.workspace ?? process.cwd()` 算死（`src/host/paths.ts` 的 `projectMemoryDir()` → `<workspace>/.auto-team/memory`）。宿主 apply 时拿到的是 profile 目录，于是之后每个 run 的项目记忆都写进了 profile 的共享目录，真正的项目工作区永远不会出现 `.auto-team/memory`。

## 2. 修复：按会话/run 的真实 workspace 动态解析

新增纯模块 `src/host/memory/locate.ts`：

- `usableWorkspaceOf(workspace)`：只有**绝对路径**才算可用 workspace（历史 run 里有 `project: "dsh-auto-team"` 这类 basename，若相对 cwd 解析会写错目录）；末尾斜杠归一。
- `memoryLocationOf({ publicDir, fallbackProjectDir, workspace, origin })` → `MemoryLocation`：
  - 有可用 workspace：`projectDir = <workspace>/.auto-team/memory`，`degraded=false`；
  - 无可用 workspace：退化到装配目录（`fallbackProjectDir`），`degraded=true` 并附带可读的 `degradeReason`（不静默）。

`src/host/bridge.ts` 增加单一解析入口 `resolvedMemoryLocation(sessionId, runProject?, origin?)`：

1. run 落盘时优先用该 run 的 `state.project`（若它不是装配 workspace）；
2. 否则用 `deps.workspaceOf(sessionId)`（`src/host/index.ts` 注入：会话 cwd `sessionWorkspaceOf` → workspace registry 的 `sessionIds` 反查）；
3. 都没有才退化到装配目录，并在快照里带 `degraded/degradeReason`。

`recordRunMemory()` 用 run 的 `state.project` + `plan.sessionId` 解析，因此**同一进程内两个不同 workspace 的 run 会分别落到各自 `<workspace>/.auto-team/memory`**。

### 四口同源

以下四个读写入口全部走同一个 `resolvedMemoryLocation()`，不再各自使用 apply 时刻的固定根：

| 入口 | 实现位置 | 说明 |
|---|---|---|
| 列表 / 注入 | `memoryFiles(roots)`、`memoryFor(goal, sessionId?)` | 面板快照与成员提示词注入用同一 roots |
| expand | `expandMemory(id, depth?, sessionId?)` | 第三参是本次解析出的 roots，`createExpander({ roots })` 按次构造 |
| read | `readMemoryFile(track, name, workspace?, sessionId?)` | HTTP `GET /memory` 现在会带 `sessionId`；显式 workspace 仍走 `isKnownWorkspace` 白名单 |
| write / delete | `act()` 的 `saveMemory` / `deleteMemory` | 用 `act(sessionId, ...)` 的会话解析 |

`PanelSnapshot.memory` 新增可选 `projectDir` / `workspace` / `degraded` / `degradeReason`，面板（`src/client/tabs/MemoryTab.tsx`）在退化时显示原因。

### 退化语义

无 workspace 时：

- 文件仍写入装配目录（不静默丢写）；
- 快照与 `auto_team_memory list` 返回 `degraded: true` 与可读原因，例如「未能解析会话 sess-xxx 的项目工作区（宿主未提供会话 cwd，工作区注册表也没有命中）；项目记忆暂时退化到装配目录 …,不会写进具体项目的 .auto-team/memory。」；
- 单测同时断言「文件确实落在装配目录」和「原因文本可读」。

## 3. 公共轨（lessons）

确认既有实现已符合要求，未改动：

- `src/host/memory/auto.ts` 的 `publicMemoryOf()` **仅当 `failures.length > 0`** 才返回 `lessons-<runId>.md`（失败判据：任务 `status==='failed'`、`attempts>1`、或门禁 `exitCode` 为 `null`/非 0），否则返回 `null`，即无内容时如实不写；
- 写入侧 `src/host/memory/repo.ts` 的 `writeMemory()` 先 `mkdirSync(dir, { recursive: true })`，目录按需创建。

## 4. 历史回填

新增 `src/host/memory/backfill.ts`（可复用实现）+ `src/host/memory/backfill-cli.ts`（CLI）。

规则：

- 只处理终态 run（`terminated` / `cancelled`）；
- 只补缺失的 `run-<runId>.md`，**目标已存在即跳过，绝不覆盖**；
- project 解析顺序：workspace registry 按 `plan.sessionId` 反查 → run 自己记录的绝对路径（排除 `.dsh/profiles/*` 装配路径） → 都没有则 skip 并给出可读原因（不猜项目）；
- 若旧的 profile 记忆目录里已有同名记忆，则**原样复制**其正文（保留用户手改），否则用 `runMemoryOf()` 重新生成；
- `--dry-run` 只输出计划与计数，不写任何文件；可重复执行。

### 命令

```bash
# 只预览（安全，不写盘）
node src/host/memory/backfill-cli.ts --dry-run

# 实际补写
node src/host/memory/backfill-cli.ts
```

可选参数：`--runs-dir`、`--registry`、`--assembly-workspace`、`--legacy-memory`（可重复）。

### 真实数据 dry-run 结果（2026-11-10）

```text
[backfill] mode=dry-run scanned=27 terminal=19 planned=19 written=0 copied=0 skippedExisting=0 skippedNoProject=0 skippedInvalid=0
```

其中 17 条 `write`（按 run 状态重新生成）与 2 条 `copy`（复用 profile 旧记忆：`run-mw3o8r92-zoe` → dsh-auto-team、`run-mw49roh7-j6z` → tuoluojiang）；目标分别是本仓库、`nengtan`、`tuoluojiang` 等项目工作区的 `.auto-team/memory`。

## 5. 单测

- `test/memory-locate.test.ts`（新增 7 例）：workspace 可用性/末尾斜杠归一、有/无 workspace 的落点与退化原因、registry 解析容错、backfill dry-run 计数、真实 project 补写、按需建目录、重复执行只补缺失、手改不覆盖、旧装配路径 skip、旧副本复制。
- `test/bridge.test.ts`（新增 3 例）：同一进程两个会话的两个 workspace 各自落点；无 workspace 退化并在快照给出原因；列表/注入/expand/read/write/delete 同源 + 未授权 workspace 拒绝。
- 既有 1013 例保持全绿。

## 6. 验证

```bash
pnpm typecheck && pnpm test && pnpm build
```

本次执行结果（2026-11-10）：

- `pnpm typecheck` → 退出码 0
- `pnpm test` → 1023 例，1023 通过 / 0 失败
- `pnpm build` → 宿主与 client 两个产物均 `Build complete`
- 整体退出码 0

新增单测覆盖（10 例）：

- locate：绝对路径判定、末尾斜杠归一、有/无 workspace 的落点与可读退化原因；
- bridge：同一进程两个会话的两个 workspace 各自落点、无 workspace 退化并在快照可见、列表/注入/expand/read/write/delete 同源 + 未授权 workspace 拒绝；
- backfill：registry 解析容错、dry-run 只出计划、按需建目录、重复执行只补缺失、手改不覆盖、装配路径 skip 并说明原因、旧副本原样复制。

