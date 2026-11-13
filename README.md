# dsh-auto-team（自动团队）

[简体中文](./README.md) · [English](./README.en.md)

把当前 DeepSeek Harness 会话变成队长：目标拆成**有依赖的任务图**，按角色**并行**派出可续聊成员，完成必须过**质量门禁**，全过程在输入框左侧开关与右栏面板里可见可改。

- 版本与基线：`dsh-auto-team@0.2.2`（`package.json`）；2026-11-13 实测 `pnpm test` = **1257 通过 / 0 失败 / 0 skipped**（exit 0，约 6–8s）
- 兼容：Node `>=22.18`、DSH `>=0.2.1-alpha.2 <0.3.0`；本机真机验证宿主 `0.2.2-rc.2`
- 以下命令默认在仓库内执行，先复制这一行（在任意子目录都落到仓库根）：

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO"
```

![自动团队：主区会话 + 右栏面板（左侧导航已裁掉）](docs/images/panel-overview.png)

## 它解决什么问题

- **任务不会抢跑**：目标先拆成任务图，依赖没做完的下游保持 `blocked`，按角色（产品 / 设计 / 架构 / 全栈 / QA + 自建）派给可续聊的子 Agent。
- **并行不打架**：写域（`writeScopes`）互斥，同一时刻只有一份任务改同一片文件；并发上限默认 3、可配 1..8，并被宿主上限夹紧。
- **「做完了」不算数**：每条任务带可执行验收命令，`exit 0` 才转 done；失败自动返工，证据回发原成员。
- **需求改了不重来**：同一个 run 里修订 / 追加 / 作废任务，已跑成果保留；token 与用时取不到就写「不可得」，**不补 0、不估算**。

## 30 秒上手

1. **安装**（本机 profile 是 `desktop`，`dsh` 不在 PATH）：

```bash
cd "$REPO" && pnpm install
cd "$REPO" && pnpm build
cd ~/.dsh/profiles/desktop
pnpm add "file:$REPO"
grep -n '"dsh-auto-team"' package.json
```

`grep` 只有 1 行（缺 `dsh.profile.bundles`）时，手工在数组里补 `"dsh-auto-team"` 再重启。

2. **开启开关**：重启宿主、刷新 GUI。输入框**左侧**的「自动团队」胶囊就是按会话的总开关，默认关。生效判定：胶囊、会话头按钮、右栏页签、设置页分区四者都在；只缺一个就是没装好。

3. **派第一个任务并验收**：对队长说目标（如「把这个需求拆成任务派给团队」），队长 `auto_team_plan` 落计划——每条任务必须带 `roleId` 与**可执行的** `acceptance`（空验收整批拒绝），落盘即**自动派发**；成员回报后由开着开关的队长会话（或该任务成员自己）提交回执 → `auto_team_receipt` 真跑验收，`exit 0` 才算 done，失败转 `rework` 并把证据回发原成员、下游保持 `blocked`。

回滚同样是三条命令（期望最后一行输出 `0`）：

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-auto-team
grep -c '"dsh-auto-team"' package.json
```

## 能力一览

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 启用 / 停用（按会话，默认关） | 输入框左侧胶囊 | `conversation.input.left`；关掉时所有工具回「未启用」 |
| 右栏面板（任务 / 历史 / 记忆） | 右栏「自动团队」页签 | keyed slot：`sidebar.right.pane.tab` + `.title`，还须注册进 `sidebarRightTabs` |
| 项目库 / 记忆 | 左栏「自动团队」栏目 + 主区整页；面板「记忆」页（项目轨）、左栏「全局」（公共轨） | 主区注册失败自动降级为面板内联库；双轨 md，也可用 `auto_team_memory` |
| 参数 / 角色 / 技能 | 设置页「自动团队」 | 6 个参数；内置 11 个角色 + 12 个技能，可改不可删（技能可恢复出厂） |
| 队长工具 | 开关打开的会话内直接调用 | 8 个，见下文 |

8 个工具：`auto_team_plan`（落计划）→ `auto_team_dispatch`（确认派发）是骨架，配 `auto_team_add_tasks`（同一 run 追加）、`auto_team_status`（只读快照）、`auto_team_message`（直达成员、可续聊）、`auto_team_receipt`（跑门禁，**唯一**完成入口）、`auto_team_memory`（双轨记忆）、`auto_team_role`（角色）；未启用时全部回同一句「自动团队未启用…」。需求改了用 `revise: true` **并回同一个 run**（不传就永远新建，判定权在队长），细节见 [r21 合并与重规划](docs/teamflow/2026-11-10-r21-merge-replan/QA-REPORT.md)；门禁判定、记忆双轨与每个工具的返回形状见 [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) 与 `src/host/tools.ts`。

## 界面

三张真机截图（macOS 桌面端，1728×1084，2026-11-10 实跑的 5 任务 / 5 成员 run）：

