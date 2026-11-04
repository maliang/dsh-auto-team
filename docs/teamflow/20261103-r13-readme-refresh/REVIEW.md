# 评审报告：README 与源码/文档一致性（r13，t2）

| 项 | 值 |
| --- | --- |
| 评审人 | 评审专家（t2 独立复核，不替实现方辩护） |
| 日期 | 2026-11-04 |
| 被评审 | `README.md`（162 行 / 13067 B，工作区未提交修改）；取证表 `FACTS.md`（130 行）；`QA.md`（189 行） |
| 代码基线 | 分支 `feat/auto-team-plugin`，HEAD `00d2b55`；文档自称基线为 `cd2bb61`（两者不同，见 B1） |
| 手段 | 只读 grep/read + `npm pack --dry-run --cache /tmp/review-npm-cache`；按任务要求**未重跑** `pnpm test` / `pnpm build`，**未改** README/FACTS/QA/源码 |

## 结论

结论：不可合并（打回）。README 的骨架、入口表、8 工具表、落点表与绝大多数数字都和源码对得上（见 §四），但「实测基线 / EPERM 归因 / CI 断言」三处用确定语气写错，且缺一条真实会拦住用户的已知限制（成员会话提交回执必失败）。修完 B1–B5 即可合并，不需要重写结构。

一句话验收：五条 blocker 每条都能落成一条命令或一句替换文案，照着改完重跑 §九 的复现命令即可自证。

## 一、必须修（blocker）

### B1 实测基线已随 HEAD 漂移，README:119-123 的数字不是当前仓库的数

- 现象：README:117 写「2026-11-04 实测基线」，但基线 commit 已从 `cd2bb61` 前进到 `00d2b55`（`git reflog`：`00d2b55 fix(host): 宿主事件订阅改走 root + {global:true}…`，父 `cd2bb61`）。
- 证据：
  - `git diff --stat cd2bb61..HEAD` → `src/host/adapters.ts +82/−24`、`lib/index.js +58`（已提交产物）、`test/host-contract.test.ts +2/−1`（CORE_MEMBERS 增加 `root`）、`docs/teamflow/architecture/HOST-EVENTS.md +26`。
  - `git cat-file -s cd2bb61:lib/index.js` = 438381（README:121 的 438.38 kB）；`git cat-file -s HEAD:lib/index.js` = **439695 → 439.70 kB**。
  - `npm pack --dry-run --cache /tmp/review-npm-cache`（exit 0）→ `package size: 238.7 kB`、`total files: 5`、`README.md 13.1 kB`、`lib/index.js 439.7 kB`、`lib/client.js 354.0 kB`、`cordis.patch.yml 646 B`。README:123 写 233.4 kB，差了 5.3 kB。
  - `668 通过`（README:120）来自 `cd2bb61`；HEAD 改了 `test/host-contract.test.ts` 与 `lib/index.js`，本轮按约束未复跑，因此它现在只能算「旧基线值」，不能算「2026-11-04 实测」。
- 建议修改（二选一，不许含糊）：
  1. 在**当前 HEAD** 重跑并替换数字：
     ```bash
     cd "$REPO" && pnpm typecheck && pnpm test && pnpm build \
       && node --input-type=module -e "await import('./lib/index.js')" \
       && node --input-type=module -e "await import('./lib/client.js')" \
       && npm pack --dry-run --cache /tmp/npmcache-r13
     ```
     把 README:117 改成「`00d2b55` 实测」并同步更新 668/尺寸/pack 三个数；README:161 的「668 通过」同步（或直接删重复，见 N8）。
  2. 若坚持保留旧数字，把 README:117 明确写成「基线 commit `cd2bb61`；之后的 HEAD 变更未复测」，不得再叫「2026-11-04 实测基线」。
- 可接受性：**不可接受**。文档里最高优先级的「实测基线」与实际产物不一致，读者会拿 438.38/233.4 去比对 CI 产物，得出「我装错了」的错误结论。

### B2 FACTS 取证表自证是旧文档的测量，README:117 的「唯一来源」失效

