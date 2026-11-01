# r7 QA 复核报告（第 4 轮 · 修复后复验）

- 需求夹：`docs/teamflow/20261101-r7-auto-team-panel-roles/`
- 分支：`feat/auto-team-plugin` · HEAD `fa56717`（工作树含修复轮未提交改动，46 项，全部在 `src/` `test/` `lib/` 与本夹文档内）
- 复核对象：第 3 轮 QA 判定的 1 个 P1（QA-R7-01）与 3 个 P3（QA-R7-02/03/04）的修复
- 环境：macOS 本机 Node v26.11.1，无浏览器（沙箱内 Chromium crashpad 无法启动，环境限制）；真机 GUI 采样由主 agent 执行，见「人工补测清单」
- 产物：本文件（QA-REPORT.md）。全部命令在本仓根实跑，输出逐条贴在此表

---

## 1. 既有 checker 重跑（本需求的回归契约，逐条通过数）

| checker | 命令 | 结果 |
|---|---|---|
| 升级迁移判据（本轮已扩展 A–G 七组场景） | `node logs/teamflow/tf-mvxo8o98-3vdnl3/scripts/qa-r7-roles-prompt-migration.mjs` | 23 PASS / 0 FAIL，exit 0（上轮 7 PASS，其中 B-legacy 3 条红） |
| 迁移判据自检（可分辨性） | `node …/qa-r7-roles-prompt-migration.mjs --selfcheck` | 2 PASS / 0 FAIL：干净副本 exit 0；seed 退回「已存在不补」→ exit 1 且红在 `FAIL [C-4]` |
| 交付门禁 | `node …/r7-delivery-gates.mjs` | ALL GATES PASS 17/17（G1 typecheck exit 0；G2 tests 425 / pass 425 / fail 0；G3 双产物新鲜、比产物新的源文件 0；G4 IMPORT_OK；G5 pack 3 条目；G6 `data-dsh-auto-team` 0；G7 `composer.dock` 0；G8 client→host import 0；G9 setInterval 仅 `src/host/team/watcher.ts:290`；G10 `pausedFrom` 0；G11 git 46 项、越界 0；F1 路由 3；F2 kind 9；F3 inject 4；F4 PlanTask 零新增；P1 client 产物 5/5 新 hook；P2 host 产物 5/5） |
| client 产物装配 | `node …/r7-client-bundle-wiring.mjs` | 10 PASS / 0 FAIL（含 W9 `sidebarRightTabs` 注册 `[{id,kind}=dsh-auto-team-panel]`、W10 `openPanel()` opened=true） |
| 真机四件套采样（mock DOM 自检） | `node …/r7-live-panel.mjs --selfcheck` | 7 PASS / 0 FAIL / 1 SKIP（AC-19-0 落地页五项=0 反证；AC-19-1..5 各 1；AC-19-6 `file://` 下 SKIP；删 option 后采样变 0 的可分辨自检） |
| 暂停往返（mock 状态机自检） | `node …/r7-pause-roundtrip.mjs --selfcheck` | 5 PASS / 0 FAIL：`none` 全绿；`no-freeze`→红 AC-20-1a/1b/2/3c、`allow-dispatch`→红 AC-20-2、`leak-progress`→红 AC-20-3b、`lose-attempts`→红 AC-20-5 |
| 设置改参/恢复默认/重启（自检） | `node …/r7-settings-restart.mjs --selfcheck` | 5 PASS / 0 FAIL：`none` 全绿；`memory-only`→红 AC-21-1/6、`no-restore`→红 AC-21-4/6、`wipe-custom`→红 AC-21-5、`restart-loses`→红 AC-21-6 |
| 接口一致性（本轮新建） | `node …/qa-r7-interface-consistency.mjs` | 7 PASS / 0 FAIL（I1 395 个相对 import 符号全存在；I2 client→host 0；B1 蓝图 API 50 个全在；R1 接口成员运行期可调用 + snapshot 四字段含暂停态；R2 五槽位字面量逐字一致；R3 四个 r7 动作不落「未知动作」；B2 内置 6 角色 prompt 非空互异） |
| 接口一致性自检 | `node …/qa-r7-interface-consistency.mjs --selfcheck` | 3 PASS / 0 FAIL（干净副本 exit 0；import 不存在的导出→红 I1；删 `SETTINGS_LIMITS` 的 export→红 B1） |
| 并发夹取（本轮新建） | `node …/qa-r7-concurrency-clamp.mjs` | 6 PASS / 1 FAIL，exit 1：K1 设置 6+宿主 3→3、K2 设置 2+宿主 3→2、**K3 夹取不可解释→红**（QA-R7-03 仍 OPEN） |
| AC-30 时序（本轮新建） | `node …/qa-r7-ac30-order.mjs` | 7 PASS / 0 FAIL（真 `dispatchReady` 驱动：plannedAt 1800000000000 < 首个 spawnedAt 1800000005000，差值 5000ms；读盘后仍成立） |

