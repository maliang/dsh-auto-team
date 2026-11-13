# r31 读取纪律 + 任务卡行号指针 —— QA 报告（t2）

- 任务：t2 / 回归测试 + 改动前基线报告（r31）
- 日期：2026-11-13
- 仓库：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`
- 基线：git HEAD `ec3ab84` + t1 未提交改动（`src/host/team/member-prompt.ts`、`src/host/team/dispatch.ts`、`src/host/tools.ts`、`test/wire.test.ts`、`test/r28-token-saving.test.ts`）
- 结论：门禁全绿（1186 例）；①②③④ 各有可执行回归；新增 8 个突变反证全部变红；发现 1 个 P2 缺陷（D1，复用成员路径不写软提示，不阻断门禁）；⑤ 基线以真实历史会话产出快照（单组、非 A/B）。

## 1. 验收项与用例对照

新增用例文件：`test/r31-read-discipline.test.ts`（7 例，全部通过）。定向运行命令与结果：

```bash
node --test test/r31-read-discipline.test.ts
# ℹ tests 7  ℹ pass 7  ℹ fail 0
```

| AC | 判据 | 用例 | 结果 |
|---|---|---|---|
| ① | `buildMemberPrompt` 含 `## 读取纪律` 段 | `r31① 读取纪律段：≤400 字符、四条短语逐字、位于「工作纪律」之后「验收判定」之前` | 通过 |
| ① | 段正文 ≤400 字符（实测 341） | 同上 | 通过 |
| ① | 四条短语逐字：`sed -n '110,230p'`、`head -40`、`--include=`、`grep -n` | 同上 | 通过 |
| ① | 顺序：`## 工作纪律` < `## 读取纪律` < `## 验收判定` | 同上 | 通过 |
| ② | `hasLinePointer` 五形态 | `r31② hasLinePointer：带扩展名路径 + 行号才算指针，裸路径/时间/URL 端口/空串都不算` | 通过 |
| ③ | 无指针 + 首次派发：恰好多 1 条 captain→user，含 taskId，排在派发消息之后 | `r31③ 无指针任务：首次派发恰好多一条 captain→user 软提示，带 taskId 且排在派发消息之后` | 通过 |
| ③ | 标题/写域带指针：零新增 captain→user | `r31③ 有指针任务：标题或写域带 path:line 时零新增 captain→user 消息` | 通过 |
| ③ | rework 重派不重复（消息数不增） | `r31③ rework 后重派不重复提醒：captain→user 软提示恒为 1 条（消息数不增）` | 通过 |
| ③ | attempts>0 判据独立于 binding | `r31③ attempts>0 的重派即使没有历史 binding 也不再提醒（返工判据独立成立）` | 通过 |
| ④ | `TASK_ITEM_SCHEMA.title.description` 含 `path:line`（plan 与 add_tasks 同源） | `r31④ TASK_ITEM_SCHEMA.title.description 要求 path:line（plan 与 add_tasks 同源）` | 通过 |

② 的具体形态：`src/host/tools.ts:123` → `true`；`src/host/tools.ts`、`12:30`、`https://x:443`、`''` → `false`。

③ 的断言不挑「第一条/最后一条」，而是按稳定特征（`from === 'captain' && to === 'user' && taskId === 't2'`）过滤后计数；对派发消息的定位沿用 t1 修订后的稳定特征（body 含「已派发给你」且带 `toMemberId`）。顺序断言用 `indexOf` 比较：派发消息必须早于软提示。

## 2. 突变反证（先问「改回错误实现会不会红」）

每次只改一处，跑 `node --test test/r31-read-discipline.test.ts`，记录变红用例，然后用备份 `cp` 还原；8 次还原后 `git diff --stat` 与初始一致、无 `.mutbak` 残留。

