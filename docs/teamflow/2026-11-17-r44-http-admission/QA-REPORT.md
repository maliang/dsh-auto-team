# r44 面板接口准入回归 — QA 报告（t6）

- 报告人：QA 测试工程师（t6）
- 时间：2026-11-17 12:33（Asia/Shanghai）
- 被测改动：t4 在 `src/host/adapters.ts` 的 `registerHttpRoutes` handler 入口加 Host/Origin 准入
  （`refusalOf` 在 `src/host/adapters.ts:870`，模块级去重 `warnedNoConnection` 在 `src/host/adapters.ts:851`，
  调用点在 `src/host/adapters.ts:915`，位于查 route 与 `readJson` 之前）
- 被测源码基线：`src/host/adapters.ts` sha256 `fd041091519d18b3443427951345299016f847d305e8d85eb98fdcc2948c420a`
  （变异探针每次还原后都与该哈希逐字节一致）
- 结论：**PASS**。3 条变异全部按预期变红并逐字节还原；全量门禁 `pnpm typecheck && pnpm test && pnpm build` 全绿。
  存在 5 条「未验证项」，其中「修后真机复验」必须由主 agent 安装新 lib 后补跑（QA 不做安装动作）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `test/r44-http-admission.test.ts` | 主用例 9 条：403 / 401 / readJson 之前 / undefined 放行 / 401→403→undefined 序列 / POST 与未知路径 / 每请求现读 / 邻居桩守卫 / 判定抛错降级 |
| `test/r44-http-admission-warn.test.ts` | 降级用例 1 条，**独立进程**：connection 缺失时放行 + 整个进程只 warn 一条（3 次请求） |
| `test/fixtures/r44-http-admission-harness.ts` | 共享假 ctx（`ctx.get('webServer'/'connection')` + `logger.warn` 收集）与 Node 风格 req/res；`throwOnBodyRead` 用来证明「准入先于 readJson」 |
| `test/r44-mutation-probes.mjs` | 变异自检脚本（M1/M2/M3），跑完把证据写到下面这个 JSON |
| `docs/teamflow/2026-11-17-r44-http-admission/mutation-evidence.json` | 变异矩阵证据（sha256 / 预期红用例 / 实际失败列表 / 还原后回绿） |
| `docs/teamflow/2026-11-17-r44-http-admission/evidence-real-host-before.txt` | 真机修前证据（同一宿主进程、同不带 cookie：我们 200 vs 宿主 `/api/session` 401） |

## 2. AC → 可执行判定

判据一律是「把实现改回错误版本，这条会不会红」；不会红的判据不采纳。

| 任务卡 AC | 判定（用例 / 命令） | 改回错误实现会红吗 |
|---|---|---|
| ① 假 ctx 直调 `registerHttpRoutes`，`requestRejection` 依次返回 401/403/undefined，断言 `statusCode` 与 body，403/401 两次 `route.handle` 计数为 0 | `test/r44-http-admission.test.ts:25`（403→`403/forbidden`，`handleCalls 0`）、`:36`（401→`401/unauthorized`，`handleCalls 0`）、`:93`（同一连接 401→403→undefined 三次请求：只放行那次进 handle，`cursor===3` 证明没缓存判定） | 会：准入挪到 handle 之后→`handleCalls` 变 1（M1）；401/403 body 写反→body 断言红（M3） |
| ② 准入发生在 `readJson` 之前（body 读口抛错 + 403 仍 403 不 500） | `test/r44-http-admission.test.ts:46`：`throwOnBodyRead` 让 `req.on` 一被订阅就抛；断言 `status===403`、`subscriptions===0`、`handleCalls===0`；对照 `:57` 放行路径 `subscriptions===3`（证明桩真的能读 body，不是永远不订阅） | 会：把准入挪到 `readJson` 之后→Promise 拒绝进 catch→500（M1） |
| ③ connection 缺失时放行且 `logger.warn` 恰 1 条（模块级去重，独立进程） | `test/r44-http-admission-warn.test.ts:16`：3 次请求（GET 命中 / POST 命中 / 未知路径 404）后 `warnings.length===1`，文案含 `[auto-team]`、`connection.requestRejection`、`按旧行为放行` | 会：去掉去重→3 条告警（M2） |
| ④ 变异 ≥2 必红 | `node test/r44-mutation-probes.mjs`：M1（准入挪到 handle 之后）、M2（去掉告警去重）、M3（401/403 body 写反） | 见 §4：3/3 变红、逐字节还原、还原后回绿 |
| ⑤ `test/wire.test.ts:121` 的 connection 桩存在、不新增同键、零告警断言仍成立 | `test/r44-http-admission.test.ts:114` 读 `test/wire.test.ts` 源：`connection:` 键恰好 1 处 + 桩文本 `requestRejection: () => undefined` + 仍含 `assert.deepEqual(h.warnings, []`；真机行为由全量 `pnpm test` 跑 `test/wire.test.ts` 覆盖 | 会：删桩→源断言红；再加一个 `connection:` 键→计数 2 红（同时 TS 重复属性会先红） |
| ⑥ 报告含真机修前证据与未验证项 | 本文件 §5 / §6 | 不适用（证据文件本身） |