补充实跑：`pnpm -s typecheck` exit 0；`pnpm -s test` tests 425 / pass 425 / fail 0；`pnpm -s build` exit 0（`lib/index.js` 254830B、`lib/client.js` 165531B）；双 import `IMPORT_OK`；`npm pack --dry-run` 3 条目；`find src -newer lib/index.js | wc -l` = 0。

---

## 2. 缺陷复核对比（第 3 轮 → 本轮；严重级列名刻意写作「round-3 级」，本表**不是**本轮 OPEN 缺陷表）

| 编号 | round-3 级 | 功能模块 | 上轮实体 | 本轮复跑命令 | 本轮结果 | 状态 |
|---|---|---|---|---|---|---|
| QA-R7-01 | P1 | 角色仓库升级迁移 | 既有安装升级后 6 个内置角色 prompt 全空（真机 `roles:6 withPrompt:0`） | `node …/qa-r7-roles-prompt-migration.mjs` | 23 PASS / 0 FAIL：B-legacy 3 条全绿；C 组证明只补缺席键（用户改过的 name/duty/model 逐字保留）；D 组证明清空过的 prompt 不复活；E 组证明损坏文件不落标记且字节不动；F 组证明 `.seeded` 不被当角色；G 组证明二次 seed 逐字幂等 | 已修复 |
| QA-R7-02 | P3 | 提示文案 | `NOT_ENABLED` 写「输入框下方的开关」（该开关行已撤除） | `grep -c "输入框下方" src/host/bridge.ts`；`grep -rn "输入框下方" src \| wc -l` | 0；0（`src/host/tools.ts:27` 已改为「请在输入框内的『自动团队』选项处启用后再试」） | 已修复 |
| QA-R7-03 | P3 | 并发设置可见性 | 设置 6、面板显示 3，界面无任何解释 | `node …/qa-r7-concurrency-clamp.mjs` | 6 PASS / 1 FAIL：K3 红（快照只有 `limit/running/source`，client 无「宿主上限」类文案） | **仍 OPEN** |
| QA-R7-04 | P3 | AC-30 时序断言 | AC-30 无 `plannedAt < spawnedAt` 断言 | `grep -n "plannedAt < state.bindings\[0\].spawnedAt" test/store.test.ts`；`node …/qa-r7-ac30-order.mjs` | 命中 1 处（:83）+ :295 用 `restored.bindings`；新增运行期探针 7/7 全绿，覆盖真实 `dispatchReady` 路径 | 已修复（并补强为运行期断言） |

命中数对比：QA-R7-01 6/6 空 → 0/6 空；QA-R7-02 2 处文案 → 0；QA-R7-03 1 处 → 1（未修）；QA-R7-04 0 条断言 → 2 条单测 + 7 条运行期断言。**与修复摘要无冲突**（修复摘要未声称 QA-R7-03 已修，实测确认仍未修）。

---

## 3. 逐条 AC 判定（26 条）

