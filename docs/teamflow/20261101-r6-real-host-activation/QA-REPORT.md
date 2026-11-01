# QA-REPORT · r6 真机激活（dsh-auto-team）

> 任务夹：`docs/teamflow/20261101-r6-real-host-activation/`｜分支 `feat/auto-team-plugin`，HEAD `ea33208`，工作树干净（`git status --porcelain --untracked-files=all` 空）
> 被测形态：cordis 插件双产物（宿主 `lib/index.js` ESM + client `lib/client.js` CJS/`__ModuleLoader__`），安装源＝包根 `file:` 依赖。宿主 0.2.1-rc.5，真机 profile `rt4`（desktop 克隆，`file:` 依赖 + hardlink）。
> 本轮为**第 2 轮 QA**（第 1 轮结论与证据留在同一提交历史里；本轮全部命令重跑一遍，未继承任何上一轮「已通过」判定）。

## 1. 结论

**不通过（不可验收）。** 阻断点只有一个族但两处独立缺陷：**client 半从未把「页签类型」注册进宿主 `sidebarRightTabs` 服务**，因此右栏「自动团队」面板在任何会话状态下都不会出现 → 母判据 AC-8 红；且 `TECHNICAL.md` 蓝图里根本没有这一步，属设计层引入、dev 按图施工必然复现的系统性缺口。

判定依据（三处互相独立、本轮全部实跑）：`node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-interface-consistency.mjs` → `FAIL [I9]`；`qa-host-slot-contract.mjs` → `FAIL [H9]`；`real-host-assert.mjs --dir capture` → exit 1（14 PASS / 3 FAIL / 1 SKIP）。宿主侧三份独立样本（宿主自带 `ui-deliverables`、`dsh-plugin-teamflow`、`dsh-better-sidebar`）均「先注册 tab 类型、再用同一 id 作 keyed key」，被检实现 `grep -rn sidebarRightTabs src/ test/ lib/` = **0 命中**。

宿主半（inject 完备 / `ctx.get` 单一入口 / 降级 / 守卫变异自检）与全量门禁已实测达标，不是本次阻断原因。

## 2. 范围与环境

| 项 | 值 |
|---|---|
| 被测交付 | `src/host/{index,adapters}.ts`、`src/client/{index,slots,TabTitle}.{ts,tsx}`、`test/{host,client}-contract.test.ts`、`test/{wire,adapters}.test.ts`、`lib/` 双产物 |
| 宿主 | DeepSeek Harness 0.2.1-rc.5 |
| 真机 | profile `rt4`（`package.json:8` `"dsh-auto-team": "file:…/dsh-auto-team"`，`:40` bundles 含 `dsh-auto-team`；仓库与 profile 两份 `lib` sha256 逐字相同，`lib/index.js` 同 inode `12153335`）；`desktop` 为克隆来源，本轮未被重装 |
| 沙箱 | 真 Chromium 无法启动（crashpad 需 PROCESS_ALL_ACCESS，宿主沙箱拒绝）→ 真机回路用 playwright `chrome-headless-shell` + CDP 抓 DOM/console。**环境限制，非交付缺陷** |
| 工具限制 | 浏览器不可用于交互点击；`cordis_inspect_query` 的 `input` 必须是对象，本轮未调用（改走静态抽取 + DOM 实测） |

## 3. 交付形态契约（11 条，逐条实跑）

