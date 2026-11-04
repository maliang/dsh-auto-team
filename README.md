# dsh-auto-team（自动团队）

把当前 DeepSeek Harness 会话变成队长：目标拆成**有依赖的任务图**，按角色**并行**派出可续聊成员，完成必须过**质量门禁**，全过程在输入框左侧开关与右栏「自动团队」面板里可见可改。

- 包名 / 版本：`dsh-auto-team@0.1.0`（`package.json`）
- 运行时约束：Node `>=22.18`；DSH `>=0.2.1-alpha.2 <0.3.0`（`package.json` 的 `engines`）
- 本文件所有命令默认在仓库内执行，先复制这一行（在仓库任意子目录都成立，执行后 `$REPO` 就是仓库根）：

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO"
```

## 30 秒看懂

1. 输入框**左侧**点开「自动团队」胶囊开关。默认关；开关按会话记在 `~/.dsh/auto-team/sessions.json`，只改开关不会起人。
2. 把目标直接说给队长。队长先调 `auto_team_plan` 落一份任务图，每条任务必须带 `roleId` 与**可执行的** `acceptance`（空验收整批拒绝、一条不落盘）。
3. 计划落盘后**自动派发**，不需要你点「派发」：并发上限、依赖门禁、写域冲突、暂停四道闸都在同一处（`src/host/team/dispatch.ts` 的 `dispatchReady`）判定，超出并发的任务排队。
4. 成员交付并向队长回报后，**由开着开关的队长会话**提交回执 → `auto_team_receipt` 执行该任务的 `acceptance`，**exit 0 才算 done**；失败转返工（rework），下游保持 blocked，失败证据回发原成员。成员子会话自己提交会一律回「未启用」（开关状态只记在点开胶囊的那个会话上，见「已知限制」）。

## 能力与入口

| 能力 | 入口 | 现状 |
| --- | --- | --- |
| 启用 / 停用（按会话，默认关） | 输入框左侧胶囊 `conversation.input.left` | 挂载点见 `src/client/slots.ts:41` |
| 打开右栏面板 | 会话头按钮 `conversation.session.header.actions` | `src/client/slots.ts:44` |
| 面板三页：任务 / 历史 / 记忆 | 右栏「自动团队」页签（keyed，`sidebar.right.pane.tab` + `.title`） | `src/client/Panel.tsx:81`（`TABS` 单源；`TabKey` 类型在 :78） |
| 项目库（跨 run 列表、历史详情、全局记忆） | 左栏「自动团队」栏目 `sidebar.panellist` + 主区整页 `main` | `src/client/slots.ts:441,449`；主区注册失败会降级为面板内联库 |
| 参数与角色/技能管理 | 设置页「自动团队」`settings.section` | 6 个参数 + 角色/技能编辑（`src/client/SettingsPage.tsx`） |
| 记忆 | 面板「记忆」页只列**项目记忆**；公共记忆在左栏「全局」 | 双轨 md，读写也可用 `auto_team_memory` |
| 角色 | 内置 **11** 个 + 自建；每角色可指定 `provider/model` | `src/host/roles/builtin.ts:230`（`BUILTIN_ROLES`） |
| 技能 | 内置 **12** 个；来源 `builtin/imported/system/manual`，内置可改、可恢复出厂 | `src/host/roles/builtin.ts:22`（`BUILTIN_SKILLS`） |

> 面板里**没有**「派发」按钮：派发由计划落盘自动触发，人能做的是暂停/继续、改角色、取消/跳过单任务、改验收命令。角色页已从面板移除，只在设置页维护。

## 安装（本机 profile = `desktop`，`dsh` 不在 PATH）

前置：`node -v` ≥ 22.18；profile 目录 `~/.dsh/profiles/desktop` 已存在，且当前进程对该目录有写权限（`pnpm add` 要改 profile 的 `package.json`，受限沙箱会话会被拒绝）。

```bash
cd "$REPO" && pnpm install        # 首次 clone 必做：tsdown/typescript 在 devDependencies（本仓用 pnpm 10.x 验证）
cd "$REPO" && pnpm build          # 先产出 lib/index.js + lib/client.js（安装源就是 lib/）
cd ~/.dsh/profiles/desktop
pnpm add "file:$REPO"
grep -n '"dsh-auto-team"' package.json   # 应看到两行：依赖项一行、dsh.profile.bundles 一行
```

`grep` 只出现 1 行（只有依赖、没有 bundles）时，手动在 `dsh.profile.bundles` 数组里补 `"dsh-auto-team"`，再重启。

安装生效的判定（缺一即未生效）：

1. 重启 DeepSeek Harness 宿主进程，刷新 Web GUI。
2. 输入框左侧出现「自动团队」胶囊；会话头出现同名按钮；右栏出现「自动团队」页签；设置页出现「自动团队」分区。
3. 对队长说「用 `auto_team_status` 看一下当前团队状态」：返回快照结构（没有计划时字段为空）算激活；返回「自动团队未启用…」只说明**开关没开**，不是装坏了。

回滚：

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-auto-team
# 再从 package.json 的 dsh.profile.bundles 中删掉 "dsh-auto-team"
grep -c '"dsh-auto-team"' package.json    # 期望 0
```

