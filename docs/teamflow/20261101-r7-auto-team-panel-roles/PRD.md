<!-- meta: summary="把自动团队从「输入框下方的开关」升级为「输入框内选项 + 顶栏面板入口 + 右栏可交互面板（暂停/继续）+ 宿主设置页的自动团队分区（参数 / 角色增删改 / 一键恢复默认）」，四类挂载点全部真机可见，暂停/继续与恢复默认有状态机级判据。" -->

基线依赖：docs/teamflow/20261101-r6-real-host-activation（该轮交付的 profile 加载入口、inject 完备性、两级 `webServer` 注册、`sidebar.right.pane.tab` keyed 注册 + `sidebarRightTabs` 页签类型注册必须逐项保持不回退）

取代：docs/teamflow/20261101-r6-real-host-activation#AC-8：开关行的挂载位置由 `conversation.composer.dock` 改为输入框内选项（`conversation.input.right`），r6 关于「composer.dock 里出现开关行」的判据在本轮不再适用，改由 AC-12 / AC-19 接替。

---

## 1. 背景与目标

r6 把插件从「单测里的插件」修成了「真机能亮」，但界面上用户能碰的入口只有一个：输入框下方那条 32px 开关行。用户这次的诉求是把它真正做成一个可用的产品界面：

1. 开关改成**选项**，放进输入框里（不再占输入框下面一整行）。
2. **顶部**增加「自动团队」面板按钮，点击在右栏打开面板。
3. 面板里看得到**成员任务流转 / 任务内容 / 任务进度 / 完成状态**。
4. 面板顶部有**暂停任务**按钮；暂停后变**继续任务**，再点从中断处继续（不是从头再来）。
5. **设置**里增加自动团队的设置栏，可设各项参数。
6. 在设置栏里**管理团队角色**：描述、提示词、技能、默认模型；可**新增角色**；有**一键恢复默认角色**。

目标不是「多加几个按钮」，而是：用户在一个界面上就能看出「这台机器上的自动团队现在在干什么、卡在哪、还差多少」，能随时暂停、随时继续，并且角色的行为（提示词/技能/模型）由用户自己掌握、改坏了能一键救回。

## 2. 用户故事（每条对应 AC）

| # | 用户故事 | 对应 AC |
|---|---|---|
| S1 | 作为用户，我不想让一个开关永久占据输入框下方一整行；我想在输入框里直接选「启用 / 停用」 | AC-12、AC-19 |
| S2 | 作为用户，我想要一个常驻在顶部的按钮，一键把自动团队面板拉到右栏 | AC-13、AC-19 |
| S3 | 作为用户，打开面板就能看到每个任务是谁在做、做到哪一步、还剩几个没完成 | AC-14 |
| S4 | 作为用户，我能在面板顶部暂停整个团队，暂停后同一位置变成「继续任务」，再点从中断处继续 | AC-9、AC-15、AC-20 |
| S5 | 作为用户，我能在宿主设置页找到「自动团队」分区，调并发、队长模型等参数，且重启后还在 | AC-6、AC-16、AC-17、AC-21 |
| S6 | 作为用户，我能在设置里改角色描述/提示词/技能/默认模型，能新建角色 | AC-7、AC-16、AC-17 |
| S7 | 作为用户，我把内置角色改坏了，一键恢复默认能救回来，而且不会误删我自己建的角色 | AC-8、AC-16、AC-21 |

## 3. 范围与非目标

**范围内**：四个挂载点（输入框内选项、顶栏按钮、右栏面板、设置分区）；面板的任务进度/完成状态可视化；暂停/继续的宿主状态机与落盘；角色提示词字段与设置页角色管理（含新增、一键恢复默认）；设置落盘与跨重启存活；上述全部的真机验证与守卫测试；`plugin-full` 交付契约 11 条。

**非目标（不做）**：不改 r5 的记忆注入「内联 + 按需展开」机制；不动三条既有 P3（`store.list()` 全量扫、面板长文本截断、跨 run 同名 fallback）；不给队长模型做「运行时热切换」以外的模型推理改造；不做技能正文的可视化编辑器（见假设 Q2）；不开放记忆注入预算为设置项（见假设 Q1）；不重排面板既有四个页签的信息架构；不改宿主侧任何代码（只消费宿主槽位与服务）。

## 4. 反面目标 / anti-goals

以下任一条成立，即使 `pnpm test` 全绿也判本轮失败——它们都是使用者一眼能看出来的。

