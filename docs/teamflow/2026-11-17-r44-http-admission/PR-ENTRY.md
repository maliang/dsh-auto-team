# awesome-dsh-plugin 条目描述修订稿（删掉「HTTP 路由没有访问检查」警示）

用途：PR #15735 已把本插件合并进 awesome-dsh-plugin（`data/plugins/maliang__dsh-auto-team.yml`，`category: workflow`），
维护者在两份 `description` 末尾各追加了一句安全警示。r44 已让面板前缀路由先过宿主的
`connection.requestRejection`（`src/host/adapters.ts:870` 的 `refusalOf`：`403` Host/Origin 不可信、`401` 无认证 Peer、
`undefined` 放行），所以那句警示不再成立，本文件给出发 PR 用的完整 yml 与逐行 diff。

## 0. 提 PR 的前置条件（不满足就不要提）

1. **含 r44 修复的版本已发布并推送 tag**。已核实当前最新 tag `v0.2.6` **不含**本修复：
   `git show v0.2.6:src/host/adapters.ts | grep -c requestRejection` → `0`。
   条目描述里删掉警示，等于对外声明「已发布的版本会做准入」；版本号由队长决定，发布并推 tag 后再提 PR。
2. 目标文件仍是合并时的路径 `data/plugins/maliang__dsh-auto-team.yml`（PR #15735 只新增了这一个文件）。
3. `description.en` 含 `: `（冒号+空格），必须用单引号包裹 —— 这是 awesome 的 CI 规则，合并版本本来就是这么写的，**不要为了好看去掉引号**。

## 1. 提交用的完整 yml（整文件替换，不要只改半行）

<!-- yml:begin -->
```yaml
url: https://github.com/maliang/dsh-auto-team
name: maliang/dsh-auto-team
category: workflow
description:
  en: 'Turns the current session into a team lead: splits a goal into a dependency graph of tasks, assembles a team from 11 built-in roles (each optionally bound to its own provider, model and reasoning effort), and dispatches ready tasks concurrently into their own sub-sessions. A task is done only after its acceptance command runs through a receipt that records the exit code and output tail; a live panel reports duration and token totals per run, task and member.'
  zh: '把当前会话变成领队：把目标拆成带依赖的任务图，从 11 个内置角色自动组队（每个角色可绑定自己的 provider、模型与推理强度），把就绪任务并发派发到各自子会话。任务只有验收命令经回执跑过、并记录退出码与输出尾部才算完成；实时面板按 run / 任务 / 成员统计用时与 token。'
```
<!-- yml:end -->

与合并版本的差别**只有**被删掉的那一句：其余能力描述（依赖图 / 11 个内置角色可绑 provider-模型-推理强度 /
回执记录退出码与输出尾部 / 面板按 run-任务-成员统计用时与 token）逐字保留，没有新增、没有夸大、没有改分类。

## 2. 与已合并版本（`main` 上的同名文件）的 diff 行

只有 `description.en` 与 `description.zh` 两行改动，各 1 行删除 + 1 行新增；`url` / `name` / `category` 与另一语言的描述不变。

