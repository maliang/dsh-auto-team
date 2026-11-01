# r10 QA-REPORT · 自动团队技能层与工具条改造

- 任务夹：`docs/teamflow/20261102-r10-autoteam-skills-toolbar/`
- 分支：`feat/auto-team-plugin`（HEAD `9cfa53c`，工作树 46 项未提交改动 = 本次交付）
- 测试形态：单包双产物 cordis 插件（宿主 `lib/index.js` + client `lib/client.js`），无独立进程可启动 → 以「构建产物挂假 ctx 跑 HTTP 全链路」作为主路径可执行验证
- 结论：**可进入验收（acceptance-ready）**。P0/P1/P2 缺陷 0 条；P3 观察 6 条（其中 1 条为 PRD AC-2 的字面 grep 判据失败，AST 语义通过，建议验收前顺手清掉）。

## 1. 范围与环境

| 项 | 值 |
|---|---|
| 需求 | 开关钮迁到输入框工具条、失败零红字、面板头部三段、会话头按钮可开可收、模型改弹层选择器、内置角色 6→11、技能四来源（导入/系统/手写/内置可改） |
| 验收项 | PRD 30 条（P0 25 / P1 5），基线 `20261101-r7-auto-team-panel-roles` |
| 被测代码 | `src/` 24 个文件改动 + 5 个新增模块（`host/roles/skills-repo.ts`、`host/roles/system-skills.ts`、`host/model-catalog.ts`、`client/ModelPicker.tsx`、`client/SkillDialogs.tsx`） |
| 运行环境 | macOS，Node v26.11.1，pnpm 工作区；无浏览器（沙箱限制，见 §5） |
| 真机环境 | 第二宿主（克隆 profile + 端口 51890）**本轮不可用** → AC-12~15、AC-16 真机部分、AC-28、AC-29 记「未验证」，列入 §5 人工补测清单 |

## 2. 验证方法与证据

### 2.1 交付门禁（AC-27）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | exit 0 |
| `pnpm -s test` | exit 0，**482 / 482 pass，0 fail，0 skipped**（≥426 达标） |
| `pnpm -s build` | exit 0，`lib/index.js` 302.77 kB、`lib/client.js` 241.8 kB |
| `node --input-type=module -e "await import('./lib/index.js')"` | exit 0（IMPORT_OK） |
| `node --input-type=module -e "await import('./lib/client.js')"` | exit 0（IMPORT_OK） |
| `npm pack --dry-run \| grep -E 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | 3 件齐（646B / 241.8kB / 302.8kB） |
| `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 0（产物与源码同步） |
| `grep -rn "from '\.\./host/" src/client \| wc -l` | 0 |
| `grep -rn 'workspace:' package.json \| wc -l` | 0 |

### 2.2 形状冻结（AC-25）

| 不变量 | 实测 |
|---|---|
| `PanelAction` 成员 | 15 |
| `ActivityEvent.kind` 成员 | 9 |
| `src/host/http.ts` 内部路由 | 3 |
| `setInterval(` 全 `src` | 1（`team/watcher.ts`） |
| 四个冻结常量 | `MEMORY_INJECT_BUDGET=4000`、`WATCHER_INTERVAL_MS=1500`、`STALL_MS=90_000`、`PANEL_ACTIVE_MS=2_000` 各 1 |

本轮形状扩张集中在 `src/shared/types.ts`（`SkillSource`/`SkillDraft`/`SkillMutation`/`ModelOption`/`ModelCatalogView`/`SystemSkillInfo`，`SkillInfo` 加 `source`+`modified`，`PanelSnapshot` 加 `modelCatalog`/`systemSkills`，`saveRole` 载荷加 `skills`），未新增动作 / 路由 / 定时器，符合 AC-25「扩张集中登记」。

### 2.3 可执行主路径验证（0a2，非存在性检查）