## 队长可用的 8 个工具

未启用时全部返回同一句中文错误：`自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。`

| 工具 | 用途 | 关键约束 |
| --- | --- | --- |
| `auto_team_plan` | 落一份执行计划，返回 `runId` | 空 `acceptance` / 非法写域整批拒绝，一条不落盘 |
| `auto_team_add_tasks` | 往**同一个** run 追加任务 | 必须带 `runId`；内容指纹幂等；整批原子；已终止的 run 拒绝 |
| `auto_team_dispatch` | 手动派发就绪任务 | **必须带 plan 返回的 `runId`**，缺了直接拒绝（保证计划早于成员） |
| `auto_team_status` | 读计划、成员、门禁证据、消息账本 | 只读；无计划时返回空字段而不是报错 |
| `auto_team_message` | 直达成员（按 taskId 或成员名定位） | 可续聊；中断后用同一 `memberId` 继续，不要新建同名成员 |
| `auto_team_receipt` | 提交回执并跑门禁 | 任务 `running → done` 的**唯一**入口；成员口头说完成不算。**只能由开着开关的队长会话提交**：handler 先用调用者会话（`exec.agent.id`）查开关，成员子会话没有开关记录，必回「未启用」（`src/host/tools.ts:408-409`） |
| `auto_team_memory` | 读写双轨记忆（`list/read/write/expand`） | 写入自动限制行数并落来源；`expand` 按 `mem://` ID 取全文 |
| `auto_team_role` | 角色读写（`list/save/remove`） | 内置角色可改不可删 |

## 门禁（acceptance）语义

- 执行目录 = 插件装配时的 `workspace`：`src/host/index.ts:102` 为 `options?.workspace ?? process.cwd()`，真机当前未传 `options.workspace`，故等于**启动宿主时的进程 cwd**（本机实测 `~/.dsh/profiles/desktop`），**不是**你打开的仓库。
  - 后果：验收命令里的仓库相对路径会 `exit 1` 且日志为空（`test -s README.md` 就静默失败）。**验收命令要先 `cd` 到仓库根，或直接用仓库根的绝对路径**（不要依赖门禁的当前目录）；本轮 t1 就是这样假红的。
  - 门禁日志落在 `<workspace>/.auto-team/artifacts/<taskId>.log`，同样跟着启动目录走。
- 默认超时 `300000ms`（`GATE_TIMEOUT_MS`），证据保留输出**末 4000 字符**（`GATE_TAIL_CHARS`）。
- 判定：`exit 0` = 通过；非 0、超时、被信号杀（`exitCode: null`）都算失败。
- 失败 → 任务转 `rework` 并把命令/退出码/输出尾部回发给同一成员；其下游保持 `blocked`，不会带着坏上游往下跑。
- 写域：只有 `running` / `gate` 状态占用写域，离开即释放；冲突 = 相等或**目录边界前缀**（`src/host` 与 `src/hostile.ts` 不冲突）。等待者会收到一条释放通知。
- 5 类不可逆动作需要二次确认（`cancel` / `cancelTask` / `skipTask` / `updateAcceptance` / `forceParallel`），其余动作可逆、不弹窗；确认后复用同一个执行体，行为不漂移。

