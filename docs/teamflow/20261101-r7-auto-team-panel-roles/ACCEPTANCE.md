# r7 验收报告（产品验收 · 最终判定）

- 需求夹：`docs/teamflow/20261101-r7-auto-team-panel-roles/`（PRD.md / DESIGN.md / TECHNICAL.md / QA-REPORT.md 齐备）
- 分支：`feat/auto-team-plugin` · HEAD `fa56717` · 工作树 **46 项未提交**（`M lib/index.js`、`M lib/client.js`、21 个 `src/` 改动、12 个 `test/` 改动、`D src/client/Toggle.tsx`、13 个新文件、本夹 3 份文档）
- 验收依据：PRD 的 26 条 AC（AC-1…AC-25 + AC-30）+ DESIGN §0.2 几何 + TECHNICAL 模块蓝图 25 个模块 + 交付形态契约 11 条
- 验收方式：本阶段**独立复跑**（不转抄 QA 结论），命令与输出见 §1；QA 的 9 个 checker 全部重跑
- 环境：macOS 本机，Node v26.11.1，`dsh` 不在 PATH；子代理权限固定在工作区（写不了 `~/.dsh/profiles/desktop`），真机安装按 AGENTS.md 只许主 agent 执行

---

## 1. 本阶段独立实测（我本人跑的，非转抄 QA）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `pnpm -s typecheck` | exit 0，0 errors |
| 2 | `pnpm -s test` | **tests 425 / pass 425 / fail 0**（3.6s；PRD 基线 337，只增不减 ✓） |
| 3 | `pnpm -s build` | exit 0；`lib/index.js` 254830 B + `lib/client.js` 165531 B（02:05 刷新） |
| 4 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | `IMPORT_OK`，exit 0（装载安全，无顶层抛错） |
| 5 | `find src -newer lib/index.js \| wc -l` | `0`（源码不新于产物） |
| 6 | `npm pack --dry-run` | 3 个交付条目：`cordis.patch.yml` 646B / `lib/client.js` 165.5kB / `lib/index.js` 254.8kB（total files 5） |
| 7 | `node logs/…/scripts/r7-delivery-gates.mjs` | **ALL GATES PASS — 17/17**（G1–G11 + F1–F4 + P1–P2） |
| 8 | `node …/r7-client-bundle-wiring.mjs` | **10 PASS / 0 FAIL**（W1–W10，产物级接线：五座位各注册一次、keyed 同 key、`sidebarRightTabs` 注册 `[{id,kind}=dsh-auto-team-panel]`、`openPanel()` opened=true） |
| 9 | `node …/qa-r7-roles-prompt-migration.mjs` | 23 PASS / 0 FAIL（A–G 七组：legacy 补 prompt、只补缺席键、清空不复活、损坏不落标记、`.seeded` 不当角色、二次 seed 幂等） |
| 10 | `node …/qa-r7-interface-consistency.mjs` | 7 PASS / 0 FAIL（395 个相对 import 符号全存在；client→host 0；蓝图 API 50 个全在；snapshot 四字段含暂停态；五槽位字面量逐字；四个 r7 动作都进 switch） |
| 11 | `node …/qa-r7-ac30-order.mjs` | 7 PASS / 0 FAIL（真 `dispatchReady` 下 `plannedAt` 早于首个 `spawnedAt` 5000ms，读盘后仍成立） |
| 12 | `node …/qa-r7-concurrency-clamp.mjs` | **6 PASS / 1 FAIL**：`K3 夹取可解释` 红（QA-R7-03 未修，见 §6-R2） |
| 13 | `node …/r7-live-panel.mjs --selfcheck` | 7 PASS / 0 FAIL / 1 SKIP（`AC-19-6` 在 `file://` 下无 fetch，属预期） |
| 14 | `node …/r7-pause-roundtrip.mjs --selfcheck` | 5/5 场景：`none` 全绿，`no-freeze`/`allow-dispatch`/`leak-progress`/`lose-attempts` 各自点名判据必红 |
| 15 | `node …/r7-settings-restart.mjs --selfcheck` | 5/5 场景：`none` 全绿，`memory-only`/`no-restore`/`wipe-custom`/`restart-loses` 各自点名判据必红 |
| 16 | `grep -rn "setInterval(" src` | **1 处**：`src/host/team/watcher.ts:290`（形态冻结成立） |
| 17 | `grep -rn "data-dsh-auto-team" src test` | 0（样式前缀单一族 `data-auto-team-*`） |
| 18 | `grep -rn "composer\.dock" src test` | 5 处命中**全为注释/文档/一条「撤销了它」的断言**（`test/client-contract.test.ts:176`），`src/client/slots.ts` 中 **0 处注册** → AC-12 成立 |
| 19 | `grep -rn "sidebarRightTabs" src` | `src/client/slots.ts:233` `ctx.inject(['sidebarRightTabs'], …)` → `tabs.register({id,kind,…})`（r6 的「页签永不出现」根因已修在产物里） |
| 20 | `grep -n "_SLOT" src/client/slots.ts` | 五槽位字面量 `:39/:42/:45/:48/:51`，注册 `:178–:214` 的 `name` 直接复用同一常量（不可能漂移） |
| 21 | `python3 -c` 读 package.json | `dsh.bundle={'patch':'./cordis.patch.yml'}`；`dsh.client` 字段集 **{platform,inject,immediately}**；`files=['lib','cordis.patch.yml','README.md']`；peer 8 项（7 个 `@deepseek-ai/*` + react）；`workspace:` 0 处 |
| 22 | `grep -n "name:" cordis.patch.yml` | `:11 name: 'dsh-auto-team'`（包根名，非子路径） |
| 23 | `grep -n "const inject" src/host/index.ts src/client/index.ts` | host `['tools','systemPrompt','agents','agentTeams']`（4 项）；client `['slots']` |
| 24 | 四个冻结常量 | `MEMORY_INJECT_BUDGET=4000`（config.ts:31）、`WATCHER_INTERVAL_MS=1500`（:52）、`STALL_MS=90_000`（:62）、`PANEL_ACTIVE_MS=2_000`（shared/const.ts:26）**各 1 处** |
| 25 | `grep -rn "settings.json\|auto-team" src/host/paths.ts` | `:34 return \`${globalDataRoot(home)}/settings.json\`` → `~/.dsh/auto-team/settings.json`（无第二层 `.dsh`） |
| 26 | client hook 落点 | `data-auto-team-option`（Option.tsx）/`header-button`（HeaderButton.tsx）/`panel`（Panel.tsx）/`pause`（Panel.tsx:175 + ui.ts:101,118）/`settings`（SettingsPage.tsx）全部存在 |
| 27 | AC-18 解构纪律 | `src/client` 中 `fetch(` 除 `doFetch` 外 **0**；`{data,error}`/`result.data`/`result.error` 消费点 **11** 处 |
| 28 | AC-16 六项设置 | `NUMBER_KEYS = [concurrencyLimit, memoryBudget, stallMs, maxAttempts, gateTimeoutMs]` + `captainModel` = 6 项，`LIMITS` 带 `1–8` 等边界；`data-setting-key` 行渲染 |