| # | 突变 | 变红的断言 | 结果 |
|---|---|---|---|
| M1 | 短语 `sed -n '110,230p'` → `sed -n '1,2000p'` | ① 四短语逐字 | fail>0 ✅ |
| M2 | 读取纪律段正文追加内容至 >400 字符 | ① 长度 ≤400 | fail>0 ✅ |
| M3 | `LINE_POINTER_RE` 放宽为 `[\w.-]+:[0-9]+` | ② `https://x:443`、`12:30` 判 true | fail>0 ✅ |
| M4 | 去掉 `dispatchedBefore`（保留 `!hasLinePointer`） | ③ rework 两例（提示重复 2 条） | fail>0 ✅ |
| M5 | 去掉 `!hasLinePointer(cardText)` 条件 | ③ 有指针任务零新增 | fail>0 ✅ |
| M6 | 软提示 `to: 'user'` → `to: 'captain'` | ③ 无指针首次派发、rework（不再归 user） | fail>0 ✅ |
| M7 | `TASK_ITEM_SCHEMA.title.description` 删掉 `path:line` | ④ schema | fail>0 ✅ |
| M8 | 软提示插到账本最前（`unshift`） | ③ 软提示排在派发消息之后 | fail>0 ✅ |

结论：①②③④ 的断言都能被对应错误实现打红，不是「永远绿」的装饰。

## 3. D1 缺陷（P2，未修：`src/` 不在本任务写域）

**症状**：复用空闲成员派发新任务时，即使该任务首次派发且任务卡没有任何 `path:line`，也不会产生 AC③ 要求的 captain→user 软提示；新建成员路径正常。表现为「同一份计划里，有些任务有提示、有些没有」，且只发生在成员被复用（bindings 中已有旧任务记录、成员 idle、角色一致）时。

**根因**：`src/host/team/dispatch.ts` 有两条派发路径：
- 新建成员分支在 spawn 成功后执行软提示（`dispatchedBefore = (task.attempts ?? 0) > 0 || state.bindings.some(...)`，`if (!dispatchedBefore && !hasLinePointer(cardText))` 才 append，约 925–940 行）；
- 复用分支在 `deps.sendMessage(reusable.memberId, card)`（774 行）成功后直接写 binding / 置 running，没有等价的软提示代码（约 765–800 行）。

因此 AC③ 的「首次派发 + 无指针 → 恰好 1 条」只在 spawn 路径成立，复用路径恒为 0 条。门禁不受影响：软提示缺失不阻断派发、不改任务状态，所以 `pnpm test` 全绿。

**复验命令**（脚本在 `docs/` 下，可复跑；当前应 exit 1，修复后应 exit 0）：

```bash
node docs/teamflow/2026-11-13-r31-read-discipline/repro-reuse-hint.mjs
# 现状：started=["t2"] reuseMessages=1 toUser=0 → exit 1
# 修复后：PASS：复用成员路径也写了带 taskId 的软提示 → exit 0
```

**建议修改**：在复用分支 `sent === true` 的分支里，复用与 spawn 分支相同的判断（`task.attempts` 与 `bindings` 是否已有本任务记录、`hasLinePointer(cardText)`），append 同一条带 `taskId` 的 captain→user 消息；也可把该逻辑抽成 `maybeHintMissingPointer(next, task, cardText, at)` 两处调用，避免再次漂移。修复后应把 `repro-reuse-hint.mjs` 的期望行为并进回归（或转为正式 test 用例）。

## 4. ⑤ 读取行为基线快照（改动前，非 A/B 结论）

脚本：`docs/teamflow/2026-11-13-r31-read-discipline/measure-read.mjs`；本次快照 JSON：`docs/teamflow/2026-11-13-r31-read-discipline/baseline-2026-11-13.json`。

### 4.1 样本与只读处理

- 数据源：`~/.dsh/auto-team/runs/*.json`（46 个 terminated run）→ 按 `plan.createdAt` 倒序取最近 **20** 个 run；按 `binding.memberId` 去重得 24 个成员，其中 **20 个** 存在 transcript（`~/.dsh/sessions/--Users-maliang-Documents-develop-maliang-dsh-plugin-dsh-auto-team--/<memberId>/session.v4.jsonl.zstd`），4 个无 transcript 被排除。
- 只读：源 transcript 仅被 `zstd -dc` 读取；脚本先把样本拷到 `/tmp/r31-read-baseline-sample/<memberId>/`，逐份校验 sha256 与源文件一致后，**只从副本统计**（本次 20/20 一致）。
- 基线纯度：20 份样本全文检索 `读取纪律` = **0 命中**，确认这些会话产生时成员提示词尚未包含该段（即真实「改动前」行为）。