1. **进度是假的**：面板上的「进度」只是把状态文字再念一遍（running 恒显示 0%，或干脆恒 100%）。可观察判据：任取一个 `running` 任务，面板显示百分比为 0 或 100，或与 `status`/`attempts` 不吻合；把同一任务改成 `gate`/`done` 后百分比不变。
2. **暂停只改了按钮文字**：点暂停后仍有新成员被创建、新任务开始跑；或者点继续后已完成任务被重跑、`members.length` 增加、`attempts` 自增。可观察判据：暂停期间 `members.length` 与 `tasks[].memberId` 集合不变；继续后 `done` 任务集合不减少。
3. **一键恢复默认是「删库式」恢复**：把用户自建的角色一起删掉，或恢复后角色与内置定义不逐字相同（用户改坏的字段残留在里面）。可观察判据：恢复前后用户自建角色目录/文件哈希不变；内置角色文件与 `BUILTIN_ROLES[id]` 序列化结果逐字相同。
4. **设置是「假持久」**：设置改完刷新页面就回默认，或只存在于浏览器 localStorage；或者写进了插件安装目录，插件一升级/重装就丢。可观察判据：`<DSH_HOME>/.dsh/auto-team/settings.json` 内容与提交值一致，且重启宿主后 snapshot 读回同值；文件不在 `node_modules/dsh-auto-team/` 里。
5. **宿主里没有**：四个挂载点里任何一个在真机 DOM 里不出现，而单测全绿（probe-v2 的老病：`name` 写成插件名 → 静默不挂载）。可观察判据：真机脚本在活会话页面上抓不到对应锚点元素即判红，不接受「单测通过」代替。

## 5. 交互流程摘要

**A. 启用/停用（输入框内）**：输入框右侧出现一个紧凑选项控件（`data-auto-team-option`），展示当前状态（`已启用 / 未启用`），点击展开选项列表：`启用自动团队` / `停用自动团队` / `打开面板`。选择启用/停用 → `act({type:'toggle'})` → 胶囊文案与选项文案同步更新；选择打开面板 → 走顶栏按钮同一条打开路径。

**B. 顶栏按钮 → 右栏面板**：`conversation.session.header.utilities` 里一个「自动团队」按钮（`data-auto-team-header-button`），点击调 `createOpenPanel` → `sidebarRight.openTab(PANEL_TAB_KIND)`；宿主路径失败时降级发 `dsh-auto-team:open-panel` 事件并给出可见提示，不静默失败。

**C. 面板（右栏 `sidebar.right.pane.tab` + `.title`）**：顶部一行 = 标题 `自动团队` + 状态胶囊（未启用 / 计划中 / 执行中 / 已暂停 / 已完成）+ `计划 N · 成员 N · 并发 r/l` + 队长模型三态 + **暂停任务 / 继续任务**按钮。下面四个页签不变：计划 / 成员 / 记忆 / 角色；计划页每个任务行显示：标题（任务内容）、角色名、`status` 文案、进度百分比、依赖已满足数、成员名、尝试次数、最近事件时间；页头显示 `完成 x/N`。

**D. 暂停 / 继续状态机**：
```
dispatching --pause--> paused
  plan.status = 'paused'；pausedAt = now
  running 任务 -> 'paused'；对运行中成员发中断 -> MemberStatus 'interrupted'
  暂停期间：dispatch 被拒（RejectionCode 'PAUSED'）；trigger 推进被丢弃（reason 'paused'）
paused --resumeTeam--> dispatching
  清 pausedAt；'paused' 任务按原 memberId 复用续聊（走既有 resume 幂等窗口 RESUME_DEBOUNCE_MS）
  已完成（done）/失败（failed）任务不回退、不重跑；重复 resume 幂等（无变化即 returned 0）
```
**E. 设置页（`settings.section`）**：宿主设置导航出现「自动团队」分区，内容两段：
- 【参数】并发上限（1–8，默认 3）、新会话默认启用（默认关）、队长模型（provider / model / reasoningEffort，留空 = 宿主默认）、成员提示词附加段（多行文本，追加到成员提示词尾部）。
- 【角色】角色列表（内置标记 + 用户自建标记）；点开编辑：名称、描述、**提示词**、技能（多选既有技能 id）、默认模型（provider/model/effort）；按钮：保存、删除（用户自建，两步确认）、新建角色、**一键恢复默认角色**（两步确认，文案明示「只重置内置角色，保留你自建的角色」）。
- 任何一次保存失败都必须在页面上显示具体错误（`RejectionCode` 对应中文文案），不允许「点了没反应」。

## 6. 交付形态契约映射（plugin-full · 11 条 → AC）