补强用例（不在卡面但要挡住「假绿」）：
- `:67` POST 与**未注册路径**同等过闸（403 优先于 404）——若实现先查 route 再准入，未知路径会回 404；
- `:82` 换掉 connection 实现后下一次请求立即生效——若实现是注册期快照，第二次仍 403；
- `:132` `requestRejection` 抛错 → 放行 + 只 warn 一条——若实现把异常抛给宿主 HTTP 栈，会 500。

## 3. 门禁结果（本地全量，仓库根执行）

```
TYPECHECK_EXIT=0   （pnpm typecheck → tsc --noEmit，无输出）
BUILD_EXIT=0       （pnpm build → lib/index.js 668.36 kB，Build complete in 59ms）
TEST_EXIT=0        （pnpm test → node --test test/*.test.ts）
ℹ tests 1322
ℹ pass 1322
ℹ fail 0
```

- 断言红=0：`grep -E '^✖' /tmp/r44-full-test.log` → 无输出；最终全量 **1322 例全绿**（其中 r44 新增 10 例，其余 1312 例为既有回归）。
- `test/wire.test.ts:121` 的桩与 `:447` 的零告警断言在全量跑中通过（r44 邻居守卫 + wire 自身断言双保险）。

## 4. 变异自检（3/3 预期红，逐字节还原）

命令：`node test/r44-mutation-probes.mjs` → 证据：`mutation-evidence.json`。

| ID | 变异 | 变异位置 | 预期红用例（命中） | 实际 |
|---|---|---|---|---|
| M1 | 把 `refusalOf` 移到 `route.handle` 之后 | `src/host/adapters.ts:915` 的准入块 → 移到 `:936` handle 之后 | `r44 准入：403 拒绝 → 403 / forbidden，且 route.handle 计数为 0` | RED（另有 401 / readJson / POST+404 / 序列 4 条连带红） |
| M2 | 去掉告警去重（删 `if (warnedNoConnection) return; warnedNoConnection = true`） | `src/host/adapters.ts:855-856` | `r44 准入降级：connection 缺失 → 放行，且整个进程只 warn 一条` | RED（另有判定抛错用例连带红：它要求同一进程只 1 条） |
| M3 | 401/403 响应体写反 | handler `res.end(...)` 三元分支 | `r44 准入：403 拒绝 → 403 / forbidden，且 route.handle 计数为 0` | RED（401 用例连带红） |

- 还原校验：每次变异后 `sha256(还原)=fd041091…`（与变异前一致），还原后基线 exit=0 / fail=0；
- 脚本行为：目标片段命中次数 ≠1 直接退出非 0；任何一条「不是预期红」也退出非 0（门禁可据此判红）。

## 5. 真机修前证据（2026-11-17 12:32，宿主 http://127.0.0.1:56582）

