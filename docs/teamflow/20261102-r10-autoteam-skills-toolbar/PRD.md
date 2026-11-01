<!-- meta: summary="把自动团队开关做成工具条上的通用选项胶囊（短标签 + 非红状态点、失败零红字）、面板头部信息分区排版且入口按钮可开可收、角色模型改弹层选择器、内置角色扩到 11 个，并让角色技能支持导入 md／选系统技能／手动新建三种来源且内置技能可改（用户覆盖层，重启读回）" -->

基线依赖：docs/teamflow/20261101-r7-auto-team-panel-roles（已验收的面板 / 角色 / 设置行为不得回归；docs/teamflow/20261102-r9-autoteam-toolbar-tab 的 PRD 范围由本夹继承并按其后的用户改判重写，r9 未落地、不构成行为基线）

取代：docs/teamflow/20261102-r9-autoteam-toolbar-tab#AC-16：技能不再「内置只读 + 无删除入口 + 不可编辑」，改为四类来源（内置 / 导入 / 系统技能 / 手动）且**内置技能可修改**，改动落用户覆盖层、重启读回用户版本
取代：docs/teamflow/20261102-r9-autoteam-toolbar-tab#AC-18：内置角色由「≥10（6 + ≥4）」改为明确的 **11 个**（现有 6 + 前端工程师 / 后端工程师 / UI-UX 设计师 / DevOps 运维 / 安全审计）

## 1. 背景与目标

自动团队面板（r7）已经能用，但三处体验仍不到位：① 开关在输入框上方单独占一行、旁边还有一行红色解释；② 面板头部把标题、状态、计划、成员、并发、模型、来源挤在一行，读起来像一锅粥；③ 角色能力靠「技能」定义，而技能只有 6 个内置、且面板里只读 —— 用户既加不了自己项目的规范（如"本仓测试怎么写"），也改不动内置技能里不合口味的条款。

本需求把开关收进对话框工具条，把失败信息从红字移进 title 与面板，把头部信息分区，让头部按钮可开可收，把模型选择改成弹层，把内置角色扩到 11 个，并**重做技能这一层**：技能可从本地 md 导入、从宿主已有技能里挑、或手动新建；内置技能更丰富且允许修改，修改落用户覆盖层（不污染包内文件），重启后读回用户改后的版本；「一键恢复默认角色」连带把内置技能恢复出厂，但不删用户自建的技能。

目标（可判定）：
- 工具条里只有 1 个「自动团队」选项、输入框上方 dock 里 0 处，页面 0 处红字解释（AC-5 / AC-12）。
- 技能条目的「来源」与「是否被改过」在界面上可分辨，且用户对内置技能的修改在重启后仍然存在（AC-19 / AC-20 / AC-29）。
- 11 个内置角色、≥12 个内置技能，任选一个角色都能选到有正文的技能（AC-17 / AC-21）。

## 2. 用户故事与验收标准

| 故事 | 作为 | 我想要 | 判据 |
|---|---|---|---|
| US-1 | 每天用自动团队的人 | 在对话框工具条上点一下就能开关，字号和别的切换钮一致，不占额外一行 | AC-1~AC-7、AC-12~AC-15 |
| US-2 | 看面板的人 | 头部一眼分清「标题 / 总体状态 / 计划与成员数 / 完成进度」，不是一长串 | AC-9、AC-10 |
| US-3 | 经常开关面板的人 | 会话头那个按钮点一下开、再点一下收，按钮亮暗跟真实状态一致 | AC-8、AC-11、AC-13 |
| US-4 | 给角色配模型的人 | 从弹层里搜索并选一个模型，而不是手打 provider / 模型名 | AC-16 |
| US-5 | 想把活分给专业角色的人 | 除了产品 / 架构 / 开发 / 测试 / 文档 / 评审，还能选前端、后端、UI-UX、运维、安全审计 | AC-17 |
| US-6 | 有自己项目规范的人 | 把本地 md 导进来、从宿主已有技能里挑、或直接手写一条，三种都行 | AC-18、AC-19、AC-23 |
| US-7 | 觉得内置技能写得不好的人 | 直接改内置技能的正文，改完重启还在；想反悔能恢复出厂，且不会顺手删掉我自己加的技能 | AC-20、AC-21、AC-22 |

