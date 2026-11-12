# r27 角色模型真动态跟随会话默认 — QA 报告

- 需求夹：`docs/teamflow/2026-11-12-r27-model-follow/`
- 被测任务：t1 宿主侧（`readSessionRoute` / `readCallerRoute` / `modelRouteOf` / 复用闸门 / 路由审计）
- 本报告任务：t2 QA（单测 + 门禁 + 真机取证）
- 执行时间：2026-11-12
- 结论：**通过（有 1 个环境导致的真机样本项未验证，见 §7 U-1）**

## 1. 现象与证据（真机样本）

### 1.1 观察方法（只读取证，未改动真实会话）

会话日志是 zstd 压缩的 JSONL；本次只把文件复制读取到 `/tmp` 再解压，真实文件零写入：

```bash
zstd -dc session.v4.jsonl.zstd > /tmp/member-session.jsonl   # 只读副本
# 逐条提取 type=request/header 的 data.header.config
```

- 成员会话（`frontend-t2-s3ub6p-3`，memberId `7e7a9348-88f0-4b42-abc9-b42a15cded9a`）：
  `~/.dsh/sessions/--Users-maliang-Documents-develop-maliang-dsh-plugin-dsh-auto-team--/7e7a9348-88f0-4b42-abc9-b42a15cded9a/session.v4.jsonl.zstd`
- 队长会话（lead，session `b6814f6b-61ad-432e-bdb3-5c83a1b76003`）：
  `~/.dsh/sessions/--Users-maliang-Documents-develop-guangdahehui-nengtan--/session-b6814f6b-61ad-432e-bdb3-5c83a1b76003/session.v4.jsonl.zstd`
- 绑定证据：`~/.dsh/auto-team/runs/run-mwd75qu3-zoe.json`
  `bindings[0] = { taskId:'t1', roleId:'frontend', memberId:'7e7a9348-…', name:'frontend-t2-s3ub6p-3', spawnedAt:1794466730980 }`
  （该成员在 r23 t5 复用逻辑上线后被多轮 run 复用，r24/r25 期间同一 memberId 反复出现。）

### 1.2 成员会话 requestHeader 时间线（6 次，全部旧路由）

| # | 时间（2026-11-12，UTC+8） | provider | model | effort |
|---|---|---|---|---|
| 1 | 2026-11-11 10:34:06（创建） | `deepseek-official` | `deepseek-flash` | high |
| 2 | 2026-11-12 14:15:01 | `deepseek-official` | `deepseek-flash` | high |
| 3 | 2026-11-12 14:36:26 | `deepseek-official` | `deepseek-flash` | high |
| 4 | 2026-11-12 14:45:22 | `deepseek-official` | `deepseek-flash` | high |
| 5 | 2026-11-12 14:58:51 | `deepseek-official` | `deepseek-flash` | high |
| 6 | 2026-11-12 15:47:47 | `deepseek-official` | `deepseek-flash` | high |

### 1.3 队长会话 requestHeader 时间线（同期已切到会话默认）

| 时间（2026-11-12，UTC+8） | provider | model | effort |
|---|---|---|---|
| 11:41:57 | `deepseek-official` | `deepseek-flash` | high |
| **11:42:24** | **`magpie`** | **`group/deppseekv4.1-flash`** | — |
| 11:55:00 / 12:04:59 / 12:07:05 / 12:18:58 | `magpie` | `group/deppseekv4.1-flash` | high |
| 13:46:46 / 13:48:45 / 13:55:27 | `magpie` | `group/deppseekv4.1-flash` | high |
| 14:46:27 / 14:47:05 | `magpie` | `group/deppseekv4.1-flash` | high |
| 15:17:40 / 15:18:04 / 16:00:35 / 16:01:06 | `magpie` | `group/deppseekv4.1-flash` | high |

**结论**：队长会话自 11:42:24 起已是 `magpie/group/deppseekv4.1-flash`，而同一成员在 14:15 / 14:36 / 14:45 / 14:58 / 15:47 五个轮次仍为 `deepseek-official/deepseek-flash`。这与「复用成员停留在创建时模型」的缺陷描述逐字吻合；缺陷在两个层面：

1. **复用不校验路由**：r23 t5 的复用分支只判断「同角色、未退休、空闲」，从不读成员会话当前路由，导致一旦复用就永久冻结旧模型。
2. **新建路由可能混合**：`fallbackProvider()` 读的是全局 `agentDefaultModel.currentSelection()`（`deepseek-official`）且只取 provider，不取 model；父会话 model 若来自另一 provider，会拼出「全局 provider + 父会话 model」的半截/混合路由。