---

## 2. 逐条 AC 判定（26 条）

| AC | 判定 | 依据（本阶段证据） |
|---|---|---|
| AC-1 | ✅ 通过 | `cordis.patch.yml:11 name: 'dsh-auto-team'`；`dsh.bundle.patch=./cordis.patch.yml`（§1-#22/#21） |
| AC-2 | ✅ 通过 | gate G8：`src/client` 中 `from '../host/'` 0 处；interface R1 用 fake deps 驱动真 bridge；`ctx.get` 收敛在 `adapters.ts` |
| AC-3 | ✅ 通过 | `dsh.client` 字段集 `{platform,inject,immediately}`；W2 产物模块 id=`dsh-auto-team`；P1 产物含 5/5 新 hook |
| AC-4 | ✅ 通过 | W4 五座位各注册一次；W5 keyed 两处同 key=`dsh-auto-team-panel`、非 keyed 带 `id/order` 无 `key`；字面量与 `inject()` 参数同源常量（slots.ts:178–214） |
| AC-5 | ✅ 通过 | W9 `sidebarRightTabs` 注册 `[{id:"dsh-auto-team-panel",kind:"dsh-auto-team-panel"}]`；W10 `openPanel()` opened=true；HeaderButton CustomEvent 回退分支在 `src/client/HeaderButton.tsx` |
| AC-6 | ✅ 通过 | paths.ts:34 派生 `~/.dsh/auto-team/settings.json`；settings 往返/损坏回落/非法拒绝由 `test/settings.test.ts` 覆盖（425 全量内）；AC-21 的「重启读回」属真机（§6-R1） |
| AC-7 | ✅ 通过 | interface B2：内置 6 角色 prompt 非空互异；`test/member-prompt.test.ts` 断言 `role.prompt` 真的进成员提示词且排在「本次任务」前 |
| AC-8 | ✅ 通过 | `test/roles.test.ts` 15/15（含「自建 id 写 `builtin:true` 不许换删除豁免」变异）；migration F-3/F-4 只重写内置 6 个、自建 kept |
| AC-9 | ✅ 通过 | `test/pause.test.ts` 8/8 端到端（暂停→重启→继续→派发→门禁→terminated）；`r7-pause-roundtrip --selfcheck` 5/5（假暂停/闸门失效/定时器没停/丢 attempts 各自必红） |
| AC-10 | ✅ 通过 | gate F1 路由 3 / F2 kind 9 / F3 inject 4 / F4 PlanTask 零新增；interface R1 snapshot 含 `paused/settings/skills` 且暂停态给 `pausedAt`；R3 四个新动作都进 `bridge.act` switch |
| AC-11 | ✅ 通过 | 四个常量各 1 处；setInterval 仍 1 处（watcher.ts:290）；空设置取 `defaultSettings()`（= config 常量） |
| AC-12 | ✅ 通过 | `composer.dock` 在 slots.ts 0 处注册（5 处命中均为注释/断言）；`Toggle.tsx` 已删除（`git status` 显示 `D`）；`data-auto-team-option` 在 Option.tsx |
| AC-13 | ✅ 通过 | W8 头按钮拿到 `openPanel`；W10 真开页签；两个分支（native / CustomEvent）都在 |
| AC-14 | ✅ 通过 | `test/client-ui.test.ts` taskRowView 四要素（title / 任务内容 / `progressOf` 10 态中文 / 角色+门禁证据）；Panel 页头「完成 x/N」+ 计划状态中文 |
| AC-15 | ✅ 通过 | `test/client-ui.test.ts` 同一 paused 下 idle vs busy 逐字段相等（文案只由 paused 决定，busy 只置 disabled）；`Panel.tsx:175 data-auto-team-pause` |
| AC-16 | ✅ 通过 | §1-#28：6 项（5 数字 + captainModel）带取值范围；`data-setting-key` / `data-role-id` 渲染；删除与恢复默认均二次确认（RoleEditor.tsx） |
| AC-17 | ✅ 通过 | `test/settings.test.ts` 非法提交被拒且 `readFileSync` 与提交前逐字相等；合法保存必然改内容 |
| AC-18 | ✅ 通过 | §1-#27：`fetch(` 除 `doFetch` 外 0，解构消费 11 处，断言写成「请求数==解构数」不锁死数字 |
| AC-19 | ⚠️ **未验证** | 自检 7 PASS（落地页五项=0 反证 + 活会话四件套各 1）；**真机活会话采样本阶段无法执行**（子代理权限固定在工作区、AGENTS.md 规定真机只许主 agent）→ 不默认通过，见 §6-R1 |
| AC-20 | ⚠️ **未验证** | 状态机级自检 5/5；真机 60s 往返需主 agent 跑 `r7-pause-roundtrip.mjs --token <tok> --session <id> --wait 60` |
| AC-21 | ⚠️ **未验证** | 磁盘自检 5/5（改参/改坏 pm/恢复默认/自建 ssha 不变/重启存活）；真机需主 agent 跑 `r7-settings-restart.mjs` 与 `--restarted` 二次执行 |
| AC-22 | ✅ 通过 | typecheck 0、425 tests（≥337）、双产物新鲜 0/0、双 import exit 0、pack 3 条目、0 处 `workspace:`、peer 覆盖 7 包 + react |
| AC-23 | ✅ 通过 | gate G11：46 项改动全部落在 `src/ test/ lib/ docs/teamflow/20261101-…/`，越界 0；setInterval 仍 1 处；r5 Inline&Spill 与三条 P3 文件不在改动清单 |
| AC-24 | ⚠️ **未验证** | 安装/回滚 6 步写在 PRD §9；子代理写不了 `~/.dsh/profiles/desktop`，须主 agent 执行（先写回滚基线，失败立即 `pnpm remove` + 摘 `dsh.profile.bundles`） |
| AC-25 | ✅ 通过 | QA-REPORT.md 已产出（26 条判定表贴实跑输出）；本文件即 ACCEPTANCE.md |
| AC-30 | ✅ 通过 | §1-#11：真 `dispatchReady` 下 `plannedAt`(1800000000000) < 首个 `spawnedAt`(1800000005000)，读盘后仍成立；计划条目含任务/角色/并发三要素 |