## 3. 范围与非目标

**范围内**
1. 开关胶囊从 `conversation.input.dock` 迁到 `conversation.input.left`（短标签「自动团队」+ 状态点），dock 注册归 0。
2. 选项失败零红字：`data-option-error` 归 0，改非红琥珀状态点 + `title` / `aria-label` 承载原因 + 面板内可展开处承载原因。
3. 面板头部三段式：`data-panel-head`（标题 / 状态胶囊 / 刷新）+ `data-panel-meta`（计划·成员·并发 / 队长模型 / 事件源）+ 独立 `data-panel-progress-row`。
4. 会话头面板按钮可开可收（收起走面板侧 `tab.actions.close()` 事件闭环，`aria-pressed` 非乐观）。
5. 角色默认模型改为弹层选择器（`data-role-model-picker`，搜索 + 列表 + 回填；无模型时说明 + 手填兜底）。
6. 内置角色 6 → 11，并补齐配套技能。
7. 技能三入口（导入本地 md / 从宿主系统技能库选择 / 手动新建），技能带来源与「已修改」状态；内置技能可改（用户覆盖层）、可恢复出厂、不可删除；用户自建 / 导入 / 系统副本技能可删。
8. 「一键恢复默认角色」连带把内置技能恢复出厂，自建角色与用户技能保留。
9. 门禁与真机：既有 426 例单测只增不减、形状冻结、真机强制项。

**非目标**
- 不做第三处面板入口，「对话、轨迹」那一栏不动（面板入口仍是会话头按钮 + 右栏页签两处）。
- 不做技能市场 / 远程下载 / 在线分享；技能来源只有本机四条（内置 / 导入 / 系统 / 手动）。
- 不做技能版本历史（只有「当前版本 + 恢复出厂」两态，不存多版本）。
- 不做富文本 / 可视化技能编辑器（纯 markdown 文本域）。
- 不改宿主技能库本身（系统技能只读复制成副本，绝不反写 `~/.agents/skills`）。
- 不做技能排序拖拽、不做技能级权限、不做多用户隔离。
- 不新增 `PanelAction` 种类、不新增 HTTP 路由、不扩 `ActivityEvent.kind`（技能变更复用既有保存载荷）。

## 4. anti-goals / 反面目标

即使测试全绿、功能都在，出现下列任一条就算失败：

1. **用户的修改是幻觉**：改了内置技能正文、界面上看着改了，重启后被首启 seed 静默写回出厂版本；或者点「恢复默认」把用户导入 / 手写的技能一起删掉。用户下一次打开面板发现自己白干。
2. **三条入口只是三个按钮**：导入的 md 丢了正文或说明、系统技能副本没记来源（列表里所有条目长得一样），用户分不清哪些是自己加的，于是一条也不敢删、一条也不敢改。
3. **选了不生效**：模型弹层里选中一项、点保存，面板关掉再开又回到旧值；或技能编辑弹层打开时正文是空的（快照里没有正文），只能改标题不能改内容。
4. **开合状态撒谎**：头部按钮点一下就把自己点亮（乐观翻转），但面板其实没开；或者收起失败后按钮仍是「已按下」，用户连点两次后不知道面板到底是开还是关。
5. **11 个角色是换皮**：新增的 5 个角色 duty / prompt 与既有角色雷同、或只写一句占位，用户在派活时无法判断该选「开发」还是「前端工程师」。

## 5. 交互流程摘要