## 数据落点

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/auto-team/runs/` | 运行状态（计划、任务、成员绑定、门禁证据） |
| `~/.dsh/auto-team/sessions.json` | 各会话的开关 |
| `~/.dsh/auto-team/settings.json` | 6 个可配参数（并发 1..8 默认 3、记忆预算 200..4000、停滞 1s..600s 默认 90s、返工上限 1..10、门禁超时 1s..600s 默认 300s、队长模型） |
| `~/.dsh/auto-team/roles/<id>.json` | 角色定义（一角色一文件；内置首次启动 seed，可改不可删） |
| `~/.dsh/auto-team/skills/<id>.md` | 技能正文（内置覆盖层 + 导入/系统/手写，带 frontmatter） |
| `~/.dsh/auto-team/memory/public/` | 公共记忆（跨项目） |
| `<workspace>/.auto-team/memory/` | 项目记忆（`workspace` = 装配 workspace，真机 = 宿主进程 cwd，见「门禁」） |
| `<workspace>/.auto-team/artifacts/<taskId>.log` | 门禁全量日志（同上前提；本机实测落在 `~/.dsh/profiles/desktop/.auto-team/artifacts/`） |
| `~/.dsh/auto-team/deviations.jsonl` | 队长亲自写文件的留痕（append-only） |

路径派生集中在 `src/host/paths.ts`：`globalDataRoot` 已含 `.dsh`，不要再拼一层（会落到 `~/.dsh/.dsh/…`，症状是「保存成功、重启全丢」）。唯一例外是会话开关 `sessions.json`，由 `src/host/bridge.ts:408-409` 用 `${deps.dataRoot}/sessions.json` 拼出。

## 开发与验证（提交前必须全绿）

```bash
cd "$REPO"
pnpm typecheck      # tsc --noEmit
pnpm test           # node --test test/*.test.ts
pnpm build          # 双产物：lib/index.js（ESM）+ lib/client.js（CJS 套 __ModuleLoader__ 壳）
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run --cache /tmp/npm-pack-cache   # 必须含 lib/index.js、lib/client.js、cordis.patch.yml
```

### 实测基线（基线 commit `cd2bb61`）

下面这组数字的基线是 **commit `cd2bb61`（2026-11-04 09:24 实测）**，逐条命令与输出见 `docs/teamflow/20261103-r13-readme-refresh/FACTS.md`。仓库 HEAD 此后已前进到 `00d2b55`（宿主事件订阅改走 root），构建体积与用例数会随实现漂移——**要拿当前数就重跑下面这组命令**，不要拿本表的旧数去比对 CI 产物。

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO" \
  && pnpm typecheck && pnpm test && pnpm build \
  && node --input-type=module -e "await import('./lib/index.js')" \
  && node --input-type=module -e "await import('./lib/client.js')" \
  && npm pack --dry-run --cache /tmp/npm-pack-cache
```

- `pnpm typecheck` → exit 0
- `pnpm test` → **668 通过 / 0 失败**，exit 0
- `pnpm build` → exit 0，`lib/index.js` 438.38 kB、`lib/client.js` 353.96 kB
- 两条 `import` 自检 → exit 0
- `npm pack --dry-run` → 5 个文件 / 238.2 kB（README 本身 13.1 kB；233.4 kB 是重写前那份 2.1 kB README 的包体积，不要再引用）

漂移实测（`00d2b55`，2026-11-04 09:44）：同一组命令 `pnpm test` 仍 668 通过，`lib/index.js` 439.69 kB、`lib/client.js` 353.96 kB 与基线一致；`npm pack` 体积随 README 自身大小变化，会一路缓慢上浮（09:44 时 238.7 kB，README 增补后 09:56 实测 241.6 kB / 5 文件），比对包体积前先看当前 README 字节数——这就是本表必须带 commit hash 的原因。

不要绕过这几条：`lib/` 必须入库（`pnpm add file:` 的安装源）；本地 import 必须带 `.ts` 扩展名；host 与 client 零直接 import，只走 `GET/POST /api/auto-team`；**宿主服务读取集中在 `src/host/adapters.ts`**，装配入口 `src/host/index.ts` 只允许 `ctx.logger` 日志调用（:316 / :654 / :658）。

## 故障排查

| 症状 | 真实原因 | 处置 |
| --- | --- | --- |
| 构建全绿、右栏页签永不出现 | keyed slot 缺 `key`，或没把页签注册进 `sidebarRightTabs` | 两处 key 与 `sidebarRightTabs.register({id,kind})` 必须同值；改完跑 `pnpm test`（含 slot 约定用例） |
| 所有工具都回「未启用」 | 工具按 `exec.agent.id` 认会话，面板按真实 session 记开关 | 确认是在**同一会话**点的开关；不要用 `'current'` 兜底 |
| 面板接口一律 `HTTP 404` | `webServer` 在 `apply` 时刻还未激活 | 本仓已两级注册：先试一次，再 `ctx.inject(['webServer'], cb)`；自检看浏览器 Network 里 `GET /api/auto-team/snapshot?sessionId=…` 是否 200 且响应带 `roles` |
| 页签出现但内容空白、点了没反应 | 前端把 `{data,error}` 整包当数据用 | 读接口必须解构 `{data,error}`（历史高频 bug 族） |
| 装完 GUI 毫无变化 | 没重启宿主 / `cordis.patch.yml` 的 `name` 写成了子路径 | `name` 必须是包根名 `dsh-auto-team`，否则 clientModules 扫描会跳过 |
| `npm pack` 报 `EPERM …/_cacache/tmp/…` | 运行环境对 npm 默认缓存目录 `~/.npm` 不可写；**不是文件属主问题**：`find ~/.npm -user root` = 0，属主是当前登录用户（非 root），本会话对 `~/.npm/_cacache` 的 `touch` 同样是 `Operation not permitted`（沙箱拒绝写工作区外目录） | 加 `--cache /tmp/npm-pack-cache`（或用可写的 `HOME=/tmp/...`）。**不要** `sudo chown -R <uid>:<gid> ~/.npm`：uid:gid 换机即错，改家目录属主有破坏性，且解决不了沙箱写限制 |

