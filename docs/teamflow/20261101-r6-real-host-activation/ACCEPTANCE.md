# 验收报告 · r6 真机加载缺陷修复

- 需求：修复真机加载缺陷——让 `dsh-auto-team` 插件在真实宿主里能被激活，并让输入框下方的开关行与右栏「自动团队」页签真正渲染出来
- run：`tf-mvxcfxze-e9elp3`（流水线在「开发 · QA 缺陷修复（第 1 轮）」处因 384k 新增 token 熔断判 failed）
- 验收人：主 agent（lead）
- 验收时间：2026-11-01
- 验收结论：**✅ 通过（真机端到端已跑通）**

## 0. 本报告的性质说明

流水线的 QA 轮（seq 9）出具的 `QA-REPORT.md` 结论是「不通过」，列出四个真缺陷（QA-01/02/03/05）。其后流水线把修复任务派给 dev，**代码确实落盘了，但阶段被 token 熔断判成「1 次尝试未交付，无阶段记录」**，于是 QA 第二轮与验收轮都没跑。

本报告是主 agent 在 HEAD 上**自己跑出来的结论**，不是转抄流水线自报：每一条都附命令与返回值，并区分「本机可自动验的」与「只有真机能验的」。

## 1. 三个阻塞项与其修复（真机实测，症状 → 根因 → 修复）

| # | 症状（真实宿主） | 根因 | 修复位置 |
|---|---|---|---|
| 1 | boot 日志 `dsh: warning: 1 entry did not activate` + `Error: cannot get property "agentTeams" without inject` | entry 的 `inject` 只声明 `tools`/`systemPrompt`，代码却访问 `ctx.agents`/`ctx.agentTeams`/`ctx.webServer`/`ctx.llm`/`ctx.agentDefaultModel` | `src/host/index.ts` 的 `inject` 补齐硬依赖；可选服务改经 `optionalService` / `ctx.get` |
| 2 | 控制台 `Uncaught Error: keyed slot "sidebar.right.pane.tab" requires options.key` | keyed slot 注册缺 `key`；且右栏页签还缺「tab 类型注册」 | `src/client/slots.ts`（`{ name, key, inject }` + 向 `sidebarRightTabs` 注册 `{ id, kind, priority, title }`） |
| 3 | 面板永远显示「面板接口失败：HTTP 404」 | `webServer` 在 `apply` 时刻尚未激活，`registerHttpRoutes` 只试一次就 `return false`，路由一条都没注册 | `src/host/adapters.ts`（两级：先试一次 → 失败则 `ctx.inject(['webServer'], cb)` 等就绪再注册；配 `readServiceQuietly` 静默读法） |

第 3 条是本轮新发现、QA 报告里没有的：它只在真机 + 真 HTTP 请求下暴露，单测与 mock 全绿。

## 2. AC 逐条判定

| AC | 判定 | 证据（命令 / 实测） |
|---|---|---|
| AC-1 加载入口声明存在且 `name` 用包根名 | ✅ | `--profile rt5 --dump-config` 的组合树末尾：`# == dsh-auto-team` / `- id: auto-team-host` / `name: dsh-auto-team` |
| AC-2 inject ⊇ 裸访问面，可选服务走 `ctx.get` | ✅ | `node logs/…/scripts/check-t1-contract.mjs` → **14/14 PASS**；`pnpm test` 的 `optionalService 的字面量集合 === OPTIONAL_SERVICES` 通过 |
| AC-3 真宿主 boot 零 warning 且 entry 激活 | ✅ **真机** | `grep -cE "did not activate\|cannot get property" /tmp/rt5-boot3.log` → `0`（修复前同一条 grep 命中 1 行） |
| AC-4 一致性守卫 + 变异自检必红 | ✅ | `bash logs/…/scripts/guard-mutation.sh` → exit 0，三处契约（host inject / keyed key / 页签类型注册）各自「变红 → 复原 → 转绿」，且复原后 sha256 与备份一致、工作区零残留 |
| AC-5 双产物顶层不抛错、零服务访问 | ✅ | `node --input-type=module -e "await import('./lib/index.js')"` 与 `…'./lib/client.js'` 均 exit 0 |
| AC-6 keyed slot 带 `key` + 两处带 `inject(sessionId)` | ✅ | `node logs/…/scripts/client-slots-probe.mjs` → `pass=38 fail=0` |
| AC-7 挂载点 `name` 与 `inject` 参数逐字相同，插件标识进 id/key | ✅ | 同上探针；`qa-host-slot-contract.mjs` → `pass=11 fail=0` |
| AC-8 真机 DOM 里开关行与右栏页签真的出现 | ✅ **真机** | 见 §3：`composer.dock` 出现开关行、点「面板」后 `sidebar.right.pane.tab` 与 `.title` 各 1 个座位、右栏渲染面板 |
| AC-9 client 声明与产物非空且含包 id | ✅ | `npm pack --dry-run` 含 `lib/client.js` 113.9 kB；批量 plugins 包里 `dsh-auto-team-toggle` ×23、`dsh-auto-team-panel` ×38 |
| AC-10 入口声明与双产物进 `files` 并被 pack 收进 | ✅ | `npm pack --dry-run` → `cordis.patch.yml 646B` / `lib/client.js 113.9kB` / `lib/index.js 228.8kB`，`total files: 5` |
| AC-11 依赖协议可解析、peer 覆盖宿主包 | ✅ | `pnpm test`（peer/依赖协议断言）全绿；`q=0` 处 `workspace:` |
| AC-12 产物与源码同步（含 profile 内那份拷贝） | ✅ | `find src -newer lib/index.js -name '*.ts*' \| wc -l` → `0`；profile 内的 `lib/` 与仓库同 inode（硬链接），构建即同步 |
| AC-13 一条可复跑真机验证脚本 + 步骤原文 | ✅ | `logs/…/scripts/real-host-verify.sh`、`real-host-dom.mjs`、`real-host-assert.mjs` + `docs/teamflow/architecture/REAL-HOST-VERIFY.md`（含 §7 本轮实测） |
| AC-14 主 agent 实跑结论进验收报告 | ✅ | 本文件 §3 |
| AC-15 安装带回滚 | ✅ | 反向步骤写在 `REAL-HOST-VERIFY.md` §6（`npx --yes pnpm@11 remove dsh-auto-team` + 从 `dsh.profile.bundles` 摘除） |
| AC-16 desktop 真宿主验证期间零污染 | ✅ | 全程在克隆 profile（`dv`/`rt4`/`rt5`）上做；`~/.dsh/profiles/desktop/package.json` mtime 未变 |
| AC-17 全量门禁 + r4 复核不降 | ✅ | typecheck exit 0；`pnpm test` **337/337**；`qa-reverify 9/9`、`qa-collision 12/12`、`qa-peer 7/7`、`captain-guard 24 asserts`、`trigger-probe 33 asserts` |
| AC-18 不夹带：预算常量/路由/PanelAction/kind/setInterval 不变 | ✅ | `qa-interface-consistency.mjs` → `pass=9 fail=0` |

