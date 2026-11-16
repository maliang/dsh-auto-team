# QA 报告：r35 README 以「特色」开篇的结构守卫（t2）

- 任务：`test/r33-readme-guard.test.ts` 跟新口径改 + 新增「特色必须出现」断言 + 门禁 + 报告。
- 结论：**门禁全绿**（typecheck / test / build 全 0），r33 定向 7/7；两条规定变异均**实测变红**并已 100% 还原。
- 上游：t1 已重写 `README.md` / `README.en.md`（均 176 行，11 个 h2），门禁已过。
- 本任务改动：`test/r33-readme-guard.test.ts`（+63/−15，`git diff --stat`）；`README*.md` 与 `test/r29-packaging.test.ts` **未由本任务改动**。

## 1. 旧口径 → 新口径对照

| 项 | 旧口径（r33 原断言） | 新口径（本次） | 强度 |
| --- | --- | --- | --- |
| 变更记录 | `### 变更记录` 标题必须含 `git log`，正文只留 3 条 | 删除该段断言；**反转为**「任何级别标题都不许再出现 `变更记录` / `Changelog`」，历史交给 git log 与 docs/teamflow/ | 反向断言（加回即红） |
| 总行数 | ≤ 180 | ≤ 200 | 按任务授权放宽 |
| 特色机制 | 无 | 双语各 7 组固定短语**恰好出现 1 次** + 「回执 / receipt」必须出现 | 新增 |
| 双语 h2 数量相等 | 有 | **逐字未动** | 不弱化 |
| 四图各引用 2 次、集合固定 | 有 | **逐字未动** | 不弱化 |
| 26 行代码块命令双语逐字相等 | 有 | **逐字未动** | 不弱化 |
| 版本号 / Node、DSH engines 逐字一致 | 有 | **逐字未动** | 不弱化 |
| 旧长节黑名单 | 含 `## 变更记录` | 去掉该项（该节已整节删除，另有更严的反转断言） | 不弱化 |
| 截图体积 | 四张统一 > 20KB | 三张面板图仍 > 20KB；`entry.png`（局部裁剪，17970 B）单独 > 10KB，见 §5 | 单图下限，仍挡空文件/占位图 |

新增锚点短语（全部逐字取自 t1 交付，`README.md:11-16` / `README.en.md:11-16`）：

| 机制 | 中文固定短语 | 英文固定短语 |
| --- | --- | --- |
| 多任务 + 依赖图 | `**多任务 + 依赖图**` | `**Multiple tasks + dependency graph**` |
| 自动组队 | `**自动组队**` | `**Automatic team assembly**` |
| 子 Agent 独立模型 | `**子 Agent 独立模型**` | `**Per-sub-agent models**` |
| 门禁 = 证据 | `**门禁 = 证据**` | `**Gate = evidence**` |
| 调用次数 | `调用次数` | `call count` |
| 面板可观测 | `**面板可观测**` | `**Observable panel**` |
| 团队记忆 + 成员自助 | `**团队记忆 + 成员自助**` | `**Team memory + member self-service**` |
| 回执（允许正文多次出现） | `回执` | `receipt` |

## 2. 门禁证据

验收命令（在仓库根执行，一次连续执行）：

```
pnpm typecheck && pnpm test && pnpm build
```

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0（tsc --noEmit 无输出） |
| `pnpm test` | **tests 1258 / pass 1258 / fail 0**，exit 0 |
| `pnpm build` | exit 0；client + host 两次 `✔ Build complete`（58ms / 52ms） |
| `node --input-type=module -e "await import('./lib/index.js')"` | exit 0 |
| `node --input-type=module -e "await import('./lib/client.js')"` | exit 0 |

产物体积与 sha256：

| 产物 | 字节 | sha256 |
| --- | --- | --- |
| `lib/index.js` | 637901（637.90 kB，gzip 211.25 kB） | `9e2e1886cc91b4578bbe32789d5763d3bbda91472ffb4397ba1e730113095a66` |
| `lib/client.js` | 603682（603.68 kB，gzip 149.59 kB） | `32c5d5fc932f1abbdffe02d8c403512356eae9328bab5c7cf1526a5f57289f3c` |

r29-packaging 复核（未改动、无结构回归）：

```
node --test test/r29-packaging.test.ts   # 6 tests / pass 6 / fail 0
git status --porcelain test/r29-packaging.test.ts   # 无输出
```

## 3. 变异验证（规定 2 条，实测均红，随后还原）

