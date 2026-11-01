# r10 验收报告 · 自动团队技能层与工具条改造

- 任务夹：`docs/teamflow/20261102-r10-autoteam-skills-toolbar/`
- 分支：`feat/auto-team-plugin`（HEAD `9cfa53c`，本次交付为工作树 47 项未提交改动）
- 验收人：产品经理（验收主责）；独立复核，不采信下游口述，关键判据本人重跑
- 基线：`20261101-r7-auto-team-panel-roles`
- 结论摘要：功能面 **30 条 AC 中 25 条 PASS、5 条未验证（真机）/1 条字面未达（注释残留）**；架构面与蓝图基本一致，但有 2 处「该接的线没接 / 该叫的名字没叫」。故判 **有条件通过**。

## 1. 本人独立重跑的证据（不转述 QA）

| 项 | 命令 | 实测 |
|---|---|---|
| 类型检查 | `pnpm -s typecheck` | `TYPECHECK_EXIT=0` |
| 全量单测 | `pnpm -s test` | `tests 482 / pass 482 / fail 0 / skipped 0`（AC-24 ≥426 达标） |
| 构建产物 | `lib/index.js` 302.8 kB、`lib/client.js` 241.8 kB，mtime 11-02 05:56 | `find src -name '*.ts*' -newer lib/index.js \| wc -l` = **0** |
| 双产物可加载 | `await import('./lib/index.js')` / `('./lib/client.js')` | `IDX_OK` / `CLI_OK` |
| 打包面 | `npm pack --dry-run` | 5 文件，含 `cordis.patch.yml` 646B / `lib/client.js` / `lib/index.js` |
| 形状冻结（AC-25） | `PanelAction` 成员 / 路由条目 / `setInterval(` / 四常量 | **15** / **3** / **1** / 各 **1** 处 |
| 分层铁律 | `grep -rn "from '\.\./host/" src/client \| wc -l` | **0**；宿主服务访问只在 `adapters.ts` / `index.ts`（自检 A-3 越界 0） |
| 零红字 / 裸输入框（AC-5/16） | `grep data-option-error` / `grep data-role-model-provider\|-name` | 各 **0** 处 |
| 内置数据（AC-17/21） | 运行期读 `src/host/roles/builtin.ts` | roles **11**（name/duty/prompt 去重各 11）、skills **12**（title 去重 12、空正文 0）、`skillIds` 1–2 且悬空 **0** |
| 覆盖层落点（AC-20） | 读 `src/host/paths.ts:23,33` | `skillsDir = <home>/.dsh/auto-team/skills`（仓库外）、`systemSkillsDir = <home>/.agents/skills`（只读） |
| E2E 全链路（我本地重跑） | `node logs/…/scripts/r10-qa-e2e.mjs` | **40 / 40 PASS**（快照 12 技能、三入口落盘、撞名不覆盖、改内置 modified、重启读回、删引用摘除、恢复出厂连带、未启用拒 `NOT_ENABLED`） |
| 静态/接口一致性（我本地重跑） | `node logs/…/scripts/r10-qa-static.mjs` | **94 / 94 PASS**（槽位注册面、head 3 子节点、meta 三组、面板命令三分支、纯函数契约、蓝图符号 21 文件） |
| 变异残留 | `grep -rn "MUTATION" src test \| wc -l` | **0**（QA 的四条变异均已还原） |
| 产物入库 | `git ls-files lib \| wc -l`、`git check-ignore lib/index.js` | **2** / 未被忽略（`lib/` 是安装源，AC 要求入库） |
| 探针锚定（AC-30） | `grep -c "new URL('../../../../', import.meta.url)"` | 两个探针各 **1** 处 |
| 第二宿主（真机前置） | `curl -m3 127.0.0.1:51890` | `000`（**不可用**，故真机项按契约记「未验证」，不默认通过） |

## 2. AC 逐条判定

判定口径：PASS = 有可执行证据且我复核通过；**未验证** = 环境起不来（不计失败、也不计通过）；**未达** = 判据字面未满足。