1. **工具条选项**：默认未启用 → 灰点 + 文本「自动团队」（不显示进度 / 不显示开关长句）；点击 → 只发一次 `toggle`；成功 → 点变强调色、`aria-checked` 同步；失败 → 文本与点位置不变，点转琥珀，`title` / `aria-label` =「操作失败：<原因摘要>」，面板 `[data-error]` 可展开看到同一原因。
2. **面板开**：会话头按钮（`aria-pressed=false`）→ 打开右栏页签 `dsh-auto-team-panel`，按钮 `aria-pressed=true`；再次点击 → 面板侧执行 `tab.actions.close()`，页签消失后按钮才回到 `false`（失败则保持 `true` 并提示）。
3. **面板头部**：`head` 只有三段（标题 / 状态胶囊 / 刷新）；`meta` 一行三组（`计划 x · 成员 y · 并发 a/b`｜`队长模型`｜`事件源`）；`progress-row` 独立一行（`完成 x/N` + 计划状态 + 暂停 / 继续）。窄宽允许折成两行，但不隐藏任何一组。
4. **模型选择**：角色编辑区「默认模型」是一个按钮，点击打开弹层（搜索框 + 可选模型列表 + 当前选中高亮）→ 选中即回填到按钮，保存后落盘；模型清单拿不到时弹层内给一句可读说明，并保留「手动填写 provider / 模型名」兜底。
5. **技能管理**（角色编辑区内）：「添加技能」展开三个入口 ——（a）选择本地 `.md` 文件导入；（b）从宿主系统技能库列表里勾选（可多选）；（c）手动填写名称 / 说明 / 正文。技能列表每行显示标题 + 来源徽标（内置 / 导入 / 系统 / 手动）+ 已修改标记；点开一行可编辑正文（内置技能同样可编辑），内置行额外有「恢复出厂」。
6. **恢复默认角色**：点按钮 → 二次确认（文案列清「11 个内置角色与内置技能将回到出厂；你自建的技能与角色不受影响」）→ 执行后内置技能正文回出厂、已修改标记清除，用户技能与自建角色逐字节不变。

## 6. 验收标准（本夹从 AC-1 编号）