## 2. 修复前后路由对照表

| 场景 | 修复前 | 修复后（本次断言的行为） |
|---|---|---|
| 新建成员，角色未声明模型，队长会话路由 = `A/B` | `fallbackProvider()` = 全局 provider `X` + 队长 model `B` → `X/B` 混合 | `readCallerRoute` 读到 `A/B`，**provider 与 model 成对**下发 |
| 新建成员，角色显式声明 `C/D` | `C/D` | `C/D`（不变，会话默认不得覆盖） |
| 新建成员，队长路由不可读、`currentSelection` = `X/B` | 只取 `X`，model 缺失 | 取 `X/B` 成对；只剩 provider/model 半截时 → `undefined`，spawn 不传 `agentOptions` |
| 新建成员，两者都不可读 | 可能产出半截路由 | `undefined`，不凭空造 provider/model |
| 复用成员，成员路由 = 目标路由 | 复用 | 复用（`routeAllowsReuse` = true） |
| 复用成员，成员 `A/B`，目标 `A/C`（仅 model 不同） | 直接复用 → 旧模型 | 不复用，落回 spawn；activity 写「成员 … 的模型是 …，本次目标模型是 …，模型不一致，改为新建成员」 |
| 复用成员，成员 `A/B`，目标 `X/B`（仅 provider 不同） | 直接复用 → 旧 provider | 同上，不复用 |
| 复用成员，两边都读不到路由 | 复用 | 仍复用（老宿主不退化，两边缺失视为一致） |
| 复用成员，仅单边可读 | 复用 | 不复用（宁可新建，不冒用未知路由） |
| 复用成员，目标未声明（跟随会话默认） | 不比较 | 目标取当前会话路由后再比 |
| 路由审计 `actual` | 用声明值/spawn 入参，可能假 `ok` | spawn/复用后 `readSessionRoute(成员会话)`；读不到 → `unverified`，绝不拿声明值冒充 |

判定函数：`src/host/team/dispatch.ts:493 routeAllowsReuse(target, actual)` —— 两边都 undefined → `true`；单边 → `false`；否则 `provider` 与 `model` 都相等（`reasoningEffort` 不参与复用判定）。
文案：`routeTextOf`（不可得） + `describeRouteOf`（`provider/model #effort`），见 `src/host/team/route.ts:143`。

## 3. AC 对照（单测逐条映射）

测试文件：`test/r27-model-follow.test.ts`（23 例，23 pass / 0 fail / 0 skip，真实 `RunsStore` + `createBridge` 夹具，未 mock 被测逻辑）。