| # | 判据 | 实测命令 | 结果 |
|---|---|---|---|
| 1 | 入口声明存在、`name`=包根名 | `grep -n "name:" cordis.patch.yml` | ✅ `11: name: 'dsh-auto-team'`（`- id: auto-team-host`） |
| 2 | client 声明块字段集合=样本；产物非空含包 id | `node -e` 读 `package.json`；`grep -c dsh-auto-team` 产物 | ✅ 字段集合 `immediately,inject,platform`，与 `dsh-plugin-teamflow` 逐字段一致；`lib/client.js 109.4 kB` 含包 id |
| 3 | 挂载点 `name`=slot 名本身、插件名只进 id/key | `node …/qa-host-slot-contract.mjs`（H3-H8b）；`node …/qa-interface-consistency.mjs`（I3/I4/I5） | 🟡 注册对象形状全对，但端到端「装进宿主真的出现」= **不出现**（见 QA-02/QA-03） |
| 4 | 入口声明与双产物进 files 并被打包 | `npm pack --dry-run` | ✅ 3 条目：`cordis.patch.yml 646B`、`lib/client.js 109.4kB`、`lib/index.js 227.1kB`（total files 5） |
| 5 | 依赖协议可解析、0 处 `workspace:` | `grep -c 'workspace:' package.json` | ✅ `0` |
| 6 | peer/peerMeta 覆盖宿主包 | `node -e` 读 package.json | ✅ 8 peer（7×`@deepseek-ai/dsh-client-*` + `react ^18.2.0`）、8 peerMeta 全 optional |
| 7 | 产物与源码同步（重建后新鲜） | `pnpm -s build`；`find src -name '*.ts*' -newer lib/index.js \| wc -l`（client 同） | ✅ 两个 `0`；产物 sha256 与第 1 轮逐字相同 → 源码自上轮未变 |
| 8 | 两产物模块顶层不抛错 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | ✅ `IMPORT_OK`，exit 0 |
| 9 | 能被 profile 真实装入并被宿主加载 | `bash …/real-host-verify.sh --profile rt4 --port 51891` 四步 | ✅ 1/4 准备+安装（`install.log` 307B）、2/4 启动宿主零 warning、3/4 页面与批量包含 `dsh-auto-team/client.js`；**UI 不出现**（第 4 步 ✗，归属 QA-03） |
| 10 | 安装带回滚 | `notes-real-host-slots.md` 反向步骤 + `real-host-verify.sh` 只操作克隆 profile（`SRC_PROFILE` 只作克隆源，脚本对 desktop 显式拒绝删除：`:549`） | 🟡 反向步骤已写（`pnpm remove dsh-auto-team` + 摘 `dsh.profile.bundles`），**未做「装上后故意失败再回滚」演练** |
| 11 | 安装只许主 agent 执行；PRD 给本机可照做步骤 | 读 PRD 安装章节 | ✅ 三步（`pnpm add file:<repo>` + 重启宿主 + GUI 可见性检查）已写入 PRD；本阶段未越权写 profile |

## 4. 用例与结果（AC-1 ~ AC-22）