`logs/teamflow/tf-mvy8htii-w566bd/scripts/r10-qa-e2e.mjs`——**用构建产物 `lib/index.js` 的 `apply()` 起假 ctx（webServer/tools/systemPrompt/agents/agentTeams/llm），经 `buildHttpRoutes` 的 3 条路由真实驱动全链路**，40 条断言 **40 PASS / 0 FAIL**：

1. `apply` 装配：7 个工具、1 条 prefix 路由、1 个提示词段、0 条 warn；
2. `GET /snapshot`：12 条内置技能全部 `source='builtin'`、`modified=false`、投影**不含正文**、技能投影 **1961 B < 8 KB**、系统技能扫描到 `~/.agents/skills` 下的条目；
3. `act{toggle}` 启用后，`act{saveRole, skills:[…]}` 走三入口落盘（`manual` 直接写、`imported` 保留 frontmatter、`system` 的 body 为空时按 `systemName` 现读磁盘正文）；
4. 同标题再建 → 得到不同 id（`qa-4` vs `qa`）且原件正文未被覆盖（AC-19 撞名不静默覆盖）；
5. 改内置技能正文 → `modified=true`，落盘 `<HOME>/.dsh/auto-team/skills/<id>.md`（**仓库外**，AC-20）；
6. 角色勾选 `skillIds` → `GET /memory?track=skill` 取回正文；
7. 用同一 deps **重建实例模拟重启** → `modified` 仍 true、正文仍是用户版本、技能条数 16→16（seed 不重复铺底）、用户三源技能全部读回（AC-18/AC-20/AC-29 的宿主侧）；
8. 删内置技能 → 被拒「内置技能不可删除：只能『恢复出厂』（prd-writing）」；删被引用技能 → notice「已删除『QA 手写技能』，并从 1 个角色摘除引用」且角色 `skillIds` 同步摘除；删不存在 id → 「技能不存在：「no-such-skill」」（AC-23）；
9. `act{restoreDefaultRoles}` → 内置正文回出厂、`modified=false`、11 内置角色 + 1 自建、用户三源正文逐字节不变、三条 notice（AC-22）；
10. 未启用会话发 `saveRole` → 拒绝码 `NOT_ENABLED`。

### 2.4 静态 / 纯函数验证（0a 接口一致性）

`logs/teamflow/tf-mvy8htii-w566bd/scripts/r10-qa-static.mjs`，94 条断言 **94 PASS / 0 FAIL**。关键项：

- 用假 slots 驱动**真 `registerSlots`**，收集 5 个座位的注册参数：字段 ⊆ `{name,id,order,label,key,inject}`；keyed 的 `pane.tab` 与 `.title` 各 1 处且 `key` 同值 `dsh-auto-team-panel`；非 keyed 座位不带 `key`；`conversation.input.left` 命中、`conversation.input.dock` 0 处（AC-1/AC-2/AC-8）；
- `data-panel-head` 直系子节点 = 3、`data-panel-meta` 三组 `data-meta=`、`data-panel-progress-row` 独立、meta 样式无 `display:none`（AC-9/AC-10）；
- `createPanelCommands` 三分支：`open()` 调 `openTab` 返回 true、`close()` 走 `tab.actions.close()`、服务缺失时返回 false 且不抛（AC-11）；
- `optionView` 失败态：可见文本逐字「自动团队」不变、琥珀点 + 「操作失败：…」、`aria-label`/`title` 同因（AC-5/6/7）；`headerButtonView` 三分支 aria 与 `opened` 非乐观（AC-11）；`skillRowView`/`skillSourceLabel`/`restoreConfirmView`/`modelPickerLabel` 纯函数契约（AC-16/17/22/23）；
- 内置数据：11 角色 `name`/`duty`/`prompt` 两两互异、`skillIds` 1–2 且无悬空；12 技能 `id`/`title`/`description` 互异、覆盖前端/后端/UI-UX/运维/安全五类（AC-17/AC-21）；
- 蓝图 API 面：21 个文件的接口符号逐个存在（AC-25 + 架构核查）；
- `src/client` 对 `src/host` 零 import；宿主服务访问只出现在 `adapters.ts`/`index.ts`。