| 契约 | 落成的 AC |
|---|---|
| 1 profile 层加载入口声明 + 入口 name 用包根名 | AC-1 |
| 2 client bundle 声明字段集合与样本一致 + 产物非空含包 id | AC-3 |
| 3 UI 挂载点 name = slot 名本身，inject 参数与 name 逐字相同 | AC-4 |
| 4 入口声明与构建产物进 `files` | AC-22 |
| 5 依赖协议可解析（0 处 `workspace:`） | AC-22 |
| 6 peer/可选 peer 覆盖宿主 `@deepseek-ai/*` | AC-22 |
| 7 产物与源码同步 | AC-22 |
| 8 装载安全（两产物顶层不抛错） | AC-22 |
| 9 能被 profile 真装并被宿主加载 | AC-19、AC-24 |
| 10 安装带回滚 | AC-24 |
| 11 安装由主 agent 执行（三步） | AC-24 |

## 7. 验收标准（AC）

> 约定：命令默认在仓库根 `/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team` 执行；`<HOME>` = `/Users/maliang/.dsh`；「真机」= 本机 `desktop` profile 的宿主（GUI `http://127.0.0.1:57150`）或 r6 建立的克隆 profile 第二宿主。每条 UI 判据都注明采样页面状态。

### A. 宿主与契约层

**AC-1（加载入口声明）** `cordis.patch.yml` 存在且其 `name` 逐字为包根名 `dsh-auto-team`；`package.json` 的 `dsh.bundle.patch` 指向该文件。
判据：`grep -n '^name:' cordis.patch.yml` → `name: dsh-auto-team`；`node -e "const p=require('./package.json');console.log(p.dsh.bundle.patch, p.files)"` → `./cordis.patch.yml [...]`。

**AC-2（inject 完备性 与 ctx.get 纪律）** 入口 `inject` 数组 ⊇ 宿主侧全部裸访问的 `ctx.<service>`（保持 r6 的 4 项：`tools` / `systemPrompt` / `agents` / `agentTeams`，若本期新增裸访问必须同步加入）；可选服务（`webServer` / `llm` / `agentDefaultModel` 等）只经 `src/host/adapters.ts` 的 `optionalService()` / `readServiceQuietly()` 走 `ctx.get`，其余模块 0 处 `ctx.get`。
判据：`node --test test/validation.test.ts test/adapters.test.ts` 绿；守卫断言「`ctx.get` 只出现在 `src/host/adapters.ts` 且总数 ≤ N」。

**AC-3（client 声明块与产物）** `package.json` 的 `dsh.client` 字段集合与同机样本逐字段一致（`platform` / `inject` 7 项 / `immediately:false`）；`lib/client.js` 非空且含包 id 字符串 `dsh-auto-team`。
判据：`node -e "const c=require('./package.json').dsh.client;console.log(Object.keys(c).sort().join(','), c.inject.length)"` → `immediately,inject,platform 7`；`grep -c 'dsh-auto-team' lib/client.js | head -1` → > 0。

**AC-4（四个挂载点的 name 逐字等于 slot 名）** 新增/保留的挂载注册均满足「`ctx.slots.inject('<slot>')` 的参数 === `register({ name: '<slot>' })` 的 name」，插件标识只出现在 `id`（或 keyed slot 的 `key`）：
| 挂载点 | 用途 | 形式 |
|---|---|---|
| `conversation.input.right` | 输入框内选项 | list，`{name,id,order,inject:(sessionId)=>({sessionId,...})}` |
| `conversation.session.header.utilities` | 顶栏面板按钮 | list，`{name,id,order,registrant,inject:(sessionId)=>({...})}` |
| `settings.section` | 设置分区 | `{name,id,order,label,inject:()=>({...})}`（宿主 0.1.x 只投影 id/order/label） |
| `sidebar.right.pane.tab` + `.title` | 右栏面板（沿用 r6） | keyed，`{name,key,inject:(sessionId)=>({sessionId})}` |

判据：`node --test test/client-contract.test.ts` 绿，且守卫脚本对四条注册逐一断言 `name === slot`；`grep -n "name: 'conversation.input.right'\|name: 'conversation.session.header.utilities'\|name: 'settings.section'" src/client/slots.ts` 三条命中。

**AC-5（右栏页签两步注册不回退）** `src/client/slots.ts` 仍通过 `ctx.inject(['sidebarRightTabs'], …)` 再 `tabs.register({ id, kind, priority, title })` 注册页签类型，且 `id === keyed key === 'dsh-auto-team-panel'`。
判据：`grep -c 'sidebarRightTabs' src/client/slots.ts` → ≥1；守卫断言 `panelTabDefinition().id === PANEL_KEY`。

