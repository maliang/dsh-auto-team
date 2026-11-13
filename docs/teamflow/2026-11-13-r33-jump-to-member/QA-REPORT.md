# r33 QA 报告：点击跳成员会话

- 需求：r33「角色卡 / 任务行 / 流程图节点点击后打开对应成员会话」
- 任务：t3（QA）· 2026-11-13 · 节点 v26.11.1 / pnpm 10.34.7
- 被测实现：t2 工作区改动（`src/client/viewmodel.ts` 的 `memberJumpOf` 族 + `src/client/session.ts` + 三处入口组件）
- 本文所有结论都附命令或 `path:line`；无证据的条目列在 §5「未验证项」，不按通过计。

## 1. 全量门禁

一条命令按验收口径串行执行（`pnpm typecheck && pnpm test && pnpm build`）：

| 项 | 命令 | 退出码 | 证据尾巴 |
|---|---|---|---|
| 类型 | `pnpm typecheck` | 0 | `tsc --noEmit`，无诊断输出 |
| 单测 | `pnpm test` | 0 | `ℹ tests 1223` / `ℹ pass 1223` / `ℹ fail 0` |
| 构建 | `pnpm build` | 0 | `lib/client.js 593.46 kB │ gzip: 146.94 kB`；`lib/index.js 629.54 kB │ gzip: 208.68 kB` |
| 组合 | `pnpm typecheck && pnpm test && pnpm build` | **0** | 同上（单次串行执行，日志 `/tmp/r33-gate.log`） |

双产物可 import（宿主 ESM / client CJS 套壳两条加载路径都实际跑过）：

```bash
node --input-type=module -e "await import('./lib/index.js')"   # HOST_IMPORT_OK, exit 0
node --input-type=module -e "await import('./lib/client.js')"  # CLIENT_IMPORT_OK, exit 0
```

体积与指纹（构建后实测）：

| 产物 | 字节 | gzip | sha256 |
|---|---|---|---|
| `lib/index.js` | 629545 | 208.68 kB | `265d959d68a0124234dedffe3777d6122b69ca7311299e2c82524c3f156102b2` |
| `lib/client.js` | 593455 | 146.94 kB | `3ee90d53cb9bf9ebaab0518e54f8494739146925a6e782e6e3f41c12c46117c5` |

产物内含 r33 新面（字符串级核对 `lib/client.js`，避免「构建绿、代码没进去」）：
`memberJumpOf` / `memberJumpNoticeOf` / `uiWorkspace` 均存在，原因文案
`该任务还没有可跳转的成员`、`宿主未提供会话导航服务` 均存在。

> 说明：`lib/client.js` 在 t2 时已随源码重写，本机没有「t2 之前」的构建快照，
> 因此体积只有绝对值，没有环比（见 §5）。

## 2. AC 对照

需求卡没有独立 PRD，AC 取自 t3 任务卡的 ①–⑤。测试文件：`test/r33-jump-to-member.test.ts`（18 例，全绿）。

