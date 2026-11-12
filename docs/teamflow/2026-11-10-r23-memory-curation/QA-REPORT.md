# r23 记忆策展（条目级记忆）— QA 报告

- 任务：t4（QA 与门禁），前置 t1 DESIGN、t2 宿主实现、t3 面板、t5 成员复用；**t2 复验轮（2026-11-10 23:10）在最终树上重跑门禁并复验 D1/D2**
- 日期：2026-11-10
- 工作区：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`
- 结论：**门禁全绿**（最终树 `pnpm typecheck && pnpm test && pnpm build` 退出码 0；**1083 例全过**；lib 双产物为本次构建且均可 `node import`）。初检发现的 **2 个宿主侧缺陷 D1（主题路由被短词遮蔽）/ D2（expand 不回条目字段）均已修复**，各自带回归断言并通过「改回错误实现必变红」的变异验证（D1 变异 2 红、D2 变异 1 红），**无回归**；仍存 2 项实现与 DESIGN 字面偏差（D3/D4）与若干真机未验证项，见下文。

## 1. 验收判定对照

| # | 验收要求 | 判定 | 证据（测试/命令） |
| --- | --- | --- | --- |
| AC-1 | 条目解析/渲染逐字格式 | 通过 | `test/memory-r23-entries.test.ts`：渲染逐字、解析往返、tombstone 20 上限、旧手写/兼容行；`counts` 断言 |
| AC-2 | 判重与 upsert 修正计数 | 通过 | 同文件：归一化 hash、同文本 `added=0/updated=1/revisions+1`、等级取高、来源/正文用 incoming、501 字截断、misc 只读碰撞 |
| AC-3 | supersede 后不再注入 | 通过 | 同文件 supersede 四码/原子；`test/memory-r23-inject.test.ts`「已作废条目永不出现」 |
| AC-4 | 三级等级与淘汰顺序（P2 先于 P1、P0 不动） | 通过 | `test/memory-r23-entries.test.ts` 淘汰 3 例 + `evictForInsert` 入口例；变异 M2 实测变红 |
| AC-5 | 文件数与条目数硬上限 | 通过 | `test/memory-r23-inject.test.ts` 配额例（project 8 / public 6 / 每文件 40 / near/over/full）；全 P0 拒绝逐字文案 |
| AC-6 | 主题路由 | 通过（D1 已修复并复验） | 路由表 11 条用例 + D1 回归 1 例；`routeTopic('模块依赖方向铁律')` 复验实测 `{"ok":true,"topic":"architecture"}`（修复前 `commands`） |
| AC-7 | 注入 P0 优先 | 通过 | `test/memory-r23-inject.test.ts`：P0 低相关性仍压过 P2 高相关性；头部/行格式逐字；单行 ≤200 |
| AC-8 | 旧手写 md 的 P1 兼容解析 | 通过 | entries：旧格式 `- [role · MM-DD HH:mm] text` 与完全无格式行均 P1/手写来源/fallbackAt；不丢内容 |
| AC-9 | 旧 `run-*.md` 被排除 | 通过 | inject：`listMemoryViews` 默认排除、`includeLegacy` 才可见、配额不计；bridge `legacyFileCount` 与注入正文排除 |
| AC-10 | 整理命令 dry-run 零写入与二次运行幂等 | 通过 | curate：dry-run 字节/mtime 不变且不建目录；实跑二次 `added=0` 字节不变；CLI dry-run/幂等/exit 2；变异 M7/M8 实测变红 |
| AC-11 | `auto_team_memory` 新参数与结构化返回 | 通过（D2 已修复并复验） | tool：`importance/topic/supersedes` 生效、20 条截断、错误码文案、list/read/curate 结构化返回、8 文件配额；expand 回归断言活动行与 `~~[P2]` tombstone 均回填 `level/revisions/source/at` |
| AC-12 | 门禁 `pnpm typecheck && pnpm test && pnpm build` | 通过 | 见 §5：退出码 0、1083 例、双产物构建 |
| AC-13 | 重建 lib 双产物并 node import | 通过 | `lib/index.js` mtime 2026-11-10 23:10:18、`lib/client.js` 23:10:17（本次构建）；两个 import 均打印 ok；sha256 见 §5 |
| AC-14 | README「记忆」章节 | 通过 | `README.md:155` 新增「记忆（双轨 md + 条目级）」，工具表 `auto_team_memory` 行同步更新 |
| AC-15 | 本报告含未验证项 | 通过 | §7 |

## 2. 用例清单（新增 59 例）

| 文件 | 例数 | 覆盖 |
| --- | --- | --- |
| `test/memory-r23-entries.test.ts` | 25 | 主题路由表 11 条 + **D1 回归 1 例**（更具体关键词优先；`依赖` 单独仍路由 commands，不能靠删词过关）；normalize/hash/ID；渲染逐字（活动行、tombstone、`## 已作废` 段、20 条上限）；解析往返/旧手写/兼容行/结构行/降级；upsert 计数/等级/截断/校验/misc 只读；淘汰顺序（P2 先于 P1、P0 不动、P2 耗尽后 P1、incoming 为 P0）；全 P0 硬上限逐字文案；supersede 四码/跨文件原子；`applyMemoryMutation` 分派 |
| `test/memory-r23-inject.test.ts` | 12 | 仓库层 legacy 排除与 `includeLegacy`；配额 8/6/40 与 near/over/full；`readMemoryEntries` 非主题文件只读；`evictForInsert` 返回值；注入 P0 优先、头部/行格式逐字、预算上限、单行 ≤200、同 hash 去重、项目轨优先、related 同轨 ≤3；bridge `snapshot.memory` 与 `memoryFor` 排除旧流水 |
| `test/memory-r23-curate.test.ts` | 8 | `extractLegacyLessons` 三种来源；dry-run 零写入；实跑 + 二次幂等；skippedExisting/skippedFull；CLI dry-run JSON/exit 0、缺 `--dir`/非法 `--now`/非法 track 均 exit 2 |
| `test/memory-r23-auto.test.ts` | 6 | 仅终态产出；失败门禁文案/at；无证据 failed 与返工文案；`commands` 去重；公共轨只写 1 条；永不 P0 + 同 hash |
| `test/memory-r23-tool.test.ts` | 8 | 真实 `createBridge` + `createExpander` + `buildToolSpecs`：`list` 空配额与 `required:['action']`；`write` 的 importance/topic 生效与 upsert；缺省 P2 与 20 条 truncated；错误码文案；`supersedes`；**expand 回填四字段（活动行与 `~~[P2]` 作废包裹，D2 回归）**；curate 缺省 dry-run；8 主题文件配额与 legacy 计数 |