## 已知限制 / 未完成

每条按「现象 → 原因 → 规避」写。

- **门禁 cwd 不是会话 workspace**（最容易踩）
  - 现象：验收里的仓库相对路径（如 `test -s README.md`）`exit 1` 且日志里没有任何输出；门禁日志与项目记忆也落在别处。
  - 原因：`src/host/index.ts:102` 取 `options?.workspace ?? process.cwd()`，真机未传 `options.workspace`，所以等于**宿主进程启动目录**（本机 `~/.dsh/profiles/desktop`，实机证据 `~/.dsh/profiles/desktop/.auto-team/artifacts/t1.log`），不是你打开的仓库。
  - 规避：acceptance 写绝对路径或自带 `cd <repo> && …`；根治要由宿主把会话工作区传进插件 `apply`。
- **`auto_team_receipt` 只能由队长会话提交**
  - 现象：成员子会话自己提交回执，一律返回「自动团队未启用」。
  - 原因：handler 先用调用者会话查开关（`exec.agent.id` → `src/host/tools.ts:408-409`），而开关只在点胶囊 toggle 时写入（`src/host/bridge.ts:1125-1126`，`setEnabled` 在 :1814-1816）；成员是独立会话，没有这条记录。
  - 规避：成员把结果回报给队长，由开着开关的队长会话代跑 `auto_team_receipt`。
- **设置里的并发可能被宿主上限夹小**
  - 现象：设置填 6，实际只并行 3。
  - 原因：`src/host/index.ts:177-192` 的 `hostConcurrency()` 以宿主上限为天花板（设置是上限请求，不是替代宿主约束）。
  - 规避：按面板/快照显示的实际生效值预期（快照带 requested 与 clamped 标记）。
- **左栏主区整页项目库未在真机验证（U2）**
  - 现象：真机上左栏「自动团队」栏目或主区整页可能不出现。
  - 原因：这段注册整体包在 `try/catch` 里，且未在真机验证过视觉与交互。
  - 规避：注册失败会自动降级为面板内联项目库，弹窗与右栏不受影响。
- **暂停只掐派发、回执与停滞判定**
  - 现象：点了「暂停」，已在跑的成员仍会继续写文件。
  - 原因：暂停不打断已启动的成员轮次，也不清门禁证据。
  - 规避：要立刻停手只能在面板中断该成员；暂停用于「别再派新的」。
- **计划落盘即自动派发，没有「先审后发」开关**
  - 现象：`auto_team_plan` 一返回，成员就可能已经被创建。
  - 原因：派发由计划落盘自动触发（没有独立的派发开关）。
  - 规避：想先复核就先点面板「暂停」，确认计划后再继续。
- **token 用量分两种口径**
  - 现象：任务/运行页的 token 偶尔显示「不可得」，记忆页的 token 带 `≈`。
  - 原因：任务/运行取宿主 `session/event` 上报，取不到就是不可得；记忆页按字符数估算（`src/host/format.ts:123` 的 `memoryTokenEstimate`，约「字符数/2」），不是 provider 上报值。
  - 规避：看真实用量读任务/运行维度；记忆页的 `≈` 只用于横向比较记忆条目大小。
- **本机 `npm pack` 的默认缓存不可写**（见故障表）
  - 现象：不加 `--cache` 时 `npm pack` 报 `EPERM …/_cacache/tmp/…`。
  - 原因：运行环境对 `~/.npm` 不可写（不是属主问题）。
  - 规避：`--cache /tmp/npm-pack-cache` 绕行；**CI 不受影响**——`.github/workflows/ci.yml` 跑在 `ubuntu-latest`，`npm pack --dry-run` 是最后一步（:34），全新 runner 的 `~/.npm` 可写。

## 文档