| AC | 判定方式（测试名） | 位置 | 结论 |
|---|---|---|---|
| ①-a 有成员可跳 | `r33 ① 角色有成员：可跳、带 memberId，title/label 由同一判定给出` | test/r33-jump-to-member.test.ts:72 | 通过：`available=true`，`memberId` 原样交给会话服务，`label` 与角色卡原 label 合并而非覆盖 |
| ①-b taskId 绑定优先 | `r33 ① 任务：明确绑定 taskId 的成员优先于同角色 running 成员` | :87 | 通过：绑定成员优先；无绑定时才回退 running / 最近活跃 |
| ①-c 任务无成员 | `r33 ① 任务无成员：available=false + 人话原因，title/label 都含原因` | :102 | 通过：`[]`/`undefined`/`null` 三种输入都 `available=false`、无 `memberId`、title 含原因 |
| ①-d 角色无成员 | `r33 ① 角色无成员 / 节点没有记录角色：分别给出对应原因，绝不静默` | :116 | 通过：两种原因文案区分，节点保留原 title 并拼接原因 |
| ①-e 成员已 retired | 同上文件 :128 / :141 | :128 | 通过（语义见 §5-2）：完全回收的成员不在快照 members 里 → 不可跳 + 原因；已停止但宿主仍保留的成员可跳 |
| ①-f 会话 id 非法/空 | `r33 ② 会话 id 非法/空：requestMemberSession → no-member，opener → unavailable` | :195 | 通过：空串/空白不进宿主；未注册与「空 id」返回可区分（`null` vs `'no-member'`） |
| ①-g 服务缺失回退 | `r33 ② 服务缺失：回退 unavailable（不是静默 false），文案说明原因` | :159 | 通过：返回 `'unavailable'` 且 `memberJumpNoticeOf` 给出含「宿主未提供会话导航服务」的提示行 |
| ②-a 三入口同一判定 | `r33 ③ 三个入口都只调 memberJumpOf，不各自 find/filter 成员` | :273 | 通过：三文件都调 `memberJumpOf(`，且不含 `memberForRole(` / `members.find|filter` / 复制原因常量 / 自带 `status === 'running'` |
| ②-b 落地动作单一 | `r33 ③ 落地动作只在任务页：requestMemberSession + 统一结局翻译` | :291 | 通过：组件不直接 `openSession(`；不可跳分支先于服务调用；结局统一经 `memberJumpNoticeOf` |
| ②-c 历史 run 不跳 | `r33 ③ 历史 run 不提供跳转（onJump 只在当前 run 传入）` | :301 | 通过：`onJump` 只在该 run 非历史时下传 |
| ③-a 角色卡可达性 | `r33 ③ 角色卡：可点时 role=button + tabIndex + Enter/Space…` | :310 | 通过：`role`/`tabIndex`/`aria-label`/`title`/`onClick`/`onKeyDown` 全部由 `onJump` 与判定结果驱动，无 `stopPropagation` |
| ③-b 任务行独立入口 | `r33 ③ 任务行：独立 button 入口、不吞展开，title/aria-label 来自判定` | :329 | 通过：原生 `button` 与展开按钮并列且位于其后，`title`/`aria-label` 来自 jump，不吞事件 |
| ③-c 流程节点 | `r33 ③ 流程图节点：原生 button，可跳优先、不可跳给原因并保留选中回退` | :344 | 通过：可跳时 `onJump` 后 return；不可跳时也 `onJump(jump)` 再 `onSelectTask`；画布拖拽抑制 `onClickCapture` 保留，节点自身无 `stopPropagation` |
| ④ 门禁/双产物/体积/指纹 | 见 §1 | — | 通过（exit 0） |
| ⑤ 报告 | 本文件 + §3 变异矩阵 + §4 真机步骤 + §5 未验证项 | — | 通过 |

顺带修了两处**过期契约**（不是放宽断言，而是把 r17 的实现钩子改成 r33 的等价不变量，语义强度不变）：

- `test/member-page.test.ts:404-438`：四个入口/透传测试仍在断言 `memberForRole(...)` / `onOpenMember(...)`，
  与 t2 的新形态冲突；改为断言 `memberJumpOf(`、`onJump(jump)`、`onJump?: (jump: MemberJumpView) => void`，
  并**新增**负面断言 `assert.equal(source.includes('memberForRole('), false)`（比原断言更严）。
- `test/r17-styles.test.ts:473-475`：`role={onOpen === undefined …}` → `role={onJump === undefined …}`，
  tabIndex 同步；「可点必须有 button 语义 + 焦点」这条不变量原样保留。

## 3. 变异矩阵（每条都必须变红）

做法：把 `src/` + 新测试复制到 `/tmp` 独立目录，用一段脚本做**单点回退**，再跑
`node --test test/r33-jump-to-member.test.ts`（node 26 原生剥离 TS，无需构建）。结果：