- 现象：README:117 写「逐条命令与输出见 FACTS.md」，而 FACTS 的 pack 行是 `README.md 2.1kB` / `package size 233.4 kB` / 基线 `cd2bb61`；当前 README 是 13067 B（tarball 里 13.1 kB），tarball 是 238.7 kB。
- 证据：FACTS.md:23-24 原值；`wc -c README.md` = 13067；`npm pack --dry-run` 输出（见 B1）。tarball 里的 README.md 已经是 13.1 kB，说明 233.4 kB 是**重写前**那份 2.1 kB README 的包体积。
- 建议修改：FACTS 按 B1 的同一组命令重跑并同步（含 HEAD 短 hash、五条输出、行号）；或者 README:117 删掉「唯一来源」表述，改为「本轮取证记录（部分已过期）」。不能一边宣称 FACTS 是唯一来源、一边让它指向旧文档。
- 可接受性：**不可接受**。取证表的全部价值就是可复跑；来源过期等于没有来源。
- 备注：QA 的 D1（233.4 → 238.2）方向正确，但 238.2 也已随 HEAD 漂移为 238.7；本项与 D1、D7 同源，修一处即可闭环。

### B3 EPERM 归因写错，并给出机器相关且有风险的 `sudo chown` 建议（README:136）

- 现象：README:136「本机 `~/.npm` 缓存是 root 所有」→ 建议 `sudo chown -R 501:20 ~/.npm`。
- 证据：`find ~/.npm -user root | wc -l` → **0**；`stat -f %Su:%Sg ~/.npm` → `maliang:staff`。本机不存在 root-owned 的 npm 缓存；本轮 `npm pack` 加 `--cache /tmp/review-npm-cache` 后 exit 0，不加 `--cache` 才会 EPERM，说明是**运行环境对默认缓存目录不可写**（沙箱/CI 常见），不是文件属主问题。
- 建议修改：把「真实原因」改为「运行环境（沙箱/CI）对默认 `~/.npm` 缓存目录不可写」，处置保留 `--cache /tmp/...`；**删掉** `sudo chown -R 501:20 ~/.npm`（501:20 是 macOS 本机 uid:gid，换机即错，且引导用户改家目录属主有破坏性）。
- 可接受性：**不可接受**。这是「照着做会做无效甚至危险操作」的错误，不是措辞问题。

### B4 「CI 首步会红」不成立（README:144）

- 现象：README:144「不影响入库判断，但 CI 首步会红」。
- 证据：`.github/workflows/ci.yml` 仅 37 行，`runs-on: ubuntu-latest`（:10），`npm pack --dry-run` 在**最后一步**（:34），其后没有步骤；首步是 checkout/安装依赖，且 ubuntu-latest 的 `~/.npm` 缓存干净可写。本机 EPERM 与 CI 无因果关系。
- 建议修改：删掉「但 CI 首步会红」；若要保留提醒，改成「本机缓存不可写时用 `--cache` 绕行，CI 全新 runner 不受影响」。
- 可接受性：**不可接受**。这句会让维护者在 CI 全绿时怀疑环境，属于制造假警报。

### B5 回执提交者写错：成员会话提交 `auto_team_receipt` 必回「未启用」（README:18、:74）

- 现象：README:18「成员交付后提交回执 → `auto_team_receipt` 执行该任务的 `acceptance`」；README:74 工具表只写「唯一入口」，未写谁提交。已知限制 §140-145 也没有这一条。
- 证据（代码路径判定，未在真机会话复现）：
  - `src/host/tools.ts:409-415`：receipt handler 先 `const sessionId = sessionOf(meta)`，再 `if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }`。
  - `src/host/tools.ts:69-76`：`sessionOf` 优先 `meta.agent.id`——也就是**调用者自己的会话**。
  - `src/host/bridge.ts:1810-1812`：`enabled()` 只读 `flags[sessionId]`；flags 只在 toggle 时写（`bridge.ts:1125`、`1814-1817`），并落盘到 `<dataRoot>/sessions.json`（`bridge.ts:423` 起的 `persistFlags`）。
  - 成员是独立 agent（各自 session），没有 toggle 记录 ⇒ 成员自己提交回执一律 `NOT_ENABLED`。`src/host/prompt.ts:47` 的队长提示词本身就是让**队长**执行 receipt，`src/host/team/dispatch.ts:840` 给成员的续跑文案只说「按验收判定回报回执」，没有说明提交者。