| AC | 判定 | 用例（行号见文件） | 结果 |
|---|---|---|---|
| AC-1 `readSessionRoute` 完整 config 逐字返回 | provider/model 相同；合法 effort 才带上 | `readSessionRoute：完整 config → 逐字返回 provider/model（合法 effort 才带上）`（:46） | ✅ |
| AC-2 `requestHeader` 返回 undefined / config 缺 model → undefined | 不补猜，不返回半截 | `readSessionRoute：requestHeader 返回 undefined / config 缺 model → undefined（不补猜）`（:59） | ✅ |
| AC-3 session 不存在 / `agents.get` 不可用 / 读口抛错 → undefined 且不抛 | `assert.doesNotThrow` + undefined | `readSessionRoute：session 不存在 / agents.get 不可用 / 读口抛错 → undefined 且不抛`（:78） | ✅ |
| AC-4 `readCallerRoute` 读队长会话路由 | 与队长会话 header 一致；无 initiator → undefined | `readCallerRoute：当前队长会话的真实路由；没有 initiator 时 undefined`（:101） | ✅ |
| AC-5 角色声明优先 | 声明 `C/D` 时忽略会话路由 | `modelRouteOf：角色声明优先于会话路由（显式模型不被会话默认覆盖）`（:139） | ✅ |
| AC-6 未声明 + 会话路由可读 → 逐字相等（provider/model 成对） | 深相等 | `modelRouteOf：未声明 + 会话路由可读 → 与会话路由逐字相等（provider/model 成对）`（:147） | ✅ |
| AC-7 会话路由不可读 + `currentSelection` 可读 → 取其 provider **与 model** | 不得只取 provider | `modelRouteOf：会话路由读不到 + currentSelection 可读 → 取 currentSelection 的 provider 与 model（不只 provider）`（:159） | ✅ |
| AC-8 后台派发（无 caller）→ 用 run 会话路由兜底 | 不落到全局默认 | `modelRouteOf：caller 无路由时用本次 run 的会话路由兜底（后台派发）`（:172） | ✅ |
| AC-9 都不可读 → undefined，spawn 不传 `agentOptions` | 不造 provider | `modelRouteOf：都读不到 → undefined，spawn 不传 agentOptions 且不凭空造 provider`（:179） | ✅ |
| AC-10 `currentSelection` 只有 provider → 不产出半截路由 | `agentOptions === undefined` | `modelRouteOf：currentSelection 只有 provider → 不产出半截路由（agentOptions undefined）`（:187） | ✅ |
| AC-11 复用闸门：一致 → 复用（sendMessage，不新建） | `started`/`reused` 与请求数 | `复用闸门：成员会话路由与目标一致 → 复用（sendMessage，不新建）`（:306） | ✅ |
| AC-12 复用闸门：provider 不同 → 不复用、走 spawn，activity 有可读原因 | spawn 1 次 + 消息含「模型不一致，改为新建成员」 | `复用闸门：provider 不同 → 不复用、走 spawn，activity 里有可读原因`（:324） | ✅ |
| AC-13 复用闸门：model 不同 → 同上 | 同上 | `复用闸门：仅 model 不同 → 同样不复用、走 spawn`（:344） | ✅ |
| AC-14 两边都读不到 → 仍复用 | 老宿主不退化 | `复用闸门：两边都读不到 → 仍复用（老宿主不退化）`（:358） | ✅ |
| AC-15 目标路由未声明 → 取会话当前路由再比 | provider 同、model 不同 → 新建 | `复用闸门：目标路由未声明时取会话当前路由再比（provider 相同 model 不同 → 新建）`（:370） | ✅ |
| AC-16 目标未声明且与会话一致 → 复用 | 复用 | `复用闸门：目标路由未声明且与会话路由一致 → 复用`（:383） | ✅ |
| AC-17 单边缺失 → 不复用 | 宁可新建 | `复用闸门：单边缺失（成员可读、目标读不到）→ 不复用，宁可新建`（:397） | ✅ |
| AC-18 装配层未接 `readSessionRoute` → 整体跳过比较 | 不因老装配永远新建 | `复用闸门：装配层没接 readSessionRoute（老装配）→ 整体跳过，不因读不到而永远新建`（:411） | ✅ |
| AC-19 审计：spawn 后 `actual` = 成员会话路由，`verdict=ok` | audit 记录真实路由 | `审计：spawn 后 actual 等于成员会话路由，verdict=ok`（:424） | ✅ |
| AC-20 审计：路由不同 → `drift`，任务标记失败、留可读消息 | verdict drift + 消息 | `审计：成员会话路由与声明不同 → verdict=drift，任务标记失败并留可读消息`（:444） | ✅ |
| AC-21 审计：读不到 → `unverified` | 不拿声明值假装生效 | `审计：读不到成员会话路由 → 保持 unverified（不拿声明值假装生效）`（:463） | ✅ |
| AC-22 复用成员也审计 | 复用后 actual 来自会话 | `审计：复用成员同样按会话真实路由审计（verdict=ok）`（:481） | ✅ |
| AC-23 `routeAllowsReuse` 四组合 | 一致/不一致/两边缺/单边缺 | `routeAllowsReuse：一致/不一致/两边缺/单边缺四种组合`（:297） | ✅ |

## 4. 变异自检（证明断言会红，不是同义反复）

| # | 注入的错误实现 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| M1 | `dispatch.ts` 复用闸门 `const routeMatches = deps.readSessionRoute === undefined \|\| routeAllowsReuse(targetRoute, actualRoute)` 改为 `const routeMatches = true`（恒复用） | 至少 1 例红 | `node --test test/r27-model-follow.test.ts` exit 1；4 例红：provider 不同、仅 model 不同、目标回退会话路由、单边缺失 | ✅ 红 |
| M2 | `adapters.ts modelRouteOf` 的返回改成只带 `{ provider: route.provider }`（只取 provider） | 至少 1 例红 | exit 1；3 例红：成对路由、`currentSelection` 成对、run 会话兜底 | ✅ 红 |