| # | 回退点（模拟「写错」） | 命令退出码 | 变红的测试 |
|---|---|---|---|
| M1 | `src/client/viewmodel.ts:2941` `available: false` → `true`（无成员也当成可跳） | **1** | #3 任务无成员 / #4 角色无成员·节点无角色 / #5 retired 已回收 |
| M2 | `RoleCard.tsx` 的 `memberJumpOf(` → `pickMember(`（角色卡绕过唯一判定） | **1** | #13 三处入口都只调 memberJumpOf |
| M2b | 三处入口**全部**替换为 `pickMember(`（共 4 处调用点，含任务表两个渲染分支） | **1** | #13 三处入口都只调 memberJumpOf |
| M3 | `src/client/session.ts:54` 服务缺失/无 `openSession` 时 `return 'unavailable'` → `'opened'`（不回退） | **1** | #8 服务缺失回退 / #9 注入未就绪·抛错·面缺方法 |
| M4 | `TaskTable.tsx` 去掉 `title={jump.title}` 与 `aria-label={jump.label}`（点了没反应、悬停也不说原因） | **1** | #17 任务行 title/aria-label 来自判定 |

可复跑脚本（一次性，未入库）：`/tmp/r33-mutate.sh`、`/tmp/r33-mutate2.sh`；每个变异都在 `mktemp -d` 的
副本里执行，不触碰工作区。M2b 的「replaced 4」说明任务表的两个渲染分支（分组/平铺）都在覆盖范围内。

## 4. 真机复验步骤（未执行，需人在宿主里点）

前置：`cd ~/.dsh/profiles/desktop && pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`，
重启宿主，打开任意会话并开启「自动团队」，跑出一个至少 2 个成员、若干任务（含 1 个未派发）的 run。

1. **角色卡**：计划页点一张有成员的角色卡 → 应切到该成员会话；再点「折叠」区域应只折叠、不跳转。
2. **任务行**：任务表里点某任务右侧「子智能体 · xxx →」→ 应切到对应成员；点同行左侧展开箭头 → 只展开、不跳转（两者是兄弟按钮，不互相吞事件）。
3. **流程图节点**：流程画布点一个已完成/运行中任务的节点 → 应切到该节点绑定成员；**按住拖动**节点 → 只移动位置，松开后不应跳转（依赖 `onClickCapture` 的拖拽抑制）。
4. **未派发任务**（关键回归）：点一个还没派发的任务行入口 → 应在面板上看到一行原因（「该任务还没有可跳转的成员：可能尚未派发，或成员已回收」），而不是无反应；该按钮仍可点（不 disabled），因为点击就是唯一的解释入口。
5. **键盘**：Tab 到角色卡按 Enter / Space → 同鼠标点击；Tab 到任务行「子智能体」按钮按 Enter → 同点击。
6. **历史 run**：切到历史 run 的任务页 → 卡片/行/节点不应出现跳转语义（角色卡无 `role=button`，入口按钮不渲染）。
7. **服务缺失旁路**（可选，难构造）：把 `registerMemberSession` 临时跳过（或旧宿主无 `uiWorkspace`）→ 点入口应看到「没有跳转：宿主未提供会话导航服务…」。

判定标准：1–3 必须在 1 次点击内切换会话；4 必须出现原因文案；任何一步「点了没反应」都算缺陷，按「症状 / 根因 / 复验命令」回填 §6。

## 5. 未验证项（不按通过计）