| AC | 判定 | 证据（命令 / 断言） |
|---|---|---|
| AC-1 | 通过 | `grep -n "name: 'dsh-auto-team'" cordis.patch.yml` → :11 逐字包根名；`package.json` `dsh.bundle={"patch":"./cordis.patch.yml"}` |
| AC-2 | 通过 | 门禁 G8（client→host import 0）、F3（entry inject 4 项）；`ctx.get` 只在 `src/host/adapters.ts`；interface R1 用 fake deps 驱动真 bridge |
| AC-3 | 通过 | `node -e` 读 `package.json`：`dsh.client` 字段集合 = `{platform,inject,immediately}`；W2 产物模块 id=`dsh-auto-team`、W4 五座位各注册一次、P1 client 产物 5/5 新 hook |
| AC-4 | 通过 | `node --test test/client-contract.test.ts` 17/17；W4/W5（input.dock / header.actions / pane.tab / pane.tab.title / settings.section 的 name 与 key 逐字） |
| AC-5 | 通过 | W9 `sidebarRightTabs` 注册 `[{id:"dsh-auto-team-panel",kind:"dsh-auto-team-panel"}]`；W10 `openPanel()` 用同一 kind 打开 opened=true；HeaderButton CustomEvent 回退见 `src/client/HeaderButton.tsx:53` |
| AC-6 | 通过 | `node …/qa-r7-interface-consistency.mjs` R1 建 `createSettingsRepo({file})` 实测 path/read/save；`test/settings.test.ts` 往返与损坏回落全绿（落点 `globalDataRoot(os.homedir())+/settings.json` = `/Users/maliang/.dsh/auto-team/settings.json`） |
| AC-7 | 通过 | interface B2：内置 6 角色 prompt 非空、去重 6；migration C-4 落盘含 prompt；`test/member-prompt.test.ts` 9/9 断言 role.prompt 进提示词且排在「本次任务」之前 |
| AC-8 | 通过 | `test/roles.test.ts` 15/15（含「自建 id 写 builtin:true 不许换删除豁免」变异自检）；migration F-3/F-4 恢复默认只重写 6 个内置 |
| AC-9 | 通过 | `test/pause.test.ts` 8/8（端到端：暂停→重启→继续→派发→门禁→terminated，2/2 done）；`r7-pause-roundtrip --selfcheck` 5/5（`no-freeze`/`allow-dispatch`/`leak-progress`/`lose-attempts` 各自点名判据必红） |
| AC-10 | 通过 | 门禁 F1 路由 3、F2 kind 9、F3 inject 4、F4 PlanTask 零新增；interface R1 实测 snapshot 含 `paused/settings/skills` 且暂停态给 `pausedAt` 数字；R3 四个新动作都进 switch |
| AC-11 | 通过 | `grep -rn "export const MEMORY_INJECT_BUDGET\|…WATCHER_INTERVAL_MS\|…PANEL_ACTIVE_MS\|…STALL_MS" src` 各 1 处；G9 setInterval 仅 `src/host/team/watcher.ts:290`；空设置下 `defaultSettings()` 取 config 常量（test/settings.test.ts） |
| AC-12 | 通过 | G7 `composer.dock` 0 命中；W4 `input.dock` 1 处；`test/client-ui.test.ts` 胶囊四态 + busy 文案不变；`src/client/Toggle.tsx` 已删除（`git status` 显示 ` D`） |
| AC-13 | 通过 | W8 头按钮拿到 openPanel；W10 openPanel 真开页签；`HeaderButton.tsx:46-53` 两个分支（native / CustomEvent）都在 |
| AC-14 | 通过 | `test/client-ui.test.ts` taskRowView 四要素（title / 任务内容 / progressOf 10 态标签 / 角色与门禁证据）；Panel 页头「完成 x/N」+ `planStatusView` 中文 |
| AC-15 | 通过 | `test/client-ui.test.ts` 同一 paused 下 idle vs busy 逐字段相等（label/action/tone 只由 paused 决定，busy 只置 disabled）；`Panel.tsx:175` `data-auto-team-pause` |
| AC-16 | 通过 | `test/client-ui.test.ts` settingsKeysView 6 项（含取值范围字面量）；client-contract 断言 `data-setting-key` / `data-role-id`；`RoleEditor.tsx:58,193` 删除二次确认、恢复默认二次确认 |
| AC-17 | 通过 | `test/settings.test.ts:203,220` 非法提交被拒且 `readFileSync(file)` 与提交前逐字相等；合法保存改变文件内容（同文件另一用例） |
| AC-18 | 通过 | `src/client/api.ts` 仅 1 个 `request<T>` 包装（:57）、3 个请求站点（:87 snapshot / :90 act / :97 memory），`grep -rn "fetch(" src/client` 除 `doFetch` 外 0 命中，消费点统一 `result.data`/`result.error`（11 处） |
| AC-19 | **未验证（人工补测）** | mock DOM 自检 7 PASS/1 SKIP（AC-19-0 落地页五项=0 反证、AC-19-1..5 各 1）；真机活会话四件套需主 agent 起第二宿主执行 `node …/r7-live-panel.mjs --token <tok>` |
| AC-20 | **未验证（人工补测）** | mock 状态机自检 5/5；真机 60s 往返需 `node …/r7-pause-roundtrip.mjs --token <tok> --session <id> --wait 60` |
| AC-21 | **未验证（人工补测）** | 自检 5/5；真机改参+改坏 pm+恢复默认+重启存活需 `node …/r7-settings-restart.mjs --token <tok> --session <id>` 与 `--restarted` 二次执行 |
| AC-22 | 通过 | G1 typecheck exit 0；G2 tests 425（基线 337，只增不减）；G3 双产物新鲜；G5 pack 3 条目；`package.json` 无 `workspace:`；peer 覆盖 7 个 `@deepseek-ai/*` + react |
| AC-23 | 通过 | G11 git 46 项改动全部落在 `src/ test/ lib/ docs/teamflow/20261101-…/`（越界 0）；G9 setInterval 仍 1 处；r5 Inline&Spill 相关文件不在改动清单内 |
| AC-24 | **未验证（人工补测）** | 子代理权限固定在工作区，写不了 `~/.dsh/profiles/desktop`；安装/回滚 6 步见 PRD §9，由主 agent 执行 |
| AC-25 | 通过（本轮产出） | 本文件即 QA-REPORT；ACCEPTANCE.md 由验收阶段产出 |
| AC-30 | 通过 | `node …/qa-r7-ac30-order.mjs` 7/7：真 `dispatchReady` 下 plannedAt 早于首个 spawnedAt 5000ms，读盘后仍成立；计划条目含任务/角色/并发（`test/bridge.test.ts:184` 另断言 plannedAt 存在） |

