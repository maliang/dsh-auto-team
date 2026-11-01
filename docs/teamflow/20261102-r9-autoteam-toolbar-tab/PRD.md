<!-- meta: summary="把自动团队开关挪进输入框工具条（短标签+非红状态点、失败零红字）、面板头部改为分区排版并把入口按钮改成可开可收、角色技能支持自定义添加、角色模型改成弹层选择器、内置角色扩充到更完整一套，真机可验。" -->
基线依赖：docs/teamflow/20261101-r7-auto-team-panel-roles/（r7 已确立的右栏面板 / 会话头按钮 / 设置页 / 暂停继续 / 门禁契约必须不回归）
取代：docs/teamflow/20261101-r7-auto-team-panel-roles/#AC-12：输入框选项的挂载槽位由 `conversation.input.dock`（输入框上方整行）改为 `conversation.input.left`（工具条左侧紧凑控制位），`input.dock` 注册归零，文案收为短标签 + 一个状态点。
取代：docs/teamflow/20261101-r7-auto-team-panel-roles/#AC-7：内置角色由 6 个扩充为完整一套（新增 ≥4，各带 1–2 个技能），"6 个内置 prompt 非空互异" 的基数与清单随之改写。
取代：docs/teamflow/20261101-r7-auto-team-panel-roles/#AC-8：一键恢复默认须恢复**全部**内置角色（含本轮新增），自建角色仍不删。
取代：docs/teamflow/20261101-r7-auto-team-panel-roles/#AC-13：面板入口**保持现状两处**（会话头按钮 + 右栏页签），但会话头按钮的语义由「只能打开」升级为「可开可收（再点收起）」。
取代：docs/teamflow/20261101-r7-auto-team-panel-roles/#AC-19：活会话采样口径改为「工具条选项 1 + 输入框上方 0 + 红字 0 + 页签 1 + 面板 1 + 头部按钮连点两次能收起再打开」。

# r9 · 自动团队：工具条开关 + 头部排版与可收面板 + 技能自定义 + 模型选择器 + 角色扩充

## 1. 背景与目标

用户重启真宿主、看过 r7 的界面后连提多轮（2026-11-02，均已澄清，权威）：

1. 「开启自动团队的切换钮位置不对，应该在对话框里的和其他功能切换钮在一排」——现状挂在 `conversation.input.dock`（宿主 doc "Full-width entries above the composer card."），独占输入框上方一整行。
2. 「去掉红色解释，只显示选项」——失败时 `Option.tsx` 渲染 `<span data-option-error role="alert">`，用 `--dsw-alias-state-error-primary`（红），把工具条撑宽、看起来像"坏了"。裁决：**方案 2 —— 工具条上留一个非红色可见状态点（正常灰、失败转琥珀），不追加任何可见文字，红字 0 处**；原因仍在 `title`/`aria-label` 与面板 `[data-error]`。
3. 「同时又发现面板的状态等信息都挤在头部太长了，需要排版优化」——面板头部一行平铺 6 项（标题、状态胶囊、计划/成员/并发、队长模型、事件源状态、刷新），下面再挤进度行 + 暂停，信息过载。
4. 「头部的自动团队的面板显示按钮应该能切换显示状态现在只能打开」——会话头按钮只开不收。
5. 「设置里角色的技能不能自定义添加」——角色编辑只能从内置 6 个技能里勾选。
6. 「角色的模型设置体验不友好改成对话框里模型选择的形式」——`RoleEditor.tsx` 里是两个裸 `<input>`（`data-role-model-provider` / `data-role-model-name`）。
7. 「自带的角色有些少，需要丰富一下」——内置角色 6 个（产品经理/架构师/高级全栈工程师/QA/技术文档/评审专家）。

**并已裁决取消**：「对话、轨迹那一栏再加一个面板入口」不做——「那不改了，还是现在的位置」，面板入口保持 r7 现状（会话头按钮 + 右栏页签），不再讨论第三条入口。