**统计**：✅ 通过 22 条 · ⚠️ 未验证 4 条（AC-19/20/21/24，均为「只能主 agent 在真机执行」）· ❌ 失败 0 条。

---

## 3. 架构一致性核对（M3 质量门）

| 检查 | 结论 |
|---|---|
| 蓝图 25 个模块是否按名落地 | ✅ 全部存在（`shared/types.ts`、`host/{config,paths,settings,store,bridge,index}`、`host/roles/{builtin,repo}`、`host/team/{watcher,dispatch,member-prompt}`、`client/{slots,ui,viewmodel,Option,HeaderButton,RoleEditor,SettingsPage,Panel,TabTitle,styles,index}`、`client/tabs/{PlanTab,RolesTab}`），`Toggle.tsx` 已删除=由 `Option.tsx` 取代 |
| 蓝图 API 逐字一致 | ✅ interface B1/B2 核对 50 个导出缺失 0（`DEFAULT_SETTINGS/SETTINGS_LIMITS/ROLE_PROMPT_MAX`、三个 settings 函数、四个 builtin 函数、五个 `*_SLOT`） |
| 重复实现 / 适配漂移 | ✅ 无。`progressOf` 两份同名不同义且互不 import（host `plan/plan.ts` 数值口径 / client `viewmodel.ts` 展示口径）；10 态中文标签只在 client 的 viewmodel.ts；槽位字面量只在 `slots.ts`；设置校验+原子写单点（settings.ts）；面板动作单 switch（bridge.ts）；唯一 setInterval（watcher.ts） |
| 既有结构是否被破坏 | ✅ 未破坏：路由 3 / kind 9 / inject 4 / PlanTask 零新增（F1–F4）；`adapters.ts` 仍是宿主 API 唯一出口 |
| 装配顺序与生效点 | ✅ `index.ts` 5 个设置生效点 + `onSettingsSaved` 重装队长路由均有接线（T2 交付 + 接口一致性 R1 运行期实测） |