**AC-6（设置落盘与跨重启存活）** 设置写入 `<HOME>/.dsh/auto-team/settings.json`（`globalDataRoot()` 派生，不在 `node_modules/` 内），字段白名单 `{ version, maxConcurrent, defaultEnabled, captainModel?, promptAddendum? }`，非法值被拒或 clamp 到合法域；宿主重启后 `GET /api/auto-team/snapshot` 的 `settings` 字段读回同值。
判据：真机执行 `POST /api/auto-team/act` `{type:'saveSettings', settings:{maxConcurrent:5}}` → 200 且 `cat <HOME>/.dsh/auto-team/settings.json` 含 `"maxConcurrent": 5`；重启宿主再 `GET snapshot` → `settings.maxConcurrent === 5`。

**AC-7（角色提示词字段）** `Role` 增加可选 `prompt?: string`（内置角色有非空默认提示词），`saveRole` 能读写，snapshot 的 `roles[]` 透传；空字符串与缺省等价。
判据：`node --test test/roles.test.ts`（含「保存 prompt 后读回一致」「缺省与空串等价」两条）；`grep -n 'prompt' src/shared/types.ts` 命中 Role 定义。

**AC-8（一键恢复默认角色 · 可分辨）** 新动作 `restoreDefaultRoles` 用 `BUILTIN_ROLES` 重写内置角色文件：① 改坏一个内置角色的 `duty`/`prompt`/`skillIds`/`model` 后恢复，其 `<HOME>/.dsh/auto-team/roles/<id>.json` 除 `updatedAt` 外与内置定义逐字相同；② 用户自建角色的文件 sha256 前后不变、不消失。
判据：`node --test test/roles.test.ts` 的 restore 用例（改坏 → 恢复 → 深比较 + 自建角色 sha256 相等）；真机 `act({type:'restoreDefaultRoles'})` 返回恢复的 id 列表并落盘。

**AC-9（暂停/继续状态机 · 宿主级）** 新动作 `pause` / `resumeTeam`：
1. `pause`：`plan.status` → `'paused'`，`pausedAt` 落盘；所有 `running` 任务 → `'paused'`；对运行中成员发中断，成员态 → `interrupted`；**不新建成员**。
2. 暂停期间：`dispatch` 返回 `{error:'PAUSED'}`（新 `RejectionCode`，有中文文案）；watcher tick 的 trigger 推进被丢弃且 reason 记为 `paused`。
3. 重复 `pause` 幂等（`pausedAt` 不刷新、任务态不变、成员数不变）。
4. `resumeTeam`：清 `pausedAt`，`'paused'` 任务按原 `memberId` 续聊（走既有 `resume` 幂等窗口），`done`/`failed` 任务不回退不重跑，重复 `resumeTeam` 返回「无变化」。
判据：`node --test test/pause.test.ts`（至少 6 条：往返、幂等×2、dispatch 被拒、trigger 丢弃、done 不回退）；`grep -n "'paused'" src/shared/types.ts` 命中 `TaskStatus`。

**AC-10（形状扩张显式清单 · 不多不少）** 本期新增且**仅**新增：
| 类别 | 增量 | 理由 |
|---|---|---|
| `PanelAction` | `pause`、`resumeTeam`、`restoreDefaultRoles`、`saveSettings`（11 → 15） | 暂停/继续是全局状态迁移，既有 `resume` 只处理单成员续聊，语义不同不能复用；恢复默认与设置保存是新的写入口，`saveRole` 无法表达 |
| `RejectionCode` | `PAUSED`（+中文文案） | 暂停期间派发必须给出可解释的拒绝原因 |
| `TaskStatus` | `paused` | 暂停后任务既非 `running` 也非 `ready`，混用会让「已完成不回退」判据失真 |
| `PanelSnapshot` | `paused?: boolean`、`pausedAt?: number`、`settings?: SettingsView`、`skills?: Array<{id,title}>` | 面板与设置页只经 snapshot 读；角色编辑器需要技能候选 |
| `Role` | `prompt?: string` | 用户要能调「提示词」 |
| 磁盘 | `<HOME>/.dsh/auto-team/settings.json` | 设置要跨重启存活 |
**不新增**：`ActivityEvent.kind`（暂停/继续记 `status`，仍 9 种）；HTTP 路由（仍 3 条，设置/角色/暂停全走 `POST /api/auto-team/act`）；`PlanStatus`（已有 `paused`）。
判据：`grep -c "type: '" src/shared/types.ts` 与守卫快照比对；`node -e "import('./src/shared/types.ts')"` 不适用，改用 `node --test test/contract-frozen.test.ts` 断言 `PanelAction` 成员集合恰为 15 项、`ActivityEvent.kind` 恰为 9 项、`src/host/http.ts` 路由注册恰 3 处。