> 事实底座（本 PRD 引用的槽位与能力均来自实测，实现阶段别重新发明）：`conversation.input.left` = `kind:list` / `scope:session` / `replaceRisk:none`，doc 原文 "Compact controls at the left of the composer tool row."，渲染在 `input.permission` / `input.plan` 那一组之后（宿主 asar；`packages/client/ui-conversation/src/client/contract/slots.ts:278`）。`ctx.sidebarRight` 的公开面只有 `openResource` / `openTab`（**没有关闭口**），页签自身可由 tab body 的 `tab.actions.close()` 收起（宿主 doc 与 `ui-schedule` 的 `onDeleted: () => tab.actions.close()` 实例）。当前面板头部的六项平铺见 `src/client/Panel.tsx:138-171`（`data-panel-head` 内：`data-panel-title` / `data-head-capsule` / `data-head-meta` / `data-captain-model` / `data-auto-team-degraded` / `data-panel-refresh`）。

## 2. 用户故事与验收标准

**US-1**：开关和权限/计划/模型钮在同一排，输入区不多一整行；点一下只需看到「自动团队 ●」。
- AC-1~AC-4（挪位/紧凑/短标签/点击语义）、AC-12（真机存在性）、AC-14（窄宽不撑破）。

**US-2**：失败时不出现红字把排版撑开，但状态点会变琥珀、鼠标悬停能读到原因，面板里也能看到原因。
- AC-5~AC-7（零红字 + 非红状态点 + 不打吞）、AC-15（真机失败分工）。

**US-3**：面板头部不再一坨，一眼能分出「状态摘要 / 运行指标 / 进度与操作」；入口按钮能开也能收。
- AC-9~AC-11（分区排版 + 可切换 + 两处既有入口不回归）、AC-13（真机连点三态）。

**US-4**：我能给角色加自己写的技能，也能在弹层里挑模型，不用手打 provider/model 字符串。
- AC-16~AC-17（技能自定义 + 模型选择器）。

**US-5**：自带角色不再只有 6 个，前端/后端/设计/运维/安全这些常见职能开箱可用，且能一键恢复全部内置。
- AC-18（角色扩充 + 恢复默认覆盖新增）。

## 3. 范围与非目标

**范围内（P0）**
1. 选项挂载 `conversation.input.dock` → `conversation.input.left`，`dock` 归零；工具条内紧凑形态；文案收为「自动团队」短标签 + 状态点（完整语义在 `aria-label`）。
2. 失败呈现：零可见红字（`data-option-error` 0 处），状态点由灰转琥珀 + `title`/`aria-label` 含「操作失败：<摘要>」；面板 `[data-error]` 仍是唯一可见的错误原因落点。
3. 面板头部排版优化：状态摘要 / 运行指标（计划·成员·并发、队长模型、事件源）/ 进度与操作（完成 x/N、计划状态、暂停/继续）分区，不再一行平铺。
4. 会话头按钮改为**可切换**：打开 → 再点收起 → 再点打开；`aria-pressed` 与真实状态一致，非乐观。
5. 角色技能自定义：可新增（名称 + 说明/正文）、落盘、可勾选、可删；内置 6 个随包、不可删。
6. 角色模型改为弹层选择器（带搜索、键盘可用、选中回填），保留手填兜底；选中结果落 `roles/<id>.md`。
7. 内置角色扩充 ≥4（清单见 §7 待拍板），每个带 1–2 个技能 md；`restoreDefaultRoles` 覆盖全部内置。
8. 真机强制证据（AC-12~AC-15、AC-17、AC-23）+ 门禁与回归不破。

**非目标（本期不做）**
- 不做第三条面板入口（用户已裁决取消；`conversation.view` 本轮注册 0 处）。
- 不改面板 tab 的信息架构与活动流/账本内容（只重排头部）。
- 不改开关语义、暂停/继续语义、6 项可配参数的语义、门禁 receipt 语义。
- 不新增 HTTP 路由（仍 3 条）；`ActivityEvent.kind` 仍 9。
- 不动宿主侧模型路由与 `resolveCallConfig` 校验逻辑（选择器只负责取值更友好）。
- 不处理 r7 遗留三条 P3。

## 4. anti-goals / 反面目标