## 3. 真机端到端实录（2026-11-01，克隆 profile `rt5`，端口 51895）

```bash
# ① 宿主激活（修复前此处有 1 条 warning）
grep -cE "did not activate|cannot get property" /tmp/rt5-boot3.log        # → 0

# ② 面板接口（修复前 404）
curl -s -w '%{http_code}' -b <cookie> \
  'http://127.0.0.1:51895/api/auto-team/snapshot?sessionId=x'             # → 200
#   body: {"data":{"enabled":false,"tasks":[],"roles":[{"id":"architect","name":"架构师",…}],
#                  "concurrency":{"limit":3,"running":0,"source":"default"},
#                  "memory":{"injectedChars":0,"budget":4000,…}}}

# ③ 界面（chrome-headless-shell + CDP，造一个活会话）
#   [data-slot] 出现 conversation.input.dock / conversation.composer.dock / rightbar / rightbar.session
#   toggle 节点 1 个、body 含「自动团队」、控制台零异常
#   点「面板」→ sidebar.right.pane.tab=1、sidebar.right.pane.tab.title=1
#     右栏文本：「自动团队 / 已关闭 / 计划 0 · 成员 0 · 并发 0/3 /
#                队长模型 跟随宿主默认 · 事件源正常 / 刷新 / 计划 成员 记忆 角色」
#   点「启用自动团队」→ 开关行状态从「已关闭」变「待派发」（act 路由通）
```

**关键点**：`conversation.composer.dock` 是 `scope=session` 的 list 槽位，**必须在活会话里才渲染**——在新建会话落地页采样会得到「未挂载」的假阴性（这正是 QA-03 的归因错误）。页签是 keyed + 需要 tab 类型注册，不点「面板」也不会自动出现（`sidebarRight.openTab(kind)`）。

## 4. 门禁汇总（本轮实跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm -s typecheck` | exit 0 |
| 单测 | `pnpm -s test` | tests 337 / pass 337 / fail 0（≈3.3s） |
| 构建 | `pnpm -s build` | `lib/index.js` 228.83 kB（gzip 76.83）、`lib/client.js` 113.9 kB |
| 产物新鲜度 | `find src -newer lib/index.js -name '*.ts*'` | 0 |
| 装载 | 两条 `await import('lib/*.js')` | exit 0 / exit 0 |
| 分发 | `npm pack --dry-run` | 5 文件，含 `cordis.patch.yml` + 双产物 |
| 变异自检 | `bash logs/…/scripts/guard-mutation.sh` | exit 0，三处契约红→绿可复现 |
| 真机 | 见 §3 | 激活 / 200 / 开关行 / 页签 / 面板数据 / act 通 |

## 5. 未验证项（环境限制，如实记录）

1. **桌面 profile（`desktop`）未被 CLI 直接启动验证**：宿主自己管理该 profile（`error: profile "desktop" is managed exclusively by the Electron application`），所以本轮全部在克隆 profile 上验证；desktop 里已装的插件**需要重启桌面宿主**才生效，重启会打断当前会话，尚未做。
2. **多会话并发下的页签行为**未验（当前只验单会话）。
3. **`sidebarRightTabs.register` 的 `canOpen`/`keepMounted` 语义**未验（未用到）。
4. 面板在窄宽度下的视觉排版（四列挤压）未做人工观感复核。

## 6. 遗留（不属本轮范围）

- P3-3 `store.list()` 全量扫、P3-4 面板长文本截断、跨 run 同名 fallback 假阴性——三条仍未立项。
- 清理实验 profile（`dv`/`rt4`/`rt5`/`verify-at`）与 desktop 里的插件安装，需用户决定留存或撤销。