### 2.5 变异自检（判据可分辨，AC-6/9/10/20/22/23 要求「必红」）

| 变异 | 期望红 | 实测 |
|---|---|---|
| `Panel.tsx` 头部加第 4 个直系子节点 | AC-9a | **FAIL [AC-9a] 直系子节点 = 4** ✅ |
| `ui.ts` 失败态 `ariaLabel` 不回填 failure | AC-6d | **FAIL [AC-6d]** ✅ |
| `skills-repo.seed()` 改成无条件覆盖（M4）+ `bridge` 不摘引用（M3）→ 重建 | E-9a/E-9b/E-10b/E-10c | **4 条 FAIL** ✅ |
| `bridge.restoreDefaultRoles` 不调 `restoreBuiltins()`（M5）→ 重建 | E-11a/E-11b | **2 条 FAIL** ✅ |

全部变异已还原（`cmp` 校验一致，`grep -rn MUTATION src test` = 0），还原后重建、`typecheck` exit 0、`pnpm -s test` 482/482、E2E 40/40 复绿。

> 注意：E2E 打的是 `lib/` 产物，**改 `src` 不重建不生效**，变异必须 `pnpm -s build` 后再跑（本轮 M3/M4 第一次没重建，假绿，已修正）。

### 2.6 r5/r7 既有 checker 回归（AC-26）

从 `$DSH_HOME` 归档目录取回 r7 的 4 个 checker 到本 run `scripts/`（前缀 `legacy-r7-`）复跑：

| checker | 结果 | 说明 |
|---|---|---|
| `qa-r7-ac30-order.mjs` | 7 / 7 PASS | 计划条目三要素与时序断言全绿 |
| `qa-r7-roles-prompt-migration.mjs` | 23 / 23 PASS | 既有安装升级后 prompt 迁移不回归 |
| `qa-r7-interface-consistency.mjs` | 4 PASS / 3 FAIL | 三条均为**断言了被 r10 有意取代的旧契约**：B1/R2 要求 `INPUT_DOCK_SLOT = 'conversation.input.dock'`（AC-1 明确改名）、B2 硬编码 `BUILTIN_ROLES.length === 6`（r10 为 11） |
| `r7-delivery-gates.mjs` | 16 / 17 | 唯一红 G11 把 r10 任务夹文档 + `memory.md` + r8/r9 遗留判成「越界」（白名单写死 r7 任务夹路径） |

结论：**无行为回归**；4 条红全部是 checker 里写死的旧常量/旧路径，属「冻结快照过期」，已记 P3-04。

### 2.7 提交面卫生（0c）

- `.gitignore` 覆盖 `logs/teamflow/`、`node_modules/`、`dist/`、`coverage/`、`.auto-team/`、`*.tgz`、`.vscode/`、`.idea/`、`.env*`，并**明确保留 `lib/`**（`lib/index.js`、`lib/client.js` 已 tracked，是 `pnpm add file:` 的安装源）；
- `git status --porcelain -uall` = 46 项，噪声正则（`node_modules|.pnpm|dist/|__pycache__|.idea|.env|.DS_Store|.log|.out`）命中 **0**；
- `git check-ignore -v logs/teamflow/tf-mvy8htii-w566bd/scripts/r10-qa-e2e.mjs` 命中 `.gitignore:2`（探针不会进交付提交）。

### 2.8 架构核查