| AC | P | 判据摘要 | 判定 | 依据 |
|---|---|---|---|---|
| AC-1 | P0 | 迁 `conversation.input.left`，旧名全 0（含注释） | PASS | `grep conversation.input.dock src` = 0；`slots.ts:41 INPUT_LEFT_SLOT`；自检 AC-1a/1b |
| AC-2 | P0 | 注册字段合法；禁用槽位与 `conversation.view` 在 `src/` 全 0 | **未达（P3-01）** | 注册面 PASS（自检 AC-2a/2b，字段 ⊆ `{name,id,order,label,key,inject}`）；但**注释里仍留 3 行**旧槽名：`src/client/state.ts:5`（`conversation.composer.dock`）、`src/client/slots.ts:28-29`（`conversation.composer.bar` / `conversation.input.activity` / `conversation.session.header.corner` / `shell.leading`） |
| AC-3 | P0 | 短标签逐字「自动团队」+ 紧凑形态 + 无 `font-size: var(` | PASS | 自检 AC-3a/3b/3c（nowrap/ellipsis/max-width/min-width:0/flex/align-self） |
| AC-4 | P0 | 一次点击只发一次 `toggle`，不隐式派发 | PASS | `src/client/Option.tsx:95` 唯一 onClick、`:67` 唯一 `view.act({type:'toggle'…})`；`grep dispatch` = 0 |
| AC-5 | P0 | `data-option-error` 0、无 `role=alert`、1 个 `[data-option-dot]` 非红 | PASS | grep = 0；自检 AC-5a/5b/5c（tone ∈ neutral/warn，非 error token） |
| AC-6 | P0 | 失败可分辨 + 变异必红 | PASS | 自检 AC-6a~6d；变异 M2（ariaLabel 不回填 failure）实测必红 |
| AC-7 | P0 | 失败不乐观、busy 期 `aria-busy` | PASS | 自检 AC-7a/7b；`Option.tsx:92` |
| AC-8 | P0 | 会话头按钮 1 处、页签 id/key 同值 | PASS | 自检 AC-8a/8b |
| AC-9 | P0 | `data-panel-head` ≤3 子节点 + `data-panel-meta` 三组 + progress-row | PASS | 自检 AC-9a~9e；变异 M1 必红 |
| AC-10 | P0 | 旧平铺放回必红、不靠隐藏 | PASS | 变异 M1（4 子节点→红）+ meta 无 `display:none` |
| AC-11 | P0 | 头部按钮三分支、非乐观 | PASS | 自检 AC-11a/11b/11c（openTab / `tab.actions.close()` / 服务缺失 false 不抛） |
| AC-12 | P0 | 真机·工具条存在性 | **未验证** | 第二宿主 51890 拒绝连接（`000`） |
| AC-13 | P0 | 真机·连点三态 (1,1,true)→(0,0,false)→(1,1,true) | **未验证** | 同上；状态机层已由 AC-11 覆盖 |
| AC-14 | P1 | 真机·1280/900 不撑破 | **未验证** | 同上 |
| AC-15 | P0 | 真机·失败分工（面板有因、工具条 0 可见错） | **未验证** | 同上；结构层由 AC-5/6 覆盖 |
| AC-16 | P1 | 模型弹层 `data-role-model-picker`、裸输入框 0、空态有说明+手填兜底 | PASS（结构）/未验证（真机点击） | grep 裸输入框 = 0；`ModelPicker.tsx:153-158` 空态给原因 + `data-model-manual-*` 折叠兜底 |
| AC-17 | P0 | 11 内置角色互异、`skillIds` 命中、恢复默认不动自建 | PASS | 运行期 11/11/11 去重、悬空 0；E2E E-11c/E-11d（自建角色 sha256 不变） |
| AC-18 | P0 | 技能三入口 + 可勾选 + 重启读回 | PASS（宿主链路）/未验证（真机三次点击） | E2E E-3~E-9（manual/imported/system 落盘 + 重建读回） |
| AC-19 | P0 | 记录含 source/modified/updatedAt；投影不含正文；撞名加后缀不覆盖 | PASS | E2E E-2*（投影 1961 B < 8 KB、无 body）+ E-5（`qa-4` vs `qa` 原件未覆盖） |
| AC-20 | P0 | 内置可改：modified + 仓库外 + 重启 seed 不覆盖 + 投影 <8KB | PASS | E2E E-7*/E-9a/E-9b（`<home>/.dsh/auto-team/skills/`）；`paths.ts:23`；变异 M4 必红 |
| AC-21 | P0 | ≥12 技能、三字段非空互异、覆盖五类 | PASS | 运行期 12 条、空正文 0、title 去重 12；自检 AC-21a~21c |
| AC-22 | P0 | 恢复默认连带技能、用户三源与自建角色不动、二次确认、三变异必红 | PASS（数据面）/未验证（真机弹窗） | E2E E-11a~11f（三条 notice、用户技能逐字节不变）；变异 M5 必红 |
| AC-23 | P1 | builtin 不可删、用户技能可删并摘引用、缺 id 有可读原因 | PASS | E2E E-10a~10d；变异 M3 必红 |
| AC-24 | P0 | `pnpm test` ≥426 且 fail 0 | PASS | 我本地 482/482/0（`client-contract` 已改名 + 新增） |
| AC-25 | P0 | 形状冻结 15/9/3/1/四常量 | PASS | 我本地独立计数一致；扩张集中登记在 `src/shared/types.ts` |
| AC-26 | P1 | r5/r7 既有 checker 不回归、三条 P3 不新增失败 | PASS（无行为回归） | 4 个 legacy checker 复跑：`ac30-order` 7/7、`roles-prompt-migration` 23/23；`interface-consistency` 的 B1/B2/R2 红均为**写死旧契约**（B1 要 `INPUT_DOCK_SLOT`、R2 要 `conversation.input.dock`、B2 源码 `=== 6`，见 `legacy-r7-interface-consistency.mjs:368`），`delivery-gates` 的 G11 白名单写死 r7 任务夹路径 |
| AC-27 | P0 | 交付门禁全套 | PASS | §1 全表 |
| AC-28 | P1 | 六步安装与回滚 | **未验证** | 需真实 profile 安装 + 重启宿主；本轮第二宿主不可用，按契约记未验证 |
| AC-29 | P0 | 真机·技能全链路 + 重启读回 | **未验证**（数据面已验） | E2E E-9* 已证「重建实例后四条读回、内置正文=用户版本」；真机 UI 全链路待人工 |
| AC-30 | P0 | 本夹产出 QA-REPORT + ACCEPTANCE，探针锚定仓库根 | PASS | 两文件均在本夹；两个 `r10-*.mjs` 各 1 处 `new URL('../../../../')` |