---

## 4. 架构核对（P1 级「架构」模块）

| 检查 | 结果 |
|---|---|
| 蓝图 25 个模块全部按名字落地 | 通过：`src/shared/types.ts`、`host/{config,paths,settings,store,bridge,index}.ts`、`host/roles/{builtin,repo}.ts`、`host/team/{watcher,dispatch,member-prompt}.ts`、`client/{slots,ui,viewmodel,Option,HeaderButton,RoleEditor,SettingsPage,Panel,TabTitle,styles,index}`、`client/tabs/{PlanTab,RolesTab}` 全部存在，`src/client/Toggle.tsx` 已删除 |
| 蓝图 API 字段逐字一致 | 通过：interface B1 核对 50 个导出，缺失 0（含 `DEFAULT_SETTINGS/SETTINGS_LIMITS/ROLE_PROMPT_MAX`、`createSettingsRepo/validateSettings/defaultSettings`、`BUILTIN_SKILLS/BUILTIN_ROLES/builtinSkillBody/composeSkillPrompt`、五个 `*_SLOT` 常量） |
| 重复实现排查 | 通过：`progressOf` 两份**同名不同义**且互不 import（host 用 `src/host/plan/plan.ts`、client 用 `src/client/viewmodel.ts`，`src/host/bridge.ts:59` 与 `src/client/ui.ts:23` 各自指向本侧）；10 态中文标签在 `src/client` 的 `.tsx` 中 0 命中（只在 viewmodel.ts）；槽位字面量代码内只在 `src/client/slots.ts`（其余出现均为注释）；样式前缀单一族 `data-auto-team-*`（`grep -rn 'data-dsh-auto-team' src test` = 0） |
| 抽象是否该抽未抽 | 通过：设置校验+原子写单点（settings.ts）、角色恢复默认逐字来源（builtin.ts）、面板动作单 switch（bridge.ts）、唯一 setInterval（watcher.ts）均按蓝图收敛，未发现第二套存储/适配/校验 |
| 既有结构是否被破坏 | 通过：门禁 F1–F4 形态冻结（路由 3 / kind 9 / inject 4 / PlanTask 零新增）；`src/host/adapters.ts` 仍是宿主 API 唯一出口 |
| 跨模块调用一致性（0a） | 通过：interface I1 静态核对 395 个相对 import 符号全部真被目标模块导出（自检证明该判据能红）；R1 运行期实测 `settingsRepo.path/read/save`、`roleRepo` 六方法、`RunsStore` 四方法、`bridge.act/snapshot` 全部可调用；R3 实测四个 r7 动作不落「未知动作」分支 |

