# r38 t2 QA 报告：注册段落必须关闭宿主插值（interpolate: false）

- 任务：t2（依赖 t1 已完成）
- runId：run-mwip0i3q-zoe
- 结论：**PASS**（4 条验收点全绿；无 src/ 净改动）
- 新增测试：`test/r38-prompt-interpolate.test.ts`（2 例）

## 1. 验收点与可执行判定

| # | 判据 | 证据 | 结果 |
|---|---|---|---|
| ① | `registerPromptSection` 传给 `ctx.systemPrompt.section()` 的对象 `interpolate === false`，且 `text()` 原样返回含 `{{ apiName }}` 的文本 | `node --test test/r38-prompt-interpolate.test.ts` → `✔ registerPromptSection 捕获到 interpolate: false…` | PASS |
| ② | `registerCaptainPrompt`（captainSection 生产路径）在快照含用户可写 `{{ apiName }}`（记忆标题 + 队长模型配置值）时，注册对象仍带 `interpolate: false`，正文含该文本且不崩 | 同文件 `✔ captainSection 拼进用户写的 {{ }} 时…`；测试内按宿主语义复刻 renderPrompt（非法变量名抛 `malformed prompt variable reference`）真跑一遍 | PASS |
| ③ | 变异自检：删掉 `src/host/adapters.ts` 的 `interpolate: false` 后新用例必须变红，然后还原 | 见 §2，删除后 2/2 红、exit=1；还原后 2/2 绿 | PASS |
| ④ | `pnpm typecheck && pnpm test && pnpm build` 全绿 + 双产物 import + `lib/index.js` 体积/sha256 | 见 §3、§4 | PASS |

## 2. 变异自检（先红后绿，已还原）

- 删除前 `git diff src/host/adapters.ts | shasum -a 256`：`747aad62814610cd01b36a22a0c0955616eb7212efc7ebef82529fe2d55f49c2`
- 临时删掉 `interpolate: false` 一行后：
  - `node --test test/r38-prompt-interpolate.test.ts` → `ℹ pass 0` / `ℹ fail 2`，exit=1；失败点 `test/r38-prompt-interpolate.test.ts:96` 与 `:112`（即 `section.interpolate === false` 断言与宿主语义渲染断言）
- 还原后同一命令 `ℹ pass 2` / `ℹ fail 0`，且 diff 哈希与删除前**逐字节一致**（同上哈希）→ `src/` 净改动为 0。

## 3. 全量门禁

命令（实际执行）：

```bash
pnpm typecheck && pnpm test && pnpm build
```

- 退出码：**0**
- 用例：`ℹ tests 1261` / `ℹ pass 1261` / `ℹ fail 0`
- 构建：

```
lib/client.js  607.17 kB │ gzip: 150.58 kB
lib/index.js   639.66 kB │ gzip: 212.00 kB
Build complete
```

## 4. 产物

| 产物 | 体积（字节） | sha256 |
|---|---|---|
| `lib/index.js` | 639664 | `228a03026c048b4582ef38def909a1ac84414837682a20ec735620d34a3a0318` |
| `lib/client.js` | 607150 | `55e850838a73876f2784fd78410f4f1d5e4d63d6095b6276bf949f0a1bc9f7c6` |

双产物 import（均在仓库根执行）：

```bash
node --input-type=module -e "await import('./lib/index.js').then(m=>console.log('index ok',typeof m))"   # index ok object，exit 0
node --input-type=module -e "await import('./lib/client.js').then(m=>console.log('client ok',typeof m))" # client ok object，exit 0
```

## 5. 未验证项

- 未在真实宿主 `renderPrompt` 上跑一轮对话：本报告的宿主语义是测试内按源码注释复刻的迷你 renderer，**不是**真机插值器实测。真机效果仍需 t1 交付后在宿主会话里确认「含 `{{ }}` 的记忆标题不再让整轮 error」。
- 未覆盖除 `systemPrompt` 之外其它会做插值的宿主入口（本次任务范围外）。
- 门禁只证明构建与单测通过，不证明宿主机上第三方 section（如 `code-index:repo-map`）的行为。