| 检查 | 结论 |
|---|---|
| 蓝图模块是否抽出 | 5 个新增模块与蓝图一致，均为「单一职责 + 依赖注入」：`skills-repo`（md 仓储，可 mkdtemp 单测）、`system-skills`（只读扫描）、`model-catalog`（可注入 `read`/`now`/`ttlMs` 的 SWR 缓存，8 例单测覆盖 TTL 与降级）、`ModelPicker`、`SkillDialogs` |
| 装配与依赖方向 | `shared` ← `host`/`client`；`client` 对 `host` 零 import；宿主服务访问只在 `adapters.ts`/`index.ts`；本轮新增的 `readModelCatalog` 把 llm 服务形状变化收敛在一处（异常一律降级成 `{groups:[],reason}`，不抛） |
| 是否重复实现 | 未发现第二套存储/适配/错误处理：技能写入复用既有 `saveRole` 载荷、正文读取复用既有 `memory` 路由（`track=skill`，路由数仍 3）、模型清单走一份缓存；`ui.ts` 仍是 tone/文案的唯一映射源（无第三套） |
| 明显被破坏的既有结构 | 无。`ROLES_SCHEMA_VERSION` 2→3 用于 backfill 新增 5 个内置角色，`roles/repo.ts` 只保留角色 JSON、技能 seed 移出到 `skills-repo`（职责更清晰） |
| 命名偏差 | `SettingsPage.tsx` 导出 `SettingsSection`，蓝图写作 `AutoTeamSettingsSection` → P3-03 |

## 3. 用例与结果

判定：PASS = 有可执行证据；未验证 = 环境限制（见 §5），不计失败。

| AC | 判据摘要 | 结果 | 证据（命令 / 探针编号） |
|---|---|---|---|
| AC-1 | 槽位迁 `conversation.input.left`，旧名全 0 | PASS | `r10-qa-static` AC-1a/1b；`grep -rn "conversation.input.dock" src \| wc -l` = 0 |
| AC-2 | 注册字段合法、禁用槽位 0 处 | **部分**：注册面 PASS；字面 grep 红 3 行（注释）→ P3-01 | `r10-qa-static` AC-2a/2b（AST/注册面）；`grep -rn "conversation\.composer\.\(bar\|dock\)\|conversation\.input\.activity\|shell\.leading" src \| wc -l` = **3** |
| AC-3 | 短标签逐字「自动团队」+ 紧凑形态 | PASS | `r10-qa-static` AC-3a（label 逐字）/AC-3b（nowrap/ellipsis/max-width/min-width:0/flex/align-self）/AC-3c（无 `font-size: var(--dsw-font`） |
| AC-4 | 点一次只发一次 `toggle`、不隐式派发 | PASS | `src/client/Option.tsx:95` 唯一 `onClick`、`:67` 唯一 `view.act({type:'toggle', enabled:!enabled})`；`grep -c "view.act(" Option.tsx` = 1、`grep -c dispatch` = 0 |
| AC-5 | 零红字 + 1 个非红状态点 | PASS | `r10-qa-static` AC-5a/5b/5c；`grep -rn data-option-error src \| wc -l` = 0 |
| AC-6 | 失败可分辨 + 变异必红 | PASS | `r10-qa-static` AC-6a~6d；变异 M2 必红 ✅ |
| AC-7 | 失败不乐观、busy 期 `aria-busy` | PASS | `r10-qa-static` AC-7a/7b；`Option.tsx:92` `aria-busy` |
| AC-8 | 两处既有入口不回归 | PASS | `r10-qa-static` AC-8a/8b（header 1 处、pane.tab 与 .title 各 1 处且 key 同值） |
| AC-9 | 头部三段 + meta 三组 + 进度行 | PASS | `r10-qa-static` AC-9a~9e；变异 M1 必红 ✅ |
| AC-10 | 放回旧平铺必红、不靠隐藏 | PASS | 变异 M1（4 子节点→红）+ meta 样式无 `display:none`（AC-10b） |
| AC-11 | 头部按钮三分支、非乐观 | PASS | `r10-qa-static` AC-11a/11b/11c（open 调 openTab / close 走 `tab.actions.close()` / 服务缺失 false 不抛） |
| AC-12 | 真机·工具条存在性 | **未验证** | 无浏览器，见 §5-1 |
| AC-13 | 真机·连点三态 | **未验证** | 见 §5-2 |
| AC-14 | 真机·1280/900 不撑破 | **未验证** | 见 §5-2 |
| AC-15 | 真机·失败分工 | **未验证** | 见 §5-2 |
| AC-16 | 模型弹层 `data-role-model-picker`、裸输入框 0 | PASS（结构）/ 未验证（真机点击） | `grep -rn 'data-role-model-provider\|data-role-model-name' src \| wc -l` = 0；`ModelPicker.tsx:153-158` 空态给原因 + 手填兜底；`data-model-manual-*` 折叠区 |
| AC-17 | 11 内置角色互异、`skillIds` 有正文、恢复默认不动自建 | PASS | `r10-qa-static` AC-17a~17d；E2E E-11c/E-11d |
| AC-18 | 技能三入口 + 落盘可勾选 + 重启读回 | PASS（宿主链路）/ 未验证（真机点击三次） | E2E E-3~E-9（manual/imported/system 三入口落盘 + 重建读回） |
| AC-19 | 记录含 source/modified/updatedAt、投影不含正文、撞名加后缀 | PASS | E2E E-2*（1961 B、无 body）+ E-5（qa-4 vs qa 不覆盖） |
| AC-20 | 内置可改：modified + 落仓库外 + 重启 seed 不覆盖 + 投影 <8KB | PASS | E2E E-7*/E-9a/E-9b（`<HOME>/.dsh/auto-team/skills/`）；变异 M4 必红 ✅ |
| AC-21 | ≥12 技能、三字段非空互异、五类覆盖 | PASS | `r10-qa-static` AC-21a~21c |
| AC-22 | 恢复默认连带技能回出厂、用户三源与自建角色 sha256 不变、二次确认 | PASS（数据面）/ 未验证（真机弹窗确认） | E2E E-11a~E-11f；`restoreConfirmView` 数字来自入参（AC-22e）；变异 M5 必红 ✅ |
| AC-23 | builtin 不可删、用户技能可删且摘引用、缺 id 有可读原因 | PASS | E2E E-10a~E-10d；变异 M3 必红 ✅ |
| AC-24 | `pnpm test` ≥426 且 fail 0 | PASS | 482 / 482 |
| AC-25 | 形状冻结（15/9/3/1/四常量） | PASS | §2.2 |
| AC-26 | r5/r7 既有 checker 不回归、三条 P3 不新增 | PASS（无行为回归）/ P3-04（4 条旧契约断言红） | §2.6 |
| AC-27 | 交付门禁 | PASS | §2.1 + §2.7 |
| AC-28 | 六步安装与回滚 | **未验证** | 需真实 profile 安装，见 §5-3 |
| AC-29 | 真机技能全链路 + 重启读回 | **未验证**（宿主链路已验） | E2E E-9* 覆盖「重启后读回」的数据面；真机 UI 全链路见 §5-4 |
| AC-30 | 本夹产出 QA-REPORT.md 与 ACCEPTANCE.md + 探针锚定仓库根 | PASS | 本文件 + 探针 `new URL('../../../../', import.meta.url)` 锚定仓库根 |