1. **真机点击未执行**：本节 1–7 均未在第二宿主里跑过；上面的绿是源码契约 + 单测 + 构建产物三级证据，不等于浏览器行为。
2. **「已停止」成员的跳转结果**：`src/host/bridge.ts:1222` 只在 `retired === true && stoppedAt === undefined` 时跳过，`binding.stoppedAt !== undefined` 的成员**保留**一行（`src/host/bridge.ts:1235-1241` 映射为 status `stopped`），所以客户端仍会给出可跳。若宿主的 `openSession` 对已停会话 retain 失败，用户会看到「宿主拒绝了这次会话切换，请再点一次」（`rejected`），不会静默——但「停在哪个会话」未真机确认。
3. **同角色 running 回退**（既有语义，非本需求引入）：某任务无绑定成员、但同角色有 running 成员时，`memberForRole` 会回退到该成员，于是「没派发的任务」也可能跳到同角色另一个任务的成员，而不是显示原因。测试 `:129` 用「该角色无任何成员」构造不可跳现场。这是设计取舍（角色视图一直如此），已列此条供验收决定是否收紧为「只认 taskId 绑定」。
4. **注入时序**：真实宿主里 `uiWorkspace` 何时就绪未验证。若点击发生在注入回调之前，用户会看到「会话导航尚未就绪，请稍后重试」（`requestMemberSession` 返回 `null`），再点一次即可；这是设计内降级，但不是无感。
5. **键盘可达性**只做了源码断言（`role`/`tabIndex`/`onKeyDown`/原生 `button`），未用 AX/无头浏览器实测焦点顺序。
6. **体积无环比**：没有 t2 之前的 `lib/client.js` 快照，只有绝对值；如需要，可在提交后以 `git show HEAD:lib/client.js` 作为下一轮的基线。
7. 未跑 `npm pack --dry-run`（不在本卡验收范围；`lib/` 双产物已在 §1 实测存在且可 import）。

## 6. 缺陷

本卡未发现阻断缺陷（0 条）。§5-3 是**待验收决策项**，不是缺陷；§5-2 是需要真机确认的行为边界。

若真机复验失败，请按以下三段回填（示例格式，勿写「偶发/疑似」）：

```
症状：点任务行「子智能体」按钮，面板无任何变化。
根因：src/client/tabs/TasksTab.tsx:xx 的 jumpToMember 未把 memberJumpNoticeOf 的结果写入 state（或 jump.memberId 为空仍调用服务）。
复验命令：node --test test/r33-jump-to-member.test.ts（对应例 #17）+ 真机点一次同位置。
```

## 7. 建议修改

| 建议 | 依据 | 影响 |
|---|---|---|
| 若产品要求「未派发任务必须显示原因」，把 `memberForRole` 的回退限定为「仅在同一 run 且 role 下唯一 running 成员」或改为只认 taskId | §5-3 | 会改变 r17 起的角色视图行为，需产品确认后再动 |
| 把 §3 的变异脚本收进 `scripts/`（脚本按 `new URL('../../..', import.meta.url)` 锚定仓库根，避免归档后假红） | AGENTS.md「探针可重跑前提」 | 下一轮改 r33 时可直接重跑变异矩阵 |
| 为 `session.ts` 的 `rejected` 路径补一条真机日志采样（宿主 throw 的 message） | 只有 `console.warn`，线上难取证 | 便于把「宿主拒绝」与「服务缺失」分开定位 |

## 8. t5 追加：README 精简重写后的门禁 + 双语一致性 + 事实核对（2026-11-13）

范围：t4 已把 `README.md` / `README.en.md` 从 379 行「16 节 + 94 行变更记录」压到 180 行「10 节 + 3 条变更记录」，本节独立复核重写后的门禁、双语结构、命令与数字事实。**本节不改 t3 的 r33 结论，只追加文档侧证据。**

### 8.1 全量门禁（按验收命令串行）

| 项 | 命令 | 退出码 | 证据尾巴 |
|---|---|---|---|
| 组合 | `pnpm typecheck && pnpm test && pnpm build` | **0** | 日志 `/tmp/r33-t5-gate.log`（单次串行执行） |
| 类型 | `tsc --noEmit` | 0 | 无诊断输出 |
| 单测 | `pnpm test` | 0 | `ℹ tests 1229` / `ℹ pass 1229` / `ℹ fail 0`（含本节新增守卫 6 例） |
| 构建 | `pnpm build` | 0 | `lib/client.js 593.80 kB │ gzip: 147.05 kB`；`lib/index.js 632.60 kB │ gzip: 209.50 kB` |

> 体积在并行 t6/t7 改动期间持续漂移：本节记录的是 t5 门禁那次的值；收尾 `auto_team_receipt` 复跑 build 为 `lib/client.js 595.89 kB` / `lib/index.js 632.60 kB`。README 声明的 593.46 / 629.54 kB 见 §8.5-2，一并待 t8 刷新。