**结论：无架构级偏离，无需架构返工。**

---

## 4. 交付形态契约（11 条）

| # | 契约 | 结论 |
|---|---|---|
| 1 | profile 加载入口声明 + `name` 用包根名 | ✅ `cordis.patch.yml:11` |
| 2 | client bundle 声明与字段集合一致、产物非空含包 id | ✅ W2/W3 |
| 3 | UI 挂载点 `name` = slot 名本身 | ✅ W4/W5 + `test/client-contract.test.ts` |
| 4 | 入口声明与产物进包白名单 | ✅ `files=['lib','cordis.patch.yml','README.md']`，pack 3 条目 |
| 5 | 依赖协议可解析（无 `workspace:`） | ✅ 0 处 |
| 6 | 宿主运行期依赖按 peer 声明 | ✅ 7 个 `@deepseek-ai/*` + react |
| 7 | 产物与源码同步 | ✅ `find src -newer lib/index.js` = 0；P1/P2 产物含新 hook/新动作 |
| 8 | 装载安全（顶层不抛错） | ✅ 双 import `IMPORT_OK` exit 0 |
| 9 | 能被 profile 真机装入并加载 | ⚠️ **未验证（只能主 agent）** |
| 10 | 安装带回滚 | ⚠️ 步骤已写（PRD §9），**未演练** |
| 11 | 安装由主 agent 执行 | ⚠️ 已如实交接，未执行 |