| AC | 判据 | 实测命令 | 结果 |
|---|---|---|---|
| AC-1 | 加载入口 name=包根名 | 见形态 1 | ✅ |
| AC-2 | inject ⊇ 裸访问面；可选服务走 `ctx.get` 单点 | `node --test test/host-contract.test.ts`；`qa-interface-consistency` I6/I7/I8 | ✅ AST 扫全部 `ctx.*` 访问；`OPTIONAL_SERVICES=['webServer','llm','agentDefaultModel']`（`src/host/adapters.ts:101`）单点，`ctx.get` 全仓仅 `adapters.ts` 一处 |
| AC-3 | 真机 boot 零 warning 且 entry 激活 | `real-host-assert` AC-3a/3b/3c | ✅ boot 零 `did not activate`、零 `cannot get property`（⚠️ 只证明不报错，不等于 UI 可见） |
| AC-4 | 守卫删 inject 项必红且红的是断言 | `bash …/guard-mutation.sh` | ✅ 8/8：删 `'agentTeams'` → 红且点名 `src/host/adapters.ts:460/634/668/868`；删 `key: PANEL_KEY,` → 红且文案「keyed slot（面板 body 与标题）必须带 key」；复原 sha256 一致后转绿 |
| AC-5 | 双产物顶层不抛错 | 见形态 8 | ✅ |
| AC-6 | keyed slot 带 key + 两处 `inject(sessionId)` | `qa-host-slot-contract` H2/H2b/H8/H8b；`node --test test/client-contract.test.ts` | 🟡 契约层全过（`key="dsh-auto-team-panel"`、body/title 同 key、dock 带必填 `id`）；**真机无证据**（keyed 座位永不派发，见 QA-02） |
| AC-7 | inject 名与 register name 逐字相同、标识只进 id/key | 同上 + I3/I4/I5 | ✅ 三处均用同一常量（`DOCK_SLOT`/`PANEL_SLOT`/`PANEL_TITLE_SLOT`），`PLUGIN_ID` 未进 `name` |
| **AC-8** | **母判据：DOM 同时出现 `[data-toggle-label]` 与 `[data-dsh-auto-team-panel]`、控制台 0 命中 requires options.key** | `node …/real-host-assert.mjs --dir …/capture` | ❌ **exit 1，14 PASS / 3 FAIL / 1 SKIP**：`AC-8e`/`AC-8e2` 无 `[data-toggle-label]`/`[data-dsh-auto-team-toggle]`；`AC-8f` 无插件节点、无「自动团队」；`AC-8g` SKIP。控制面条目 `AC-6a/6b`、`AC-7a` 确为零命中 ✅ |
| AC-9 | client 声明块=样本；产物非空含包 id | 见形态 2 | ✅ |
| AC-10 | 入口声明与双产物进 files 并被打包 | 见形态 4 | ✅ |
| AC-11 | 依赖协议可解析、peer 覆盖宿主包 | 见形态 5/6 | ✅ |
| AC-12 | 产物与源码同步、profile 内实体拷贝 sha256 相等 | `shasum -a 256 lib/*.js ~/.dsh/profiles/rt4/node_modules/dsh-auto-team/lib/*.js` | ✅ 两侧 `index 251979fc…`、`client 3216f1c4…` 完全相同（hardlink 同 inode） |
| AC-13 | 一条可复跑真机回路 + 三步原文 | `bash …/real-host-verify.sh --profile rt4 --port 51891` | 🟡 脚本可复跑、四步均出结论（1/4✓2s 2/4✓4s 3/4✓0s 4/4✗），但 `AC-8e` 的失败文案把「未挂载」归因写死，实际本机只有落地页状态（见 QA-05） |
| AC-14 | 主 agent 实跑原文进验收报告 | — | ⛔ 无法由 QA 闭环：profile 安装/真机启动只许主 agent 执行（子代理权限被钉在工作区），按要求**不得默认通过** |
| AC-15 | 安装带回滚 | 见形态 10 | 🟡 未演练 |
| AC-16 | desktop 真宿主零污染 | `stat`+脚本审计 | ✅ `real-host-verify.sh` 只写克隆 profile，对 desktop 显式拒绝破坏操作（`:549`） |
| AC-17 | 全量门禁 + r4 复核不降 + 上期三条 P3 零改动 | `pnpm -s typecheck`；`node --test test/*.test.ts`；`qa-reverify-probe.mjs`；`qa-collision-probe.mjs` | ✅ typecheck 0；**330 tests / 330 pass / 0 fail**（门槛 ≥311）；r4 `9/9` + `12/12` 本轮重跑；`dispatch.ts`/`store.ts`/`trigger.ts` 不在改动清单 |
| AC-18 | 预算常量/路由/`setInterval` 逐字不变 | `grep -rn "setInterval(" src \| wc -l`；`grep -n "WATCHER_INTERVAL_MS =\|PANEL_ACTIVE_MS =" src` | ✅ `setInterval` 1 处（`src/host/team/watcher.ts:265`）；`WATCHER_INTERVAL_MS=1500`（`src/host/config.ts:52`）、`PANEL_ACTIVE_MS=2_000`（`src/shared/const.ts:26`） |
| AC-19 | Slow 层只留位、默认关闭 | `grep -n TRIGGER_SLOW_LAYER src/host/team/trigger.ts` | ✅ `= false`，零改动 |
| AC-20 | 触发到面板可见 ≤5000ms | — | ⛔ 面板本身不渲染（AC-8 红），判据不可能成立，一并阻塞 |
| AC-21 | 全量门禁（typecheck/test/build/新鲜/import/pack/r4/新探针） | 见上逐条 | ✅ 除 AC-8/AC-14/AC-20 外全绿；r5 三支新探针本轮未重跑（r6 无相关改动，产物 sha256 与上轮逐字相同可证未变） |
| AC-22 | 不回归 + 不夹带 | `git status --porcelain --untracked-files=all` | ✅ 空（HEAD `ea33208` 已提交全部改动） |

## 5. 强制项执行记录