三条 AC 全绿、构建全绿、单测 426+ 全绿，下面任一条发生，用户仍会说「这次也没做对」：

1. **窄窗口把工具条挤爆**：1280px 正常，收到 900px 时标签被截成「自动…」、整排换行或与模型钮重叠、发送钮掉行。（可观测：两个视口各采样一次 bounding box 与 `scrollWidth`）
2. **「去红字」被做成「失败静默」**：点了没反应、状态点没变色、面板里也没有原因，用户只能重启宿主。（可观测：制造一次必然失败的 act，看 `[data-option-dot][data-tone]` 与面板 `[data-error]`）
3. **「头部排版优化」只是把行变高**：信息仍挤在同一屏，或反向把并发/队长模型折叠藏死、用户找不到。（可观测：`data-panel-head` 直接子节点数、meta 区在 1440px 与 900px 两个宽度下是否可读）
4. **「按钮可切换」做成假切换**：第一次打开、第二次点了看着收起但页签还在，第三次点打不开；或 `aria-pressed` 与实际状态长期相反。（可观测：连点三次的页签数/面板节点数与 `aria-pressed` 三元组）
5. **模型选择器/技能做成假功能**：弹层永远空列表或选中后保存的仍是旧值；技能只能起个名字、重启后快照里没有它、角色 `skillIds` 里也勾不上。（可观测：选中后 `cat ~/.dsh/auto-team/roles/<id>.md`；重启后 snapshot 的 `skills` 与角色 `skillIds`）

## 5. 交互流程摘要

```
输入框工具条：[权限▾][计划][自动团队 ●]                     模型▾ [发送]
                    ↑ 点一下 = act({type:'toggle'})；失败：点转琥珀、零红字，
                      title/aria-label 追加「操作失败：<摘要>」，data-error-state=true

面板头部（r9 分区）：
  [自动团队] [状态胶囊] [刷新]            ← data-panel-head（≤3 个直接子节点）
  [计划 5 · 成员 3 · 并发 2/3] [队长模型 …] [事件源正常]   ← data-panel-meta（可折）
  [完成 3/5] [计划状态]                 [暂停任务]        ← data-panel-progress-row

会话头按钮（可切换）：点 1 打开右栏页签 → 点 2 收起（面板卸载、页签消失）→ 点 3 再打开
                       aria-pressed / data-pressed 跟随真实状态；关闭经面板自身 tab.actions.close()

设置 · 角色编辑：技能 [✓内置…] [+ 新增技能]（名称 + 说明/正文 → 落盘 → 可勾选）
                 默认模型 [选择模型…] → 弹层（搜索框 + 可用模型列表 + 手填兜底）→ 选中回填
```

## 6. 验收标准（本夹从 AC-1 编号）

性质列：**单测**=`pnpm test` 可判；**真机**=第二宿主 + CDP/DOM 可复跑脚本；**门禁**=命令可判。