**AC-11（形态冻结：预算常量与定时器）** `MEMORY_INJECT_BUDGET`(4000)、`WATCHER_INTERVAL_MS`(1500)、`PANEL_ACTIVE_MS`(2000)、`STALL_MS`(90000)、`NOWAIT_THRESHOLD_MS` 全仓各一处定义；`setInterval` 仍只在 `src/host/team/watcher.ts`；本期设置项**不得**把这些常量做成可配（设置只含 AC-6 白名单字段）。
判据：`grep -rn 'MEMORY_INJECT_BUDGET = 4000' src | wc -l` → 1（其余常量同理）；`grep -rn 'setInterval(' src | grep -v watcher.ts | wc -l` → 0。

### B. client 与交互层

**AC-12（输入框内选项取代开关行）** 原 `conversation.composer.dock` 的 32px 开关行**移除**（`src/client/Toggle.tsx` 改为输入框内选项组件，或删除并在 `slots.ts` 注销 `conversation.composer.dock`）；`conversation.input.right` 内渲染紧凑选项控件，带 `data-auto-team-option` 锚点、当前状态文案（`已启用`/`未启用`）、可聚焦（`role="button"` 或原生 `button`）、`aria-expanded` 反映菜单开合。
判据：`grep -n 'conversation.composer.dock' src/client/slots.ts` → 0 命中；`grep -n 'conversation.input.right' src/client/slots.ts` → 1 命中；真机 DOM（活会话）`document.querySelectorAll('[data-auto-team-option]').length === 1`。

**AC-13（顶栏按钮打开右栏面板）** `conversation.session.header.utilities` 注册「自动团队」按钮（`data-auto-team-header-button`，`aria-label="自动团队"`）；点击后 `sidebarRight.openTab(PANEL_TAB_KIND)` 返回 true 即视为打开；返回 false 时发 `dsh-auto-team:open-panel` CustomEvent 并在按钮上给出可见提示，不允许静默。
判据：`node --test test/client-contract.test.ts`（含「openPanel 失败时必须发事件」）；真机：活会话点击按钮后右栏出现 `[data-slot="sidebar.right.pane.tab"]` 内容且标题为 `自动团队`。

**AC-14（面板展示任务流转 / 内容 / 进度 / 完成状态）** 计划页每个任务行必须可被单独锚定（`[data-auto-team-task="<taskId>"]`）并包含：`任务标题`、角色名、状态中文文案、**进度百分比**、依赖满足数、成员名、尝试次数。进度由纯函数 `progressOf(task)` 产出，`TaskStatus` 8+1 态映射为离散百分比（`pending/blocked/ready 0`、`running 40`、`gate 70`、`rework 60`、`done 100`、`failed 100`、`paused 40`），页头显示 `完成 x/N`。
判据：`node --test test/viewmodel.test.ts` 断言 9 态映射逐一正确、`done` 恒 100 且 `running` 不出现 0/100；真机 `document.querySelector('[data-auto-team-task="task-1"]').textContent` 含百分比数字与状态文案。

**AC-15（面板顶部暂停/继续按钮）** 面板顶部同一位置一个按钮：未暂停时文案 `暂停任务`、`data-auto-team-action="pause"`；暂停态文案 `继续任务`、`data-auto-team-action="resumeTeam"`；点击分别发对应 `act`；请求进行中显示禁用态防重复点击；服务端返回错误时在按钮旁显示中文原因。
判据：`node --test test/viewmodel.test.ts`（文案切换）；真机：点一次后 `document.querySelector('[data-auto-team-action]').textContent === '继续任务'`。

**AC-16（设置分区：参数 + 角色管理 + 恢复默认）** `settings.section` 注册的「自动团队」分区包含：并发上限输入（1–8）、新会话默认启用开关、队长模型三输入（provider/model/effort）、成员提示词附加段文本域、保存按钮；角色区列出全部角色（内置/自建标记），可编辑名称/描述/提示词/技能（多选）/默认模型，可新建、删除（自建，两步确认）、**一键恢复默认角色**（两步确认，确认文案明示「只重置内置角色」）。
判据：`grep -n "settings.section" src/client/slots.ts` → 1 命中；真机（设置页打开）`document.querySelector('[data-auto-team-settings]')` 非空，且其内 `querySelectorAll('[data-role-id]').length >= 6`。

**AC-17（设置与角色的输入校验 · 拒绝不落盘）** `maxConcurrent` 非 1–8 整数 → `BAD_REQUEST` 且 settings.json 内容不变；`captainModel` 的 provider/model 必须同填或同空（沿用 RolesTab 既有规则）；角色 `name`/`duty` 超长或为空 → `BAD_REQUEST`；角色 id 必须匹配 `/^[a-z0-9][a-z0-9-]{0,31}$/`。
判据：`node --test test/bridge.test.ts`（4 条校验用例，含「失败后文件 mtime/内容不变」断言）。

