# r19 真机复验（第二宿主 dv / 51890，2026-11-05 14:51–14:56）

## 环境

- 第二宿主：`~/.dsh/profiles/dv`，`--profile dv --no-open --port 51890`，启动日志无 `did not activate`。
- 安装副本：把仓库 `pnpm build` 产物 `lib/index.js`(488480 B) 与 `lib/client.js`(507099 B) 覆盖进
  `~/.dsh/profiles/dv/node_modules/dsh-auto-team/lib/`（宿主是 `file:` 硬链接安装，改 profile 即改仓库）。
- 浏览器：`chrome-headless-shell` + CDP，复用 `/tmp/cdp-profile`（全新 user-data-dir 会落在空白 New Session、
  没有面板头按钮）；token 走一次性 URL 换 cookie。

## 1. 左栏项目名 = 工作区 title（r19c）

`GET /api/auto-team/library` 实测：

| 项目 | 运行数 |
|---|---|
| `dsh-auto-team` | 19 |
| `nengtan` | 1 |

- 改前：`desktop`（profile 目录）/ `tmp` / `历史运行（未记录工作区）`。
- 改后：旧 run 全部经 `sessionId → workspaceRegistry` 聚合到真实工作区；`desktop` 桶消失，
  0 次运行的项目仍然隐藏。宿主未注册的目录（如 `/private/tmp`）按 basename 兜底，不吞。
- 真机截图：`r19-library-workspaces.png`（2 个项目、`data-project-count="2"`、
  `[data-auto-team-library]` 900=视口 900、抽屉 900 / body 856 / 遮罩 900）。

## 2. 记忆自动沉淀（r19b）

真机触发方式：在 dv 上造一条 `dispatching` 探针 run，通过 `act.cancel` → `confirmPending`
走宿主真实 saveState 路径（plan 变 `cancelled`）：

```
.auto-team/memory/run-run-memprobe-01.md
# 记忆落盘探针 · run-memprobe-01
- 状态：已取消 · 2026-11-05 15:00
- 项目：/private/tmp · 会话：session-dc39ce5c…
- t1 [pending] 打印 hello
```

- 文件由 `bridge.recordRunMemory` 在 `store.save` 之前写出，标题取首行 `#`（记忆页与注入索引同一规则）。
- 同一快照 `memory.injectedChars` 从 0 变为 237，`files` 2 条、`inline` 标题正确 → 注入链路闭环。
- 无失败信号时**没有**写公共轨（符合「有返工/门禁失败才写教训」的口径）。
- 探针文件已清理（run JSON、两条 md、目录），清理后 `injectedChars` 回到 0。

## 3. 流程图画布 600px（r19d）

页签「任务」→ 流程图：

```
canvas {w:594, h:600, height:"600px", overflow:"hidden", position:"relative", viewportH:900}
```

- 与设计一致：300px → 600px 只改 CSS；`overflow:hidden` / `position:relative`（r14 D4 定位上下文）保持。
- 真机截图：`r19-flow-600.png`。
- 静态契约：`test/r19-flow-height.test.ts` 3 例；`test/client-ui.test.ts` 旧「画布 300」断言同步为 600。

## 门禁（队长在本机复跑）

```
pnpm typecheck → exit 0
pnpm test      → 928 / 928 pass
pnpm build     → lib/index.js 488.48 kB；lib/client.js 507099 B
node --input-type=module -e "await import('./lib/index.js')"  → ok
node --input-type=module -e "await import('./lib/client.js')" → ok
npm pack --dry-run → 5 files, 298.0 kB
```

## 未覆盖 / 已知边界

- 记忆「run 结束即写」在真机用 cancelled 路径验证；terminated 路径由单测覆盖（同一函数、同一 saveState 入口）。
- 公共轨（教训）未在真机触发（无失败 run）；单测覆盖。
- 历史 run 若早于 workspaceRegistry 记录、且没有 sessionId，仍落「历史运行（未记录工作区）」桶。
- 本会话 Team roster 已满 8（不可删），全部实现由 subagent 完成，任务回执由队长代跑。