## 4. 缺陷表

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| （无） | — | — | — | — | — | — | — | — |

> **P0 / P1 / P2 缺陷：未发现。** 下列 P3 为观察项（不阻塞验收，建议顺手清理）。

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-R10-01 | P3 | 客户端·槽位 | 在仓库根跑检测命令 | AC-2 字面判据「禁用槽位名在 `src/` 全 0 处」成立 | 3 行命中，均为注释：`src/client/state.ts:5`（r7 遗留旧注释 `conversation.composer.dock`）、`src/client/slots.ts:28-29`（有意文档化禁用名单）。**注册代码 0 处**，AST/注册面判据（AC-2 声明的验证方式）通过 | AC-2 | `grep -rn "conversation\.composer\.\(bar\|dock\)\|conversation\.input\.activity\|shell\.leading" src \| wc -l` | 输出 `0` |
| QA-R10-02 | P3 | 宿主·文案 | 触发 `act{restoreDefaultRoles}` 后看第三条 notice | 「你的 3 条自建/导入/系统技能与 1 个自建角色未受影响」（数字与「与」之间有空格） | 输出「…技能**与1 个**自建角色未受影响」，缺空格（`src/host/bridge.ts:1231` 模板 `${userSkillsText}与${customRolesText}`） | AC-22 | `grep -n '你\|未受影响' src/host/bridge.ts \| grep -c '与\${customRolesText}'` | 输出 `0` |
| QA-R10-03 | P3 | 客户端·设置页 | 对照蓝图「接口」字段 | `src/client/SettingsPage.tsx` 导出 `AutoTeamSettingsSection` | 实际导出名 `SettingsSection`（`SettingsPage.tsx:95`），蓝图命名未对齐 | AC-25 / 架构 | `grep -c 'export function AutoTeamSettingsSection' src/client/SettingsPage.tsx` | 输出 `1`（或改蓝图登记为 `SettingsSection`） |
| QA-R10-04 | P3 | 回归资产 | 从归档目录复制 r7 四个 checker 复跑 | 既有 checker 全绿 | `qa-r7-interface-consistency.mjs` 3 条、`r7-delivery-gates.mjs` 1 条红：B1/R2 断言旧槽名 `INPUT_DOCK_SLOT='conversation.input.dock'`（AC-1 已取代）、B2 硬编码 `BUILTIN_ROLES.length === 6`、G11 白名单写死 r7 任务夹路径。**非行为回归**（I1 的 465 个 import、R1、R3、G1–G10/G12–G17 全绿） | AC-26 | `node logs/teamflow/tf-mvy8htii-w566bd/scripts/legacy-r7-interface-consistency.mjs` | 把 B1/R2/B2 改成引用共享常量后 `7 PASS / 0 FAIL` |
| QA-R10-05 | P3 | 客户端·系统技能 | 打开「从系统技能选择」弹层，`~/.agents/skills` 不存在或不可读 | 说明「目录不可用：<路径>」，与「本机确实没有技能」可区分 | 只显示「本机没有可用系统技能。」——`RoleEditor` 有 `systemSkillsReason` 入参，但 `PanelSnapshot` 无该字段，`RolesTab.tsx:53` 与 `SettingsPage.tsx:286` 传不进值（T2 已登记为偏差 2） | AC-18 | `grep -c 'systemSkillsReason' src/shared/types.ts` | 输出 ≥1（快照补 `systemSkillsReason` 并从 `SystemSkillScan.reason` 投影） |
| QA-R10-06 | P3 | 客户端·弹层（craft/真机风险） | 在真机上打开技能编辑弹层并点击弹层内控件 | 弹层内的点击与输入均生效 | 本仓无 `react-dom`（`peerDependencies` 只声明 `react`，`tsdown.config.ts:39` `external:['react']`），`SkillDialogs.tsx` 以固定定位覆盖层替代 `createPortal`；若宿主该区域处于 `-webkit-app-region: drag` 热区，真机点击可能失效（CDP 合成点击无法暴露此问题） | AC-16/AC-18 真机部分 | `grep -c 'createPortal' src/client/SkillDialogs.tsx` | 真机验证弹层内点击生效（见 §5-5）；或在 `SkillDialogs` 根样式补 `-webkit-app-region: no-drag` |