结论：**未发现架构级缺陷**（无 P1 架构项）。

---

## 5. 交付形态契约（11 条逐条探测）

| # | 契约 | 探测命令 | 结果 |
|---|---|---|---|
| 1 | 宿主 profile 加载入口声明、`name` 用包根名 | `grep -n "name:" cordis.patch.yml` | 通过（:11 `dsh-auto-team`） |
| 2 | client bundle 声明与被扫描 id、字段集合一致 | `node -e` 读 `dsh.client`；W2 | 通过（`{platform,inject,immediately}`；产物模块 id=`dsh-auto-team`） |
| 3 | UI 挂载点 `name` = slot 名本身 | W4/W5 + `test/client-contract.test.ts` 17/17 | 通过（五个座位 name 与 inject 参数逐字相同，插件标识只进 id/key） |
| 4 | 入口声明与产物进包白名单 | `node -e "require('./package.json').files"` | 通过（`["lib","cordis.patch.yml","README.md"]`） |
| 5 | 依赖协议无 `workspace:` | 同上（整包 JSON 扫描） | 通过（0 命中） |
| 6 | peer 覆盖宿主提供的包 | 同上 | 通过（7 个 `@deepseek-ai/*` + react，均有 `peerDependenciesMeta`） |
| 7 | 产物与源码同步 | G3 `find src -newer lib/index.js` | 通过（0） |
| 8 | 装载安全（顶层不抛错） | G4 双 import | 通过（`IMPORT_OK`，exit 0） |
| 9 | 能被 profile 真实装入并加载 | 需重启宿主 | **未验证 → 人工补测** |
| 10 | 安装带回滚 | PRD §9 已写反向步骤（`pnpm remove` + 摘 `dsh.profile.bundles`） | 文档齐，实跑归人工补测 |
| 11 | 安装由主 agent 执行 | 子代理权限被钉在工作区 | **未验证 → 人工补测** |

---

## 6. 提交面卫生（0c）

- `git status --porcelain -uall | wc -l` = 46，全部落在 `src/` `test/` `lib/` `docs/teamflow/20261101-r7-auto-team-panel-roles/`（另有 ` D src/client/Toggle.tsx` 的删除），**无依赖目录、构建缓存、IDE 文件、密钥噪声**。
- `.gitignore` 覆盖核对：`node_modules` → IGNORED、`logs/teamflow` → IGNORED、`.env` → IGNORED；`lib` 与 `docs/teamflow` → 未忽略（`lib/` 必须入库，符合产品约定）。
- 结论：通过。

---

## 7. 缺陷表（仅列复核后仍 OPEN 的缺陷）

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-R7-03 | P3 | 设置页/面板·并发可见性 | ① 设置页把「并发上限」设为 6 保存；② 打开右栏面板看页头「并发 x/y」 | 生效值仍受宿主上限约束时，界面要说明「被宿主上限压到 3」，或快照暴露请求值/夹取来源 | 页头只显示 `并发 0/3`，设置页提示仍写 `1–8`，用户无法得知设的 6 被静默夹取 | AC-16、AC-11 | `node logs/teamflow/tf-mvxo8o98-3vdnl3/scripts/qa-r7-concurrency-clamp.mjs` | `PASS [K3]`（快照含 `requested`/`ceiling` 类字段，或 client 出现「宿主上限」类用户可见文案），整体 exit 0 |
| QA-R7-05 | P3 | 注释一致性（已撤除的开关行） | 阅读 `src/client/state.ts:5`、`src/client/api.ts:102` 注释 | 注释不得再提已按 AC-12 撤除的「开关行」 | 两处注释仍写「开关行（`conversation.composer.dock`）」/「两个挂载面（开关行与面板）」 | AC-12 | `grep -rn "开关行\|composer.dock" src/client \| wc -l` | 0（当前 2） |

