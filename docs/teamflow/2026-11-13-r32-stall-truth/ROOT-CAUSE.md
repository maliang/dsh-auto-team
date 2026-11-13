# r32 假停滞：根因与修复

- 需求：修「成员明明在干活，面板却报 stalled」。t2 成员 `22fed7a4`（会话 434 行 / 55 step / 63 tool.call、
  文件 10:34 仍在增长）被判 `stalledForMs=1210840`，`lastEventAt` 停在派发时刻。
- 结论：**不是阈值问题，是两处断链 + 一处不诚实的兜底**。三者叠加才产生「20 分钟干活被判 20 分钟停滞」。

## 1. 断链点（path:line）

### 1.1 进度信号从来没有落过盘（主因）

- 订阅：`src/host/adapters.ts:1744` `onMemberProgress()`，在**根作用域**订阅 `tools/result` / `agent/status`，
  回调里再用 `memberIdentityOf()` 反查 binding。
- 写盘：`src/host/index.ts` `onMemberProgress` 处理器 → `recordProgress()`（本次新增，见 §2）→
  `state.progress[memberId].at`；旧实现内联在处理器里，同样只在这条链上写。
- 真机事实（决定性）：`cd ~/.dsh/auto-team/runs && grep -l '"progress":{[^}]' *.json` → **0 命中**；
  同期 `routeAudits` / `stallAlerts` 也是 0 命中。也就是说 11-12～11-13 的全部 run 里，这条链**一次都没写过**，
  而成员会话有几十次工具调用。
- 为什么断：宿主 `tools/result` 的 scope 过滤 **keyed by `exec.agent`**
  （宿主 `this.ctx.events.dispatch('emit', [scopeTarget(this.tools, exec.agent), 'tools/result', exec, result])`），
  官方事实文档 `docs/teamflow/architecture/HOST-EVENTS.md` §3.2 的结论就是「按成员归属工具调用只有一条正路：
  在 `agent.ctx` 上注册 `tools/result`」。插件过去只在根作用域订阅（`subscribeHostEvent` 的 `{global:true}`），
  成员作用域的调用是否被投递到根监听器**不是宿主契约**，实测即「收不到 / 收不全」。
- 第二处断链：`src/host/adapters.ts:1955` `memberIdentityOf()` 读 `subagents.namesOf(agent).name`，
  而宿主 0.2.2-rc.2 的 `namesOf()` 返回 `{ self, parent }`（`self` 是 `lead/dev-t1-…` 这样的斜杠路径），
  **没有 `name` 字段** → 名字恒为空串，按名字匹配 binding 的分支永久失效，且失败路径没有任何日志。
- 第三处：`src/host/index.ts` 处理器里 `if (!hit) continue` —— 信号来了但对不上 binding 时**完全静默**，
  真机上无法区分「没信号」与「信号有但对不上」。

### 1.2 兜底把「没证据」算成「停滞」

- `src/host/bridge.ts:1283` `stallFieldsOf()`：`const baseline = progressAt ?? fallbackAt`，
  调用方传的是 `binding.spawnedAt`。于是「一条进度都没有」时，从**派发时刻**开始倒计时 ——
  这正是 `stalledForMs=1210840` 的来源（1210840 ≈ 20 分钟，恰好等于成员干活时长）。
- `src/host/team/watcher.ts:186` 同样的回落（`record?.at ?? binding.spawnedAt`）会给这类成员发「停滞」告警。

## 2. 修复

### 2.1 让进度信号真的到达、真的落盘

- 新增 `src/host/adapters.ts:1821` `watchMemberProgress(ctx, memberId, handler)`：
  用 `ctx.agents.get(memberId)` 取**活着的** agent，在它自己的 `agent.ctx` 上订阅 `tools/result` 与
  `agent/status`（只接本人调用，`owner.id` 与 `memberId` 不一致的丢弃），返回 `{ ok, reason?, stop }`。
  根作用域订阅保留为兜底（双保险，不是主路）。
- `src/host/index.ts:269` `recordProgress(memberId, at)`：按 `memberId` 找非退役 binding，
  **1 秒内（`PROGRESS_SAVE_MIN_MS`）的重复信号合并成一次 `store.save`**，不逐次刷盘。
- `spawn` / `resume` 成功后立刻挂订阅；根作用域收到信号时也会补挂（`watchMember`，按成员去重）。
- `src/host/adapters.ts:1955` `memberIdentityOf()` 改为读 `namesOf().self` 的**最后一段**（再退 `.name`），
  并把 id 作为主匹配键。