### 4.2 口径（固定，复测不得改）

- 读类命令：`read` / `grep` 工具调用；bash 命令出现 `cat|head|tail|sed|grep|rg|awk|less|more|bat|wc` 或 `git diff|git show|git log -p`。**先判测试/typecheck**，命中则归测试类，不算读类。
- 字节：该次调用 `tool/result` 中 text block 的 UTF-8 字节（真正进入上下文的文本量）。
- 单次 >8KB：上述字节 > 8192 的读类调用。
- 测试/typecheck 占比：bash 调用中命中 `pnpm test|node --test` 或 `pnpm typecheck|tsc --noEmit` 的比例（一条命令同时含两者只计一次 gate）。
- 会话内重复读：按「文件路径」计（read→`file_path`；grep→`path`；bash 读命令取带扩展名的路径 token）；同一路径在本会话第 2 次及以后出现即重复读。比例 = 重复读事件 / 全部可识别路径的读事件。

### 4.3 总量快照（20 个成员会话）

| 指标 | 数值 | 占比 |
|---|---:|---:|
| 工具调用总数 | 2,216 | — |
| 读类调用 | 1,525 | 68.8% of 工具调用 |
| 读类字节 | 6,219,355 B（约 6.22 MB） | — |
| 单次 >8KB | 194 | 12.7% of 读类调用 |
| bash 调用 | 1,611 | — |
| 其中 test 命令 | 174 | — |
| 其中 typecheck 命令 | 95 | — |
| gate（test 或 typecheck） | 230 | 14.3% of bash |
| 可识别路径的读事件 | 2,238 | — |
| 会话内重复读 | 1,397 | 62.4% of 读事件 |

单会话读字节分布：min 15,831 / median 152,084.5 / max 1,053,030；读字节最高的 3 个会话合计 2,702,395 B，占样本 43.4%。

### 4.4 每会话明细（按读字节倒序）

| task | role | readCalls | readBytes | >8KB | bash | gate | dup% |
|---|---|---:|---:|---:|---:|---:|---:|
| t1 | frontend | 244 | 1,053,030 | 32 | 218 | 41 | 60% |
| t1 | dev | 219 | 827,727 | 24 | 213 | 20 | 79% |
| t2 | dev | 126 | 821,638 | 38 | 144 | 23 | 60% |
| t2 | qa | 198 | 635,996 | 12 | 242 | 33 | 65% |
| t5 | dev | 121 | 462,393 | 15 | 124 | 12 | 67% |
| t4 | qa | 83 | 451,431 | 14 | 100 | 25 | 59% |
| t2 | qa | 82 | 335,809 | 12 | 86 | 9 | 51% |
| t3 | frontend | 61 | 307,629 | 11 | 61 | 8 | 70% |
| t1 | architect | 68 | 230,415 | 8 | 73 | 0 | 76% |
| t1 | dev | 34 | 172,188 | 5 | 31 | 4 | 17% |
| t4 | dev | 26 | 131,981 | 5 | 32 | 5 | 65% |
| t1 | dev | 18 | 129,594 | 6 | 16 | 3 | 56% |
| t3 | qa | 48 | 117,644 | 1 | 64 | 12 | 39% |
| t1 | dev | 33 | 108,725 | 3 | 29 | 4 | 67% |
| t2 | qa | 25 | 108,360 | 3 | 30 | 7 | 40% |
| t2 | docs | 36 | 94,381 | 4 | 32 | 1 | 64% |
| t2 | dev | 35 | 82,699 | 1 | 30 | 6 | 50% |
| t1 | dev | 34 | 70,317 | 0 | 42 | 7 | 66% |
| t3 | qa | 23 | 61,567 | 0 | 32 | 9 | 66% |
| t1 | dev | 11 | 15,831 | 0 | 12 | 1 | 36% |

（明细行由脚本 `perSession` 直接生成；task/role 只是成员名的一部分，同一 task/role 可对应不同成员会话。）

### 4.5 这是基线，不是 A/B 结论