还原方式：变异前 `cp README.md /tmp/README.zh.bak`、`cp README.en.md /tmp/README.en.bak` 并记录 sha256；每轮结束 `cp` 回并 `sha256sum -c`，两次均输出 `README.md: OK` / `README.en.md: OK`，最终 7/7 复绿。

### M1 删掉「特色」整段（`## 特色` → 下一个 `## `）

```
✖ r33 文档守卫：双语 h2 数量相等且非空
  AssertionError [ERR_ASSERTION]: 双语 h2 数量不一致：zh=10，en=11
✖ r33 文档守卫：「特色」六项机制在双语各有固定锚点（每处恰好 1 次）
  AssertionError [ERR_ASSERTION]: README.md 缺少「## 特色」章节
```

### M2 把变更记录加回去（`### 变更记录（历史见 git log）` + 3 条）

```
✖ r33 文档守卫：旧版长节不复现、总行数 ≤ 200、变更记录整节已删除
  AssertionError [ERR_ASSERTION]: README.md 又出现了「变更记录」节：r35 已删除整节，历史交给 git log 与 docs/teamflow/
```

两条变异分别命中「特色必须存在」与「变更记录必须不存在」两个方向，说明断言不是恒真。

## 4. 断言强度自查（会不会假绿）

- 锚点用 `text.split(phrase).length - 1 === 1`，删段 → 0、复制段 → 2，两个方向都红；不用空串、不用宽松正则。
- 「变更记录」用 `^#{1,6}\s*(变更记录|Changelog)` 多行匹配：`##`/`###` 加回都会红（M2 已验证 `###`）。
- 行数上限 200 为任务授权放宽；当前 176 行，留 24 行余量，不掩盖旧版 379 行回归。
- 图片体积下限只覆盖「空文件/占位图」，不宣称能验证截图内容正确（旧断言同样不能）。
- 受保护断言（h2 相等 / 四图各 2 次且集合固定 / 26 行命令逐字 / versions+engines）在本次 diff 中**逐字保留**，`git diff test/r33-readme-guard.test.ts` 可复核。

## 5. 缺陷与调整记录

### D1 入口截图 17970 B 触发旧「> 20KB」红线

- **症状**：r33 旧断言 `docs/images/entry.png 只有 17970 B，要求 > 20KB` 红；该文件自 2026-11-15 00:26 重截后即为此体积，工作区无未提交改动（`git status --porcelain docs/images/` 无输出）。
- **根因**：20KB 是四张图统一拍的下限；`entry.png` 是输入框左下角开关的局部裁剪，内容真实但画布小，统一阈值属误设，不是图片缺失。
- **处理**：改为按图下限——三张面板图保持 `> 20KB`，`entry.png` 用 `> 10KB`；空 PNG（几十字节）与占位图仍会红。任务要求「图本身不要改」，故未重截图。
- **复验命令**：`stat -f %z docs/images/entry.png` → `17970`；`node --test test/r33-readme-guard.test.ts` → 7/7。

| 建议修改 | 可接受 |
| --- | --- |
| 若坚持统一 20KB，需产品同意重新裁剪 `entry.png`（会改图，超出 t2 授权） | 当前按图下限保留；四图引用次数与路径断言未动 |
| 「特色」锚点是固定短语，README 再改文案时需同步改测试（t3 类任务） | 短语即验收点，漂移时红是对的，不应放宽成空串 |

## 6. 未验证项（全绿也要说）

1. **真机行为**：本任务只动文档与测试，未启动宿主验证面板/开关；README 描述的机制是否与实现逐条一致，以 t1 门禁与既有单测为准，未由本任务复核实现代码。
2. **英文语义**：只校验结构（h2 数量、命令逐字、版本/engines、锚点短语）与双语一致，未做逐句人工翻译审校。
3. **截图内容**：只校验路径存在与体积下限，未逐像素确认截图展示的是最新 UI。
4. **文档索引**：本报告所在任务夹由 TeamFlow 约定落盘，未新增到 README 的「文档索引」条目（README 现有索引指向 docs/teamflow/ 总目录，无死链；`r33` 相对链接断言已覆盖）。

## 7. 变更文件

| 文件 | 说明 |
| --- | --- |
| `test/r33-readme-guard.test.ts` | 行数 180→200；删除变更记录 3 条/git log 断言与黑名单项，新增「任何级别都不许有变更记录」反转断言；新增 `FEATURE_ANCHORS` 双语特色锚点断言；截图体积按下图拆分下限 |
| `docs/teamflow/2026-11-16-r35-readme-pitch/QA-REPORT.md` | 本报告 |