- **0a 跨模块接口一致性**：`node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-interface-consistency.mjs` → 8 PASS / 1 FAIL（exit 1）。I1 全仓 **226 条 import 目标模块全部存在**；I2 具名符号**全部确实被导出**（含 `export type {…}` 形态）；I3/I4/I5 inject↔register name 同常量且单点；I6/I7/I8 可选服务经 `ctx.get` 单点；**I9 FAIL：client 半无 `sidebarRightTabs` 页签类型注册**。
- **0a2 主路径真的能跑**：真机四步回路实跑（`real-host-verify.sh` exit 1，宿主真启动、页面 44308 B、批量包 11969824 B 含 `dsh-auto-team/client.js` 与「自动团队」文案），非「只查文件存在」；`qa-host-slot-contract` 的 H6/H7 驱动真实注册对象过宿主契约校验。
- **0 架构检查**：无重复实现（可选服务单点 `adapters.ts:101/122`、slot 常量单点 `slots.ts`、client/host 零交叉 import 0 命中）；无该抽未抽；**偏差＝蓝图缺页签类型注册这一步（QA-01）**，另 `slots.ts` 注册下沉优于蓝图（属正向偏差，不记缺陷）。
- **0c 版本控制面**：`.gitignore` 覆盖 `node_modules/`、`logs/teamflow/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`、`.auto-team/`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.env*`（保留 `.env.example`），并显式声明不忽略 `lib/` 与 `docs/`；`git status -uall` 空 → 无依赖/产物/缓存/密钥误入。
- **0d craft**：交互四态齐备（`src/client/styles.ts:44/48/51/55`、`:178/182/185/189`、`:202-204` 焦点态、`:220` 选中态），空态/拦截提示齐备（`src/client/Panel.tsx:90`、`src/client/tabs/MemoryTab.tsx:50/65/69`）；真机无渲染 → 视觉只能记 P3 观察。

## 6. 缺陷表

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-01 | P1 | 架构（蓝图/技术方案） | 读 `TECHNICAL.md` 的 client 半模块清单（`src/client/slots.ts:35`、`TabTitle.tsx:36`、挂载点表:131、U2:349），再 grep 页签类型注册 | 蓝图显式列出「tab 类型注册进 `sidebarRightTabs` + 所需服务（`ctx.inject` 或 `ctx.get`）」这一步，否则 dev 按图施工必然重复本缺陷 | 蓝图全文 0 命中 `sidebarRightTabs`/页签类型；模块清单只到挂载点 | AC-6、AC-7 | `grep -c 'sidebarRightTabs' docs/teamflow/20261101-r6-real-host-activation/TECHNICAL.md` | 输出 ≥1 |
| QA-02 | P1 | client 挂载（右栏页签） | 读 `src/client/index.ts`（`inject=['slots']`）与 `src/client/slots.ts`（3 处 `ctx.slots.inject` 只注册座位），对照宿主自带 `ui-deliverables`、`dsh-plugin-teamflow`、`dsh-better-sidebar` 三份样本 | 产物把 tab 类型 id=`dsh-auto-team-panel` 注册进 `sidebarRightTabs`（`ctx.get('sidebarRightTabs')` 或加进 client `inject`），再用同一 id 作 `sidebar.right.pane.tab` 的 keyed key | 从未注册 tab 类型（全仓 `grep -rn sidebarRightTabs src/ test/ lib/` = 0），宿主不存在该 kind 的 tab → keyed 座位永不派发，页签与面板永不出现（构建全绿、控制台零报错） | AC-6、AC-7、AC-8 | `node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-interface-consistency.mjs \| grep -c '^FAIL \[I9\]'`；`node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-host-slot-contract.mjs \| grep -c 'PASS \[H9\]'` | 前者输出 `0` 且后者输出 `1`，两脚本 exit 0 |
| QA-03 | P1 | 真机验收（母判据 AC-8） | `node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-assert.mjs --dir logs/teamflow/tf-mvxcfxze-e9elp3/capture` | 17 条判据全 PASS、exit 0（DOM 有 `[data-toggle-label]` 与 `[data-dsh-auto-team-panel]`、控制台零 `requires options.key`） | exit 1：14 PASS / 3 FAIL / 1 SKIP；`AC-8f` 面板零节点（根因＝QA-02），`AC-8e`/`AC-8e2` 开关行零节点（当前只有落地页状态，**未判定**，见第 7 节） | AC-8、AC-14 | 同上 | 17 PASS / 0 FAIL / 0 SKIP，exit 0 |
| QA-04 | P3 | craft（可见 UI） | 两个挂载面在真机都不渲染，无法取元素级视觉证据 | 深浅主题下开关行 32px 行高/面板四页间距与 hover/focus/disabled 态符合 DESIGN §2 | 无真机截图；静态 CSS 已具备四态与 token，但「看起来对不对」无证据 | AC-8 | - | - |
| QA-05 | P3 | 文档（结论可继承性） | 读 `logs/teamflow/tf-mvxcfxze-e9elp3/notes-real-host-slots.md` 与 `real-host-assert.mjs` 的 `AC-8e` 文案 | 归因写成「本机当前的采集状态里该 slot 未挂载（落地页/无活跃会话）」，供下一轮当事实 | 现有 capture 只能证明「落地页状态下两个 slot 不在已挂载清单（39 项）与 DOM（44 个 `data-slot` 元素）里」；同页对照 `dsh-cost-meter` 同时注册 `conversation.composer.dock`（`.cm-stat-entry` 真实元素 0 个）与 `conversation.input.dock`（`.cm-qstrip` 1 个）——**同一插件一渲染一不渲染**，与「宿主本版没有该容器」和「当前无活跃会话」两种解释**同时相容**，不能当定论；据此改挂 `conversation.input.dock` + `sidebar.panellist` 会改坏 keyed 实现（`panellist` 是 `kind=list scope=root`，形状要 `id/order/label`） | AC-13 | - | - |

## 7. 人工补测清单（环境/权限限制，非交付缺陷）

1. **活跃会话里的开关行**（AC-8e/8e2 唯一真机判据）：在 `rt4` 第二宿主里进入一个**有消息的会话**（`sessionId` 已赋值、`variant==="composer"`），再抓 DOM 看 `conversation.composer.dock` 是否出现、`[data-toggle-label]` 是否渲染。工具：`bash logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-verify.sh --profile rt4 --port 51891` + `real-host-dom.mjs`。判定要点：若 dock 出现而开关行缺失 → 本插件注册问题（升 P1 并对准 `id`/`order`）；dock 不出现而 `input.dock` 渲染 → 挂载点选错（改挂点）。
2. **主 agent 实跑**（AC-14）：由主 agent 在 `rt4` 完整跑一次真机回路，把原文贴进 `ACCEPTANCE.md`；QA 无 profile 写权限，不能代跑，**不得默认通过**。
3. **面板内容与页签点击**（AC-8g）：修复 QA-02 后点开右栏页签，核对计划/成员/记忆/角色四页渲染与交互。
4. **视觉目视**（QA-04）：深浅主题下开关行与面板的间距、对比、hover/focus/disabled 态。
5. **安装回滚演练**（AC-15）：在克隆 profile 上故意制造失败（如装入未构建的旧 `lib`），确认能按反向步骤 `pnpm remove dsh-auto-team` + 摘 `dsh.profile.bundles` 恢复且宿主可再次启动。
6. **Slow 层判据**（AC-19/AC-20）：面板可见之后，再验「触发到面板可见 ≤5000ms」。

## 8. 修复建议（按依赖顺序）

1. **补页签类型注册（QA-02）**：`src/client/slots.ts` 内新增 `registerPanelTabType(ctx)`：`ctx.get('sidebarRightTabs')`（或在 `index.ts` 的 `inject` 里加 `'sidebarRightTabs'`）→ `tabs.register({ id: PANEL_KEY, kind: …, icon, label: () => t(…) })`，用 `ctx.effect(...)` 包裹以便卸载；keyed 座位的 `key` 复用同一 `PANEL_KEY`。参照宿主自带 `ui-deliverables` 与 `dsh-plugin-teamflow` 的写法，不要凭记忆造字段。
2. **把这一步写进蓝图与守卫（QA-01）**：`TECHNICAL.md` client 半模块清单补该函数与所需服务；`test/client-contract.test.ts` 增加断言「fake slots 之外，必须持有 `sidebarRightTabs.register` 的调用，且其 id 与 keyed key 相同」——当前守卫只验注册对象形状，验不出「宿主根本没有这个 tab 类型」。
3. **更正 AC-8e 的归因文案（QA-05）**：`real-host-assert.mjs` 的 `AC-8e` 失败文案目前写「`conversation.composer.dock` 未挂载」，会让人误以为宿主缺该 slot；改为「本采集状态（落地页/无活跃会话）未渲染」，并在报告里区分「未判定」与「判定为红」。
4. **修完后重跑**：`real-host-verify.sh` → `real-host-assert.mjs`（目标 17 PASS / 0 FAIL），并把 AC-8e 的活跃会话探针结果一并回填本报告 §7 第 1 项。