```diff
--- a/data/plugins/maliang__dsh-auto-team.yml
+++ b/data/plugins/maliang__dsh-auto-team.yml
@@ -1,6 +1,6 @@
 url: https://github.com/maliang/dsh-auto-team
 name: maliang/dsh-auto-team
 category: workflow
 description:
-  en: 'Turns the current session into a team lead: splits a goal into a dependency graph of tasks, assembles a team from 11 built-in roles (each optionally bound to its own provider, model and reasoning effort), and dispatches ready tasks concurrently into their own sub-sessions. A task is done only after its acceptance command runs through a receipt that records the exit code and output tail; a live panel reports duration and token totals per run, task and member. Its HTTP routes have no DSH access check, so a web page open in your browser could call them.'
-  zh: '把当前会话变成领队：把目标拆成带依赖的任务图，从 11 个内置角色自动组队（每个角色可绑定自己的 provider、模型与推理强度），把就绪任务并发派发到各自子会话。任务只有验收命令经回执跑过、并记录退出码与输出尾部才算完成；实时面板按 run / 任务 / 成员统计用时与 token。它的 HTTP 路由没有 DSH 的访问检查，浏览器里打开的网页可以调用它们。'
+  en: 'Turns the current session into a team lead: splits a goal into a dependency graph of tasks, assembles a team from 11 built-in roles (each optionally bound to its own provider, model and reasoning effort), and dispatches ready tasks concurrently into their own sub-sessions. A task is done only after its acceptance command runs through a receipt that records the exit code and output tail; a live panel reports duration and token totals per run, task and member.'
+  zh: '把当前会话变成领队：把目标拆成带依赖的任务图，从 11 个内置角色自动组队（每个角色可绑定自己的 provider、模型与推理强度），把就绪任务并发派发到各自子会话。任务只有验收命令经回执跑过、并记录退出码与输出尾部才算完成；实时面板按 run / 任务 / 成员统计用时与 token。'
```

删掉的两截原文（供审核逐字核对）：

- en 被删：` Its HTTP routes have no DSH access check, so a web page open in your browser could call them.`
- zh 被删：`它的 HTTP 路由没有 DSH 的访问检查，浏览器里打开的网页可以调用它们。`

## 3. 提交前自检（仓库根执行，逐条可复制）

取当前 `main` 上的已合并版本，与本文档里的 yml 做真实的逐行 diff：

```bash
curl -sSL https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/maliang__dsh-auto-team.yml -o /tmp/awesome-merged.yml
sed -n '/^<!-- yml:begin -->$/,/^<!-- yml:end -->$/p' docs/teamflow/2026-11-17-r44-http-admission/PR-ENTRY.md | grep -v '^<!--' | grep -v '^```' | sed '/^$/d' > /tmp/awesome-new.yml
diff -u /tmp/awesome-merged.yml /tmp/awesome-new.yml
```

再跑三条不变量（本地没装 pyyaml，`python3 -c "import yaml"` 会 `ModuleNotFoundError`，所以用 grep 断言而不是解析器）：

```bash
diff -u /tmp/awesome-merged.yml /tmp/awesome-new.yml | grep -cE '^[-+]  (en|zh):'   # 期望 4（两删两增），多一行说明正文被顺手改了
grep -q "^  en: '.*'$" /tmp/awesome-new.yml && echo "en: 单引号包裹 OK"
grep -c 'access check\|访问检查' /tmp/awesome-new.yml                              # 期望 0（grep 无命中退出码 1，属正常）
```

第一条输出 `4`、第二条输出 `en: 单引号包裹 OK`、第三条输出 `0`，才算可以提 PR。

## 4. PR 提交信息（建议）

- 标题：`Update maliang/dsh-auto-team description: drop the stale "no access check" note`
- 正文只说三件事：
  1. 从 v0.2.7（以实际发布版本为准）起，面板接口 `/api/auto-team/*` 会先调宿主的 `connection.requestRejection`：Host/Origin 不可信返回 403、无认证 Peer 返回 401；
  2. 旧宿主没有该方法时退化为旧行为（宿主日志告警一次），因此条目不再需要那句警示；
  3. 其余描述逐字未改，diff 仅两行。

## 5. 未完成项（不掩盖）

- **尚未发版**：带 r44 修复的版本还没 commit/tag（当前 `v0.2.6` 不含 `requestRejection`，见 §0），本 PR 必须先等发版，否则条目描述会领先于已发布代码。
- **尚未在真机上复验新版本**：`curl` 无 cookie 应得 `401` 的实证在 r44 任务里做过，但那是未发布构建；发版后应按 ARCHITECTURE 的探针流程再测一次。
- README 已经按新口径补了准入说明（`README.md:115` / `README.en.md:115`），但 README 里的版本号要等发版时才跟 `package.json` 一起变。