| AC | 判据（可测、可分辨） | 性质 |
|---|---|---|
| AC-1 | 挂载点迁移落地：`grep -rn "conversation.input.left" src/` 命中且唯一注册点（`src/client/index.ts` 一处 `ctx.slots.inject` + `slots.ts` 一处常量 `INPUT_LEFT_SLOT='conversation.input.left'`）；`grep -rn "conversation.input.dock" src/ \| wc -l` == **0**（含注释） | 单测/门禁 |
| AC-2 | 注册字段符合宿主 catalog：只传 `{name,id,order,label,inject}` 中存在的键，`id` 非空；不带 `key`（非 keyed slot）；`composer.bar` / `composer.dock` / `input.activity` / `header.corner` / `shell.leading` 在 `src/` 全 0 处；`conversation.view` 全 0 处（本轮已取消第三条入口） | 单测（AST 守卫） |
| AC-3 | 紧凑形态 + 短标签：`optionView().label` 逐字 ==「自动团队」（≤4 汉字，不含进度/暂停/「完成 x/N」句式），完整语义保留在 `ariaLabel`；`styles.ts` 选项根选择器含 `white-space:nowrap`、`text-overflow:ellipsis`、`max-width`、`min-width:0`、`flex:0 1 auto`、`align-self:center`，且该区块无 `font-size: var(`（字号写 `font: var(--dsw-font-xs-13, …)`） | 单测（AST/正则）+ 真机 |
| AC-4 | 点击语义不变：点一次只发一次 `act({type:'toggle', enabled:!enabled})`；不隐式派发（面板 `PlanTask` 数与 `planStatus` 不变） | 单测 |
| AC-5 | 零红字 + 非红状态点（结构）：`grep -rn "data-option-error" src/ \| wc -l` == **0**；`Option.tsx` 内无 `role="alert"` 可见节点、无错误色 token 引用；选项内恰好 1 个 `[data-option-dot]`，`data-tone` ∈ {`neutral`,`warn`}，**用到的颜色 token 不得是** `--dsw-alias-state-error-primary`（取 computed 值比对） | 单测（AST）+ 真机 |
| AC-6 | 失败可分辨：伪造 `{error:'宿主未提供 webServer'}` 后 ① 可见文本与点击前逐字相同（只有「自动团队」，无追加文本）② `data-error-state="true"` 且 `[data-option-dot][data-tone="warn"]` ③ `title`/`aria-label` 含「操作失败」与该摘要 ④ 面板 `[data-error]` 文本含同一摘要。**变异自检**：把 `data-tone` 写死 neutral、或把红字节点加回 → 必红 | 单测 |
| AC-7 | 失败不乐观不抖动：失败后 `data-enabled`、`aria-checked`、短标签文本与点击前逐字相同；busy 期间 `aria-busy=true` 且文案不变 | 单测 |
| AC-8 | 两处既有入口不回归：`conversation.session.header.actions` 仍 1 处 `data-auto-team-header-button`；`sidebar.right.pane.tab` + `.title` 仍各 1 处、`sidebarRightTabs.register` 的 `id` 与 keyed `key` 同值（`dsh-auto-team-panel`） | 单测 |
| AC-9 | 头部排版分区（结构）：`data-panel-head` 的直接子节点 ≤ **3**（只留标题、状态胶囊、刷新/主操作）；新增独立 `data-panel-meta` 承载「计划 x · 成员 y · 并发 a/b」「队长模型」「事件源」三类信息（各有稳定 `data-*` 选择器）；`data-panel-progress-row` 仍独立且只含「完成 x/N」「计划状态」「暂停/继续」；**同一类信息全面板只渲染 1 处**（逐类计数 == 1） | 单测（AST/渲染描述层） |
| AC-10 | 排版可分辨：把旧的一行平铺实现放回 → AC-9 必红（head 直接子节点数 6 > 3、meta 选择器缺失）；同时断言分区后每一类信息仍可见（不得用「藏起来」冒充「分区」） | 单测（变异自检） |
| AC-11 | 头部按钮可切换：状态机级断言——（a）未开时点击 → 调 `openPanel()` 且 `data-pressed="true"`；（b）已知打开时再点 → 派发关闭路径（面板侧 `tab.actions.close()`）且 `data-pressed="false"`；（c）服务缺失时仍走 CustomEvent 回退且不抛错（三分支各一条断言）；失败/异常不得翻转 `data-pressed`（非乐观） | 单测 |
| AC-12 | 真机·工具条存在性（强制）：第二宿主（克隆 profile + 51890，见 `docs/teamflow/architecture/REAL-HOST-VERIFY.md`）跑可复跑脚本，活会话内断言 ① 工具条容器里 `[data-auto-team-option]` == 1 ② 输入框上方 dock 容器里 == **0** ③ 页面 `[data-option-error]` == 0 且选项子树内无错误色文本 ④ 选项与权限/计划钮同一行（`getBoundingClientRect().top` 差 ≤ 4px） | 真机 |
| AC-13 | 真机·头部按钮切换（强制）：同一脚本连点三次断言三元组（页签数 / `[data-auto-team-panel]` 节点数 / `aria-pressed`）= (1,1,true) → (0,0,false) → (1,1,true)；每次点击等待 ≤ 1.5s 稳定；并断言收起后**不误关**聊天或其它右栏页签 | 真机 |
| AC-14 | 真机·窄宽不撑破（强制）：1280px 与 900px 两视口各采样：选项 `right ≤ 下一个控件 left - 4`、高度 ≤ 28px、`document.scrollingElement.scrollWidth ≤ clientWidth`（无水平溢出）、短标签完整可见（未被截成 3 字以下） | 真机 |
| AC-15 | 真机·失败分工（强制）：在面板里触发一次必然失败的动作，断言 ① 面板 `[data-error]` 文本非空 ② 工具条选项内可见错误文本 0 处 ③ 选项 `title` 含「操作失败」 ④ 3s 内不自愈成正常态 | 真机 |
| AC-16 | 技能可自定义添加：角色编辑区有「新增技能」入口（名称 + 说明/正文）；保存后落盘到技能目录（路径见 §7 待拍板），`snapshot.skills` 出现该条且能在该角色 `skillIds` 里勾上；内置 6 个带 `builtin` 标记、无删除入口；自建技能可删且删后 `skillIds` 同步清理；重启后读回一致 | 单测 + 真机 |
| AC-17 | 模型选择器：角色默认模型字段改为「按钮 + 弹层选择器」（`data-role-model-picker`），弹层含搜索输入 + 可用模型列表 + 选中回填；裸 `data-role-model-provider` / `data-role-model-name` 输入框 **0 处**；无可选模型时给出可读说明并保留手填兜底（不得静默空列表）；选中后 `roles/<id>.md` 与界面读回一致；**真机**：第二宿主点开弹层、选中一项并保存成功 | 单测 + 真机 |
| AC-18 | 内置角色扩充：内置角色数 ≥ **10**（现有 6 + 新增 ≥4，清单见 §7），每个新增角色 `name`/`duty`/`prompt` 非空且两两互异，且 `skillIds` 非空（1–2 个），这些技能在 `BUILTIN_SKILLS` 里都有正文；`restoreDefaultRoles` 恢复**全部**内置角色（含新增）且不改自建角色（逐字段比对 + 自建角色 sha256 不变）；变异自检必红 | 单测 |
| AC-19 | 单测基数：`pnpm test` 结果 `tests ≥ 426` 且 `fail 0`（本轮开工实测 `tests 426 / pass 426 / fail 0`）；`test/client-contract.test.ts` 的 `INPUT_DOCK_SLOT` 断言替换为 `INPUT_LEFT_SLOT` 并新增头部/技能/模型断言——属改名 + 新增，总数只增不减 | 门禁 |
| AC-20 | 形状与常量冻结：`PanelAction` == 15（**除非用户裁决放宽，见 §7**）、`ActivityEvent.kind` == 9、HTTP 路由 == 3、`MEMORY_INJECT_BUDGET`/`WATCHER_INTERVAL_MS`/`PANEL_ACTIVE_MS`/`STALL_MS` 各 1 处、`setInterval` 1 处；本轮形状扩张逐项登记（`SkillInfo` 增 `builtin?`/`body?`、`Role.skillIds` 可含自建 id、`Role.model` 不变） | 门禁 |
| AC-21 | 不回归：r5 直投与停滞、r7 暂停/继续与 6 项设置参数、两处面板入口、门禁 receipt 的既有 checker 全绿；三条 P3 不新增失败（允许原样保留红） | 门禁 |
| AC-22 | 交付门禁：`pnpm typecheck` 0 错误；`pnpm build` 后 `lib/index.js`/`lib/client.js` 均新于 `src`；两条 `node --input-type=module -e "await import('./lib/...')"` exit 0；`npm pack --dry-run` 3 条目（含 `cordis.patch.yml`）；`grep -rn "workspace:" package.json lib/ \| wc -l` == 0 | 门禁 |
| AC-23 | 安装与回滚：主 agent 按 r7 §9 六步（先写回滚基线 → build → profile 内 `pnpm add file:<repo>` → 登记 `dsh.profile.bundles` → 重启宿主 → 活会话四件套采样）；失败立即 `pnpm remove` + 摘 bundles 并贴输出；**跑不了记「未验证」，不得默认通过** | 门禁/真机 |
| AC-24 | 本夹产出：`QA-REPORT.md`（AC-1~AC-23 逐条判定表，每条贴至少一行实跑输出）+ `ACCEPTANCE.md`（结论 + 未验证清单 + 真机实录/截图路径）；探针脚本落 `logs/teamflow/<runId>/scripts/r9-*.mjs`，用 `new URL('../../../../', import.meta.url)` 锚定仓库根 | 门禁 |

