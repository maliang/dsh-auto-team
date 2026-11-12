# T1：run 终态自动沉淀记忆（双轨）

- 任务夹：`docs/teamflow/2026-11-05-r19-memory/`
- 写域：`src/host/memory/auto.ts`（新建）、`src/host/bridge.ts`、`test/memory-auto.test.ts`（新建）、`test/bridge.test.ts`、本文档
- 未改：`src/host/store.ts`、`src/host/memory/repo.ts`（本方案不需要新字段，也不改既有读写规则）

## 1. 动机：注入是通的，写入是缺的

用户报「记忆系统完全没有运行，没有任何记忆记录」。核实结论：**注入链路正常，自动写入从未存在**。

| 环节 | 证据 |
| --- | --- |
| 注入预算 | `src/host/config.ts:31` `MEMORY_INJECT_BUDGET = 4000` |
| 记忆根注入 | `src/host/index.ts:157` `{ publicDir: publicMemoryDir(home), projectDir: projectMemoryDir(workspace) }` |
| 注入产出 | `bridge.memoryFor` 产出 `injectedChars`，`src/host/prompt.ts:84` 显示「已内联 N/4000 字符」 |
| 写入入口 | 只有手动 `act.saveMemory`（`bridge.ts` 的 `saveMemory` case）与 `bridge.remember` |
| 空库证据 | 修复前 `~/.dsh/auto-team/memory` 与 `<workspace>/.auto-team/memory` **都不存在**（`ls -d` 均报 missing），因此任何 run 结束后提示词都只能内联 0 条 |

也就是说：用户从没手动点过「保存记忆」，而 run 的经过不会自己落盘——缺的是「自动写」。

用户确认的口径：

1. **每个 run 结束写一条项目记忆**（`terminated` / `cancelled` 都算结束；进行中不写）；
2. **按内容分两轨**：项目相关的今回经过写项目轨，跨项目通用教训写公共轨。

## 2. 双轨规则

| 轨道 | 目录 | 何时写 | 文件 |
| --- | --- | --- | --- |
| 项目 | `<workspace>/.auto-team/memory`（`deps.memoryRoots.projectDir`） | **每个**终态 run 固定一条 | `run-<runId>.md` |
| 公共 | `<home>/.dsh/auto-team/memory/public`（`deps.memoryRoots.publicDir`） | **只有存在失败信号**时 1 条 | `lessons-<runId>.md` |

「失败信号」三条件各自独立命中（`failureOf`，`src/host/memory/auto.ts:185`）：

1. 任务 `status === 'failed'`；
2. `(attempts ?? 0) > 1`（走过返工）；
3. `evidence.exitCode !== 0` —— **`null` 也命中**（超时/被信号杀死，与「命令返回非 0」都是失败证据）。

无失败时**不写**公共记忆（避免公共轨被「一切正常」的噪音占满）。

## 3. 文件命名与幂等：存在即跳过

- 名字只由 `runId` 派生，**不拼 `now`/日期**：同一 run 反复 `saveState` 得到同一个名字。
  - `runStem` 把非法字符换成 `-`、去掉开头非字母数字、截到 40 字符（`run-<stem>.md` /
    `lessons-<stem>.md` 都远低于 `safeMemoryName` 的 64 字符上限）。
- 接线点：`bridge.saveState`（`src/host/bridge.ts:565`）在 `deps.store.save(state)` **之前**调用
  `recordRunMemory(state)`（`src/host/bridge.ts:527`）。
- 幂等键是**目标文件是否存在**（`existsSync`，不读后合并）：
  - 已存在 = 跳过，**绝不覆盖用户手改**；
  - 用 `existsSync` 而不是 `readMemory` 判空：空文件也算「用户已有内容」，`readMemory` 判空会把它当没写过而覆盖。
- 整段 `try/catch` fail-open：目录不可写、名字非法、磁盘满都只吞掉异常，**不影响 run 落盘/派发通知**。
  记忆是锦上添花，状态丢失才是事故。

## 4. 内容模板

### 项目记忆（`run-<runId>.md`，正文 ≤ 24 行，含首行标题）

```markdown
# <goal> · <runId>
- 状态：已终止 · 2026-11-05 14:38
- 项目：dsh-auto-team · 会话：sess-xxx
- 任务：done 2 · failed 1（共 4）
- t1 [done] 任务标题
- t2 [failed] 任务标题
## 失败与教训
- t2 返工 2 次：门禁 `pnpm test` 退出码 1；输出尾部：<换行压成空格、截断 120 字符>
```

规则：

- 首行恒为 `# <goal> · <runId>`；`goal` 为空 → 「未命名计划」；换行压成单行；
  整行（含 `# `）≤ 80 字符，**先保 runId 再裁目标**（runId 是幂等键的一半）。
- 状态行中文标签：`terminated → 已终止`、`cancelled → 已取消`；时间取 `finishedAt`，缺省回退 `createdAt/plannedAt`。
- 统计只列**非零**计数（done/failed/cancelled/skipped），全 0 时整段省略；项目/会话都缺省时整段省略。
- 逐任务一行 `- tN [status] 标题`；失败段只在有失败信号时出现。
- 行数上限是硬约束：先保头段与失败段，任务行占剩余空间，超出留一行
  `- …另有 N 条任务（已截断）` / `- …另有 N 条失败证据（已截断）`。

