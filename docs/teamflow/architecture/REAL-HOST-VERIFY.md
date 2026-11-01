# 真机验证回路（第二个宿主 + 无头浏览器取证）

> 目的：证明「插件在**真实宿主**里能被激活、能渲染」，而不是只在 mock ctx 里通过单测。
> 本文记录 2026-11-01 主 agent 实际跑通的命令原文与判据（此前未留档，导致下游只能猜）。
> 权限：**只有主 agent 能做**（子代理权限固定在工作区，装不了 profile）。

## 0. 先决：desktop profile 归 Electron 独占

```
$ dsh --profile desktop --no-open --port 51890
error: profile "desktop" is managed exclusively by the Electron application
```

所以必须克隆一个别名 profile 来做验证，**不要动 `desktop`**。

## 1. 造一个可启动的验证 profile

```bash
# 460M，约 10 秒
cp -a ~/.dsh/profiles/desktop ~/.dsh/profiles/dv
```

克隆出来的组合树（2621 行）末尾应出现本插件：

```bash
cd ~/.dsh/profiles/dv
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile dv --dump-config | tail -5
# 期望： # == dsh-auto-team / - id: auto-team-host / name: dsh-auto-team
```

## 2. 安装本插件（两条路，任选）

```bash
# 官方入口：会**自动**把包追加进 dsh.profile.bundles
cd ~/.dsh/profiles/dv
ELECTRON_RUN_AS_NODE=1 "<App 可执行>" "<cli.js>" plugin --profile dv add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team

# 或 pnpm（注意 store 版本要匹配；PATH 上的 pnpm 若是 10.x 而 profile 是 store v11，会 ERR_PNPM_UNEXPECTED_STORE）
cd ~/.dsh/profiles/dv
npx --yes pnpm@11 add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
# 然后手工把 "dsh-auto-team" 追加进 package.json 的 dsh.profile.bundles
```

> ⚠️ `file:` 依赖是**硬链接**：`~/.dsh/profiles/dv/node_modules/dsh-auto-team/lib/index.js` 与仓库 `lib/index.js` 是**同一个 inode**。改 profile 里那份等于改仓库（会脏 git），反之亦然。实验时务必 `git checkout -- lib/index.js` 复核。

## 3. 启动第二宿主

```bash
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile dv --no-open --port 51890
```

输出里带一次性 token 的 URL（形如 `http://127.0.0.1:51890/?token=<...>`）。

**判据一（host 激活）**：启动日志里**不得**出现

```
dsh: warning: N entry did not activate
auto-team-host (dsh-auto-team): Error: cannot get property "<service>" without inject
```

一旦出现，说明 `src/host/index.ts` 的 `inject` 漏了服务（cordis 对未注入服务**直接抛错**，不是返回 undefined）。详见 §5。

## 4. 取页面与控制台

token URL 会 303 → `./` 并下发 `dsh-auth-*` cookie，**curl 必须带 cookie jar**：

```bash
curl -s -c /tmp/dvcookies -L "http://127.0.0.1:51890/?token=<tok>" -o /tmp/dv-index.html
grep -o 'dsh-auto-team/client.js' /tmp/dv-index.html   # client 产物是否进了批量 URL
```

批量包里是否真有我们的注册代码（11.96 MB，含全部插件 client）：

```bash
U=$(python3 -c "import re,html,sys;s=open('/tmp/dv-index.html').read();print([html.unescape(u) for u in re.findall(r'href=\"(plugins/[^\"]+)\"',s) if 'dsh-auto-team' in u][0])")
curl -s -b /tmp/dvcookies "http://127.0.0.1:51890/$U" -o /tmp/bundle.js
grep -o 'dsh-auto-team-toggle\|dsh-auto-team-panel\|自动团队' /tmp/bundle.js | sort | uniq -c
```

**判据二（client 注册不抛错）**：`--dump-dom` 在本机会 hang（`Unexpected renderer destruction`），但 **stderr 里的 CONSOLE 行有效**，用它抓运行时异常：

```bash
B=~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell
( "$B" --headless --disable-gpu --no-sandbox --virtual-time-budget=15000 --timeout=20000 \
    --dump-dom "http://127.0.0.1:51890/?token=<tok>" >/tmp/dv-dom.html 2>/tmp/dv-dom.err ) & 
sleep 35; pkill -f chrome-headless-shell
grep "CONSOLE" /tmp/dv-dom.err | grep -i "auto-team\|slot\|inject"
```

历史上这条抓到过：`Uncaught Error: keyed slot "sidebar.right.pane.tab" requires options.key`。