---

## 5. 人眼/真机补测清单（转主 agent，不得默认通过）

1. **安装（AC-24，先写回滚基线）**：`cd ~/.dsh/profiles/desktop && pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team` → 登记 `dsh.profile.bundles` → 重启宿主 → 失败即 `pnpm remove dsh-auto-team` 并摘 bundles。
2. **AC-19 母判据**：活会话里 `[data-auto-team-option]=1`、`[data-auto-team-header-button]=1`、页签=1、`[data-auto-team-panel]=1`、`[data-auto-team-settings]=1`；落地页四项=0 作反证 → `node …/r7-live-panel.mjs --token <tok>`。
3. **AC-20 暂停往返**：60s 内成员数/活动流不增、`done` 任务三字段不变、继续后 `planStatus` 回 `dispatching` → `node …/r7-pause-roundtrip.mjs --token <tok> --session <id> --wait 60`。
4. **AC-21 改参/恢复默认/重启**：改 6 项参数 + 改坏 `pm` 的 duty/prompt → 恢复默认 → 与 `builtin.ts` 逐字相等且自建角色 sha256 不变 → 重启后存活 → `node …/r7-settings-restart.mjs --token <tok> --session <id>` 与 `--restarted`。
5. **人眼项**：右栏面板在 320px 下限的文字不裁切、胶囊在输入框内不挤压输入区、页头「完成 x/N」与暂停按钮的位置关系。

---

## 6. 验收条件（Rework / 条件清单）

- **R2（必做，P3 缺陷）**：QA-R7-03 仍未修 —— 设置「并发上限 6」而宿主硬上限 3 时，快照只有 `limit/running/source`，界面无任何说明，用户看到「设了 6 却按 3 跑」。判据 `qa-r7-concurrency-clamp.mjs K3` 本阶段复跑仍红（6 PASS/1 FAIL）。最小修法：设置页并发项旁渲染「生效上限 3（宿主硬约束）」或快照补 `hostLimit` 并在面板提示；修完 K3 必须转绿且变异自检仍可分辨。
- **R3（必做，交付卫生）**：T6「单笔提交」未完成 —— 46 项改动（含 `lib/` 双产物）仍在工作树。需入库一笔，提交后重跑 typecheck / test / build / 双 import / pack 与 17 条门禁，再把「提交后产物未陈旧」写回交付记录。
- **R1（条件性，不可在流水线内完成）**：AC-19/20/21/24 四条真机 AC 由主 agent 按 §5 执行；只有四条全绿且贴出原始输出，本需求才转为 ✅ 通过；任一红立即按回滚基线卸载并把输出写进本夹。

---

## 7. 遗留（不阻塞本次判定，建议排期）

- 并发夹取属「宿主硬约束 > 用户设置」的合理设计，缺的只是**可见性**，不需要改语义（R2 只补文案/字段）。
- `settings.json` 与既有 `<dataRoot>/captain.json` 的双源迁移回落目前只读，未做一次性迁移工具（TECHNICAL 已声明为迁移期只读回落，可接受）。
- 46 项改动里 `test/dispatch.test.ts` 的 `restoreDefaults` 桩补齐、`test/store.test.ts` 版本号改符号引用属「接口扩展/升版的固定成本」，已由 dev 主动申报，不计越界。

---

**验收结论：⚠️ 有条件通过** —— 22/26 条 AC 通过、0 条失败、4 条（AC-19/20/21/24）因「只能主 agent 真机执行」记未验证；架构与交付形态无偏离；须完成 R1（真机四件套）+ R2（并发夹取可见性）+ R3（单笔提交）后方可转 ✅。

验收结论：⚠️ 有条件通过