- 建议修改（文档 1 行，二选一）：
  1. README:18 改为「成员交付并回报后，由**开着开关的那个会话（队长）**提交回执」；README:74 关键约束补「成员会话没有开关状态，会收到未启用」；已知限制加同一条。
  2. 如果产品意图是成员自交，则需改代码让子会话继承 enabled 标记（不在本轮 README 范围，另开任务）。
- 可接受性：**不可接受（作为文档）**。这是用户按 README 操作第一步就会撞上的「假失败」，比缺一句说明严重。

## 二、建议修（nit，不阻塞合并）

| 编号 | 位置 | 问题 | 建议修改 |
| --- | --- | --- | --- |
| N1 | README:26 | `src/client/Panel.tsx:78` 指向 `TabKey`；`TABS` 在 :81 | 改为 `Panel.tsx:81`（或写 `78-84`）；QA D6 成立 |
| N2 | README:143 | 「token 展示…不用字数估算补位」对记忆页不成立：`src/host/format.ts:123` 有 `memoryTokenEstimate`，`src/client/tabs/MemoryTab.tsx:9/24/27-38` 标 `tokenBasis: 'estimate'`，`src/client/viewmodel.ts:1217/1222` 渲染 `≈N token` | 把主语收窄为「任务/运行 token 用量」；或改成「任务/运行用量取宿主上报，取不到显示不可得；记忆页 token 是 `≈` 估算，已标注」 |
| N3 | README:125 | 「宿主 API 只许出现在 `src/host/adapters.ts`」与 `src/host/index.ts:316/654/658` 的 `ctx.logger` 冲突（AGENTS.md 同款措辞） | 改为「宿主服务访问集中在 `adapters.ts`；装配入口只允许 `ctx.logger`」，或在源码侧把 logger 也收进 adapters（任选，但文档要与实际一致） |
| N4 | README:103 | 「派生规则只在 `src/host/paths.ts` 一处」不成立：`sessions.json` 由 `src/host/bridge.ts:409` 用 `${deps.dataRoot}/sessions.json` 拼出 | 措辞改为「目录派生在 `paths.ts`；`sessions.json` 由 bridge 基于 `dataRoot` 拼出」；更好的是把该路径收进 `paths.ts` |
| N5 | README:140-145 | 缺「并发上限被宿主 clamp」：`src/host/index.ts:181-192` 的 `hostConcurrency()` 会在宿主上限更小时夹住设置值，并在快照给出 requested/clamped | 已知限制加一条：「设置里的并发可能被宿主上限夹小，面板显示实际生效值」 |
| N6 | README:39-43 | 快速开始缺 `pnpm install`：新 clone 直接 `pnpm build` 会因 tsdown/typescript 未安装而失败 | 在 `pnpm build` 前加一行「首次先 `pnpm install`」；仓库无 `packageManager` 字段，可顺带写明 pnpm 版本或「pnpm 10+」 |
| N7 | AGENTS.md §1 | 仍写「输入框**下方**一键启用/停用」，与源码槽位 `conversation.input.left`（`src/client/slots.ts:41`）和 README:15/24 的「左侧」不一致 | 同步 AGENTS.md（团队资产，非本轮 README 行，属跨文档一致性） |
| N8 | README:120 + :161 | 668 与构建尺寸在两处出现（开发验证的基线 + 变更记录的「怎么验」），改一处必忘另一处 | 数字只留在 §实测基线一节；变更记录改为「见 §实测基线」 |

## 三、无需改（已逐条核对通过）