| AC | 判据（可测 / 可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-1 | 挂载点迁移落地：`grep -rn "conversation.input.left" src/` 命中且唯一注册点（`src/client/index.ts` 一处 `ctx.slots.inject` + 槽位常量一处）；`grep -rn "conversation.input.dock" src/ \| wc -l` == **0**（含注释） | 单测 / 门禁 | P0 |
| AC-2 | 注册字段符合宿主 catalog：只传 `{name,id,order,label,inject}` 中存在的键、`id` 非空、不带 `key`（非 keyed slot）；`conversation.composer.bar`、`conversation.composer.dock`、`conversation.input.activity`、`conversation.header.corner`、`shell.leading` 在 `src/` 全 **0** 处；`conversation.view` 全 **0** 处 | 单测（AST 守卫） | P0 |
| AC-3 | 紧凑形态 + 短标签：`optionView().label` 逐字 ==「自动团队」（≤4 汉字，不含进度 / 暂停 /「完成 x/N」句式），完整语义留在 `ariaLabel`；选项根选择器含 `white-space:nowrap`、`text-overflow:ellipsis`、`max-width`、`min-width:0`、`flex:0 1 auto`、`align-self:center`，且该区块无 `font-size: var(`（字号写 `font: var(--dsw-font-xs-13, …)`） | 单测（AST / 正则）+ 真机 | P0 |
| AC-4 | 点击语义不变：点一次只发一次 `act({type:'toggle', enabled:!enabled})`；不隐式派发（面板 `PlanTask` 数与 `planStatus` 不变） | 单测 | P0 |
| AC-5 | 零红字 + 非红状态点（结构）：`grep -rn "data-option-error" src/ \| wc -l` == **0**；选项子树无 `role="alert"`、无错误色 token 引用；选项内恰好 1 个 `[data-option-dot]`，`data-tone` ∈ {`neutral`,`warn`}，取 computed 值断言所用颜色**不是** `--dsw-alias-state-error-primary` | 单测（AST）+ 真机 | P0 |
| AC-6 | 失败可分辨：伪造 `{error:'宿主未提供 webServer'}` 后 ① 可见文本与点击前逐字相同（只有「自动团队」）② `data-error-state="true"` 且 `[data-option-dot][data-tone="warn"]` ③ `title` / `aria-label` 含「操作失败」与该摘要 ④ 面板 `[data-error]` 文本含同一摘要。**变异自检**：把 `data-tone` 写死 `neutral`、或把红字节点加回 → 必红 | 单测 | P0 |
| AC-7 | 失败不乐观不抖动：失败后 `data-enabled`、`aria-checked`、短标签文本与点击前逐字相同；busy 期间 `aria-busy=true` 且文案不变 | 单测 | P0 |
| AC-8 | 两处既有入口不回归：`conversation.session.header.actions` 仍 1 处 `data-auto-team-header-button`；`sidebar.right.pane.tab` 与 `.title` 仍各 1 处，`sidebarRightTabs.register` 的 `id` 与 keyed `key` 同值（`dsh-auto-team-panel`） | 单测 | P0 |
| AC-9 | 头部排版分区（结构）：`data-panel-head` 的**直接子节点 ≤ 3**（标题、状态胶囊、刷新 / 主操作）；新增独立 `data-panel-meta` 承载「计划 x · 成员 y · 并发 a/b」「队长模型」「事件源」三组（各有稳定 `data-*` 选择器）；`data-panel-progress-row` 仍独立且只含「完成 x/N」「计划状态」「暂停 / 继续」；**同一类信息全面板只渲染 1 处**（逐类计数 == 1） | 单测（渲染描述层 / AST） | P0 |
| AC-10 | 排版可分辨 + 不靠隐藏：把旧的一行平铺实现放回 → AC-9 必红（head 直接子节点 6 > 3、`data-panel-meta` 缺失）；同时断言分区后三组信息与进度行**都仍可见**（不得用 `display:none` / 折叠冒充分区） | 单测（变异自检） | P0 |
| AC-11 | 头部按钮可切换：状态机级断言 ——（a）未开时点击 → 调 `openPanel()` 且 `aria-pressed="true"`；（b）已知打开时再点 → 派发关闭路径（面板侧 `tab.actions.close()`）且页签消失后 `aria-pressed="false"`；（c）服务缺失时仍走 CustomEvent 回退且不抛错（三分支各一条断言）；失败 / 异常不得翻转 `aria-pressed`（非乐观） | 单测 | P0 |
| AC-12 | 真机·工具条存在性（强制）：第二宿主（克隆 profile + 51890，见 `docs/teamflow/architecture/REAL-HOST-VERIFY.md`）跑可复跑脚本，活会话内断言 ① 工具条容器里 `[data-auto-team-option]` == 1 ② 输入框上方 dock 容器里 == **0** ③ 页面 `[data-option-error]` == 0 且选项子树内无错误色文本 ④ 选项与权限 / 计划钮同一行（`getBoundingClientRect().top` 差 ≤ 4px） | 真机（CDP） | P0 |
| AC-13 | 真机·头部按钮切换（强制）：同一脚本连点三次断言三元组（页签数 / `[data-auto-team-panel]` 节点数 / `aria-pressed`）= (1,1,true) → (0,0,false) → (1,1,true)；每次点击等待 ≤ 1.5s 稳定；并断言收起后**不误关**聊天或其它右栏页签 | 真机（CDP） | P0 |
| AC-14 | 真机·窄宽不撑破（强制）：1280px 与 900px 两视口各采样：选项 `right ≤ 下一个控件 left - 4`、高度 ≤ 28px、`document.scrollingElement.scrollWidth ≤ clientWidth`（无水平溢出）、短标签完整可见（未被截成 <3 字） | 真机（CDP） | P1 |
| AC-15 | 真机·失败分工（强制）：在面板里触发一次必然失败的动作，断言 ① 面板 `[data-error]` 文本非空 ② 工具条选项内可见错误文本 **0 处** ③ 选项 `title` 含「操作失败」 ④ 3s 内不自愈成正常态 | 真机（CDP） | P0 |
| AC-16 | 模型弹层选择器：角色默认模型字段是「按钮 + 弹层」（`data-role-model-picker`），弹层含搜索输入 + 可用模型列表 + 选中回填；裸 `data-role-model-provider` / `data-role-model-name` 输入框 **0 处**；无可选模型时给可读说明并保留手填兜底（不得静默空列表）；选中并保存后从磁盘读回的 `Role.model` 与界面一致；**真机**：第二宿主点开弹层、选中一项并保存成功 | 单测 + 真机 | P1 |
| AC-17 | 内置角色 11 个：内置角色数 == **11**（现有 6 + 前端工程师 / 后端工程师 / UI-UX 设计师 / DevOps 运维 / 安全审计），每个 `name` / `duty` / `prompt` 非空且两两互异（duty 两两相似度不得为同句改写，按逐字比对断言互异），每个 `skillIds` 1–2 个且命中的技能都有正文；`restoreDefaultRoles` 恢复**全部 11 个**内置角色且不改自建角色（逐字段比对 + 自建角色 sha256 不变）；变异自检必红 | 单测 | P0 |
| AC-18 | 技能三入口：角色编辑区有「添加技能」且三个入口各自可用 ——（a）导入本地 `.md`：选文件后技能列表出现新条目，`source==='imported'`，正文与文件内容一致、标题/说明来自 frontmatter 或兜底；（b）从宿主系统技能库选择：弹层列出系统技能（至少含名称 + 说明），勾选后落成 `source==='system'` 的副本并记录原始名称；（c）手动新建：填名称 + 说明 + 正文后落成 `source==='manual'`；三者保存后都能在该角色的 `skillIds` 里勾上，重启后读回一致 | 单测 + 真机 | P0 |
| AC-19 | 技能模型可表达来源与可改性：技能记录至少含 `id` / `title` / `description` / `body` / `source`（`builtin` \| `imported` \| `system` \| `manual`）/ `modified`（bool）/ `updatedAt`；`snapshot.skills` 投影含 `source` 与 `modified`（但不含正文，见 AC-20 的体积约束）；同一来源内部条目两两 `id` 唯一，撞名自动加后缀且**不得静默覆盖**既有条目 | 单测 | P0 |
| AC-20 | 内置技能可改 + 用户覆盖层：编辑任一内置技能正文并保存后 ① 该条 `modified===true`、正文读回即用户版本 ② 落点在 `<dataRoot>/skills/`（`~/.dsh/auto-team/skills/`，仓库外），`git status --porcelain src lib` 保持干净（不污染包内文件与产物）③ **重启后 seed 不得覆盖用户版本**（再次启动读回仍是用户版本，`modified` 仍为 true）④ `snapshot` 体积不因技能正文线性膨胀（技能投影总量 < 8 KB，正文按需读取） | 单测 + 真机 | P0 |
| AC-21 | 内置技能更丰富：内置技能数 ≥ **12**，每条 `title` / `description` / `body` 非空且两两互异；11 个内置角色的 `skillIds` 全部命中内置技能清单、每个角色 1–2 个；新增技能需覆盖前端 / 后端 / UI-UX / 运维 / 安全五类岗位上手就要用的动作（按标题 + 正文关键词断言，不靠人工目检） | 单测 | P0 |
| AC-22 | 恢复默认连带技能：`restoreDefaultRoles` 后 ① 11 个内置角色逐字段回到出厂 ② 内置技能正文回到出厂、`modified` 清为 false ③ 用户 `imported` / `system` / `manual` 技能**一条不少**（逐条 sha256 不变）④ 自建角色 sha256 不变 ⑤ 弹二次确认且确认文案含影响范围；**变异自检**：不写覆盖层 / 不恢复技能 / 顺手删用户技能 —— 三种变异各必红 | 单测 | P0 |
| AC-23 | 删除与引用一致性：`builtin` 技能不提供删除入口（只提供「恢复出厂」）；`imported` / `system` / `manual` 可删，删后所有角色的 `skillIds` 不再含该 id（无悬空引用），且删除动作在列表里可撤销提示（至少给出「已删除 X，并已从 N 个角色摘除」的可读结果）；删除不存在的 id 返回可读原因而非静默成功 | 单测 | P1 |
| AC-24 | 单测基数：`pnpm test` 结果 `tests ≥ 426` 且 `fail 0`（本轮开工实测 426/426/0）；`test/client-contract.test.ts` 的 `INPUT_DOCK_SLOT` 断言替换为 `INPUT_LEFT_SLOT`，并新增头部 / 技能 / 模型断言 —— 属改名 + 新增，总数只增不减 | 门禁 | P0 |
| AC-25 | 形状与常量冻结：`PanelAction` == **15**（技能 CRUD 复用既有保存载荷，不新增动作种类）、`ActivityEvent.kind` == 9、HTTP 路由 == 3、`MEMORY_INJECT_BUDGET` / `WATCHER_INTERVAL_MS` / `PANEL_ACTIVE_MS` / `STALL_MS` 各 1 处、`setInterval(` 1 处（仅 `src/host/team/watcher.ts`）；本轮形状扩张逐项登记（技能记录新增 `source` / `modified` / `body`，`SkillInfo` 投影新增 `source` / `modified`） | 门禁 | P0 |
| AC-26 | 不回归：r5 直投与停滞、r7 暂停 / 继续与 6 项设置参数、两处面板入口、门禁 receipt 的既有 checker 全绿；三条 P3（QA-R7-03 / 05 及 r4 遗留）不新增失败（允许原样保留红） | 门禁 | P1 |
| AC-27 | 交付门禁：`pnpm typecheck` 0 错误；`pnpm build` 后 `lib/index.js` / `lib/client.js` 均新于 `src`（`find src -name '*.ts' -newer lib/index.js \| wc -l` == 0）；两条 `node --input-type=module -e "await import('./lib/…')"` exit 0；`npm pack --dry-run` 3 条目（含 `cordis.patch.yml`）；`grep -rn "workspace:" package.json lib/ \| wc -l` == 0 | 门禁 | P0 |
| AC-28 | 安装与回滚：主 agent 按 r7 §9 六步（先写回滚基线 → build → profile 内 `pnpm add file:<repo>` → 登记 `dsh.profile.bundles` → 重启宿主 → 活会话采样）；失败立即 `pnpm remove` + 摘 bundles 并贴输出；**环境起不来记「未验证」，不得默认通过** | 门禁 / 真机 | P1 |
| AC-29 | 真机·技能全链路（强制）：同一第二宿主脚本内 —— ① 导入一个 md ② 从系统技能库勾选一条 ③ 手动新建一条 ④ 修改一条内置技能正文；列表四条 `source` / `modified` 与预期一致；**重启宿主后**四条全部读回，内置技能正文 == 用户改后版本（不等于出厂正文），系统技能副本与导入副本正文逐字一致 | 真机（CDP） | P0 |
| AC-30 | 本夹产出：`QA-REPORT.md`（AC-1~AC-29 逐条判定表，每条贴至少一行实跑输出）+ `ACCEPTANCE.md`（结论 + 未验证清单 + 真机实录 / 截图路径）；探针脚本落 `logs/teamflow/<runId>/scripts/r10-*.mjs`，一律用 `new URL('../../../../', import.meta.url)` 锚定仓库根 | 门禁 | P0 |