- 只有一组观测、没有对照组；样本是「最近 20 个 run 中有 transcript 的成员会话」，**非随机**、任务难度不同，不能据此声称「读取纪律降低了 X%」。
- 数字的用途只有一个：改动后用同一脚本、同一口径复测，观察同量级指标是否变化；比较时先看样本是否同质（同样 20 个 run？还是新的 run 集），跨任务集不可直接对比。
- 复测命令（前置：`zstd` 在 PATH，本机 `/opt/local/bin/zstd`；Node 22/26 均可）：

```bash
node docs/teamflow/2026-11-13-r31-read-discipline/measure-read.mjs \
  --json /tmp/r31-read-after.json
```

脚本会重新按「最近 20 个 terminated run」选样并覆盖 `/tmp/r31-read-baseline-sample`；若要与本快照逐字节比对样本，请保留本文件与 `baseline-2026-11-13.json`（内含 20 份样本的 memberId 与 sha256）。两次实跑结果已核对：`totals` / `shares` / `perSessionBytes` 完全一致（确定性）。

### 4.6 基线口径的已知偏差（未验证项）

- bash 路径识别只认「带扩展名」的 token：无扩展名目录、`--include=` 的 glob 模式、`git grep` 的路径参数可能漏计，重复读比例偏保守。
- 字节按 UTF-8 文本计，不含工具调用的 JSON 包装开销；与宿主 token 计量不是 1:1（8KB ≈ 2–3k token 量级，仅作阈值口径）。
- `tool/result` 无 text block 的调用 byte 记 0（如纯结构结果），可能低估。
- 被宿主截断的 tool 结果按实际进上下文的文本计；若截断发生在宿主层，这里看到的是截断后文本。
- 4 个候选成员无 transcript（未落盘）被排除，样本对「短命/未产生会话的成员」有生存偏差。
- 本次只验证提示词文本与软提示消息行为；**成员是否真的按读取纪律执行，未在真机行为层验证**（需后续样本复测，且不能当 A/B）。

## 5. ⑥ 门禁证据

命令（仓库根，退出码 0）：

```bash
pnpm typecheck && pnpm test && pnpm build
# EXIT=0
```

| 项 | 结果 |
|---|---|
| `pnpm typecheck`（`tsc --noEmit`） | exit 0（含新用例；首跑曾因 `buildMemberPrompt` 缺 `name` 报 TS2345，已修） |
| `pnpm test`（`node --test test/*.test.ts`） | tests 1186 / pass 1186 / fail 0 / skipped 0 / todo 0 |
| `pnpm build` | client 587.57 kB（gzip 145.07 kB）、index 619.97 kB（gzip 205.47 kB），Build complete |
| `node --input-type=module -e "await import('./lib/index.js')"` | exit 0 |
| `node --input-type=module -e "await import('./lib/client.js')"` | exit 0 |
| `npm pack --dry-run` | 含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`；package size 385.4 kB / unpacked 1.3 MB |

构建产物（`pnpm build` 后）：

| 文件 | 字节 | sha256 |
|---|---:|---|
| `lib/index.js` | 619,968 | `0fa017939f63a8a8893b12845c992d1f64120e30fc990bc80ac900743dbb65fd` |
| `lib/client.js` | 587,574 | `b2312b5ad81f34e5c95b90ac2c79dd9ea9f2bcc51d036531942cb9f118bd5514` |

`lib/index.js` 因 t1 的 host 改动被 build 重写；`lib/client.js` 未变（内容 sha256 与 build 前一致）。注意 `lib/` 是入库产物，提交时应连同本次 build 结果一起提交。

## 6. 未验证项 / 风险

1. D1（复用成员路径缺软提示）未修，属功能缺口但不影响门禁；已给复验脚本与建议。
2. 「读取纪律」对成员真实行为的影响未验证（本次是提示词契约 + 软提示行为 + 基线快照，不是效果验证）。
3. ③ 的软提示仅在 `dispatchReady` 直派路径验证；其它入口（resume / 面板继续）未覆盖。
4. 基线样本 20 个会话、来自最近 20 个 run，非随机；重复读 62.4% 等数字只作基线，不作结论。