**判据三（DOM 真出现）**：`/tmp/dv-dom.html` 里出现开关行与右栏页签文案（「自动团队」）。注意 `--dump-dom` 可能产出 0 字节，此时以「控制台零相关报错 + 批量包内含注册代码 + 页签可点」三项合并判定，并如实写明哪一项是间接证据。

## 5. cordis inject 语义（实测，别猜）

- `inject` 是**普通 map（服务名 → 配置）**；数组形式等价于全部 required。
- 对象形式 `{ required: [...], optional: [...] }` **是错的**：宿主把 `required`/`optional` 当成服务名，报 `pending (waiting for services: required, optional)`。**cordis 不支持 optional 分组。**
- 可选服务用 `ctx.get("<name>")` 读（缺失返回 undefined、不抛错）；硬依赖才写进 `inject`。
- 服务目录原文即如此（access 规格写的是 `optional: { expression: 'ctx.get("agents")', requiresUndefinedCheck: true }`）：
  `cordis_inspect_query(platform="host", provider="Service", method="listService", input={"service":"agents"})`

## 6. 收尾清理

```bash
rm -rf ~/.dsh/profiles/dv          # 实验 profile（含本插件安装，硬链接不进仓库）
# desktop 若装了： cd ~/.dsh/profiles/desktop && npx --yes pnpm@11 remove dsh-auto-team
#                 并确认 dsh.profile.bundles 里已摘除
```

## 7. r6 实测结果（2026-11-01，插件首次真机跑通）

三次真机取证各暴露一个阻塞项，前两次修完后第三次才把面板真正点亮：

| # | 症状（真机） | 根因 | 修复 |
|---|---|---|---|
| 1 | boot 日志 `dsh: warning: 1 entry did not activate` + `Error: cannot get property "agentTeams" without inject` | entry 的 `inject` 只声明了 `tools`/`systemPrompt`，代码却访问 `ctx.agents`/`ctx.agentTeams`/`ctx.webServer`/`ctx.llm`/`ctx.agentDefaultModel` | `src/host/index.ts` 的 `inject` 补齐硬依赖，可选服务改经 `optionalService` / `ctx.get` |
| 2 | 控制台 `Uncaught Error: keyed slot "sidebar.right.pane.tab" requires options.key` | keyed slot 的注册少 `key`；且右栏页签还缺「tab 类型注册」这一步 | `src/client/slots.ts` 用 `{ name, key, inject }` 注册挂载点，并向 `sidebarRightTabs` 注册 `{ id, kind, priority, title }` |
| 3 | 面板永远显示「面板接口失败：HTTP 404」 | `webServer` 在 `apply` 时刻尚未激活，`registerHttpRoutes` 只试一次就 `return false`，路由一条都没注册 | `registerHttpRoutes` 两级：先试一次 → 失败则 `ctx.inject(['webServer'], cb)` 等就绪再注册 |

真机复验（克隆 profile `rt5`，端口 51895，2026-11-01）：

```bash
# ① 激活：宿主日志无告警
grep -cE "did not activate|cannot get property" /tmp/rt5-boot3.log   # → 0
# ② 面板接口
curl -s -o /dev/null -w '%{http_code}' -b <cookie> \
  'http://127.0.0.1:51895/api/auto-team/snapshot?sessionId=x'        # → 200（含 roles/concurrency/memory）
# ③ 界面（无头浏览器 + CDP）
#   造一个活会话后：[data-slot] 出现 conversation.composer.dock，开关行渲染，控制台零异常
#   点「面板」→ sidebar.right.pane.tab / .title 各 1 个座位，右栏渲染
#     「自动团队 / 已关闭 / 计划 0 · 成员 0 · 并发 0/3 / 队长模型 跟随宿主默认 · 事件源正常」
#   点「启用自动团队」→ 状态变「待派发」（act 路由通）
```

**三条经验**：① 前两类错误 mock 测不出来，只有真机能抓（`ctx.slots` 的 keyed 判定、cordis 的 inject 判定都在宿主侧）；② 前两类失败的表现都是「构建全绿、控制台/日志安静、功能不存在」，所以**「构建通过」不能作为可用的证据**；③ 启动早期拿不到的服务，别急着降级返回，先问一句「它是不是稍后才 provide」（`ctx.inject(deps, cb)` 就是为这件事存在的）。

第四类同源坑（不属于插件缺陷）：`cordis_inspect_query` 的 `input` 必须是对象，四次误判里有四次都把它当成 env-unavailable 反复重试——见 §4。