## 7. 假设与待澄清

**事实类（缺信息，需要调研 / 宿主核实）**

1. **宿主系统技能库的读取通道**：契约里没说「系统技能」怎么枚举。默认做法：优先用宿主提供的技能清单能力，拿不到就扫描 DSH 技能库目录（`~/.agents/skills/*/SKILL.md`，frontmatter 取 name/description）作为只读来源；选中后复制成副本并记录原始名称。若两者都不可用 → 该入口以「本机没有可用系统技能」的可读说明出现，不得静默空列表。
2. **技能元数据的落点与迁移**：现有 6 个内置技能只把正文 seed 成 `<dataRoot>/skills/<id>.md`，没有 frontmatter、没有来源记录。默认做法：在该 md 的 frontmatter 里记 `source` / `title` / `description` / `updatedAt`（不新增目录层）；历史无 frontmatter 且 id 命中内置清单的文件按内置识别，正文与出厂 hash 不同即 `modified=true`。若改为独立清单文件，则必须同时处理这批存量文件。
3. **技能正文的读取通道**：`SkillInfo` 现在刻意不下发正文（避免快照膨胀），而编辑正文需要原文。约束是**不新增路由路径、不新增动作种类**。默认做法：正文按需读取（打开编辑弹层时取单条），快照只带元数据；具体复用哪条既有读取口由技术方案定。