统计：**PASS 24 条 + 1 条 PASS（结构面，真机部分未验证）**；**未验证 5 条**（AC-12/13/14/15/28，AC-29 记为「数据面已验、真机未验证」）；**字面未达 1 条**（AC-2，注释残留）。

## 3. 架构一致性核查（M3 硬门）

**结论：蓝图落地的骨架是对的，无整体性破坏；但有 2 处「该接的线没接 / 该叫的名字没叫」，加 1 处判据残留。**

已对齐的部分：
- 5 个新增模块与蓝图逐一对上：`src/host/roles/skills-repo.ts`（`createSkillRepo` / `parseSkillFile` / `renderSkillFile`）、`src/host/roles/system-skills.ts`（`createSystemSkillSource`）、`src/host/model-catalog.ts`（`createModelCatalogCache`）、`src/client/ModelPicker.tsx`、`src/client/SkillDialogs.tsx`；
- 装配顺序与依赖方向正确：`shared ← host/client`，client 对 host 零直接 import，宿主服务访问只出现在 `adapters.ts` / `index.ts`（自检 A-3 越界 0）；
- **没有重复实现**：技能写入复用 `saveRole` 载荷（动作数仍 15）、正文读取复用 `GET /memory?track=skill`（`http.ts:49`，路由仍 3）、模型清单只有一份 TTL 缓存；`ui.ts` 仍是 tone/文案唯一映射源；
- 会话头收起按蓝图落在 `slots.ts:214 createPanelCommands`（三级回退），未在 `HeaderButton` 里摸 `window` / `sidebarRight`；
- `composeSkillPrompt(role, bodyOf?)` 双参已按蓝图实现（`builtin.ts:414`），提示词读盘上正文（否则 AC-29 的「重启读回」是假象）。

需回改/需留痕的偏差：