README 重写**没有把任何既有断言弄红**，因此不存在「为契合新结构而弱化断言」的改动：

- `node --test test/r29-packaging.test.ts` → 6/6 pass（含「双语 h2 数量与图片引用集合相等」「engines 与双语兼容表逐字一致」「真实 npm pack 清单」）。
- 全量跑时曾观察到 1 次瞬态红：`ReferenceError: aliveMemberNamesOf is not defined`（`src/host/bridge.ts:1739`）。同一分钟内单跑 `test/wire.test.ts` 恢复 5/5 pass，属并行 t6/t7 编辑落盘的中间态，不是 README 改动的产物；最终门禁 exit 0。未按「偶发」记录，仅作过程说明。

### 8.2 脚本校验（10 项，9 绿 1 红）

复跑：`node docs/teamflow/2026-11-13-r33-jump-to-member/verify-readme.mjs`（脚本用 `new URL('../../../', import.meta.url)` 锚定仓库根；`--no-test` 可跳过「跑 pnpm test 对照基线」那一步）。

| # | 判据 | 结果 |
|---|---|---|
| 1 | 去掉代码块后，双语 h2 数量相等且非空 | 通过：10 = 10 |
| 2 | 四张约定图片每张在每份 README 里**各引用 2 次**（hero + 原文件清单），双语集合相等 | 通过：4 × 2 |
| 3 | 代码块命令 26 行、双语逐字相同 | 通过：26 行（含空行剔除后） |
| 4 | 版本号 `dsh-auto-team@…` 与 `package.json` 一致 | 通过：0.2.1 |
| 5 | 兼容表 Node.js / DSH 行与 `package.json` 的 `engines` 逐字一致 | 通过：`>=22.18` / `>=0.2.1-alpha.2 <0.3.0` |
| 6 | README 声明的测试基数 == `pnpm test` 实际输出 | **红（待刷新）**：声明 1223，实际 tests=1229 / pass=1229 / fail=0 |
| 7 | 旧版长节标题不再出现，两份 README 均 ≤ 180 行 | 通过：≤ 180 行（旧版 379 行） |
| 8 | 变更记录只留最近 3 条（h3）且指向 `git log` / docs | 通过：3 条 |
| 9 | 相对链接与 `docs/…` 路径无死链 | 通过：全部命中 |
| 10 | 四张图文件存在且 > 20KB | 通过：59 / 99 / 652 / 145 KB |

第 6 项的数字分解（不是断言放宽）：t4 落盘时基线确为 1223；并行 t6/t7 的代码改动新增 3 例 → 1226；本卡新增守卫 `test/r33-readme-guard.test.ts` 6 例 → 1229。**t5 写域不含 README**，按队长口径记「待 t8 收尾后由队长统一刷新 README 的 1223 → 当时的实际数」，不得为凑数改 README 或删断言。其余 9 项已把 t5 的结构要求变成机械判定。

顺带核对 `npm pack --dry-run --json`：**8 个文件**（`package.json`、中英 README、`cordis.patch.yml`、两份 `lib/`、`locale/en.json`、`locale/zh.json`），与 README「8 个文件」一致；r29 的 7 个必需文件断言也在其中。

### 8.3 新增守卫与变异矩阵（每条都必须变红）

新增 `test/r33-readme-guard.test.ts`（6 例，全绿）。为什么另起文件而不是塞进 r29：r29 只钉 h2 数量与图片**集合**，本卡要钉的是「每张图 2 次、命令逐字、版本/engines、旧节与死链、>20KB」。为什么「1223 对照」不写进单测：新增用例本身会改变基数，自指断言只会永远红，故留给上面的脚本。

变异做法：把 `README*.md`、`package.json`、`AGENTS.md`、`docs/teamflow/`、`docs/images/`、测试文件复制到 `mktemp -d` 目录，单点改坏后跑该测试（基线先跑绿，避免脏夹具）：