- 合计新增 **59 例**（25+12+8+6+8）；全量从基线 1024 例增至 **1083 例**（t4 初检 1082 + t1 为 D1 新增 1 例）。

## 3. 覆盖矩阵（验收点 → 断言 → 变异）

| 验收点 | 关键断言（改回错误实现会变红） | 变异实测 |
| --- | --- | --- |
| 条目解析逐字 | `renderEntryFile` 全字符串相等；`parseEntryFile` 往返 entries/计数；`## 已作废` 后全部 superseded | — |
| 判重/upsert | 归一化后 5 变体同 hash；同文本 `added=0/updated=1/revisions+1`；等级取 max；ID 不变 | — |
| supersede 后不注入 | 注入结果不含 superseded（含高等级 P0 作废条目） | **M4**：移除 `inject.ts` 的 superseded 过滤 → 2 例红 |
| 三级等级/淘汰顺序 | 40 条混合时淘汰最旧 P2（即使 P1 更旧）；P2 耗尽才动 P1；P0 永不 | **M2**：反转 `evictionOrder` 等级排序 → 2 例红 |
| 硬上限 | `quotaOf` 返回 8/6/40；全 P0 第 41 条 → `MEMORY_QUOTA_FULL` 逐字文案 | **M1**：`ENTRIES_PER_FILE 40→12` → 配额例红 |
| 主题路由 | §5.3 表驱动 11 条 + D1 回归：`模块依赖方向铁律`→architecture，且 `依赖`/`安装依赖` 仍→commands | **M9**：`routeTopic` 退回「只按主题 priority」→ 2 例红 |
| 注入 P0 优先 | P0 低相关性排在 P2 高相关性前；预算/单行 200 不越界 | — |
| 旧手写 P1 兼容 | 旧格式与无格式行均 P1、source=手写、fallbackAt、正文不丢 | — |
| 旧 `run-*.md` 排除 | 默认列表无 legacy、配额不计、注入正文不含 | — |
| 整理 dry-run 零写/幂等 | 字节 + mtime 不变、目录不新建；二次 `added=0` | **M7**：dry-run 仍写 → 2 例红；**M8**：去掉 skippedExisting → 2 例红 |
| 工具新参数/结构化返回 | `importance/topic/supersedes` 落盘字段；list/read/curate 字段齐全；expand 活动行与 tombstone 均回填四级字段 | **M10**：expand 正则退回 `[P012]` 字符类 → 1 例红 |
| 成员复用回归 | 见 §6 | — |