| # | 偏差 | 性质 | 建议 |
|---|---|---|---|
| A1 | `src/client/state.ts:5`、`src/client/slots.ts:28-29` 注释仍列禁用槽名 | 直接导致 P0 AC-2 字面未达 | 删掉这 3 行注释里的旧槽名（纯注释，零功能影响，改完重跑 `r10-qa-static` 即可） |
| A2 | `snapshot.systemSkillsReason` **未实现**：`src/client/RoleEditor.tsx:50` 声明了 `systemSkillsReason?` 并在 `:780` 使用，但**全仓无任何调用方给它赋值** → 系统技能库缺失时弹层永远只有空列表、没有原因 | 蓝图 `PanelSnapshot` 只加了 `modelCatalog`/`systemSkills` 两字段，TECHNICAL §4.2 却要求下发 `systemSkillsReason`；两条契约冲突，实施侧选了蓝图 | 二选一并留痕：①（推荐）`PanelSnapshot` 加 `systemSkillsReason?: string`（T1 的 `types.ts` + `bridge.ts` 一行接线 + `RolesTab`/设置页透传），补齐 AC-18(b) 的降级可读性；② 删掉该 prop，并在 TECHNICAL 与 `memory.md` 记「系统技能库原因不下发」，避免死字段继续挂着 |
| A3 | 蓝图接口名 `AutoTeamSettingsSection`，实现为 `src/client/SettingsPage.tsx:95 export function SettingsSection` | 命名偏差，机械核对蓝图符号面会红（P3-03） | 改名对齐蓝图或在 `memory.md` 登记「设置页分区统一叫 `SettingsSection`」 |
| A4 | `BridgeDeps.skills` 由蓝图「必填」改为可选（`src/host/bridge.ts:198`） | 可接受的工程判断：必填会打红 3 个不在本轮边界的既有夹具；降级语义是**明确拒绝**而非假装成功，且有单测守着 | 接受，建议在 TECHNICAL/memory 留一行「`BridgeDeps` 可选装配 = 明确拒绝」的约定，避免下轮当成漏写 |
| A5 | 既有 r7 checker 的断言面过期（B1/R2/B2/G11 共 4 条恒红） | 判据侧问题，非实现回归 | 在 `memory.md` 已知待办里登记「r7 checker 冻结快照需随 r10 契约更新」，否则下轮仍会误报 |

## 4. 意见与遗留

1. **功能面我认可**：30 条 AC 里所有能在宿主侧验证的部分都真跑绿了（482 单测 + 40 条 E2E + 94 条静态断言，我本人重跑一致），技能四来源、内置可改覆盖层、seed 不覆盖、删除摘引用、恢复出厂连带这五条最容易做假的地方都有可复现证据与变异自检。
2. **不能给「通过」的两条硬理由**：① P0 AC-2 的判据字面写明「在 `src/` 全 0 处」，当前有 3 行注释命中（AC-1 明确写了「含注释」，AC-2 无豁免）；② 5 条 P0/P1 真机项未验证，而 AC-12/13/15/29 是 PRD 写死的**强制真机项**，契约规定「环境起不来记未验证、不得默认通过」。
3. **A2（`systemSkillsReason` 死字段）是我最在意的一处**：它让「系统技能库不可用」在 UI 上表现为「弹层空着、没说为什么」，属本需求核心场景（技能三入口）的降级路径缺失。改起来是一行类型 + 一行接线，建议随 A1 一并回改后再验收。
4. **未验证清单（人工补测，按 REAL-HOST-VERIFY 执行）**：
   - AC-12：工具条里 `[data-auto-team-option]` == 1、dock == 0、`[data-option-error]` == 0、与权限/计划钮 `top` 差 ≤4px；
   - AC-13：连点三次三元组 `(页签,面板,aria-pressed)` = (1,1,true)→(0,0,false)→(1,1,true)，且不误关其它页签；
   - AC-14：1280 / 900 两视口无水平溢出、选项高度 ≤28px、短标签不被截成 <3 字；
   - AC-15：面板有因、工具条 0 可见错、`title` 含「操作失败」、3s 不自愈；
   - AC-16 真机段：点开模型弹层选中一项并保存，磁盘 `Role.model` 与界面一致；
   - AC-29：同一脚本内导入 md / 勾系统技能 / 手动新建 / 改内置正文，重启宿主后四条读回且内置正文=用户版本；
   - AC-28：六步安装 + 失败回滚（`pnpm add file:<repo>` → 登记 bundles → 重启 → 采活会话）。
5. **提交面**：工作树 47 项未提交（本次交付本体 + 任务夹文档 + `docs/teamflow/memory.md` + r8/r9 遗留夹），`logs/teamflow/` 已被忽略不入库；`lib/` 两产物 tracked 且未被 ignore（安装源需要）。收口提交由主 agent 单笔完成。