**口味类（都可做，选哪个取决于用户想要什么）**

4. **内置技能被改后的展示形态**：单条「内置·已修改」+「恢复出厂」（推荐：一条技能一个身份，列表不翻倍）vs 拆成两条（出厂只读 + 我的版本）。选后者会让技能列表在同一能力上出现两条，角色勾选时容易勾错。
5. **删除仍被角色引用的技能**：允许删除并自动从角色引用摘除 + 提示「已从 N 个角色摘除」（推荐：符合"我就是不想要它了"的直觉）vs 阻止删除并提示被引用次数（更保守，但多一步手动解绑）vs 允许删除并留悬空（会让成员提示词缺技能，不推荐）。
6. **系统技能选择的交互形态**：带搜索的多选列表、一次导入多条（推荐：系统技能可能有几十条）vs 单选逐个添加（步骤多但每次决策更轻）。
7. **内置技能的扩充规模与搭配**：12 条（11 个角色各 1–2 条，含 1–2 条跨角色通用技能，推荐：与角色一一对应、维护成本低）vs ≥18 条（每个角色 2 条 + 6 条通用，内容更厚但每条都要有人写、也更容易写空话）。
8. **「恢复默认」的按钮形态**：一个按钮同时回退「11 个内置角色 + 内置技能」并二次确认（推荐：与用户已裁决的"连带覆盖技能"一致）vs 拆成「恢复内置角色」「恢复内置技能」两个按钮（更细粒度，但用户容易只点一个、状态半新半旧）。
9. **导入 md 的宽松度**：缺 frontmatter 时用文件名作标题、首段作说明并提示补填（推荐：先能用，再慢慢补）vs 严格拒绝（要求 name/description 齐全，数据干净但导入经常失败）。

