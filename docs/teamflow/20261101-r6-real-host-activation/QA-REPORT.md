# QA-REPORT · r6 真机激活（dsh-auto-team）

> 任务夹：`docs/teamflow/20261101-r6-real-host-activation/`｜分支 `feat/auto-team-plugin`（HEAD `61e03fd`，改动未提交，按 ADR-2026-08-27 由 host 统一收口）
> 被测形态：cordis 插件双产物（宿主 `lib/index.js` ESM + client `lib/client.js` CJS/`__ModuleLoader__`），安装源=包根 `file:` 依赖。宿主 0.2.1-rc.5，真机 profile `rt4`（desktop 克隆），`desktop` 为对照。

## 1. 结论

**不通过（不可验收）。** 宿主半契约（inject 完备 / `ctx.get` 单一入口 / 降级）与守卫体系已实测达标；**client 半的右栏页签在本机任何状态下都不会出现**，原因是只注册了 keyed 挂载点、没有注册页签类型——母判据 AC-8 因此为红，且这不是环境问题。

判定依据（三处互相独立）：`node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-host-slot-contract.mjs` → `FAIL [H9]`；`real-host-assert.mjs` → `14 PASS / 3 FAIL / 1 SKIP`、exit 1；`grep -r 'sidebarRightTabs' src` → 0 命中。

## 2. 范围与环境

| 项 | 值 |
|---|---|
| 被测交付 | `src/host/{index,adapters}.ts`、`src/client/{index,slots,TabTitle}.{ts,tsx}`、`test/{host,client}-contract.test.ts`、`test/{wire,adapters}.test.ts`、`lib/` 双产物 |
| 宿主 | DeepSeek Harness 0.2.1-rc.5（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，182 MB） |
| 真机 | profile `rt4`（`file:` 依赖 + hardlink 安装，仓库与 profile 的 `lib` sha256 相同、inode 相同 `11341006`）；对照 profile `desktop` 本轮未被重装（`package.json` mtime `11-01 10:40`） |
| 沙箱 | 真 Chromium 无法启动（crashpad 需 PROCESS_ALL_ACCESS，宿主沙箱拒绝）→ 用 playwright `chrome-headless-shell` + 宿主契约静态抽取替代，属环境限制、非交付缺陷 |
| 工具限制 | `cordis_inspect_query`(client/`Slots.listSubTree`) 连续两次 `rejected input: "input" must be an object` → 改用 app.asar 静态抽取宿主 slot 契约（本报告所有宿主契约结论均来自 app.asar 原文，不是记忆） |

## 3. 用例与结果（AC-1 ~ AC-22）