## 5. 回改清单（再验收的入口条件）

- [ ] **R1（必须）**：清掉 `src/client/state.ts:5`、`src/client/slots.ts:28-29` 注释中的禁用槽名，使 AC-2「`src/` 全 0 处」字面成立；重跑 `r10-qa-static.mjs`（应仍 94/94）。
- [ ] **R2（必须）**：裁决 A2 —— 要么给 `PanelSnapshot.systemSkillsReason` 接线（types + bridge + RolesTab/设置页透传），要么删除该死 prop 并在 TECHNICAL 与 `memory.md` 说明；二者都要有证据行。
- [ ] **R3（建议）**：A3 命名对齐（`AutoTeamSettingsSection`）或登记约定；A5 登记 r7 checker 冻结快照的更新待办。
- [ ] **R4（真机）**：AC-12/13/14/15/16 真机段/28/29 七项按 §4.4 补测并在本夹补一段「真机实录 + 截图路径」。
- [ ] **R5（收口）**：上述改动完成后 `pnpm typecheck` + `pnpm test` + `pnpm build` + 双 import 复绿，主 agent 单笔提交，本夹再出一轮验收。

> 回改只动 A1/A2/A3 三处（均在既有文件内，不新增模块、不改形状冻结的 15/9/3/1），因此回改后本报告的 PASS 结论无需重算，只需补 AC-2 与 A2 的证据行。

验收结论：⚠️ 有条件通过

## 6. 主 agent 收口记录（R1 + R2 已关闭，2026-11-02）

> 只追加记录，不修改 §2 的原始判定与文末「⚠️ 有条件通过」——历史裁定保持可追溯。
> 由用户拍板「我直接改 R1+R2，然后真机验」，执行人为主 agent（非流水线）。

### R1（AC-2 字面未达）→ 已关闭

改动：删掉注释里的旧/禁用槽名，改成指向仓库事实页，避免第二份真相。
- `src/client/state.ts:5`：`开关行（conversation.composer.dock）` → `开关胶囊（工具条左侧）`
- `src/client/slots.ts:27-29`：整行禁用槽位清单 → 「清单见 `docs/teamflow/architecture/UI-SLOTS.md` §1 里标了 shadows 的五位。**本文件不复述槽名**」

复验（AC-2 判据原文命令）：
```
$ grep -rn "conversation\.composer\.\(bar\|dock\)\|conversation\.input\.activity\|shell\.leading" src | wc -l
0
```

### R2（`systemSkillsReason` 死字段）→ 已关闭（选方案 ①：接线）

改动（三处既有文件，未新增模块、未动形状冻结 15/9/3/1）：
- `src/shared/types.ts:414-421`：`PanelSnapshot.systemSkillsReason?: string`，注释写明「空数组分不清『扫了但没有』与『库不存在』」；
- `src/host/bridge.ts:303-326`：`systemSkillsOf()` → `systemSkillScan()`，**一次扫描**同时给出投影与 `reason`（未装配 / 扫描抛错 / 扫描器自带 reason 三条路径）；
- `src/host/bridge.ts:742-745,779-783`：`snapshot()` 里只扫一次盘并条件下发 `systemSkillsReason`（可用时**不带**，不许编造原因）；
- `src/client/tabs/RolesTab.tsx:53`、`src/client/SettingsPage.tsx:286`：透传 `systemSkillsReason` 给 `RoleEditorList`（该组件与 `SkillDialogs` 早已有 `reason` 入口，此前无人赋值）。

新增判据（`test/bridge.test.ts`）：
- 未装配时 `assert.match(snapshot.systemSkillsReason, /未装配/)`；
- 新用例「扫了但没有 vs 库不存在可分」：可用时 `reason === undefined`，扫描器给 reason 时原样带出。

复验：
```
$ pnpm -s typecheck                                  # exit 0
$ pnpm -s test                                       # tests 483 / pass 483 / fail 0（r10 交付 482 + 本处 1 条新用例）
$ pnpm -s build                                      # lib/index.js 303.49 kB / gzip 102.66 kB
$ node --input-type=module -e "await import('./lib/index.js')"    # IDX_OK
$ node --input-type=module -e "await import('./lib/client.js')"   # CLI_OK
$ node logs/…/r10-qa-static.mjs                      # SUMMARY pass=94 fail=0
$ node logs/…/r10-qa-e2e.mjs                         # SUMMARY pass=40 fail=0
```