## 7. 假设与待澄清

> 本期范围已从「三件小改」扩成「UI 排版 + 设置交互 + 角色扩充」，下面每条都进了确认单；**未确认前不得把细节写死成实现**。

- **（事实·待拍板）内置角色清单与数量**：主 agent 给的下限是「+4」，本 PRD 建议新增 **5 个**：`前端工程师`、`后端工程师`、`UI/UX 设计师`、`DevOps 运维`、`安全审计`（连同现有 6 个 产品经理/架构师/高级全栈工程师/QA 测试工程师/技术文档工程师/评审专家，合计 11）。配套新增 5 个内置技能 md：`frontend` / `backend` / `uiux` / `devops` / `security`（合计 11 个技能）。若用户要别的组合（例如加数据分析，或把「高级全栈工程师」拆成前后端两个），AC-18 的清单与技能数随之改。
- **（事实·待拍板）自建技能的存储位置**：建议 `~/.dsh/auto-team/skills/<id>.md`（与 `roles/`、`memory/` 同级，自建可写可删；内置仍编译进包、只读、带 `builtin` 标记）。若用户希望这些技能同时出现在宿主自己的技能库里，则要走宿主技能目录，权限与格式都不同，需另议。
- **（事实·待拍板）`PanelAction` 冻结与「保存技能」的冲突**：新增/删除自建技能需要写盘入口，而硬约束是 `PanelAction` 仍 15。建议**复用现有动作载荷**（角色保存动作里带 `skills` 变更），把改动限制在形状（`SkillInfo` 加字段），从而不动 15 这个数。若用户允许 15→16（新增 `saveSkill`/`deleteSkill`），实现更直白但违反当前冻结，需明确同意。
- **（事实·待拍板）模型选择器的模型清单从哪来**：本仓 `src/host/adapters.ts` 目前只用到 `llm.resolveCallConfig`，没有模型目录能力；宿主是否暴露「可用模型列表」尚未核实。建议：探测 `llm` / `agentDefaultModel` 是否给候选列表，取不到就退化为「已登记过的路由 + 手填兜底」并在弹层里说明来源。若用户要求列表来自宿主真实模型目录，需先确认宿主 API 再定 AC-17。
- **（口味·待拍板）头部排版的具体分区形态**：默认三行分区（`data-panel-head` ≤3 项 / `data-panel-meta` 一行（计划·成员·并发、队长模型、事件源）/ `data-panel-progress-row` 一行（完成 x/N、计划状态、暂停）），meta 在窄宽时可折成两行但不得隐藏。若用户想要「摘要卡片 + 折叠更多」另一种形态，AC-9 的直接子节点与选择器判据要重写。
- **（事实）本轮真机环境能否满足**：AC-12~AC-15、AC-17（真机部分）、AC-23 全部依赖第二宿主 + CDP。r7 的四条真机 AC 上一轮就因环境限制记为未验证；若本轮仍起不来，只能记「未验证 + 人工补测清单」，**不得以 mock 断言替代**（本项目已两次「单测全绿、真机不出现」）。
- **（已裁决，不再询问）** 第三条面板入口取消；面板入口保持会话头按钮 + 右栏页签两处；工具条胶囊只显示短标签 + 一个状态点；失败状态点用琥珀而非红。