### 3.1 变异验证实际执行（在 `/tmp/mut-r23` / `/tmp/mut-r23-qa` 的 src 副本上改，不动仓库 `src/**`）

| 变异 | 改动 | 结果 |
| --- | --- | --- |
| M1 常量 39/12 | `src/host/config.ts:139` `ENTRIES_PER_FILE = 40 → 12` | 12 例中 1 红：配额「每文件 40」断言 |
| M2 淘汰顺序反转 | `src/host/memory/entries.ts:549` 等级排序取反 | 当时 entries 文件 24 例中 2 红：P2 先于 P1、P2 耗尽后 P1 |
| M4 不排除 superseded | `src/host/memory/inject.ts:95` 删除 `if (entry.superseded) continue` | 12 例中 2 红：作废不注入、预算尾行 |
| M7 dry-run 仍写 | `src/host/memory/curate.ts:225` 去掉 `input.dryRun` 判断 | 8 例中 2 红：dry-run 零写入、CLI dry-run 零写入 |
| M8 二次仍追加 | `src/host/memory/curate.ts:197` 删除 `knownHashes` 跳过 | 8 例中 2 红：二次运行幂等、skippedExisting |
| **M9 D1 回退** | `src/host/memory/entries.ts` `routeTopic` 退回「全表按 priority 先命中」旧实现（删掉最长关键词让位逻辑） | `memory-r23-entries` 25 例中 **2 红**：§5.3 表驱动（`模块依赖方向铁律`→commands）、D1 回归专测；还原后 25/25 |
| **M10 D2 回退** | `src/host/tools.ts:769` 把 `/^- (?:\[P[012]\]|~~\[P[012]\])/` 退回旧 `/^- (?:\[[P012]\]|~~)/` | `memory-r23-tool` 8 例中 **1 红**：expand 活动条目断言先红（旧实现 activity 无四字段；tombstone 断言旧实现本就通过）；还原后 8/8 |

## 4. 缺陷与偏差

### D1（缺陷，宿主侧，**已修复**）主题路由被更短关键词遮蔽

- 症状（修复前）：`routeTopic({track:'project', text:'模块依赖方向铁律'})` 返回 `commands`；DESIGN §5.3 期望 `architecture`。
- 根因：`src/host/memory/entries.ts:36` 的 commands 关键词含 `依赖`（priority 2），先于 architecture 的 `依赖方向`（priority 5）命中；旧实现只按主题 priority 排序、先命中即返回，未按关键词具体程度（最长匹配）决胜。
- 影响：依赖方向类教训被写进 `commands.md`，注入时主题/文件分类错误（内容本身不丢）。
- 修复（t1，`src/host/memory/entries.ts:94-114`）：先收集全表命中，再让「更具体（更长）的关键词」优先——短词只是另一个命中词的字面子串时让位（`依赖` 让位给 `依赖方向`）；无包含关系仍按主题 priority 先命中，DESIGN §5.2 顺序不变。
- 复验命令：
  ```bash
  node --input-type=module -e "import('./src/host/memory/entries.ts').then(m=>console.log(JSON.stringify(m.routeTopic({track:'project',text:'模块依赖方向铁律'}))))"
  ```
