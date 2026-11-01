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