| # | 改坏点 | 退出码 | 变红的用例 |
|---|---|---|---|
| M1 | 删掉 hero 的 `panel-overview.png` 引用（少一张图） | **1** | 「四张图各引用 2 次」 |
| M2 | 把 `README.en.md` 的 `pnpm install` 改成 `pnpm i` | **1** | 「26 行命令双语逐字相同」 |
| M3 | `README.md` 版本号 0.2.1 → 0.2.0 | **1** | 「版本号与 engines 跟 package.json 一致」 |
| M4 | 中文版插回 `## 门禁（acceptance）语义` 旧长节 | **1** | 「旧版长节不复现 / ≤180 行」+「双语 h2 数量相等」 |
| M5 | 插入 `[死链](docs/no-such-file.md)` | **1** | 「相对链接与截图路径无死链」+「≤180 行」 |

### 8.4 四张图（文件事实 + 待补项）

| 文件 | 字节 | sha256（前 12 位） | 结论 |
|---|---|---|---|
| `docs/images/panel-overview.png` | 667296 | `d57e8173974e` | 存在且 >20KB；**仍是 08:38 的旧图，待队长重新生成** |
| `docs/images/panel-tasks.png` | 148837 | `16791a143b65` | 存在且 >20KB |
| `docs/images/panel-flow.png` | 101013 | `438fbc3351dc` | 存在且 >20KB |
| `docs/images/entry.png` | 60817 | `9e2c0d50d82c` | 存在且 >20KB |

`panel-overview.png` 的 mtime 为 `2026-11-13 08:38`，早于本轮 r33 客户端改动；据队长口径，本轮由队长在修复部署后重新生成、路径不变（旧图含左侧导航栏，run 卡还带「未收口·可能残留」徽标）。因此**本节不断言「已裁掉左侧栏 / 徽标已消失」**（README:15 的 alt 文案「左侧导航已裁掉」要等新图落盘后才成立），也不做成会红的断言——图落盘后按 8.5-1 人工复核。

### 8.5 未验证项（不按通过计）

1. **新图与 README 描述的一致性**：四张图（尤其 `panel-overview.png`）未重新生成/未人工比对；「左侧导航已裁掉」目前只是 README 的声明，不是已验证事实。
2. **README 的另两项基线数字**：`lib/index.js` 实际 632.60 kB vs 声明 629.54 kB、`lib/client.js` 实际 593.80 kB vs 声明 593.46 kB（并行实现改动导致）；README 自身已写「数字随实现漂移」，待 t8 统一刷新，本轮不作为缺陷。
3. **英文语义审校**：只机械校验了 h2 数量、图片集合、26 行命令逐字与版本/engines；英文散文是否与中文等义（尤其「诚实边界」「成员 API 分界」两段）未做人工逐句审校。
4. **真机安装/开关四件套**：README 的「30 秒上手」命令未在本轮重新执行（安装/回滚会改 profile），只有静态与既有单测依据。

---

## 9. r34 · 残留判定收紧的回归与门禁（t8，2026-11-13 追加）

> 用户 2026-11-13 口径：**确认没有存活成员才提示「未收口·可能残留」**（t7 已改 `isResidualRun` / `runSummaryRowOf` / `liveMemberCountOf`）。本节是 QA 侧的回归、边界、宿主字段与变异证据。

### 9.1 任务夹选择（二选一，选「追加」）

本节**追加到 r33 任务夹**，不新建 r34 任务夹。理由：r34 的改动全部是对 r33 期间落地的 t7 判定的验收（同一需求「跳转到成员」的收尾），证据与 §8 的 t5 报告同属一轮门禁；另起目录会让「同一轮测试基数 1229 → 1238」与四张图待补项分散在两处。下面所有数字都以本机 2026-11-13 本轮 `pnpm test` 输出为准。

### 9.2 ① 旧断言复核：**没有一条因口径变化变红，无需改前提**

三种证据都跑过（都在仓库根）：