## 5. 人工补测清单

> 全部为**环境限制，非交付缺陷**（本沙箱无法启动浏览器：Chromium crashpad 需 `PROCESS_SET_INFORMATION`/`PROCESS_SUSPEND_RESUME`，受限 token + Low integrity 下必失败，`--no-sandbox` 无效；第二宿主需主 agent 启动）。

| # | 项 | 方法 / 工具 | 关联 AC |
|---|---|---|---|
| 1 | 工具条存在性与同行判定 | 主 agent 按 `docs/teamflow/architecture/REAL-HOST-VERIFY.md` 起第二宿主（克隆 profile + 51890），CDP 断言：工具条容器 `[data-auto-team-option]` == 1、输入框上方 dock 容器 == 0、`[data-option-error]` == 0、与权限/计划钮 `getBoundingClientRect().top` 差 ≤ 4px | AC-12、AC-15 |
| 2 | 头部按钮连点三态 + 窄宽 | 同环境连点三次断言（页签数 / `[data-auto-team-panel]` / `aria-pressed`）= (1,1,true)→(0,0,false)→(1,1,true)，且不误关其他页签；1280px 与 900px 两视口采样：`right ≤ 下一控件 left-4`、高 ≤ 28px、`scrollWidth ≤ clientWidth`、短标签未被截成 <3 字 | AC-13、AC-14 |
| 3 | 六步安装与回滚 | `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` + 同步 `dsh.profile.bundles`；失败时用 `dsh plugin remove dsh-auto-team`（或从 profile deps/bundles 摘除）回滚；**先写下卸载命令再装** | AC-28 |
| 4 | 真机技能全链路 | 真机依次点：导入本地 md → 从系统技能多选 → 手动新建 → 编辑一条内置技能；重启宿主后断言四条技能仍在、内置技能正文 == 用户版本（`~/.dsh/auto-team/skills/<id>.md` 内容一致） | AC-29、AC-18、AC-20 |
| 5 | 弹层真实点击（含 drag 热区） | 真机点开技能编辑弹层/模型弹层/系统技能弹层，逐一点击内部按钮与输入框（验证 QA-R10-06 的 `createPortal` 替代是否受影响） | AC-16、AC-18 |
| 6 | 恢复默认二次确认与视觉 | 真机点「恢复默认」看对话框数字与确认按钮文案、确认后技能徽标「已修改」消失、自建角色仍在 | AC-22 |
| 7 | 观感类（overlay 遮挡 / 动画 / 排版美学） | 真机截图人眼评审；脚本层已断言结构分区与 `overflow`，观感不阻塞 | AC-9、AC-10、AC-14 |