- 架构与模块契约：`docs/teamflow/architecture/ARCHITECTURE.md`
- 宿主事件 / UI 槽位 / 真机验证：`docs/teamflow/architecture/HOST-EVENTS.md`、`UI-SLOTS.md`、`REAL-HOST-VERIFY.md`
- 产品记忆（约定与踩坑）：`docs/teamflow/memory.md`
- 本轮 README 取证表：`docs/teamflow/20261103-r13-readme-refresh/FACTS.md`
- 团队协作守则与文档索引：`AGENTS.md`

## 变更记录

### 2026-11-04 — README 对齐 r13 实际契约

- 改了什么：按源码重写能力/入口表、安装与回滚、8 工具表、门禁与状态语义、数据落点、验证命令与实测基线、故障排查与已知限制。
- 为什么：旧版停留在 r1 口径（「内置 6 个角色」、输入框下方 dock 开关、面板含角色页、`pnpm test` 无基线），与 r10~r13 的实现不一致；文档与实现对不上比没有文档更有害。
- 怎么验：`pnpm typecheck && pnpm test` + 两条 import 自检 + `npm pack --dry-run`（可复现数字与基线 commit 见「开发与验证」的实测基线节，不在此重复）；每条数字的来源命令都记在 `docs/teamflow/20261103-r13-readme-refresh/FACTS.md`。
- 追加修正（同轮）：门禁执行目录原写成「会话 workspace」，实测是宿主进程 cwd（`~/.dsh/profiles/desktop`），导致相对路径验收假红；已按 `src/host/index.ts:102` 的真实取值改写「门禁」节、数据落点与已知限制。怎么验：在 `~/.dsh/profiles/desktop` 下把仓库根写成绝对路径跑同一套断言 → exit 0（同一断言用相对路径会 exit 1）。
- 追加修正（去作者路径）：开头准备行与实测基线复现命令里的 `$REPO` 不再写死本机绝对路径，统一改为 `export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO"`，在仓库任意子目录粘贴都落到仓库根；基线那段合并成一条完整命令链。怎么验：`grep -cE '/Users/[A-Za-z0-9._-]+/' README.md` 期望输出 `0`（无命中时 grep 退出码为 1，看计数即可）；两段命令块原样粘贴到仓库子目录执行，第一段后 `pwd` 为仓库根，第二段整链 exit 0。

### 2026-11-04 — 按 t2 评审（B1–B5）与 t1 QA（D1–D7）修补

- 改了什么：
  - B1/B2：实测基线改为**锚定 commit `cd2bb61`（09:24 实测）**，补一行可复制的复现命令（`git rev-parse` 推导 `$REPO` 版），并附 `00d2b55` 的漂移实测；`npm pack` 取 238.2 kB / 5 文件，注明 233.4 kB 是重写前 2.1 kB README 的旧包体积。
  - B3：EPERM 归因改为「运行环境对默认缓存目录 `~/.npm` 不可写」，删掉「`~/.npm` 是 root 所有」与 `sudo chown -R 501:20 ~/.npm`。
  - B4：删掉「CI 首步会红」，改为「本机缓存不可写用 `--cache` 绕行，`ubuntu-latest` 全新 runner 不受影响」（`ci.yml:34` 是最后一步）。
  - B5：正文步骤 4、工具表 `auto_team_receipt` 行、已知限制各补一条「只有开着开关的队长会话能提交回执；成员子会话必回『未启用』」。
  - N1～N8：`Panel.tsx:81`；记忆页 token 标为 `≈` 估算、只对任务/运行维度说「宿主上报」；宿主服务读取收窄为「集中在 `adapters.ts`，`index.ts` 仅 `ctx.logger`」；`sessions.json` 归到 `bridge.ts:408-409`；并发被宿主 clamp 进已知限制；快速开始补 `pnpm install`（pnpm 10.x）；668 只留在基线表，变更记录改为引用。
- 为什么：t2 评审结论是「不可合并」——旧数字会让人拿 `438.38 kB / 233.4 kB` 去比对当前产物并误判装错，`sudo chown` 是无效且危险的建议，「CI 首步会红」是假警报，而「成员自交回执必失败」会在第一次使用时就撞上。
- 怎么验：`cd "$REPO" && sed -n '/## 故障排查/,/## 已知限制/p' README.md | grep -c 'root 所有'`（期望 `0`，故障表不再有属主归因）；`sed -n '/## 已知限制/,/## 文档/p' README.md | grep -c 'CI 首步'`（期望 `0`）；`grep -n 'cd2bb61\|00d2b55\|auto_team_receipt' README.md`（均有命中）。正文里 `sudo chown` 只出现在故障表「**不要** `sudo chown` …」这一句纠错提示中；数字出处见 `docs/teamflow/20261103-r13-readme-refresh/FACTS.md` §1 / §1.1 / §9。