1. `grep -rn --include='*.test.ts' -E "isResidualRun|residualBadge|RESIDUAL_RUN|未收口|可能残留|终止计划|liveMembers" test/` → 除本轮新增的两个 r34 文件外**零命中**；唯一旧命中是 `test/dispatch.test.ts:1496` 的「未收口任务」，指任务卡占用，与 run 残留判定无关。
2. `git log -S 'isResidualRun' -- test/` → 空（该函数从未被测试覆盖过）。
3. 三个被点名的文件在**改动前**就是全绿，改动后依旧全绿：`test/r24-stale-reconcile.test.ts` 11/11、`test/r25-closed-run-cards.test.ts` 10/10、`test/viewmodel.test.ts` 76/76。

因此本卡对「旧断言」的处理不是改前提，而是补一条**反向前提守卫**：`test/r34-live-members-residual.test.ts:112` 用「draft/dispatching/paused + 无 finishedAt + 无 liveMembers 事实」直接断言**不出徽标**——即 r24 那两条旧判据（计划态、无 finishedAt）单独不再能触发残留提示；把它改回 `return true` 会红（见 9.5 P1）。

### 9.3 ② 客户端四条边界（`test/r34-live-members-residual.test.ts`，5 例）

| 用例 | 行 | 断言要点 |
|---|---|---|
| ① `liveMembers>0` | :75 | 三种计划态逐一断言 `isResidualRun===false` 且行投影**没有** `residualBadge` 字段（按钮同源不渲染）；宿主 3 > 快照空列表时仍不提示 |
| ② `liveMembers===0` | :95 | `deepEqual(row.residualBadge, RESIDUAL_RUN_BADGE)`（徽标唯一来源）、`text/tone` 逐字、`RESIDUAL_RUN_TITLE` 含「确认没有存活成员」；宿主 0 压过快照里残留的 running 成员 |
| ③ `liveMembers===undefined` | :112 | 三种计划态均 `false`；`liveMembersOfSnapshot(undefined)===undefined`（不补 0）；快照只剩 done/failed/stopped → 0 → 提示；快照有 running → 不提示 |
| ④ 已结束/终态 | :144 | `finishedAt>0` 即使 `liveMembers===0` 也不判残留；terminated / cancelled 行无徽标 |
| ⑤ 徽标与按钮同源 | :161 | 三个入口（HistoryTab / TasksTab / RunSwitcher）源文本都必须按 `row.residualBadge` 分支；历史行与 run 卡各**恰好一次** `<RunCloseAction`，切换器零次（只传调用方注入的入口） |

为什么「不显示」用 `'residualBadge' in row === false` 而不是看文案：`runSummaryRowOf` 只在判定为真时写入该字段（`src/client/tabs/rows.ts` 的对象展开），字段缺席才是「没有按钮」的机械判据；按文案断言会把 copy 变更误报成功能回归。

### 9.4 ③ 宿主侧 `RunSummary.liveMembers`（`test/r34-host-live-members.test.ts`，4 例）

夹具用真实 `createBridge` + 临时 `RunsStore`，`now` 可变、`listMembers` 包一层计数器：

| 用例 | 行 | 断言要点 |
|---|---|---|
| ① 无 binding | :146 | `'liveMembers' in row === true` 且 `=== 0`（0 是事实，不是缺省） |
| ② alive >0 | :165 | 3 条绑定（alive / retired-but-running / inactive）→ 恰好 1；retired 与 dead 都不算 |
| ③ 读失败 / 无读口 | :196 | `listMembers` 同步抛错、以及装配时干脆不给读口：字段**缺席**且 `!==0`（0 会被客户端读成「确实没人」） |
| ④ 整批只读一次 | :226 | 装配预热先 `settle`，`resetCalls()`，推进 2000ms 越过 1500ms 名单 TTL，一次 snapshot 后计数 `=== 1`；`settle` 后第二次 snapshot 仍 `=== 1`；3 条 run 的计数各自独立（0 / 1 / 1）；`store.load('run-one')` 里没有 `liveMembers` 键（视图字段不落盘） |

计数器断言的意义：`historyOf` 每次快照都跑，若实现改成 per-run 调 `listMembers()`，功能仍「对」但 50 个 run × 2s 一刷会打爆宿主成员服务——只有计数能抓住这类退化。