两次变异后均把源码按原字节回写（脚本比对 `bytes_equal: true` 且 sha256 一致），再跑全量门禁确认全绿。

## 5. 门禁证据

命令与日志：`.auto-team/artifacts/qa-t2-r27-final.log`

| 门禁 | 退出码 | 证据 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc --noEmit`，无输出 |
| `pnpm test` | **0** | `tests 1138 / pass 1137 / fail 0 / skipped 1 / todo 0` |
| `pnpm build` | **0** | `lib/client.js 587.57 kB（gzip 145.07）`、`lib/index.js 602.57 kB（gzip 199.40）` |

`lib/` 双产物（本次构建，2026-11-12 16:00:13）：

| 文件 | 字节数 | sha256 |
|---|---|---|
| `lib/index.js` | 602574 | `ed0e575bf994685b568cbdc4108f0418bc6bd879f9898139fd0c0a61f588cd01` |
| `lib/client.js` | 587574 | `b2312b5ad81f34e5c95b90ac2c79dd9ea9f2bcc51d036531942cb9f118bd5514` |

```bash
node --input-type=module -e "await import('./lib/index.js')"   # INDEX_IMPORT_OK
node --input-type=module -e "await import('./lib/client.js')"  # CLIENT_IMPORT_OK
```

### 唯一 skipped 的说明

`test/r25-closed-run-cards.test.ts` 的真实数据用例本次 skip：现场两条 run 已被运行中的宿主插件按 r25 逻辑修复（残留任务 = 0），没有「修复前」样本可验。该用例已改为「检测到残留为 0 时跳过并指向 r25 QA-REPORT」，并保留「被终结任务数 = 修复前残留数」的逐 run 断言，不是为通过门禁而放宽断言。非 r27 回归。

## 6. 真机验证步骤（需重启宿主后执行）

1. 确认本轮 `lib/index.js` 的 sha256 与上表一致，重启宿主（profile 安装源为仓库 `lib/`，改源码后必须重新安装/重启才能生效）。
2. 在队长会话切一次模型（例如切到 `magpie/group/deppseekv4.1-flash`），发一条消息确认新会话 `request/header` 已是新路由。
3. 派一个「同角色、可复用旧成员」的任务（旧成员创建于另一个模型），观察：
   - 自动团队 activity 出现「成员 … 的模型是 …，本次目标模型是 …，模型不一致，改为新建成员」；
   - 新成员会话 `session.v4.jsonl.zstd` 的首个 `request/header.data.header.config` 与新会话路由**逐字相等**；
   - `~/.dsh/auto-team/runs/<runId>.json` 的 `routeAudits` 中该任务 `actual` 为新路由，`verdict` 非 `unverified`（角色声明了模型时为 `ok`/`drift`）。
4. 反向验证：同模型下再派一次，确认复用旧成员（不新建），activity 无「改为新建成员」。
5. 老宿主回归：`readSessionRoute` 读不到时复用照旧（可临时把 `deps.readSessionRoute` 置空验证，或依赖单测 AC-18）。

## 7. 未验证项（如实列出）

- **U-1 真机端到端未跑**：本次只做了只读取证 + 夹具单测，未重启宿主、未实际切模型派任务验证「activity 出现改为新建成员 + 新成员 requestHeader 等于新路由」。需要主 agent 在重启宿主后按 §6 执行一次。原因：重启宿主会影响当前会话，属主 agent 权限。
- **U-2 修复前的混合路由（全局 provider + 队长 model）无同期真实样本**：11-11 队长与全局默认恰好同为 `deepseek-official/deepseek-flash`，未观察到混合路由落地；该缺陷由源码结构（`fallbackProvider` 只取 provider）证明，单测 AC-10 覆盖，但没有历史报文可引用。
- **U-3 `reasoningEffort` 不参与复用判定**：`routeAllowsReuse` 只比 provider/model；effort 不同仍复用。这是 t1 的实现选择（需求只要求 provider/model 成对），本报告按现状记录，未判为缺陷。
- **U-4 审计只对声明了模型的角色写 `routeAudits`**：未声明模型的角色在 `dispatch.ts` 的审计分支被跳过（`if (role.model)`），复用/新建都不会产生审计行。这是现状行为，本报告未断言其应改。
- **U-5 队长会话样本来自另一个工作区**（`guangdahehui-nengtan`）：该 session id 是 run 记录里的 `plan.sessionId`，与本次 QA 工作区不同；若宿主未来把 lead 会话迁走，取证路径需同步更新。
