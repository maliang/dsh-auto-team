# r29 打包与文档回归 — QA 报告

- 任务：t3 打包与文档回归（上游 t1 插件元数据、t2 README 双语化均已完成并通过门禁）
- 执行：QA 测试工程师（2026-11-13）
- 结论：**PASS** — 任务卡验收判定 `pnpm typecheck && pnpm test && pnpm build` 退出码 0；新增 6 条打包/文档断言，反向探针 6/6 变红、恢复后 6/6 变绿。

## 1. 验收判定（任务卡原文，实际执行）

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
pnpm typecheck && pnpm test && pnpm build
```

退出码：**0**（`time` 实测整链 11.0s；`pnpm test` 单独 7.4s）

证据尾部：

```
ℹ tests 1167
ℹ pass 1167
ℹ fail 0
ℹ skipped 0
real	0m11.045s
```

补充自检（README 声称、本次一并复验）：

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | `IMPORT_HOST_OK` |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | `IMPORT_CLIENT_OK` |
| `npm pack --dry-run --cache /tmp/npm-pack-cache` | 0 | `total files: 8` / `package size: 381.0 kB` |

环境：macOS，`node v26.11.1`，`npm 11.20.0`，`pnpm` 为仓库脚本。

## 2. 新增 `test/r29-packaging.test.ts`（6 条，逐条可判死）

| # | 断言 | 判据（实现改坏后必红） |
| --- | --- | --- |
| 1 | `version` 是合法 semver | 正则 `^(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)(-…)?(+…)?$`，且无前后空白；改成 `0.1` 即红 |
| 2 | `engines.node` / `engines.dsh` 存在且与中英 README「兼容性与版本支持 / Compatibility and version support」表**逐字一致** | 先按 `## ` 切出矩阵节（节被删/改名即红），再按首列标签取反引号值比对；`engines.node` 改成 `>=22.20` 即红 |
| 3 | `exports["./locale/*.json"] === "./locale/*.json"`；`files` 含 `lib`、`cordis.patch.yml`、`locale/*.json` | 删掉任一 manifest 项即红 |
| 4 | `locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description` 为非空白字符串 | 置空串即红 |
| 5 | `README.md` 与 `README.en.md` 的 h2 数量相等、图片引用集合相等 | 先剥离 ``` 代码块（代码块里的 `## ` 是注释不是章节），再比 `^## ` 计数与 `docs/images/*.png` 去重集合；当前 17/17、4/4（`entry.png`、`panel-flow.png`、`panel-overview.png`、`panel-tasks.png`） |
| 6 | 真实 `npm pack --dry-run --json` 清单含 7 个必需文件，且不含 `src/`、`test/` | 必需集：`lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`README.md`、`README.en.md`、`locale/en.json`、`locale/zh.json`；从 `files` 删 `locale/*.json` 即红 |

实现要点：

- 仓库根用 `new URL('../', import.meta.url)` 锚定，从任何 cwd 跑都不漂（遵守「归档目录复跑」教训）。
- `npm pack` 用 `mkdtempSync(join(tmpdir(), 'dsh-r29-pack-'))` 作 `--cache`，绕开本机 `~/.npm` 不可写；`--json` 解析 `files[].path`，不是解析 npm 的文本输出。
- 按任务卡提醒：README* 是 npm **无条件收录**，只对真实清单断言存在，**没有**断言它们出现在 `package.json.files` 里。

### 反向探针（防「假断言」）

一次性把 6 类错误实现同时注入，再跑新增测试文件：

```
✖ version 是合法 semver…                 (version → 0.1)
✖ engines 与 README 双语表一致…           (engines.node → >=22.20)
✖ exports 含 locale，files 含 …           (删 exports['./locale/*.json'] 与 files 的 locale 项)
✖ 两份 locale 的 meta.title/description…  (en.json meta.title → "")
✖ README 双语 h2 数量与图片引用集合相等…  (panel-flow.png → panel-flow-x.png)
✖ 真实 npm pack 清单含 7 个必需文件…      (files 少了 locale，pack 清单同步缺文件)
ℹ pass 0  ℹ fail 6
```

恢复三份被改文件后重跑：`ℹ pass 6 / fail 0`。⇒ 每条断言都对实现敏感，不是恒真断言。

## 3. 文档漂移修复（症状 / 根因 / 复验命令）

### D1 README 实测基线过期

- 症状：README.md / README.en.md 的「实测基线 / Measured baseline」仍写 `1023 通过`、`npm pack → 5 个文件 / 320.5 kB`、`lib/index.js 529.81 kB`、`README 29.1 kB`。
- 根因：基线表是手抄快照，r17–r28 持续加测试与双语文档后无人回填；`locale/*.json` 进包后文件数也变了。
- 处置：刷新为 2026-11-13 06:25 实测值 —— `pnpm test` **1167 通过 / 0 失败 / 0 skipped（约 7.4s）**；`lib/index.js` **613.65 kB**、`lib/client.js` **587.57 kB**；`npm pack --dry-run` → **8 个文件 / 381.0 kB**（含 `package.json`、中英两份 README、`cordis.patch.yml`、两份 `lib/`、`locale/en.json`、`locale/zh.json`）；pack 时 `README.md` 为 **37.9 kB**。
- 复验命令：`ls -l lib/index.js lib/client.js README.md | awk '{print $5, $9}'`、`npm pack --dry-run --cache /tmp/npm-pack-cache 2>&1 | grep -E "package size|total files"`、`pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"`。
- 数字来源：`lib/index.js` 613649 B、`lib/client.js` 587574 B（B÷1000）；`README.md` 37882 B（npm 输出 37.9kB）；包 381.0 kB / 8 文件取 npm 自身输出。

### D2 AGENTS.md 文档索引缺英文入口、测试计数过期

- 症状：§2 文档索引只有 `README.md`，新加入的成员读不到 `README.en.md`；§4 验证命令仍写「当前 484 例」。
- 根因：t2 新增英文 README 时只改了 README 自身，未登记进团队文档索引；测试数注释自 r10 起未回填。
- 处置：§2 增加一行 `产品入口（英文） | README.en.md | 与 README.md 结构、命令、图片引用一一对应的完整英译（改中文版时同步改）`；§4 的 `pnpm test` 注释改为「当前 1167 例」。
- 复验命令：`grep -n "README.en.md" AGENTS.md`（§2 第 17 行命中）、`grep -n "当前 1167 例" AGENTS.md`（§4 第 56 行命中）。

### D3 npm pack 清单提示只列了 3 个文件

- 症状：README 开发命令的注释写「必须含 lib/index.js、lib/client.js、cordis.patch.yml」，漏掉 locale 与英文 README —— 读者按注释自检会漏。
- 根因：这条注释写在 locale 子路径与英文 README 之前。
- 处置：中英两份注释改为「必须含 lib/index.js、lib/client.js、cordis.patch.yml、中英两份 README 与 locale/*.json」。
- 复验命令：`grep -n "npm pack --dry-run --cache" README.md README.en.md`。

## 4. 变更文件

| 文件 | 变更 |
| --- | --- |
| `test/r29-packaging.test.ts` | 新增，6 条打包/文档断言（199 行） |
| `README.md` | 基线刷新（1167 例 / 8 个 pack 文件 / 体积）；pack 注释补 locale 与英文 README；变更记录新增 r29 条目 |
| `README.en.md` | 同上英译；变更记录新增 r29 条目 |
| `AGENTS.md` | §2 文档索引新增 README.en.md 行；§4 测试计数 484 → 1167 |

未改动：`package.json`、`locale/*.json`、`cordis.patch.yml`、`src/**`、`lib/**`（本轮为回归与文档任务，无产品代码改动）。

## 5. 未验证项（全绿也不冒充已验）

1. **真机 GUI 的 locale 渲染**：只断言了 `locale/*.json` 的字段与 `npm pack` 收录，未把包装进真实 profile 重启宿主看面板标题/描述是否显示（需主 agent 的真机验证流程）。
2. **npm registry 对 semver 的最终判定**：本地正则 + `npm pack` 通过；未 `npm publish --dry-run` 到 registry。
3. **CI（ubuntu-latest）实跑**：本地 macOS 通过；CI 的 `npm pack --dry-run` 末步与 `pnpm test` 未在远端验证。
4. **中英 README 的段落语义等价**：只比 h2 数量与图片引用集合（任务卡口径），未逐段比对文字内容是否等价。
5. **反向探针是手工注入**：未固化成 `test/r29-mutation-probes.mjs` 之类的可重跑脚本（如需长期回归可补）。