### 9.5 ④ 变异矩阵（`node test/r34-mutation-probes.mjs`，3/3 通过）

做法同 r16：复制 `src/`、`test/` 与类型/构建配置到系统临时目录，先在原样副本上跑目标用例（必须 exit 0 且标题真的出现在输出里），再派生只打一处补丁的副本，必须 exit ≠ 0 且命中 `AssertionError`。

| # | 改坏点 | 基线 | 变异后 | 变红的用例 / 证据 |
|---|---|---|---|---|
| P1 | `src/client/viewmodel.ts`：`return run.liveMembers === 0` → `return true`（去掉第三条判据） | exit 0 | **exit 1** | ①：`AssertionError: draft + liveMembers=1 说明还有人在跑，不是残留` |
| P2 | 同上：`return (run.liveMembers ?? 0) === 0`（未知写成 0） | exit 0 | **exit 1** | ③：`AssertionError: draft 缺 liveMembers 时必须按「无法确认」处理，不得写成 0` |
| P3 | `src/host/bridge.ts`：unknown 分支 `return undefined` → `return 0`（读失败写成 0） | exit 0 | **exit 1** | 宿主 ③：`AssertionError: 读失败时字段必须缺席（不知道）` |

锚点命中次数在脚本里强制恰好 1 次；补丁没打上会整体失败，不会被误判成「测试抓不住」。脚本是 `.mjs`，不进 `pnpm test` 的 glob（`test/*.test.ts`），由本卡手动执行。

### 9.6 ⑤ 全量门禁（本轮唯一一次全量）

```
$ pnpm typecheck && pnpm test && pnpm build
EXIT=0
ℹ tests 1238
ℹ pass 1238
ℹ fail 0
✔ Build complete in 66ms   (lib/client.js 595.89 kB │ gzip 147.88 kB)
✔ Build complete in 48ms   (lib/index.js 632.60 kB │ gzip 209.50 kB)
```

基数分解：t5 记录 1229（r33 守卫 6 例已含）→ 本卡新增 `r34-live-members-residual` 5 例 + `r34-host-live-members` 4 例 = **1238**（+9，与 1229→1238 一致，无跳变）。

双产物导入 + 产物指纹（构建后）：

```
$ node --input-type=module -e "await import('./lib/index.js')"   → HOST_IMPORT_OK
$ node --input-type=module -e "await import('./lib/client.js')"  → CLIENT_IMPORT_OK
11745400a3d54c5fc0f0cfe88a3e057e0baa68675aea77c44e1de8894fed722f  lib/index.js   (632603 B)
4b4cd8e733e88a3fa56e67ec0ee0fa732748e9e97534101bbbc76468b4e21a28  lib/client.js  (595892 B)
$ grep -c liveMembers lib/client.js lib/index.js  → 8 / 6
```

### 9.7 未验证项 / 遗留（不按通过计）

1. **真机面板未复验**：本仓无 react-dom，`RunCloseAction` / 徽标组件不能渲染测试；⑤ 只钉了「数据开关同源 + 源文本分支」，「跑着的 run 在真机上确实看不到徽标与终止按钮」仍属未验证。宿主侧依赖 `ctx.get('subagents').listMembers`，本轮用注入读口覆盖，没有在真实宿主会话里造「有存活成员」的场景。
2. **README 里的产物体积已过期**：当前 `lib/index.js` 632.60 kB / `lib/client.js` 595.89 kB，README 声明 629.54 / 593.46（§8.5-2 记为待 t8 刷新）。本卡写域是 `test/`、`lib/`、`docs/teamflow/`，**未改 README**；需队长在后续收尾统一刷新，别为凑数改文档。
3. **AGENTS.md 的测试基数（1179 例）早于本轮**，当前实际 1238；本卡写域不含 AGENTS.md，仅记录漂移事实。
4. **变异探针不进门禁**：`node test/r34-mutation-probes.mjs` 是手动步骤（耗时与临时副本），CI 仅跑 `pnpm test`；若后续把它接进 CI，需要另行确认临时目录与 node_modules 软链的可用性。