![任务页：进度、角色成员卡、验收结论](docs/images/panel-tasks.png)

任务页一屏给全：运行头（`计划 5 · 成员 5 · 并发 0/3 · 已终止`）、用量块、按角色归并的成员卡、完成环与逐任务验收结论。顶部带「需求更新」的胶囊说明这次 run 被修订过。

![依赖流程图：实线已完成、虚线未完成](docs/images/panel-flow.png)

依赖图上每个任务直接标 token 与用时；`t5` 显示「不可得」是因为那次确实没有可读的用量来源，而不是写 0。

![输入框左下角的自动团队开关](docs/images/entry.png)

四张图的原文件：[面板总览](docs/images/panel-overview.png)、[任务页](docs/images/panel-tasks.png)、[依赖图](docs/images/panel-flow.png)、[入口](docs/images/entry.png)。

## 兼容性与版本支持

| 组件 | 要求 / 实测 | 依据 |
| --- | --- | --- |
| Node.js | `>=22.18`（声明）；本机实测 `v26.11.1` | `package.json` 的 `engines.node`；`node -v` |
| DSH 宿主 | `>=0.2.1-alpha.2 <0.3.0`（声明）；真机验证 `0.2.2-rc.2`（macOS 桌面端） | `package.json` 的 `engines.dsh`；`CFBundleShortVersionString` |
| 成员 API 分界 | **0.2.2-rc.2 起**成员能力在 `subagents`；旧 `agentTeams` 只剩任务簿方法 | `src/host/adapters.ts` 的 `HostSubagents` |
| 双路径兼容 | 逐个 `typeof` 探测：新接口优先，旧接口按能力回退 | `src/host/adapters.ts`；单测 `test/adapters.test.ts` |

**分界意味着什么**：宿主注释原文 *teammates are subagents, so subagent limits and inbox delivery apply*。创建成员时 `provider` 是 **subagent provider 名**（本机只有 `spawn`），逐角色模型走 `agentOptions`，不走 `provider`；填错会让每次派发都失败。两个命名陷阱全文见 [HOST-EVENTS.md](docs/teamflow/architecture/HOST-EVENTS.md) §3.3。

**诚实边界**：本机只装 `0.2.2-rc.2`，`0.2.1-alpha.2 ~ 0.2.2-rc.1` 的旧路径只有单测桩覆盖、没有真机回归；`engines.dsh` 是声明范围，不是每版都验过。

```bash
node -v
node -e "const p=require('./package.json');console.log(p.version,p.engines.node,p.engines.dsh)"
```

## 数据落点

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/auto-team/runs/` | 运行状态：计划、任务、成员绑定、门禁证据、`termination` |
| `~/.dsh/auto-team/sessions.json` | 各会话的开关 |
| `~/.dsh/auto-team/settings.json` | 6 个可配参数（并发、记忆预算、停滞阈值、返工上限、门禁超时、队长模型） |
| `~/.dsh/auto-team/roles/<id>.json`、`~/.dsh/auto-team/skills/<id>.md` | 角色与技能（内置首次启动 seed，可改不可删） |
| `~/.dsh/auto-team/memory/public/`、`<workspace>/.auto-team/memory/` | 公共记忆（跨项目）与项目记忆；项目 `workspace` 按 run 的真实项目解析，解析不到时返回 `degraded/degradeReason` |
| `<会话工作区>/.auto-team/artifacts/<taskId>.log` | 门禁全量日志（验收里的相对路径可直接用） |
| `~/.dsh/auto-team/deviations.jsonl` | 队长亲自写文件的留痕（append-only） |

落盘核对与历史数据整理（回填幂等，整理先 dry-run）：

```bash
ls ~/.dsh/auto-team/
ls ~/.dsh/auto-team/runs/ | tail -5
ls .auto-team/memory/
node src/host/memory/backfill-cli.ts --dry-run
node src/host/memory/curate-cli.ts --track project --dir "$(pwd)/.auto-team/memory" --dry-run
```

## 故障排查

只列最常见的三条，其余见 [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) §9 与 [memory.md](docs/teamflow/memory.md)。

| 症状 | 真实原因 | 处置 |
| --- | --- | --- |
| 所有工具都回「未启用」 | 工具按 `exec.agent.id` 认会话，面板按真实 session 记开关 | 在**同一会话**点开关；不要用 `'current'` 兜底 |
| 构建全绿、右栏页签永不出现 | keyed slot 缺 `key`，或没把页签注册进 `sidebarRightTabs` | 两处 key 与 `register({id})` 必须同值；改完跑 `pnpm test` |
| 面板接口一律 `HTTP 404` | `webServer` 在 `apply` 时还没激活 | 本仓已两级注册（先试一次 + `ctx.inject(['webServer'])`）；Network 里 `GET /api/auto-team/snapshot?sessionId=…` 应 200 且带 `roles` |

自检命令：

```bash
grep -rn 'sidebarRightTabs' src/client/slots.ts
grep -rn 'ctx.get' src/host/adapters.ts | wc -l
node --test test/r29-packaging.test.ts
```

## 已知限制

- **成员会话只能看 / 交自己的任务**，且成员自助也受开关约束：run 所属队长会话关掉时，`status` 与 `receipt` 同回「未启用」。
- **并发可能被宿主夹小**：设置填 6 实际只并行 3；设置是请求上限，快照带 requested / clamped 标记。
- **左栏栏目与主区整页项目库未真机验证（U2）**：注册失败会自动降级为面板内联库，右栏不受影响。
- **暂停只掐派发、回执与停滞判定**：已在跑的成员会继续写文件，要立刻停只能在面板中断该成员；计划落盘即自动派发，没有「先审后发」开关，想先复核就先点「暂停」。
- **老 run 的用量可能永远「不可得」**：结束于旧构建、会话已销毁；记忆页的 token 带 `≈`，是按字符估算（约「字符数 / 2」），不是 provider 上报值。

## 开发与验证（提交前必须全绿）

```bash
cd "$REPO" && pnpm typecheck
cd "$REPO" && pnpm test
cd "$REPO" && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run --cache /tmp/npm-pack-cache
```

一行复现整链：

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO" && pnpm typecheck && pnpm test && pnpm build && node --input-type=module -e "await import('./lib/index.js')" && node --input-type=module -e "await import('./lib/client.js')" && npm pack --dry-run --cache /tmp/npm-pack-cache
```