| README 断言 | 证据 |
| --- | --- |
| 内置 11 角色 / 12 技能 / 角色可指定 provider-model | `src/host/roles/builtin.ts:230`（BUILTIN_ROLES）、`:22`（BUILTIN_SKILLS）；实测 id：pm, architect, dev, qa, docs, reviewer, frontend, backend, designer, devops, security |
| 8 个 `auto_team_*` 工具名与用途 | `src/host/tools.ts:205/278/327/362/396/437/530/596`；未启用文案逐字一致（`tools.ts:54`） |
| plan 每条任务必须带 roleId 与可执行 acceptance | schema `required: ['title','roleId']`（`tools.ts:119`）+ `src/host/plan/plan.ts:55-59` 拒绝空 title/roleId、空验收整批拒绝 |
| 派发四道闸都在 `dispatchReady` | **正确**：暂停闸 `src/host/team/dispatch.ts:348-351`；并发位 running+gate `dispatch.ts:334-337`；依赖与写域在 `dispatchReady` 内；`src/host/team/auto-dispatch.ts:5` 注释同口径 |
| 5 类不可逆动作 | `src/host/confirm.ts:19-25` 恰为 cancel / cancelTask / skipTask / updateAcceptance / forceParallel |
| 写域只认 running/gate、目录边界、释放通知 | `src/host/team/scope-locks.ts:32`；`src/host/team/scope.ts` 的 `src/host` vs `src/hostile.ts` 边界规则 |
| 门禁 300000ms / 末 4000 字符 / exit0 判定 | `src/host/config.ts:40`（GATE_TIMEOUT_MS）、`:37`（GATE_TAIL_CHARS）；`src/host/gate/gate.ts:135`、`:185`（null → timeout-or-signal）、`:195` |
| 门禁 cwd = 宿主启动目录（真机） | `src/host/index.ts:102`（`options?.workspace ?? process.cwd()`）、`:405`；实机证据：`~/.dsh/profiles/desktop/.auto-team/artifacts/t1.log` 存在（67110 B），与 README:80/100 一致 |
| 门禁日志落 `<workspace>/.auto-team/artifacts/<taskId>.log` | `src/host/gate/gate.ts:74` |
| 6 个可配参数与范围 | `src/shared/types.ts:254-267`；`src/host/config.ts:179-185`（并发[1,8]、记忆[200,4000]、停滞[1s,600s]、返工[1,10]、门禁[1s,600s]）；`src/host/settings.ts:62-66` + captainModel；`src/client/ui.ts` settingsKeysView 6 行 |
| 落点表（runs/sessions/settings/roles/<id>.json/skills/<id>.md/public 记忆/项目记忆/deviations.jsonl） | `src/host/paths.ts` 各导出；`src/host/roles/repo.ts:2`、`skills-repo.ts:2`；`src/host/bridge.ts:409-428` |
| 槽位行号 `slots.ts:41,44,441,449`、`builtin.ts:22/230`、`index.ts:102/405`、`gate.ts:135` | 逐一 grep 命中；`slots.ts:53` 设置分区、`:404-410` registerPanelTab 走 `ctx.inject(['sidebarRightTabs'])` |
| 安装自检「期望 2 行」 | `~/.dsh/profiles/desktop/package.json:7` 与 `:30`（依赖 + `dsh.profile.bundles`） |
| `cordis.patch.yml` 的 name 必须是包根名 | `cordis.patch.yml` 实测 `name: dsh-auto-team`，含 insert 块 |
| 两级注册 webServer（404 故障表） | `src/host/adapters.ts:505` `registerHttpRoutes`（先立即试，失败 `ctx.inject(['webServer'])`） |
| 前端读接口解构 `{data,error}` | 属于历史 bug 族约定，README:134 表述正确 |
| 面板三页只有 tasks/history/memory；无派发按钮 | `src/client/tabs/TasksTab.tsx:9-10` 注释；`Panel.tsx:78-84` |
| 文档引用全部存在 | `docs/teamflow/architecture/{ARCHITECTURE,HOST-EVENTS,UI-SLOTS,REAL-HOST-VERIFY}.md`、`docs/teamflow/memory.md`、`AGENTS.md` |
| 运行时约束 Node ≥22.18 / dsh 0.2.x | `package.json` engines |

## 四、对 QA.md 的逐条复核

| QA 编号 | QA 判定 | 本评审复核 | 说明 |
| --- | --- | --- | --- |
| D1 pack 233.4→238.2 | 成立 | **成立，且已继续漂移** | 当前实测 238.7；233.4 是 2.1 kB 旧 README 的包体积（见 B1/B2） |
| D2 EPERM 归因 | 成立 | **成立** | root-owned 计数 = 0；`sudo chown` 必须删（B3） |
| D3 CI 首步会红 | 成立 | **成立** | pack 是 ci.yml:34 最后一步（B4） |
| D4 token 不估算 | 成立 | **成立** | 记忆页确为 `≈` 估算（N2） |
| D5 adapters.ts 独占 | 成立 | **成立** | index.ts 3 处 ctx.logger（N3） |
| D6 Panel.tsx:78 | 成立 | **成立** | TABS 在 81（N1） |
| D7 FACTS 同源过期 | 部分成立 | **成立且更严重** | FACTS 的基线 commit 本身也过期（B2） |
| （漏项）基线 commit 漂移 | — | **QA 未覆盖** | cd2bb61→00d2b55，438.38→439.70（B1） |
| （漏项）回执提交者 | — | **QA 未覆盖** | 成员会话必 NOT_ENABLED（B5） |
| （漏项）sessions.json 不在 paths.ts | — | **QA 未覆盖** | N4 |
| （漏项）并发 clamp 未进已知限制 | — | **QA 未覆盖** | N5 |