- **修复前后对比**：

  | 输入 | 修复前 | 修复后（本次复验实测） |
  | --- | --- | --- |
  | `模块依赖方向铁律` | `{"ok":true,"topic":"commands"}` | `{"ok":true,"topic":"architecture"}` |
  | `依赖` | `commands` | `commands`（仍按 priority；不能靠删词过关） |
  | `安装依赖` | `commands` | `commands` |

- 回归断言：`test/memory-r23-entries.test.ts:90`（D1 专测）+ `:52-70` 表驱动；变异 M9（退回旧实现）实测 2 红，还原 25/25 全绿。
- 处理：**已关闭**。原「本任务可写域不含 `src/**`」的限制由 t1 任务解除并在最终树修复。

### D2（缺陷，宿主侧，**已修复**）活动条目 `expand` 不回结构化字段

- 症状（修复前）：`auto_team_memory expand <活动条目 ID>` 返回 `ok/code/message/id/track/name/body/chars/truncated/depth/related`，**不含** `level/revisions/source/at`（DESIGN §13.3 / §12 `expand` 要求条目 ID 额外回这些字段）。`- ~~[P2] …~~` 作废条目因旧判据的 `~~` 分支碰巧能回四字段，但那是「见 `~~` 就认」，并未真正识别等级字形。
- 根因：`src/host/tools.ts:767` 旧判据 `/^- (?:\[[P012]\]|~~)/` 中 `[P012]` 是字符类，匹配单个字符 `P`/`0`/`1`/`2`，而真实行是 `- [P0] …`。实测（修复前）：`- [P0] x` → false，`- [P1] x` → false，`- ~~[P1] x~~` → true（只有行首 `~~` 分支碰巧命中）。
- 影响：模型 expand 活动条目后拿不到等级与修正次数，无法按等级判断可信度；正文与 file 仍可用。
- 修复（t1，`src/host/tools.ts:769`）：改为 `/^- (?:\[P[012]\]|~~\[P[012]\])/`，活动行与 `~~[P2] …~~` 作废包裹都认；配套用 `parseEntryFile` 解析正文回填字段。
- 复验命令（旧/新判据对比）：
  ```bash
  node -e "
  const oldRe=/^- (?:\[[P012]\]|~~)/, newRe=/^- (?:\[P[012]\]|~~\[P[012]\])/;
  for (const s of ['- [P0] x','- [P1] x','- [P2] x','- ~~[P1] x~~']) console.log(JSON.stringify(s),'old=',oldRe.test(s),'new=',newRe.test(s))"
  ```
- **修复前后对比**：

  | 行首形态 | 旧判据 | 新判据 | expand 字段（修复前 → 修复后） |
  | --- | --- | --- | --- |
  | `- [P0] x` | false | **true** | 缺 4 字段 → `level=P0` 等 |
  | `- [P1] x` | false | **true** | 缺 4 字段 → `level=P1` 等 |
  | `- [P2] x` | false | **true** | 缺 4 字段 → `level=P2` 等 |
  | `- ~~[P1] x~~` | true（`~~` 分支） | **true**（识别 `~~[P1]`） | 四字段已回 → 四字段仍回（无回归） |

- **旧实现实测（在 `/tmp/mut-r23-qa` 副本上跑同一探针）**：活动条目 expand 的 keys = `["ok","code","message","id","track","name","body","chars","truncated","depth","related"]`（`ACTIVE_HAS_ALL=false`）；tombstone 仍回 `{"level":"P2","revisions":1,"source":"队长","at":1794302400000}`。

- **真实 bridge 复验（node 探针，非 mock）**：写入 `P1` 条目后 expand 实测
  `{"level":"P1","revisions":1,"source":"队长","at":1794302400000}`（`atISO=2026-11-10T09:20:00.000Z`，四字段齐）；tombstone `~~[P2]` expand 实测 `{"level":"P2","revisions":1,"source":"队长","at":1794302400000}`。