其余上轮缺陷（QA-R7-01/02/04 已修复）不在此表重复列出，逐条复跑证据见 §2。

---

## 8. craft 观察（P3，不阻断）

| 观察 | 具体元素 | 说明 |
|---|---|---|
| 空态/前置态提示 | 面板页头并发区 | 未派发时页头只有「并发 0/3」，没有「为什么是 0」的说明；与 QA-R7-03 同源，建议一并给文案 |
| 交互反馈 | 设置页「恢复默认角色」 | 已有二次确认（`RoleEditor.tsx:58`），但确认态没有「将重置 6 个内置角色、自建角色保留」的说明文案，用户只能凭猜 |
| 视觉一致性 | 输入框内胶囊 vs 会话头按钮 | 胶囊 28px / 头按钮 24px 按 DESIGN §0.2 落地，尺寸差是设计意图，非缺陷；真机需人眼确认命中区（44×40）在窄输入框内不溢出 |

---

## 9. 人工补测清单（环境限制，非交付缺陷）

| 项 | 方法 | 工具 | 环境限制 |
|---|---|---|---|
| AC-19 真机四件套渲染计数 | 起第二宿主（克隆 profile，端口 51890），活会话里采样 `[data-auto-team-option]` / `[data-auto-team-header-button]` / 页签 / `[data-auto-team-panel]` / `[data-auto-team-settings]` 各 1，落地页五项 0 作反证 | `node logs/teamflow/tf-mvxo8o98-3vdnl3/scripts/r7-live-panel.mjs --token <tok>` | 沙箱内 Chromium crashpad 无法启动（PROCESS_ALL_ACCESS 被拒），无法跑浏览器 |
| AC-20 真机暂停/继续 60s 往返 | 暂停后 60s 内成员数与活动流不增、done 任务三字段不变；继续后 planStatus 回 dispatching、未完成任务不再 paused | `node …/r7-pause-roundtrip.mjs --token <tok> --session <id> --wait 60` | 同上（需真宿主活会话） |
| AC-21 真机改参+改坏 pm+恢复默认+重启存活 | 改 settings 与 `roles/pm.json` → 读原文 → 恢复默认 → 与 `builtin.ts` 逐字相等且自建角色仍在 → 重启再读 | `node …/r7-settings-restart.mjs --token <tok> --session <id>`（重启后加 `--restarted --custom-id <上次打印值>`） | 同上 + 需重启宿主 |
| AC-24 desktop profile 安装与回滚 | 按 PRD §9 六步：写回滚基线 → build + 双 import → `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` → 登记 `dsh.profile.bundles` → 重启宿主 → 活会话四件套；失败立即 `pnpm remove dsh-auto-team` + 摘 bundles | 主 agent 手工 | 子代理权限被钉在工作区，写不了 `~/.dsh/profiles/desktop` |
| 视觉/命中区人眼确认 | 胶囊 44×40 命中区、页头 320px 下限、暂停按钮 80px 最小宽 | 真机截图 | 无浏览器 |

---

## 10. 结论

- **可进入验收**：第 3 轮唯一的 P1（QA-R7-01 升级迁移）已修复且判据可分辨（自检证明改回旧行为必红）；QA-R7-02/04 已修复，AC-30 另补运行期断言；既有 8 个 checker 全部重跑通过。
- 剩余 2 条 **P3 观察**（QA-R7-03 并发夹取不可解释、QA-R7-05 注释残留），均不阻断验收，建议与下次 UI 迭代一并处理。
- 架构核对与接口一致性均无缺陷（蓝图 25 模块 / 50 个 API / 395 个 import 符号逐字核对通过，判据自检可红）。
- 4 项真机验证（AC-19/20/21/24）受环境限制未执行，已在 §9 给出可照做的方法与工具，**不得视为已通过**。