### 公共教训（`lessons-<runId>.md`，正文 ≤ 6 行，含首行标题）

```markdown
# 自动团队教训 · <runId>
- 日期：2026-11-05
- 目标：<goal>
- 失败模式：t1 门禁 `pnpm test` 退出码 1；输出尾部：<120 字符内>（另有 N 条失败任务）
- 可复用提示：同一门禁失败先在本地重跑 `pnpm test` 并对照输出尾部，确认结论后再让成员返工（证据：退出码 1）
```

「提示」只写**证据 + 操作建议**，不解释原因（不编造「因为依赖没装」这类没有证据的因果）。

## 5. 注入 / 面板兼容

现有 md 读取规则全部按**首行 `#`** 取标题，自动记忆与之天然兼容：

- `listMemoryItems`（`src/host/memory/repo.ts`）→ `memoryTitleOf` 取正文第一个 `#`，自动记忆的标题可读；
- `selectMemory` / `memoryIndexOf`（`src/host/memory/inject.ts`）→ `titleOf` 同样取首个 `#`；
- `createExpander` / `parseMemoryId`（`src/host/memory/expand.ts`）按 `mem://<track>/<stem>` 展开，
  文件名只含字母数字与 `._-`，`safeMemoryName` 校验直接通过；
- 文件落在既有双轨目录，`bridge.memoryFiles()` / 快照 / 左栏项目页无需改动即可看到。

## 6. 测试清单

纯逻辑 `test/memory-auto.test.ts`（13 例，不碰 fs）：

- terminated 产出项目记忆、首行 `# goal · runId`、统计/任务行形态；
- cancelled 同样产出，状态行「已取消」；
- `dispatching` / `paused` / `draft` → `[]`；
- 文件名稳定（同一 runId 不同 `finishedAt` 两次调用同名）；
- 失败三条件各自命中（failed / attempts>1 / 非 0 与 null 超时）；
- 无失败 → 没有公共记忆也没有失败段；有失败 → 有且只有一条公共记忆；
- 正文行数上限（40 任务 + 失败 → 项目 ≤24、公共 ≤6，含截断说明）；
- 空目标 →「未命名计划」；含换行/超长目标 → 首行单行且 ≤80；
- 缺 `evidence` / `attempts` 不崩，缺项目/会话不写空段。

集成 `test/bridge.test.ts`（新增 4 例，`r19 自动记忆` 段，`test/bridge.test.ts:1561` 起）：

- terminated run 落 `memory-project/run-run-t4.md`，首行正确；手改文件后再 `saveState`，内容保持不变；
- paused 状态不写项目记忆也不写公共记忆；
- 失败任务额外写 `memory-public/lessons-run-t4.md`，含命令/退出码/tail；
- fail-open：`publicDir` 挂在文件下（`mkdirSync` 会 ENOTDIR）时动作不被拒、`store.save` 正常完成。

## 7. 门禁输出（本机，2026-11-05）

```text
$ pnpm typecheck
> tsc --noEmit
（无输出，exit 0）

$ node --test test/memory-auto.test.ts test/memory.test.ts test/bridge.test.ts
ℹ tests 96
ℹ pass 96
ℹ fail 0
ℹ duration_ms 992.412708
（exit 0）
```

全量 `pnpm test`：928 例、pass 927、fail 1。唯一红的是
`test/wire.test.ts:202「apply() 装配…」`，失败原因是宿主桩缺 `workspaceRegistry` 时
`adapters.ts` 新增的降级告警（3 条 `[auto-team] 宿主未提供可选服务 workspaceRegistry，相关功能降级`），
属**并行任务对 `src/host/adapters.ts` 的改动**，与本次记忆写入无关；本任务未改 `adapters.ts` / `wire.test.ts`。
（`test/bridge.test.ts` 里一条 r17 用量断言 `60,421 → 60.42K` 是按并行任务 `format.ts` 已生效的
新口径同步，属同一并发改动的配套。）

## 8. 未真机验证声明

**本次只做了类型检查与单测，未在真实宿主（桌面 profile）上跑通。** 真机需确认：

1. 起一个真实 run 并让它跑到 `terminated`（或取消），随后：
   - `ls <workspace>/.auto-team/memory` 出现 `run-<runId>.md`；
   - 有失败任务时 `~/.dsh/auto-team/memory/public` 出现 `lessons-<runId>.md`；
2. 面板「记忆」页能看到这两条的**可读标题**（不是文件名）；
3. **下一次**新计划的队长提示词里「已内联 N/4000 字符」的 N 包含这两条（注入命中）；
4. 手改记忆后再次触发 `saveState`（例如改验收命令），内容不得被覆盖。

未覆盖的风险：真实 runId 的字符集、宿主 `finishedAt` 是否真的落盘（本模块在缺省时回退 `createdAt`，
不会崩但状态行时间可能等于创建时间）、以及多进程同时结束同一 run 的写竞争（当前靠
`existsSync` + 单进程桥，跨进程同 run 双写未验证）。