QA 结论「不通过（需修补 D1–D3）」方向正确，但**低估了范围**：D1/D2/D3 之外还有 B1（基线整体过期）与 B5（真实操作会撞墙）。只修 D1–D3 不足以合并。

## 五、可用性复核（没接触过本插件的人能否从零装起来）

可照做的部分：

1. 前置（README:37）写了 node ≥22.18 与 profile 目录；
2. 构建 → `pnpm add "file:$REPO"` → grep 自检 → 重启，顺序正确，`pnpm add file:` 的安装源确实是已入库的 `lib/`（README:40 的注释正确）；
3. 生效判定（:48-52）给了三条可观察信号，并明确「返回未启用 ≠ 装坏」，这句能省掉大量误报；
4. 回滚（:54-61）给了 remove + 删 bundles + grep 0，闭环完整。

仍缺的前置/陷阱：

- **缺 `pnpm install`**（N6）：新 clone 直接 `pnpm build` 会失败在找不到 tsdown/tsc。
- 未提「安装动作只能由主 agent/有写权限的进程执行」；普通用户按 :41-42 在 profile 里 `pnpm add` 会撞权限或宿主限制。建议在「前置」加一句环境前提。
- `grep -n` 期望「2 行」（:43）只在 profile 原本没有同名包时成立；已有旧版本时可能仍是 2 行，但 bundles 里重复会出现 3 行。建议写「应看到两行：依赖项一行、bundles 一行」，而不是死数字。
- 面板三页怎么用（README:26/33）只说了入口，没有一句「任务页看进度、历史页看 run、记忆页改项目记忆」；首次安装者打开面板会停在任务页空态。属可选补充，不阻塞。

## 六、诚实性复核

- 做得好：U2 整页库（README:140）、回滚与真机 UI 未被写成「已验证」；README:80-81 主动把门禁 cwd 的假红写出来，还给了绕法——这是本轮最好的部分。
- 危险的是「以确定语气写错」的三处（B3/B4/N2）：比「未验证」更容易误导，因为读者不会去怀疑。
- 已知限制缺两条真实风险：回执提交者（B5）、并发 clamp（N5）。README:145 对门禁 cwd 的覆盖是充分的，且有实机证据（t1.log）支撑。

## 七、本次未能独立验证的项（按假设处理，不计入通过）

1. `668 通过 / 0 失败` 在当前 HEAD 的复跑结果（受「不重跑 pnpm test」约束；B1 已要求作者复测）。
2. `pnpm build` 在当前 HEAD 的产物尺寸（同上；本评审用已提交产物字节数 + npm pack 旁证）。
3. 真机 UI：胶囊/页签/设置分区实际出现、面板三页渲染、回滚实操——只读约束下无法起宿主；README 把它们写成步骤而非「已验证」，可接受。
4. B5 的「成员提交必失败」是代码路径判定（flags 只在 toggle 写入），未在真机会话抓一次 NOT_ENABLED 响应。

## 八、复现命令（本评审实际执行）

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
git rev-parse --short HEAD                          # 00d2b55
git diff --stat cd2bb61..HEAD                       # adapters.ts +82/-24; lib/index.js +58; test +2/-1
git cat-file -s HEAD:lib/index.js                   # 439695
npm pack --dry-run --cache /tmp/review-npm-cache    # exit 0; package size 238.7 kB; total files 5
find ~/.npm -user root | wc -l                      # 0
grep -n 'TABS\|TabKey' src/client/Panel.tsx         # 78 TabKey; 81 TABS
grep -n 'enabled\|flags\[' src/host/bridge.ts       # 1810-1812 只读 flags; 1125/1814-1817 写
grep -n 'npm pack' .github/workflows/ci.yml         # :34，最后一步
test -s ~/.dsh/profiles/desktop/.auto-team/artifacts/t1.log && echo gate-cwd-evidence-ok
```