**AC-18（前端读接口必须解构 `{data,error}`）** 所有新增/修改的前端调用统一经 `src/client/api.ts` 解构 `{data,error}`；`state.ts`/新组件内 0 处 `= await request(...)` 整包赋值；错误分支必须渲染出文案。
判据：`grep -rn 'await request' src/client | grep -v 'const { data' | wc -l` → 0；`node --test test/client-contract.test.ts` 含「error 分支渲染文案」用例。

### C. 真机可见性

**AC-19（真机 DOM 四件套同时出现 · 母判据）** 在**活会话**页面（有 sessionId、composer 已渲染）上，一次采样必须同时命中：① `[data-auto-team-option]`（输入框内选项）② `[data-auto-team-header-button]`（顶栏按钮）③ 打开后右栏 `[data-slot="sidebar.right.pane.tab"]` 内的面板根 `[data-auto-team-panel]` 与标题 `自动团队`；在**设置页**采样命中 `[data-auto-team-settings]`。任一缺失即判红。采样前必须先造活会话（r6 实测：无活会话时 `composer` 相关槽位不渲染，会得到假阴性）。
判据：真机脚本 `node logs/teamflow/<runId>/scripts/real-host-ui-probe.mjs`（跑完归档）输出四行 `OK/FAIL`，全 OK 才算过；本 AC 不接受单测代替。

**AC-20（真机暂停/继续往返 · 不重跑 / 不回退）** 真机上：执行一次派发 → 面板点 `暂停任务` → snapshot 中 `planStatus === 'paused'`、`paused=true`、无新增成员、`running` 任务数为 0；再点 `继续任务` → `paused=false`，已完成任务仍 `done` 且 `memberId`/`attempts` 不变，`members.length` 不增加。全程在 DOM 上核对按钮文案切换与页头 `完成 x/N` 不回退。
判据：同一真机脚本的 `pause/resume` 段，输出暂停前后/继续后的 `{planStatus, paused, doneCount, members, attempts}` 四组快照，逐项与预期比对。

**AC-21（真机设置落盘 + 恢复默认可分辨）** 设置页改 `并发上限=5` 保存 → `cat <HOME>/.dsh/auto-team/settings.json` 含 `"maxConcurrent": 5` → 重启宿主 → 设置页显示 5、snapshot `settings.maxConcurrent === 5`。角色区改坏一个内置角色（例如把 `duty` 改成 `XXX`）→ 点恢复默认 → 该角色文件与内置定义逐字相同（`updatedAt` 除外），且用户自建角色文件 `sha256` 不变。
判据：真机脚本 `settings-persist` 段 + `sha256sum` 前后对比；输出贴文件路径与内容片段。

### D. 门禁与不回归