- 基线（2026-11-13 实测）：`pnpm test` **1257 通过 / 0 失败 / 0 skipped**（约 6–8s）；`lib/index.js` **637.90 kB**、`lib/client.js` **603.68 kB**；`npm pack --dry-run` 8 个文件（`package.json`、中英两份 README、`cordis.patch.yml`、两份 `lib/`、`locale/en.json`、`locale/zh.json`）。
- 数字随实现漂移：要当前数就重跑上面这组命令，不要拿本表去比对 CI 产物；包体积也会随 README 自身大小变化。
- 不要绕过：`lib/` 必须入库（`pnpm add file:` 的安装源）；本地 import 带 `.ts` 扩展名；host 与 client 零直接 import，只走 `GET/POST /api/auto-team`；宿主服务读取集中在 `src/host/adapters.ts`。

## 文档索引

| 想看什么 | 去哪 |
| --- | --- |
| 架构、模块契约、数据流转、构建 / 测试 / CI、未完成清单 | [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) |
| 宿主事件、UI 槽位、真机验证 | [HOST-EVENTS.md](docs/teamflow/architecture/HOST-EVENTS.md)、[UI-SLOTS.md](docs/teamflow/architecture/UI-SLOTS.md)、[REAL-HOST-VERIFY.md](docs/teamflow/architecture/REAL-HOST-VERIFY.md) |
| 团队约定与踩坑 | [memory.md](docs/teamflow/memory.md) |
| 同一需求修订的合并 / 作废 / 停止态 | [r21 合并与重规划](docs/teamflow/2026-11-10-r21-merge-replan/QA-REPORT.md) |
| 每个需求的任务夹（按日期倒序即迭代史） | [docs/teamflow/](docs/teamflow/) |
| 协作守则与文档索引 | [AGENTS.md](AGENTS.md) |

### 变更记录（最近 3 条，历史见 `git log` 与 [docs/teamflow/](docs/teamflow/)）

- **2026-11-13 · v0.2.2 面板可达与待回执**：角色卡、任务行、流程图节点点一下直接切到对应成员会话（`ctx.uiWorkspace.openSession`，无成员或会话不可达时说原因，不静默）；成员结束本轮却没交回执时记 `silentFinish`，任务行 / 成员页显示「待回执」并通知队长一次——只告知，不替成员完成、不自动返工；「未收口」徽标只在确认没有存活成员时出现。验：`pnpm test`（1257 例，含 `test/r34-silent-finish-wire.test.ts`）。
- **2026-11-13 · 成员自助**：`auto_team_status` / `auto_team_receipt` 在成员子会话可用——只回自己那条任务，传别人的 `taskId` 返回 `FORBIDDEN`，门禁仍走宿主同一条路径；开关关闭时两工具同态拒绝。验：`pnpm test`（含 `test/r30-member-self-service.test.ts` 12 条）。
- **2026-11-13 · 打包清单回归**：新增 `test/r29-packaging.test.ts`（6 条）——`version` 合法 semver、`engines` 与中英 README 兼容表逐字一致、`exports` / `files` 含 locale、双语 h2 与图片集合相等、真实 `npm pack` 清单含 7 个必需文件。为什么：这些项靠人手同步，漂移时「构建全绿、单测全绿」，谁也发现不了。