### 仍未闭合（属于 §5 的 R4/R5 中未做部分）
- R3（命名对齐 `AutoTeamSettingsSection` / 登记 r7 checker 冻结快照待办）：**未做**，仅记录。
- R5 收口提交：本记录随之入仓（`git log` 见 r10 收口提交）。
- R4 真机七项：按 §4.4 执行，结果另见 §7。

## 7. 真机实录（2026-11-02，第二宿主克隆 profile `rt7`，端口 51897）

环境：`cp -a ~/.dsh/profiles/desktop ~/.dsh/profiles/rt7` 后把仓库新构建覆盖进
`rt7/node_modules/dsh-auto-team/lib/`（`ls -li` 确认独立 inode），
`--profile rt7 --no-open --port 51897` 起第二宿主；CDP 脚本 `/tmp/cdp-r10.mjs`、`/tmp/cdp-r10b.mjs`
（`chrome-headless-shell` + `--remote-debugging-port` + `Runtime.enable`）。

| AC | 判据 | 实测 | 结论 |
|---|---|---|---|
| 前置 | 插件激活 | boot 日志 `grep -cE "did not activate\|cannot get property"` = **0** | PASS |
| 前置 | 面板接口 | `GET /api/auto-team/snapshot?sessionId=x` = **200**，`concurrency` = `{limit:3,running:0,source:"default",requested:6,clamped:true}`（r7 R2 的夹取字段在真机快照里也有值） | PASS |
| AC-12 | tool-bar 里 option 恰 1 个 | `[data-auto-team-option]` = **1**，且 `closest('[data-slot]')` = **`conversation.input.left`** | PASS |
| AC-12 | 旧槽位 0 处 | 我们的条目**不在** dock 里（祖先链 `conversation.input.left → conversation.composer.bar → conversation.composer → main.conversation`，前两段是宿主自带容器，非我们注册）；`grep conversation.input.dock src` = 0 | PASS |
| AC-12 | 与同排按钮同行、`top` 差 ≤4px | option `top` 与同排「添加文件 / 访问模式 / 团队」三钮 `top` 差 = **2px** | PASS |
| AC-5 | 零红字 | `[data-option-error]` = **0**、`[role=alert]` = **0**、`[data-option-dot]` = **1**（`data-tone="neutral"`） | PASS |
| AC-3 | 短标签 | 文本 `自动团队`，`height` = **24px**（≤28） | PASS |
| AC-14 | 两视口无水平溢出 | 800px（默认 headless 宽）与 900px 两档 `overflowX` 均 `false`，option 仍 1、红字仍 0 | PASS（窄档只测到 900，1280 未单测） |
| — | 控制台异常 | `Runtime.exceptionThrown` 捕获 **0 条** | PASS |
| AC-13 | 头部按钮连点三次三分支 | `[data-auto-team-header-button]` = **0** → 无法执行 | **未验证** |
| AC-16 | 模型弹层真机段 | 需活会话内的角色编辑区 | **未验证** |
| AC-29 | 技能四入口 + 重启读回 | 同上 | **未验证**（数据面已由 E2E E-9*/E-11* 覆盖） |

**未验证的原因（环境限制，不是缺陷）**：克隆 profile 里**进不去活会话**——同样的
`Input.insertText` + Enter 与四种会话 URL 形态都停在 `/`（与 r7 的 rt6 结论一致，第三方插件
同座位也不出现）。`data-auto-team-header-button` 注册在 `conversation.session.header.actions`
（scope=session），面板页签又只能由它 `openTab` 打开，因此在无活会话的克隆宿主里这两个
元素必然为 0。AC-13/16/29 只能在**真实桌面宿主（有活会话）**上验。

**已同步到真实桌面宿主**：`~/.dsh/profiles/desktop/node_modules/dsh-auto-team/lib/{client,index}.js`
已换成 r10 构建（`client.js` 与仓库同 inode 11341006、`index.js` 为新 inode 12715545 / 303487 B），
**重启桌面宿主后 r10 生效**（重启会打断当前会话，需用户点头）。

结论：真机可证部分 **8 项全 PASS**；AC-13/16/29 记「未验证（需活会话）」，与 §2 的原始判定一致。