**AC-22（全量门禁）** `pnpm typecheck` 0 错；`pnpm test` ≥ 337 例全绿（可增不许减）；`pnpm build` 出双产物；`find src -newer lib/index.js -name '*.ts*' | wc -l` = 0；`node --input-type=module -e "await import('./lib/index.js')"` 与 `./lib/client.js` 均退出码 0；`npm pack --dry-run` 含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`；`package.json` 全文 0 处 `workspace:`；`peerDependencies`/`peerDependenciesMeta` 覆盖 7 个 `@deepseek-ai/*` 宿主包。
判据：逐条实跑并贴输出（QA-REPORT 判定表）。

**AC-23（r6 与 r5 不回归）** `sidebarRightTabs` 两步注册仍在（`grep -c sidebarRightTabs src/client/slots.ts` ≥ 1）；入口 `inject` 仍含 4 项且无 `{required, optional}` 形式；`webServer` 仍是两级注册（`src/host/adapters.ts` 有 `ctx.inject(['webServer']`）；r5 记忆注入逻辑与三条 P3 涉及文件零改动（`git diff --stat` 不含 `src/host/memory/*` 的注入与 `store.ts` 的 list 实现）；r4 既有探针（9/9）与 collision（12/12）不降。
判据：r4 复核脚本 + `git diff --stat` 输出。

**AC-24（安装带回滚 · 主 agent 三步实跑）** 按 §9 步骤执行：先落盘回滚步骤与基线，再装、再重启宿主、再 GUI 可见性检查；若可见性检查失败 → 立即执行卸载恢复并把现象写进 ACCEPTANCE。安装由**主 agent**执行（子代理权限钉死在工作区），ACCEPTANCE 必须贴主 agent 的实跑记录（命令 + 关键输出），不接受「人工补测」占位。
判据：ACCEPTANCE.md 含三步命令与输出原文、回滚命令、以及「失败即已恢复」或「成功」结论。

**AC-25（QA 报告与验收报告）** 本夹产出 `QA-REPORT.md`（AC-1 ~ AC-24 判定表，逐条贴实跑输出，未执行项必须写「未执行 + 原因」）与 `ACCEPTANCE.md`（结论 + 未验证清单 + 已知限制）。
判据：两个文件存在且判定表条目数 = 24。

## 8. 优先级

- **P0**：AC-1~AC-5（能装能亮）、AC-9/AC-10/AC-15/AC-19/AC-20（暂停继续 + 真机可见）、AC-22/AC-24（门禁与安装回滚）。
- **P1**：AC-6/AC-7/AC-8/AC-16/AC-21（设置落盘、角色提示词、恢复默认）、AC-12/AC-13/AC-14（选项 / 顶栏按钮 / 进度）。
- **P2**：AC-11/AC-17/AC-18/AC-23/AC-25（冻结与守卫、校验、解构、不回归、文档）。

## 9. 真机安装步骤（给主 agent 执行 · 本机）

本机探测结论：`DSH_HOME=/Users/maliang/.dsh`，profile=`desktop`，profile 目录 `/Users/maliang/.dsh/profiles/desktop`，`dsh` **不在 PATH** → 走 profile 内 `pnpm add file:` 的等价手动步骤。该 profile 当前已装 `dsh-auto-team`（`dependencies` 里有 `file:` 条目，`node_modules/dsh-auto-team` 存在），所以本轮是**更新安装**，回滚基线必须先记录。

**第 0 步（先写回滚，再装）**
```bash
cd /Users/maliang/.dsh/profiles/desktop
cp package.json /tmp/profile-desktop-package.baseline.json
grep -n 'dsh-auto-team' package.json
sha256sum node_modules/dsh-auto-team/lib/index.js 2>/dev/null || shasum -a 256 node_modules/dsh-auto-team/lib/index.js
```
回滚（任意时刻失败立即执行，包名取自产物 `package.json`，不写死）：
```bash
cd /Users/maliang/.dsh/profiles/desktop
pnpm remove dsh-auto-team
# 并把 dsh.profile.bundles 数组里的 "dsh-auto-team" 一行删除（手工编辑或按基线文件恢复）
cp /tmp/profile-desktop-package.baseline.json package.json   # 仅在需要精确还原时
```

**第 1 步（本机构建 + 门禁）**
```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
pnpm typecheck && pnpm test && pnpm build
find src -newer lib/index.js -name '*.ts*' | wc -l        # 期望 0
npm pack --dry-run | grep -E 'cordis.patch.yml|lib/index.js|lib/client.js'
```

**第 2 步（装进 profile）**
```bash
cd /Users/maliang/.dsh/profiles/desktop
pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
grep -n 'dsh-auto-team' package.json    # dependencies 与 dsh.profile.bundles 都要有
```

**第 3 步（重启宿主 + GUI 可见性检查）** 重启 DeepSeek Harness 应用（当前 GUI `http://127.0.0.1:57150`），打开一个**活会话**，逐项检查：① 输入框右侧「自动团队」选项（`[data-auto-team-option]`）② 顶栏「自动团队」按钮（`[data-auto-team-header-button]`）③ 点击按钮后右栏出现「自动团队」页签与面板（`[data-auto-team-panel]`）④ 打开设置页出现「自动团队」分区（`[data-auto-team-settings]`）。四项缺一即判失败并按第 0 步回滚。

## 10. 工程约束

- 分支：在 `feat/auto-team-plugin` 上就地开发（当前分支，勿切走、勿新建分支）；本轮不 rebase 主干。
- 未提交改动处理：工作区当前仅 `?? docs/teamflow/20261101-r7-auto-team-panel-roles/`（TeamFlow 建夹 + 本 PRD 等产物），**保留不动**，不 stash、不 revert；它与代码改动在同一次提交里收口。
- 提交：功能与文档**一次做完、最后单独一笔提交**（沿用 r6 习惯，便于整笔 `git revert`）；提交信息点名本任务夹路径；提交后 `git status --porcelain --untracked-files=all` 必须为空。
- 构建产物入库：`lib/` 必须入库（profile 安装源就是它），**不得**加入 `.gitignore`；每次提交前重新 `pnpm build` 保证产物与源码同步（AC-22）。
- `.gitignore` 收口：本栈需要覆盖 `node_modules/`、`*.tgz`（`npm pack` 产物）、`.DS_Store`、`logs/teamflow/`（运行日志，run 结束由 host 归档，不入库）、`.pnpm-store/`（若仓库内出现）、`*.log`、`coverage/`；**不得**出现 `lib/`。
- 其它：不改宿主副作用文件；不动 `$DSH_HOME` 之外的 profile；真机安装只能由主 agent 执行并附实跑记录。

## 11. 依赖与风险

**依赖**：r6 交付的宿主事实（inject 普通 map、`webServer` 两级注册、keyed slot 带 key、`sidebarRightTabs` 二次注册）不回退；宿主 0.1.x/0.2.x 的槽位契约（`settings.section` 只投影 id/order/label；`conversation.session.header.utilities` 是带 `registrant` 的 list 槽位；`conversation.input.right` 由 `dsh-plugin-teamflow` 同机使用，可作样本）。

**风险与降级**：
| 风险 | 影响 | 降级 |
|---|---|---|
| `settings.section` 在宿主里不渲染（宿主版本差异） | 设置栏不可见 | 面板内保留一个「设置」入口（不发新动作，复用 `saveSettings`），并在 ACCEPTANCE 记明降级 |
| `conversation.input.right` 无会话时不渲染 | 落地页假阴性 | 判据只在活会话采样（AC-19 明确写死采样状态） |
| 硬暂停中断成员与「成员刚好完成」竞态 | 任务被误标 paused | `pause` 只对快照里 `running` 且 `status !== 'done'` 的任务生效，逐任务幂等；单测构造「完成瞬间暂停」用例 |
| 新增 4 个动作被下游当形状扩张 | 契约冻结争议 | AC-10 给出增量表与理由，守卫断言总数恰 15/9/3 |
| 设置/角色写盘并发（面板与设置页同时保存） | 文件损坏 | 复用 `RunsStore` 的 tmp+rename 原子写；单测覆盖并发两次保存 |

## 12. 里程碑建议

- **T1 宿主**：`settings` 落盘与白名单、`pause/resumeTeam` 状态机、`restoreDefaultRoles`、`Role.prompt`、snapshot 新字段（AC-2/6/7/8/9/10/11/17）。
- **T2 client**：四个挂载点与组件（选项 / 顶栏按钮 / 面板暂停按钮 + 进度 / 设置分区）（AC-4/5/12/13/14/15/16/18）。
- **T3 守卫与单测**：`client-contract` 三处 name 断言、契约冻结守卫、pause 状态机、restore 可分辨、进度映射（AC-3/4/10/14/17）。
- **T4 构建 + 真机脚本**：双产物、`real-host-ui-probe.mjs`、`settings-persist` 段（AC-19/20/21/22）。
- **T5 交付自检 + 单笔提交**：门禁全绿、主 agent 安装实跑、QA/验收报告（AC-23/24/25）。

## 13. 假设与待澄清

- **（fact）Q1 设置项的确切边界**：需求只说「可设各个参数」。我假设设置只含「并发上限 / 新会话默认启用 / 队长模型 / 成员提示词附加段」四项，不含记忆注入预算、停滞阈值、门禁超时——因为这些是冻结的单点常量（AC-11），开放为设置项等于解冻。若用户要求开放，需同步改 AC-11 并说明常量不再单点。
- **（fact）Q2 角色「技能」的含义**：我假设技能 = 从既有技能库（`<HOME>/.dsh/auto-team/skills/*.md`，6 个内置）里多选 `skillIds`，**不**提供技能正文编辑器（正文编辑留到后续）。若用户要能改技能正文，需要新增技能的写入口（新动作/新路由），会扩张 AC-10 的形状清单。
- **（taste）Q3 暂停的力度**：硬暂停（中断运行中成员，继续时按原 `memberId` 续聊）vs 软暂停（只停新派发，成员跑完当前轮）。我推荐**硬暂停**——它才符合「从中断的地方继续」，且状态可断言（成员 `interrupted`、任务 `paused`）。默认：硬暂停。
- **（taste）Q4 输入框内「选项」的形态**：下拉菜单（启用 / 停用 / 打开面板）vs 分段开关（常驻两段）vs 单按钮轮换。我推荐**下拉菜单**：不占宽、能同时容纳「打开面板」，且和「选项」一词最贴。
- **（taste）Q5 设置栏的位置**：宿主设置页新增「自动团队」分区（`settings.section`）vs 只放在右栏面板的第五个页签。我推荐**宿主设置页分区**：用户说的「设置里」指宿主设置，且面板已四个页签不宜再挤。
- **（taste）Q6 一键恢复默认的范围**：只重置 6 个内置角色的定义（保留技能正文与用户自建角色）vs 连技能正文一起重置为出厂内容。我推荐**只重置内置角色**：用户改过的技能正文往往是自己写的团队约定，误删代价高；恢复按钮的文案会明示范围。