## 8. 工程约束

- **分支与提交**：当前分支 `feat/auto-team-plugin`，从当前 HEAD 继续实现，**不新开分支、不 rebase、不 amend 既有提交**。全部实现与文档改完、五项门禁全绿后，由 host 做**单笔提交**（T6），提交后不再改文件；提交前重跑一次门禁。提交前先 `git status --porcelain --untracked-files=all` 列出清单并确认归属。
- **工作树现状（4 处未提交改动，全部保留、不得 revert）**：`M docs/teamflow/memory.md`；`?? docs/teamflow/20261102-r10-autoteam-skills-toolbar/`、`?? docs/teamflow/20261102-r8-auto-team-tab-entry/`、`?? docs/teamflow/20261102-r9-autoteam-toolbar-tab/`。三份都是任务夹文档，随本 run 一并提交；实现改动只允许落在本需求范围内，不得把别人的在途代码改动夹带进来。
- **`.gitignore` 复核（本轮为开发阶段动作，不是新增文件）**：现有规则已覆盖 `node_modules/`、`dist/`、`coverage/`、`*.tsbuildinfo`、`logs/teamflow/`、`.auto-team/`、`.env*`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.DS_Store`，并显式声明**不忽略 `lib/`**。本轮只需复核两点：① 用户技能覆盖层必须落在仓库外的 `~/.dsh/auto-team/skills/`，仓内不得出现技能产物目录；② 若实现过程新增了任何构建缓存 / 临时目录，必须补规则，别让噪声进收口提交。`lib/` 仍必须入库（`pnpm add file:` 的安装源）。
- **验证命令（提交前必须全绿）**：`pnpm typecheck` → `pnpm test` → `pnpm build` → 两条 `node --input-type=module -e "await import('./lib/…')"` → `npm pack --dry-run`。
- **环境边界**：只改本仓 `dsh-auto-team`；不动 desktop profile（除已有安装副本）；实验 profile 一律克隆；真机验证只许主 agent 按 `docs/teamflow/architecture/REAL-HOST-VERIFY.md` 执行（克隆 profile + 端口 51890 + cookie）。
- **槽位事实**：一律读 `docs/teamflow/architecture/UI-SLOTS.md`，**禁止**再为 UI 槽位去调 `cordis_inspect_query` 的 Slots 方法（已四次烧掉阶段预算）。
- **形状冻结**：`PanelAction` 仍 15（技能变更复用既有保存载荷）、HTTP 路由仍 3、`ActivityEvent.kind` 仍 9、`PlanTask` 不加字段、四个预算常量各 1 处、`setInterval` 仅 `src/host/team/watcher.ts` 一处。

## 9. 优先级、依赖与风险

**优先级**：P0 = AC-1~AC-13、AC-15、AC-17~AC-22、AC-24、AC-25、AC-27、AC-29、AC-30（不达即不可验收）；P1 = AC-14、AC-16、AC-23、AC-26、AC-28（可带条件通过，但必须在 ACCEPTANCE 里写明）。

**依赖**
- 宿主 `sidebarRight` 只有打开口、没有关闭口 → 收起必须走面板侧 `tab.actions.close()` 事件闭环（r7 已验证 `openTab`）。
- 模型清单来源依赖宿主 llm 能力，当前未全核实 → 无清单时必须给说明 + 手填兜底。
- 系统技能来源依赖宿主技能库（见 §7.1），不可用则该入口降级说明。
- 真机验证依赖第二宿主能起来（克隆 profile + 51890）；起不来按「未验证」记录。

**风险**
- 首启 seed 与用户覆盖层冲突（最高风险）：seed 只在「文件不存在」时写，若实现改成"总是写"就会静默覆盖用户修改 → AC-20 ④ 与 AC-29 是真机兜底。
- 快照膨胀：把技能正文塞进快照会让面板首屏变慢 → AC-20 ④ 用体积阈值卡住。
- 引用悬空：删技能不同步 `skillIds` 会让成员提示词缺正文 → AC-23 卡住。
- 角色换皮：新增 5 个角色容易写成同句改写 → AC-17 要求逐字互异，AC-21 要求内容关键词可断言。
- 与 r9 的差量：内置技能从「只读」改为「可改」，r9 的 AC-16 若被直接抄进实现与测试会与 AC-20 冲突 → 以本夹 `取代` 声明为准。

## 10. 里程碑建议

| 里程碑 | 内容 | 覆盖 AC |
|---|---|---|
| M1 | 工具条迁移 + 零红字 + 头部按钮可开可收 | AC-1~AC-8、AC-11~AC-13 |
| M2 | 头部信息分区 + 模型弹层选择器 | AC-9、AC-10、AC-16 |
| M3 | 内置角色 11 个 + 技能模型 / 三入口 / 覆盖层 / 恢复出厂 / 引用一致性 | AC-17~AC-23 |
| M4 | 门禁收口 + 真机全量（工具条、按钮三态、窄宽、失败分工、技能全链路） | AC-24~AC-30 |