- 回归断言：`test/memory-r23-tool.test.ts:173`（活动行 + 作废包裹四字段硬断言）；变异 M10（退回旧正则）实测 1 红，还原 8/8 全绿。构建产物 `lib/index.js` 已含新正则（`grep -c 'P\[012\]' lib/index.js` = 1）。
- 处理：**已关闭**。

### D3（偏差）围栏内条目仍被解析

- 现象：`parseEntryFile` 只把 ``` / ~~~ 标记行当结构行跳过，不跟踪围栏状态；围栏内的 `- [P0] …` 仍会成为条目。
- DESIGN §4.2 的结构行清单只列了「围栏（```|~~~）」，未明确要求跳过围栏内正文；按 Markdown 语义应收起。严重度低（正常写入不会在围栏内放条目）。
- 复验命令：
  ```bash
  node --input-type=module -e "import('./src/host/memory/entries.ts').then(m=>console.log(m.parseEntryFile('\`\`\`text\n- [P0] 围栏内\n\`\`\`',{track:'project',file:'pitfalls.md',now:Date.now()}).entries.length))"
  ```
- 处理：测试只断言围栏标记行本身不计条目，未把「围栏内必须忽略」写成硬断言；建议后续按 Markdown 语义补围栏状态机。

### D4（偏差）极小预算时 text 不是空串

- 现象：`selectMemoryEntries(goal, candidates, 90)` 一条都放不下时，`text` 不是 `''`，而是只有「另有 N 条未内联…」尾行（`chars ≤ budget`）。
- DESIGN §9.3 字面：「一条都放不下时 text=''」。实现（`src/host/memory/inject.ts:245-248`）保留尾行，便于模型知道还有条目可 expand；`chars` 仍不越界。
- 处理：测试断言 `entries.length ≤ 1`、`entries+omitted` 守恒、`chars ≤ budget`，未锁死 `text===''`；建议 DESIGN 明确以尾行优先，或实现改为空串。

## 5. 门禁证据（最终树，t2 复验 2026-11-10 23:10）

以下命令均在仓库根 `/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team` 执行：

```bash
pnpm typecheck   # exit 0（tsc --noEmit，无输出）
pnpm test        # exit 0
# ℹ tests 1083 / suites 0 / pass 1083 / fail 0 / cancelled 0 / skipped 0 / todo 0
# ℹ duration_ms 5772.499875
pnpm build       # exit 0：build:client → lib/client.js（563.82 kB）；build:host → lib/index.js（581.19 kB）
node --input-type=module -e "await import('./lib/index.js'); console.log('index ok')"   # index ok（exit 0）
node --input-type=module -e "await import('./lib/client.js'); console.log('client ok')" # client ok（exit 0）
```

- **产物为本次构建**：构建完成时刻 23:10:17/18，`lib/client.js` mtime `Nov 10 23:10:17`（563819 B）、`lib/index.js` mtime `Nov 10 23:10:18`（581186 B）——晚于本次命令开始时刻 23:10:07，非上一次 t1 构建（23:09:52）的残留。
- 产物摘要（sha256）：`lib/index.js` = `25508e5c8aafade19f9b8dc6092bf4ed8f634f57c44c713e53afe224039549f2`；`lib/client.js` = `d664c9073e231c8879430151d5cdb27e3ea975099b59e46f5f857770e48da5d6`。
- D2 修复已进入宿主产物：新正则 `/^- (?:\[P[012]\]|~~\[P[012]\])/` 在 `lib/index.js` 中命中 1 处；旧写法 `\[[P012]\]` 固定串检索 0 命中。
- 新增用例 59 例（25+12+8+6+8），全量从基线 1024 例增至 **1083 例**。
- 复跑提醒：以上命令的 cwd 必须是仓库根；从归档目录跑会因相对路径解析失败而假红（AGENTS.md §4）。

## 6. 成员复用回归（t5）

t5 的复用改动在最终树中，相关测试均随全量 1083 例通过：