依据文件：`evidence-real-host-before.txt`。同一宿主进程、同样**不带 cookie**：

```
$ curl -s -o /tmp/r44-body.txt -w '%{http_code}' 'http://127.0.0.1:56582/api/auto-team/snapshot?sessionId=x'
200
{"data":{"enabled":false,"tasks":[],"members":[],"messages":[],"routeAudits":[],...}}

$ curl -s -o /tmp/r44-session.txt -w '%{http_code}' 'http://127.0.0.1:56582/api/session'
401
unauthorized
```

- 症状：本插件前缀路由无 cookie 200，宿主自己的路由无 cookie 401 —— 前缀路由绕过了宿主准入；
- 根因：`webServer.register({kind:'prefix'})` 的前缀 handler 先于宿主访问检查拿到请求（t4 交接的真机结论）；
- 复验命令（修后，安装新 lib + 重启宿主后跑）：
  `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:56582/api/auto-team/snapshot?sessionId=x'` → 期望 `401`；
  带浏览器 cookie 时应恢复 `200`（面板可用）。

## 6. 未验证项（全绿也要报）

1. **修后真机未复验**：本轮只能证明「修前 200」，`127.0.0.1:56582` 上安装的仍是旧 lib。修后 401/带 cookie 200 需要主 agent 把新 `lib/index.js` 安装进 profile 并重启宿主（QA 不执行安装）。
2. **真机 403 分支未触发**：403（Host/Origin 不可信）只用假 ctx 覆盖；未在真机构造跨站 `Origin` 请求验证宿主真的对前缀路由派 403——这依赖宿主 `requestRejection` 的实现，不是本插件的逻辑。
3. **真机 401 的对照来自宿主路由**：`/api/session` 的 401 只证明宿主整体要求认证，不证明前缀路由修后一定回 401 的 `unauthorized` 文本（文本由本插件写，已由单测锁定）。
4. **客户端对 401/403 非 JSON 响应体的处理未验证**：拒绝响应是纯文本（无 `content-type`），若前端 bridge 对响应体无条件 `JSON.parse`，会抛解析错；本卡只测宿主侧路由，client 需另卡确认。
5. **`requestRejection` 返回 Promise 的宿主未覆盖**：按 t4 交接的宿主源码它是同步方法，单测只覆盖同步返回；若未来宿主改异步，`typeof verdict === 'number'` 会判成放行（不会崩，但会静默降级）。

## 7. 建议修改 / 可接受

| 建议修改（非阻塞） | 可接受（有依据） |
|---|---|
| 拒绝响应建议补 `content-type: text/plain; charset=utf-8`（或直接回 JSON `{error:'unauthorized'}`），避免前端把 `unauthorized` 当 JSON 解析 | 未注册路径在准入之后才 404 是有意为之：前缀路由吞掉宿主准入，先 404 会泄露「路径存在性」判定顺序；已由 `:67` 锁定 |
| 若前端确实会对所有响应做 JSON 解析，建议 client 侧对 `res.status` 401/403 先判非 2xx，再决定是否解析 | 告警去重是进程级模块变量：多 profile 各自独立进程各警告一次，符合「不刷屏」目标，无需持久化 |
| 后续卡可在 client 层补一条「401/403 时面板显示未授权提示而非空白」的用例 | 判定抛错时放行（而不是 500 / 拒绝面板）符合 t4 交接的第 2 条纪律：旧宿主可用性优先，且告警留证 |

## 8. 复跑方式

```bash
cd <repo 根>
node --test test/r44-http-admission.test.ts test/r44-http-admission-warn.test.ts   # 10 例
node test/r44-mutation-probes.mjs                                                   # 变异 3/3 必红
pnpm typecheck && pnpm test && pnpm build                                           # 全量门禁
```

注意：`r44-mutation-probes.mjs` 必须从仓库根跑（它用 `new URL('../', import.meta.url)` 锚定仓库根）；
从归档的 `logs/` 位置直接跑会因相对根解析失败而假红。
