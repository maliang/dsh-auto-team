<!-- meta: summary="修复成员名归一塌缩（R2-1）并补 peer 声明、技能正文运行期断言与不实 QA 描述勘误，重跑全部探针与门禁出新验收" -->

基线依赖：docs/teamflow/20261030-r1-auto-team-plugin（其 AC-1~AC-25 / AC-30 既有行为不得回归；本轮只做缺陷修复、契约补齐与证据补强）

取代：docs/teamflow/20261030-r1-auto-team-plugin#AC-17：成员名生成规则改为「角色可读段 + 任务可读段 + 原始身份短哈希」；「同一任务名字恒定、恢复不翻倍、不重跑」的语义不变，仅名字形态变化

---

## 1. 背景与目标

### 1.1 事实（均已在仓库/交付物中核对）

| 事实 | 证据位置 |
|---|---|
| 成员名由 `memberNameFor` 生成，只做「小写 + 非 `[a-z0-9]` 折成 `-`」 | `src/host/team/dispatch.ts:103` |
| 派发时唯一取名字的调用点 | `src/host/team/dispatch.ts:245`（`const name = memberNameFor(task)`） |
| 宿主名契约：`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，长度上限 48 | `src/host/config.ts:78`、`src/host/config.ts:81` |
| 现有单测只做「单任务合法性」视角（并有一条把旧形态 `dev-t1` 写死） | `test/dispatch.test.ts:374`、`test/dispatch.test.ts:393`、`test/dispatch.test.ts:420` |
| `package.json` 的 `peerDependencies` 只有 `react`，7 个 `@deepseek-ai/*` 客户端注入包**未声明** | `package.json:60`、`package.json:63`；`dsh.client.inject` 在 `package.json:24-30` |
| 上一轮 QA 声称 peer 已达标（不实） | `docs/teamflow/20261030-r1-auto-team-plugin/QA-REPORT.md:97` |
| 技能正文注入函数存在，但没有任何运行期断言证明它进了成员 prompt | `src/host/roles/builtin.ts:135`、`src/host/index.ts:92` |
| 上一轮 QA 新增探针：碰撞 5 项（C1~C5）、复验 9 项（A1~A5、B1~B4） | 归档于 `$DSH_HOME/teamflow/ws-dsh-auto-team-20702aa5/logs/tf-mvv49icd-0axwfe/scripts/` |

**缺陷本质（R2-1）**：归一化把「身份信息」和「可读信息」一起压掉了。`dev-登录流程` → `dev`、`dev-注册接口` → `dev`、`dev-Login_Flow` 与 `dev-login-flow` → 同一个 `dev-login-flow`。宿主 `memberName()` 只校验字符集、不去重，于是同角色第二个任务的 `spawn` 被宿主判重名拒绝，该任务永久停在 `pending`——面板上看不见原因，只能看到「一个成员在跑、另一个任务不动」。这直接破坏 AC-15（就绪任务并行）、AC-16（直达消息要能区分身份）、AC-17（靠名字重绑），因此上一轮判「不可验收」。

### 1.2 目标

1. 让成员名**在归一后仍保持身份可分**：不同 `(roleId, id)` 必得不同名字；同一 `(roleId, id)` 必得同名（确定性与唯一性同时成立）。
2. 在派发层加**两两唯一断言**作为最后防线：宁可显式报错，也不静默重名 spawn。
3. 补齐 `@deepseek-ai/*` 的 `peerDependencies`（可选 peer），并**更正**上一轮 QA-REPORT 中不实的 peer 描述。
4. 补一条**运行期**断言：内置角色的技能正文特征句真的出现在成员 prompt 里（不是「读了代码觉得应该有」）。
5. 全量重跑既有 checker 与门禁，产出本轮 `QA-REPORT.md` 与 `ACCEPTANCE.md`。

### 1.3 用户故事与验收标准

- **US-1（队长视角）**：我把「登录流程」「注册接口」两个任务派给同一角色，两个成员都能建出来，各自推进，面板各有一行。
  - 判据：AC-1、AC-2、AC-4、AC-6
- **US-2（运维视角）**：插件被宿主重启后我再点恢复，成员不翻倍、已完成不重跑、名字还能对上原来那个任务。
  - 判据：AC-3、AC-7
- **US-3（安装者视角）**：我用 `pnpm add file:<repo>` 装进 desktop profile，安装过程不因 peer 声明缺失/错位出现 `ERR_PNPM` 或大片 unmet peer。
  - 判据：AC-8
- **US-4（验收人视角）**：我读 QA-REPORT 能逐条复现结论；上一轮那种「写着 PASS、仓库里其实没有」的情况不再出现。
  - 判据：AC-9、AC-12
- **US-5（验收人视角）**：我能在不看源码的前提下确认「成员真的拿到了技能正文」。
  - 判据：AC-10

### 1.4 验收标准（本夹编号，自 AC-1 起）

| AC | 内容 | 判据（可执行 / 可量化） |
|---|---|---|
| AC-1 | **唯一性（核心）**：`memberNameFor` 对任意两个不同 `(roleId, id)` 给出不同名字。固定样例：`dev/登录流程` ≠ `dev/注册接口`；`dev/Login_Flow` ≠ `dev/login-flow`；`dev/t1` ≠ `dev/t2`。 | `qa-collision-probe.mjs` 的 C2、C3、C1 全绿；且 `test/dispatch.test.ts` 有同角色多任务用例 |
| AC-2 | **先编码身份段再归一**：名字中含由**原始** `roleId + id`（含大小写、分隔符、中文）派生的身份段；纯中文 id 不得塌缩成角色名（`dev/登录流程` ≠ `dev`）；输出仍满足 `HOST_MEMBER_NAME` 且长度 ≤ 48。 | 探针 C5 绿；单测断言字符集正则与长度上界 |
| AC-3 | **确定性**：同一 `(roleId, id)` 反复计算（含计划重新加载、进程重算）名字逐字相同；恢复后按 `binding.taskId` 绑定，不依赖名字格式。 | 单测「同输入恒等」；探针 C1；复验探针幂等项绿 |
| AC-4 | **派发层两两唯一断言**：`dispatchReady` 在 `spawn` 之前对本计划全部任务名做唯一性校验；冲突时该任务**不 spawn**，并写入 `errors`（含冲突名与任务 id），不得出现「宿主返回 `TEAM_MEMBER_EXISTS` → 静默永久 pending」。 | 单测用「强制撞名的 `memberNameFor` 桩」验证：`errors.length > 0`、无重复 spawn 名、对应任务不进入 `running` |
| AC-5 | **多任务单测**：`test/dispatch.test.ts` 新增 ≥4 例（同角色中文 id ×2、仅大小写/分隔符差异 ×2、N=5 两两唯一、48 边界 + 合法性 + 确定性）；旧断言 `dev-t1` 按新契约同步更新（**不得**放宽为模糊匹配）。 | `pnpm test` 全绿，用例数 ≥ 150（现 146） |
| AC-6 | **碰撞探针 5/5**：`qa-collision-probe.mjs` C1~C5 全绿。 | 输出 `QA COLLISION PROBE RESULT: 5/5 passed`，exit 0 |
| AC-7 | **复验探针 9/9 不回归**：`qa-reverify-probe.mjs` 仍 9/9（A1~A5、B1~B4），**项数不得变**。 | 输出 9/9，exit 0 |
| AC-8 | **peer 声明补齐**：`dsh.client.inject` 的 7 个 `@deepseek-ai/*` 包全部出现在 `peerDependencies`，且 `peerDependenciesMeta[*].optional === true`；`dependencies` 中 `@deepseek-ai/*` 数量为 0；`react` 保留。 | 一行脚本比对三集合输出 PASS；`pnpm build/test/typecheck` 不因之失败 |
| AC-9 | **peer 描述更正**：本轮 QA-REPORT 必须写明「上一轮 `QA-REPORT.md:97` 的 PASS 不实（当时 `package.json` 只有 `react` peer）」，并贴出两轮的真实命令与输出；不得只写「已修正」。 | QA-REPORT 内含该条 + 至少一条 `grep/sed` 实跑输出 |
| AC-10 | **技能正文运行期断言**：新增独立探针 2 项——① 走真实 bridge + 真实 `buildPrompt` 派发内置角色（`skillIds` 非空），捕获的 spawn `prompt` 含该技能正文的特征句；② 对照：`skillIds` 为空的自建角色 prompt **不含**该句。 | 新探针 `2/2`，exit 0；既有两个探针项数不变（5、9） |
| AC-11 | **全量门禁**：`pnpm typecheck` 0 错；`pnpm test` 全绿；`pnpm build` 生成 `lib/index.js` + `lib/client.js` 且 mtime 晚于 `src` 最新 mtime；两产物 `node --input-type=module -e "await import('./lib/…')"` exit 0；`npm pack --dry-run` 含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`。 | 5 项命令 + 输出尾部贴在 QA-REPORT 判定表 |
| AC-12 | **交付文档**：本夹产出 `QA-REPORT.md` 与 `ACCEPTANCE.md`，均含判定表（每条命令 + 至少一行实跑输出）与明确结论（可验收 / 不可验收）；ACCEPTANCE 逐条覆盖 AC-1~AC-11。 | 两文件存在且 AC 覆盖数 = 11，无「待补」占位 |

## 2. 范围与非目标

**范围内**

- `src/host/team/dispatch.ts`：`memberNameFor` 改为「可读段 + 身份短哈希」并新增唯一性断言。
- `test/dispatch.test.ts`：多任务 / 碰撞 / 边界用例。
- `package.json`：补 7 个 `@deepseek-ai/*` 可选 peer。
- `logs/teamflow/<runId>/scripts/`：迁移并重跑碰撞、复验探针；新增技能正文探针。
- 本任务夹：`PRD.md`（本文）、`TECHNICAL.md`、`QA-REPORT.md`、`ACCEPTANCE.md`。

**非目标（本轮不做）**

- 不改角色/记忆/门禁/面板的功能语义，不新增 UI。
- 不重构 `dispatchReady` 的并发与门禁流程（只插入唯一性校验）。
- 不修改 `docs/teamflow/20261030-r1-auto-team-plugin/` 任何文件（任务夹不可变；勘误只落本轮）。
- 不做历史 run state 迁移：旧 `bindings.name` 存档照旧可读，恢复按 `taskId` 匹配。
- 不追求名字「人类可读且全局无碰撞」的数学证明，只要求工程上两两可分 + 断言兜底。

## 3. 反面目标（anti-goals）

即使测试全绿、探针全过，出现下列任一情况仍应判**不可验收**：

1. **探针绿但真实链路仍塌缩**：同一角色两个中文任务，面板上第二个任务永远 `pending`、且没有任何失败原因（只有探针里的桩 `spawn` 不再报错）。
2. **靠序号/列表位置消歧**：名字里带 `-1/-2` 由派发顺序决定 —— 恢复一次后同一任务换名、成员翻倍（AC-17 回归）。
3. **截断兜底吃掉唯一性**：两个 40 字以上长 id 截到 48 字符后变成同一个名字，且断言没覆盖长 id。
4. **名字变成一串不可读哈希**：人在面板与直达消息里认不出「哪个角色、哪个任务」（唯一性靠牺牲可读性换来，用户会直接说「这不是我想要的」）。
5. **QA-REPORT 只是换了措辞**：旧的 PASS 措辞残留、或只写「已修正」而不贴命令与输出，验收人无法复现——等于把不实结论包装了一遍。

## 4. 交互流程摘要（修复后的派发链路）

1. `auto_team_plan` 建计划 → 任务图就绪集（`pending` → `ready`）。
2. `dispatchReady` 对每个就绪任务：
   a. 计算 `name = memberNameFor(task)`（角色可读段 + 任务可读段 + 原始身份短哈希，整体 ≤48、lower-kebab）；
   b. **唯一性断言**：本计划全部任务名两两不同（对已存在 `bindings` 的同名也判冲突）；冲突 → `errors` + 该任务不 spawn；
   c. 逐角色模型预校验（不变）→ `spawn`（不变）→ `bindings` 落盘（含 `name`）。
3. watcher 1.5s / 前端 2s 轮询 → 面板每行显示角色/任务/状态/实际模型。
4. 恢复：`snapshot` → 按 `binding.taskId` 绑回成员，**不重算旧名去匹配**。

## 5. 优先级

- **P0**：AC-1、AC-2、AC-3、AC-4、AC-6、AC-7、AC-11（缺陷本体 + 不回归 + 门禁）
- **P1**：AC-5、AC-8、AC-9、AC-10（契约补齐与证据补强）
- **P2**：AC-12（文档收口，可与 P0/P1 同轮完成）

## 6. 依赖与风险

| 依赖/风险 | 说明与应对 |
|---|---|
| 宿主名契约可能变动 | `HOST_MEMBER_NAME` / `MAX=48` 是单点常量（`src/host/config.ts:78`），改动只影响 `memberNameFor` 与单测；实现不得复制字面量 |
| 短哈希碰撞 | 6 位 base36 ≈ 2.2×10⁹ 空间；碰撞概率工程可忽略，但仍由 AC-4 断言兜底（碰撞时显式报错而非静默） |
| 截断破坏唯一性 | 可读段截断后仍保留完整短哈希，且断言覆盖长 id 用例（反目标 3） |
| 恢复幂等回归 | 既有 9 项复验探针必须原地重跑并保持 9/9；不得为了让新断言通过而改探针项数 |
| 探针路径依赖 | 探针放在 `logs/teamflow/<runId>/scripts/`，相对 import 深度 `../../../../src/...`；换位置必须同步改 import |
| 共享工作树 | 本轮结束前不落第二笔提交；提交后不再改文件（避免把复核判决与字节版本错位） |
| 时间预算 | 全量 checker 一轮 10~15 分钟量级；先修 P0 → 本地单测 → 再跑全量，避免反复全量 |

## 7. 里程碑建议

1. **M1 契约与单点修复**：`memberNameFor` 新算法 + `test/dispatch.test.ts` 多任务/边界用例（AC-1/2/3/5 的一半）。
2. **M2 派发断言**：`dispatchReady` 唯一性校验 + 桩单测（AC-4）。
3. **M3 契约补齐**：`package.json` 7 个可选 peer + 集合比对脚本（AC-8）。
4. **M4 证据补强**：迁移两份探针 → 碰撞 5/5、复验 9/9；新增技能正文探针 2/2（AC-6/7/10）。
5. **M5 全量门禁**：typecheck / test / build / 双产物 import / npm pack（AC-11）。
6. **M6 文档与提交**：QA-REPORT（含 peer 勘误）→ ACCEPTANCE → 单笔提交（AC-9/12）。

## 8. 工程约束（raw requirement 原样保留 + 本仓库卫生要求）

- **raw requirement 中的工程动作（逐字保留）**：修复 `dispatch.ts` 的 `memberNameFor`（先编码身份段再归一）；加成员名两两唯一断言与多任务单测；补齐 `@deepseek-ai/*` 的 `peerDependencies` 声明；更正 `QA-REPORT` 中不实的 peer 描述；补一条技能正文进成员 prompt 的运行期断言；最后重跑 `qa-collision-probe`（须 5/5）与 `qa-reverify-probe`（须 9/9）以及 `typecheck`、`test`、`build`、双产物 import、`npm pack` 自检，并重跑 QA 与产品验收出新 `ACCEPTANCE`。
- **分支与基线**：在 `feat/auto-team-plugin` 上原地修改，**不切分支、不 rebase、不 squash 历史**；分支基线为当前 HEAD（`a0d32df`）。
- **现有未提交改动**：仓库当前只有 1 处未提交项 `?? docs/teamflow/20261031-r2/`（本任务夹）。**必须保留**，不得 `git checkout`/`stash drop` 丢弃，随本轮交付一并入库。
- **构建产物入库**：`lib/index.js` / `lib/client.js` 是本插件的安装源，`pnpm build` 后必须入库；`.gitignore` 不得忽略 `lib/`。
- **`.gitignore` 审计（本栈：pnpm + tsdown + `node --test`）**：现有已覆盖 `logs/teamflow/`、`node_modules/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`、`.auto-team/`。本轮开发阶段需补：① `*.tgz`（若用 `npm pack` 非 `--dry-run`，包会落在仓库根）；② `pnpm-debug.log*`；③ 临时探针输出目录（一律落 `logs/teamflow/` 下，不散落项目根）。补完用 `git status --porcelain` 确认仓库根无新增噪声文件。
- **提交**：修复 + 文档一次到底后**单笔提交**，message 点名「R2-1 成员名塌缩 / peer 补齐 / 技能正文运行期断言」；`logs/teamflow/` 不入库（由 host 归档）。
- **文档边界**：只写 `docs/teamflow/20261031-r2/`、`docs/teamflow/memory.md`（如有约定变化）与 `logs/teamflow/tf-mvvjakqn-xhhc7s/`；**不得**写宿主 `docs/<职责>/`，不在项目根留 dump 与脚本。

## 9. 假设与待澄清

- **（事实）`@deepseek-ai/*` 的 peer 版本范围怎么声明**：本机 profile 里只有 `@deepseek-ai/cosmokit`(`1.8.6`) 与 `@deepseek-ai/schemastery`(`3.18.5`)，7 个 `dsh-client-*` 由宿主注入、仓库内查不到版本，因此无法确定「精确范围」。**默认取 `"*"` + `optional: true`**（不制造版本假冲突；若改为与 `engines.dsh` 对齐的窄范围，则宿主小版本升级可能触发 unmet peer 告警）。
- **（主观）唯一性 vs 可读性怎么配比**：`dev-登录流程-<短哈希>` 这种「保留可读段 + 短哈希」最友好，但长 id 截断后只剩哈希；另一种是统一 `dev-<8 位哈希>` 更短更稳。**默认取前者**（可读段 ≤16 字符 + 6 位 base36 短哈希，总长 ≤48）：面板与直达消息里能认出是哪个任务，代价是名字偏长。
- **（主观）撞名时的产品行为**：编码后理论上不撞，但断言触发时是「报错停派（任务留 `pending` 并在面板显示原因）」还是「确定性消歧（追加 `-2`）」？**默认取报错停派**：重名是契约被破坏的信号，静默改名会让 AC-17 的重绑不再可信。