| 回归点 | 用例（文件:行） | 断言要点 |
| --- | --- | --- |
| 复用判据正例 | `test/dispatch.test.ts:1402` | 同 run 同角色有空闲成员 → `spawned.length===0`，任务卡直发该成员且落消息账本、binding 保留 |
| 跨 run 复用 | `test/dispatch.test.ts:1442` | 上一轮 run 收口后的成员仍接新 run 任务，`spawned=0`；只扫本 run bindings 会红 |
| 负例：无空闲成员 | `test/dispatch.test.ts:1515` | 照常新建，不因「看起来能复用」而不派 |
| 负例：retired/stopping/failed | `test/dispatch.test.ts:1521` | 不复用 |
| 负例：路由漂移 | `test/dispatch.test.ts:1542` | 实际模型与声明不符 → 新建，`spawned=1` |
| 负例：发送失败 | `test/dispatch.test.ts:1573` | 先试复用，失败落回新建 |
| 名单不可得 | `test/dispatch.test.ts:1614` | `listMembers` 抛错 → 一律不复用，宁可新建 |
| 终身名额文案 | `test/adapters.test.ts:1145` | `Team member limit 8 reached` 原文保留 + 提示调大 `maxMembers` |
| 并发名额文案 | `test/adapters.test.ts:1160` | `active child limit 3 reached` 与普通失败文案不同 |
| 面板不谎报创建 | 全量 bridge/panel 相关用例 | 复用路径派发 notice 区分「创建/复用」，测试断言复用时不出现「已创建」 |

## 7. 未验证项（需真机/队长复验）

1. **真机 UI**：面板「记忆」页的等级徽标、作废删除线、「整理旧流水」dry-run 预览/执行按钮、失败不清空列表 —— 仅单测与构建通过，未在第二宿主真机点验（按约定由队长执行）。
2. **真机注入**：常驻提示词里的条目级索引在真实会话中是否按预算裁剪、expand 后是否可读 —— 需真实宿主会话验证；D2 修复后单测/探针已确认活动条目回四字段，但模型在真实会话里是否能收到并利用这些字段未验证。
3. **真实 run 收口**：`recordRunMemory` 在真实门禁失败/返工场景的落盘与 `memorySunkAt` 幂等 —— 单测覆盖纯函数与 bridge，未跑真实长 run。
4. **归档目录上的 curate**：CLI 在 `$DSH_HOME/teamflow/<workspace>/logs/<runId>/` 归档路径上整理旧流水 —— 仅临时目录验证；相对路径/权限边界未测。
5. **面板 8/6 文件上限提示**：接近上限/超限的文案在真机渲染 —— 单测只验证快照字段。
6. **D1/D2 修复后的回归**：已在最终树复验（单测 + 真实 bridge 探针 + 变异 M9/M10 + 全量 1083 例）通过；**未验证**的是这两个修复在真实宿主会话里的表现（路由落盘到哪个 md、模型实际 expand 是否读到等级），需第二宿主真机。
7. **D1 最长匹配的语义边界**：当前实现是「关键词互为子串时让位」，不做分词/语义理解；若两个互不包含的关键词同时命中，仍按主题 priority。DESIGN §5.2 认可该口径，但自然语言长句里是否存在优先序争议（如「架构依赖」同时含 `架构` 与 `依赖`）未穷举，仅按 §5.3 表驱动锁定。

## 8. 变更文件（本任务可写域）

- 新增：`test/memory-r23-entries.test.ts`、`test/memory-r23-inject.test.ts`、`test/memory-r23-curate.test.ts`、`test/memory-r23-auto.test.ts`、`test/memory-r23-tool.test.ts`
- 更新（t2 复验）：`test/memory-r23-entries.test.ts`（+D1 回归 1 例，24→25）、`test/memory-r23-tool.test.ts`（expand 四字段硬断言）、`lib/index.js`、`lib/client.js`（本次重建）、本报告
- 初检更新的产品文档：`README.md`（记忆章节 + 工具表）
- 未改：`src/**`（D1/D2 的修复由 t1 任务完成；本任务只复验、不修改）