## 8. 工程约束

- **分支与工作树（原样保留）**：分支 `feat/auto-team-plugin`。当前未提交改动 2 处：`?? docs/teamflow/20261102-r8-auto-team-tab-entry/`、`?? docs/teamflow/20261102-r9-autoteam-toolbar-tab/` —— 本轮**不新建分支、不 stash、不清理**这两个任务夹，直接在该分支上改；收口一笔提交包含代码 + 双产物 + 本任务夹。
- **硬约束（原样保留）**：426 例全绿且只增不减；`PanelAction` 15 / `ActivityEvent.kind` 9 / HTTP 路由 3 / 预算常量各 1 处 / `setInterval` 1 处不得扩张（技能写入口按 §7 的裁决处理）；r5 直投与停滞、r7 暂停与设置参数、右栏页签与会话头按钮两处入口不许回归；三条 P3 不在本期。
- **禁止动作（原样保留）**：**不要为 UI 事实调 `cordis_inspect_query(provider=Slots)`**（已五次同坑）。槽位事实读 `docs/teamflow/architecture/UI-SLOTS.md`、本 PRD §1 的事实底座，或读真机 DOM。
- **槽位纪律**：只用 `replaceRisk:none` 的槽（`conversation.input.left`、`conversation.session.header.actions`、`sidebar.right.pane.tab(.title)`、`settings.section`）；`shadows-shipped-ui` 的一律不碰。
- **关闭面板的唯一合法路径**：宿主 `ctx.sidebarRight` 只有 `openResource`/`openTab`，**没有关闭口**；收起必须由面板自身 `tab.actions.close()`（经按钮派发的关闭事件触发）。不要把「收起」实现成调不存在的 API。
- **样式纪律**：只用宿主 token；字号写 `font: var(--dsw-font-xs-13, …)`，禁 `font-size: var(...)`；新变量名先确认真机存在。
- **接口纪律**：client 侧所有请求解构 `{data,error}`；失败由 store 的 `error` 承载，不许吞。
- **`.gitignore` 审计（开发期动作）**：现有规则已覆盖本栈要点（`node_modules/`、`*.tsbuildinfo`、`dist/`、`coverage/`、`.auto-team/`、`logs/teamflow/`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.env*`、`!.env.example`、`.DS_Store`），且明确不忽略 `lib/` 与 `docs/`。本轮用户数据落点是 `~/.dsh/auto-team/skills|roles/`（仓库外，天然不进版本），仓库内新增的只有源码、内置技能正文与文档；真机采样/截图必须落 `logs/teamflow/<runId>/`（已忽略）或 `/tmp`，**不得**在仓库根产生散落文件；若确实新增了本机产物类型，须同步补 `.gitignore` 并在 QA-REPORT 说明理由。
- **可复跑探针**：`logs/teamflow/<runId>/scripts/*.mjs` 一律 `new URL('../../../../', import.meta.url)` 锚定仓库根；归档位置重跑会假红，报告前先确认脚本位置。

## 9. 优先级与里程碑建议

- **P0**：AC-1~AC-3（挪位 + 紧凑 + 短标签）、AC-5~AC-6（零红字 + 琥珀点 + 面板留因）、AC-9~AC-11（头部排版 + 可切换按钮）、AC-16~AC-18（技能自定义 + 模型选择器 + 角色扩充）、AC-19/AC-20（基数与冻结）、AC-22（交付门禁）。
- **P0（真机强制）**：AC-12~AC-15（工具条存在 / 头部按钮连点三态 / 窄宽 / 失败分工）、AC-17 真机部分、AC-23（安装与回滚）。
- **P1**：AC-4、AC-7、AC-8、AC-21（语义不回归）。
- 里程碑建议：T1 挪位 + 紧凑 + 短标签（AC-1~AC-4）→ T2 零红字 + 琥珀点（AC-5~AC-7）→ T3 头部排版 + 可切换按钮（AC-9~AC-11，先验「页签可自关」）→ T4 内置角色与技能扩充（AC-18 + 技能目录落盘骨架）→ T5 技能自定义 + 模型选择器（AC-16/AC-17，依赖 §7 两项裁决）→ T6 单测与契约（AC-19~AC-21）→ T7 真机脚本（AC-12~AC-15）→ T8 门禁 + 安装回滚 + QA/ACCEPTANCE（AC-22~AC-24）。T2/T3/T4 文件基本不重叠可并行；T5 必须等 §7 的裁决。