- 可观测性：信号对不上 binding 时按 agent id 只 warn 一次
  （`推进信号来自未登记的 agent（id=… name=…）：本轮进度不会推进`）；
  老宿主没有 `agents.get` 属能力缺口，静默降级（不刷 warn，见 §2.2 的诚实语义）。

### 2.2 兜底改成诚实：区分「真停滞」与「没证据」

- `src/host/team/stall.ts:48` `stallOf(progressAt, now, stallMs)` —— **删除 baseline 参数**，
  没有 `progressAt` 就不可能有任何时间推断：
  - 无/非法 `progressAt` → `reason: 'unreported'`，`stalled: false`，`stalledForMs: 0`
  - `now - progressAt < stallMs` → `reason: 'none'`
  - 否则 → `reason: 'quiet'`，`stalled: true`，`stalledForMs = now - progressAt`
- `src/host/team/stall.ts:66` `stallNoteOf('unreported') = '宿主未上报推进信号，无法判定是否停滞'`（其余为空串）。
- 契约字段（`src/shared/types.ts`）：`StallReason = 'none' | 'quiet' | 'unreported'`（唯一来源），
  `MemberView.stallReason?: StallReason`、`MemberView.stallNote?: string`。
- `src/host/bridge.ts:1283` `stallFieldsOf(state, memberId, status, stallMs)` 不再接受任何基线，
  透出 `stalled / stalledForMs / stalledSecondsText / stallReason / stallNote`；
  `lastEventAt` 现在也把 `state.progress[memberId].at` 折进去（Math.max）。
- `src/host/team/watcher.ts:186` 只对 `reason === 'quiet'` 发停滞告警，`unreported` 一条都不发。
- 客户端**零阈值**：`src/client/nav.ts` 把 `stallNote` 原样放进 `MemberPageView`，
  `src/client/views/MemberPage.tsx` 在非 stalled 时直接渲染该文案（不自己算秒数、不自己定阈值）。

## 3. 为什么以前没暴露

- 阈值 `config.STALL_MS = 90_000`（不是需求卡写的 45000），只有成员**连续干活超过 90 秒**才会碰到这条路径；
  绝大多数 run 的成员在 90 秒内就结束了，面板根本没机会显示停滞。
- 即使显示，也长得像「成员卡住了」，而这条链在真机上从未成功过 —— 一个**永久为空**的进度表配上
  一个**永远有值**的 `spawnedAt` 兜底，等于把「无证据」稳定地渲染成「差评」，谁也不会怀疑它。
- 失败路径全静默（名字读不到、binding 对不上都没有日志），宿主运行日志里也没有 `[auto-team]` 痕迹。

## 4. 修复后如何验证

离线（本次已跑）：

```
node --test test/stall.test.ts            # 22 pass / 0 fail（含「从未收到信号 → 一条告警都不发」+ 对照用例）
node --test test/bridge.test.ts           # 63 pass / 0 fail（含 unreported → 证据不足、lastEventAt 折入 progress）
node --test test/r32-stall-truth.test.ts  # 成员 ctx 订阅 / 他成员调用被过滤 / 失败原因 / namesOf self 解析 / 面板文案
pnpm typecheck && pnpm test
```

真机（下次 run 复查）：

1. `grep -o '"progress":{[^}]*}' ~/.dsh/auto-team/runs/<runId>.json` 必须非空，且成员每次实质工具调用后 `at` 前进（≤1 秒合并）。
2. 成员在跑时 `auto_team_status` 的 `lastEventAt` 必须跟着前进；不再停在派发时刻。
3. 若宿主**从未**上报进度：面板显示「宿主未上报推进信号，无法判定是否停滞」且**不出现**黄色停滞条
   （`stalled=false`、`stalledForMs=0`、`stallReason='unreported'`）。
4. 真实静默（有信号后 90 秒无推进）：`stallReason='quiet'`、`stalledForMs≈now-progressAt`，措辞仍为「⏳ N 秒无实质产出」。

## 5. 写域偏差（已获队长同意）

- `src/host/team/watcher.ts`：两行（`stallOf` 调用去掉 spawnedAt 基线；告警时间戳改用 `record.at ?? now`）。
  不改就仍会给「从未上报进度」的成员发停滞告警，与 §2.2 自相矛盾。
- `src/client/nav.ts`、`src/client/views/MemberPage.tsx`：透出/渲染 `stallNote`（客户端零阈值要求）。
- 测试：`test/stall.test.ts`、`test/bridge.test.ts` 更新旧语义断言 + 新增 `test/r32-stall-truth.test.ts`。
  `test/wire.test.ts` 的改动已全部回退（工作区里与 HEAD 一致）。