| AC | 判据 | 实测命令 | 结果 |
|---|---|---|---|
| AC-1 | 加载入口 name=包根名 | `cat cordis.patch.yml` | ✅ `- id: auto-team-host / name: 'dsh-auto-team'` |
| AC-2 | inject ⊇ 裸访问面；可选服务走 `ctx.get` 单点 | `node --test test/host-contract.test.ts`；`grep -n OPTIONAL_SERVICES src/host/adapters.ts` | ✅ 8 例全过；`OPTIONAL_SERVICES=['webServer','llm','agentDefaultModel']` 单点（adapters.ts:101），`ctx.get` 无第二处 |
| AC-3 | 真机 boot 零 warning | `grep -cE 'did not activate\|cannot get property' capture/boot.log` | ✅ 0（⚠️ 只是「没报错」，不等于「已激活」，见 AC-8） |
| AC-4 | 守卫删 inject 项必红且红的是断言 | `bash logs/.../scripts/guard-mutation.sh` | ✅ 8/8：删 `agentTeams`→红并点名服务；删 `key: PANEL_KEY`→红并点名 keyed slot；复原 sha256 一致后转绿 |
| AC-5 | 双产物顶层不抛错 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | ✅ `IMPORT_OK` exit 0 |
| AC-6 | keyed slot 带 key + 两处 inject(sessionId) | `node logs/.../scripts/qa-host-slot-contract.mjs` | 🟡 契约层 PASS（`H2/H2b/H8/H8b`：宿主 required=`key` 满足、body/title 同 key、dock 带必填 `id`）；**真机无证据** |
| AC-7 | inject 名与 register name 逐字相同、标识只进 id/key | 同上 + `node --test test/client-contract.test.ts` | ✅ 契约层（`H6/H7` 三个挂载点全部通过宿主契约校验）；**但页签类型缺失，见 QA-02** |
| **AC-8** | **母判据：真机 DOM 同时出现 `[data-toggle-label]` 与 `[data-dsh-auto-team-panel]`、控制台 0 命中 requires options.key** | `node logs/.../scripts/real-host-assert.mjs --dir logs/.../capture` | ❌ **exit 1，14 PASS / 3 FAIL / 1 SKIP**：`AC-8e`/`AC-8e2` 无 `[data-toggle-label]`/`[data-dsh-auto-team-toggle]`；`AC-8f` 无插件节点、无「自动团队」；`AC-8g` SKIP。控制面条目（`AC-6a/6b`、`AC-7a`）确为零命中 ✅ |
| AC-9 | client 声明块字段集合=样本；产物非空含包 id | `node -e "…require('./package.json')"`；`npm pack --dry-run` | ✅ 字段集合与 `dsh-plugin-teamflow` 逐字段一致（`platform/inject/immediately`）；`lib/client.js 109.4 kB` 含 `dsh-auto-team` |
| AC-10 | 入口声明与双产物进 files 并被打包 | `npm pack --dry-run 2>&1 \| grep -E 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | ✅ 3 条目：`cordis.patch.yml 646B`、`lib/client.js 109.4kB`、`lib/index.js 227.1kB` |
| AC-11 | 依赖协议可解析、peer 覆盖宿主包 | `grep -c 'workspace:' package.json` | ✅ 0 命中；peerDependencies 覆盖 7 个 `@deepseek-ai/dsh-client-*` + `react` |
| AC-12 | 产物与源码同步、profile 内实体拷贝 sha256 相等 | `shasum -a 256 lib/*.js ~/.dsh/profiles/rt4/node_modules/dsh-auto-team/lib/*.js`；`find src -newer lib/index.js \| wc -l` | ✅ 两侧 `index 251979fc…`/`client 3216f1c4…` 完全相同（同 inode=hardlink）；源码新鲜度 `0/0` |
| AC-13 | 一条可复跑真机回路 + 三步原文 | `bash logs/.../scripts/real-host-verify.sh --profile rt4 --port 51891` | 🟡 脚本可复跑、四步都出结论（1/4✓ 2/4✓ 3/4✓ 4/4✗），但第 4 步判据本身采样错了页面（见 QA-05） |
| AC-14 | 主 agent 实跑原文进验收报告 | — | ⛔ 无法由 QA 闭环：profile 安装与真机启动只许主 agent 执行（子代理权限被钉在工作区），按要求**不得默认通过** |
| AC-15 | 安装带回滚 | `capture/install.log` | 🟡 安装成功（`Packages: +1 … Done in 888ms`）；回滚反向步骤（`pnpm remove dsh-auto-team` + 摘 `dsh.profile.bundles`）已写在 `notes-real-host-slots.md`，**未做「装上后故意失败再回滚」的演练** |
| AC-16 | desktop 零污染 | `stat -f '%Sm' ~/.dsh/profiles/desktop/package.json` | ✅ `11-01 10:40`（早于本轮），本轮未重装；`node_modules/dsh-auto-team/lib/*` 与仓库同 inode，属 hardlink 联动而非拷贝污染 |
| AC-17 | 全量门禁 + r4 不降 + 上期三条 P3 零改动 | `pnpm -s typecheck`；`node --test test/*.test.ts`；`qa-reverify-probe.mjs`；`qa-collision-probe.mjs` | ✅ typecheck 0；**330 tests / 330 pass / 0 fail**；r4 `9/9` + `12/12`；`dispatch.ts`/`store.ts` 不在改动清单，`src/host/index.ts` 仅 2 个 hunk |
| AC-18 | 预算常量/路由/`setInterval` 逐字不变 | `grep -rn 'setInterval(' src \| wc -l`；`grep -rn 'WATCHER_INTERVAL_MS\|PANEL_ACTIVE_MS' src` | ✅ `setInterval` 仅 1 处（`watcher.ts:265`）；`WATCHER_INTERVAL_MS=1500`(config.ts:52)、`PANEL_ACTIVE_MS=2_000`(shared/const.ts:26) |
| AC-19 | Slow 层只留位 | `grep -n 'TRIGGER_SLOW_LAYER' src/host/team/trigger.ts` | ✅ `= false`（trigger.ts:93），零改动 |
| AC-20 | 触发到面板可见 ≤5000ms | — | ⛔ 面板本身不渲染（AC-8 红），该判据不可能成立；一并阻塞 |
| AC-21 | 全量门禁（typecheck/test/build/新鲜/import/pack/r4/新探针） | 见上逐条 | ✅ 除 AC-8/AC-14/AC-20 外全绿；新探针 `captain-guard`/`inline-spill`/`trigger` 未在本轮重跑（r5 已 14/14，本轮无相关改动） |
| AC-22 | 不回归 + 不夹带 | `git status --porcelain -uall` | ✅ 12 项全部是源码/测试/产物/任务夹文档，**无 `node_modules`、无 `dist`、无缓存、无密钥**；`logs/teamflow/` 已被 `.gitignore` 排除 |

## 4. 缺陷表

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-01 | P1 | 架构（蓝图/技术方案） | 读 `TECHNICAL.md` 的 client 半模块蓝图（`slots.ts`/`TabTitle.tsx`/`index.ts`），再 grep 页签类型注册 | 蓝图应显式列出「右栏 tab 类型注册 + 所需服务」这一步（同机样本 `dsh-plugin-teamflow` 先 `ctx.get("sidebarRightTabs")` 再 `tabs.register(...)`，两步缺一不可） | 蓝图、PRD、`src` 三处 `sidebarRightTabs` 命中均为 0 → dev 按图施工必然缺这一步，缺陷是设计层引入的 | AC-6、AC-7 | `grep -c 'sidebarRightTabs' docs/teamflow/20261101-r6-real-host-activation/TECHNICAL.md` | 输出 ≥1，且蓝图指明该步骤归属模块（client 半） |
| QA-02 | P1 | client 挂载（右栏页签） | `node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-host-slot-contract.mjs` | 产物把 tab 类型 id=`dsh-auto-team-panel` 注册进 `sidebarRightTabs` 服务，再用同一 id 作 `sidebar.right.pane.tab` 的 keyed key | 只注册了 keyed body/title 挂载点（`src/client/slots.ts:86/91`），`inject` 仅 `['slots']`、无 `tabs.register` → 宿主不存在该 kind 的 tab，派发永不发生，页签永不出现、面板永不渲染 | AC-6、AC-7、AC-8 | `node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/qa-host-slot-contract.mjs` | 输出 `PASS [H9]` 且退出码 0 |
| QA-03 | P1 | 真机验收（母判据） | `node logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-assert.mjs --dir logs/teamflow/tf-mvxcfxze-e9elp3/capture` | 17 条判据全 PASS、exit 0（`[data-toggle-label]`、`[data-dsh-auto-team-panel]` 都在 DOM 里） | exit 1：`14 PASS / 3 FAIL / 1 SKIP`；`AC-8e`「`conversation.composer.dock` 未挂载」的文案是**归因错误**——宿主契约里该 slot 真实存在（`kind=list scope=session`，`required=[id]`），只是 InputBar 仅在 `variant==="composer" && input!==undefined && sessionId!==undefined` 时渲染，而采集页是新建会话落地页 | AC-8、AC-14 | 同上 | 17 PASS / 0 FAIL / 0 SKIP，exit 0 |
| QA-04 | P3 | craft（可见 UI） | 真机只在新建会话落地页抓过 DOM | 开关行在有输入框的会话里的视觉与交互态（hover/focus/禁用、深浅主题对比）符合 DESIGN | 无任何真机截图或元素级证据（静态抓取不点击） | AC-8 | - | - |
| QA-05 | P3 | 文档（结论可继承性） | 读 `logs/.../notes-real-host-slots.md` | 归因结论与宿主契约定理一致，供下一轮当事实 | 「本机宿主 0.2.1-rc.5 没有 `composer.dock`/`pane.tab` 容器」与宿主源码矛盾；据此提出的「改挂 `conversation.input.dock` + `sidebar.panellist`」会在下一轮把正确的 keyed 实现改坏（`panellist` 是 `kind=list scope=root`、注册形状要 `id/order/label`，与 keyed tab 完全不是一回事） | AC-13 | - | - |

## 5. 人工补测清单（环境限制 / 权限限制，非交付缺陷）

1. **活跃会话里的开关行**（AC-8e/8e2 的唯一真机判据）：在 `rt4` 第二宿主里点开任意历史会话使输入条出现（`sessionId` 被赋值），再跑 `bash logs/.../scripts/real-host-verify.sh --profile rt4 --port 51891`。工具：该脚本 + `real-host-dom.mjs`。
2. **主 agent 实跑**（AC-14）：由主 agent 在 `desktop`/`rt4` 上完整跑一次真机回路，把原文贴进 `ACCEPTANCE.md`；QA 无 profile 写权限，不能代跑。
3. **面板内容与页签点击**（AC-8g）：修复 QA-02 后点开右栏页签，核对计划/成员/记忆/角色四页渲染。
4. **视觉目视**（QA-04）：深浅主题下开关行与面板的间距、对比、hover/focus 态。
5. **Slow 层切换判据**（AC-19/AC-20）：面板能出现之后，再验「触发到面板可见 ≤5000ms」。

## 6. 修复建议（按依赖顺序）

1. **先修 QA-01/QA-02**：在 client 半新增页签类型注册（`ctx.get('sidebarRightTabs')` → `tabs.register({ id: 'dsh-auto-team-panel', kind: …, icon, label })`，`apply` 前先 `ctx.inject(['sidebarRightTabs'])` 或把该服务加进 client `inject`），keyed key 复用同一 id；并把这一步写进蓝图与 `test/client-contract.test.ts` 的守卫（当前守卫只验「注册对象形状」，验不出「宿主根本没有这个 tab 类型」）。
2. **更正 QA-05 的归因**：`notes-real-host-slots.md` 的「宿主无此容器」结论作废；`composer.dock` 与 `pane.tab` 都是宿主真实声明的 slot，采集失败的真因是「没有活跃会话 + 页签类型没注册」。
3. **再跑真机**：修完后重跑第 5 节第 1 项，取 `real-host-assert.mjs` 的 17 PASS 作为 AC-8 的收口证据。