## 6. 结论

- **功能面**：30 条 AC 中 23 条 PASS（含 5 条由变异自检证明判据可分辨），7 条因「无浏览器 / 无第二宿主」记未验证（AC-12~15、AC-16 真机部分、AC-28、AC-29 真机部分）——这些项的数据面已被 `r10-qa-e2e.mjs` 覆盖，仅 UI 交互层留待真机。
- **架构面**：蓝图模块按职责抽出、依赖方向与「宿主 API 只在 adapters」铁律保持，未发现重复实现或结构破坏；1 处命名偏差（P3-03）。
- **质量面**：门禁全绿（typecheck 0 / 482 测试 / 双产物新鲜 / 双 import / pack 3 / 越界 0），提交面干净（46 项、噪声 0），形状冻结（15/9/3/1/四常量）成立。
- **缺陷面**：P0/P1/P2 **0 条**；P3 观察 6 条（1 条为 PRD AC-2 的字面 grep 判据，建议验收前清掉；其余为文案/命名/回归资产/真机风险）。
- **判定：可进入验收（acceptance-ready）**，验收时请按 §5 补齐 7 项人工补测。

## 7. 复跑方式

```bash
# 静态 + 纯函数（94 条）
node logs/teamflow/tf-mvy8htii-w566bd/scripts/r10-qa-static.mjs
# 构建产物 HTTP 全链路（40 条，需 lib/ 为最新）
node logs/teamflow/tf-mvy8htii-w566bd/scripts/r10-qa-e2e.mjs
# r7 回归资产（4 个，见 §2.6）
for f in logs/teamflow/tf-mvy8htii-w566bd/scripts/legacy-r7-*.mjs; do node "$f"; done
```

> 探针均以 `new URL('../../../../', import.meta.url)` 锚定仓库根。run 结束后 host 会把 `scripts/` 归档到 `$DSH_HOME/teamflow/<workspace>/logs/tf-mvy8htii-w566bd/`，**从归档位置直接跑会解析到 `~/.dsh/teamflow/`**；复跑前先 `cp -r` 回 `<repo>/logs/teamflow/tf-mvy8htii-w566bd/scripts/`。
