# 客户端「打开 / 切换到某个会话」公开入口 — 侦察结论

> 结论性质：**已找到**。证据全部来自宿主安装包 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（2026-11-11 18:08，与 `mem://project/pitfalls#74cdb321e1f3` 记录的同一份）。
> 提取方式：脚本解析 asar 头（`base = 8 + headerSize`），按字节偏移映射回文件路径；**不依赖 cordis_inspect_query**（本次会话未暴露该工具）。
> 未做真机点击验证（见 §7）。文中 asar 内路径都是包内路径，不是本仓库路径。

## 1. 结论（可直接抄）

| 项 | 值 |
|---|---|
| 服务 | `ctx.uiWorkspace`（cordis client 服务名 **`uiWorkspace`**） |
| 方法 | `openSession(target: SessionTarget): void` |
| 类型 | `SessionTarget = SessionId \| SubagentAddress`（`SessionId` 与成员 `memberId` 同源，直接传字符串即可） |
| 同步性 | **同步**，返回 `void`；选中态在同一 tick 内写入 store（内部 `this.selection.set(...)`），没有 Promise 可等 |
| 失败行为 | **会抛**（`retain` 失败 / 信号已中止 / `beforeOpen` 抛），**不会**返回 false，必须自己 `try/catch` |
| 是否必须 click 里调用 | **不必须**（无用户激活要求、无 popup 限制）；从 React onClick、store action、`setTimeout` 里调都能生效。它自主完成导航，不需要宿主队友/成员在线 |
| 是否需要 pak / 激活 | 不需要 pak。需要服务就绪：`apply` 时刻 `uiWorkspace` 常未激活，**只能** 用 `ctx.inject(['uiWorkspace'], cb)` 等它（和本仓库 `src/client/slots.ts:615` 等 `layout` 的写法同构）；**不要**把可选服务硬写进 entry 的 `inject`（`AGENTS.md` §4 的 r6 事故） |
| 副作用 | 内部 `replaceMain(target, signal, 'reveal')` 末尾会调 `ctx.layout.selectPanel(null)` → **主区自动从任何全局面板回到会话**，这正是「跳到成员」想要的落点，不需要我们再调 selectPanel |

### 实现原文（`dsh-client-ui-workspace/src/client/navigation.ts`）

```ts
// :45（接口 UiWorkspace）
/** Select a Session and show its Conversation as one UI navigation action. */
openSession(target: SessionTarget): void

// :293（实现）
openSession(target: SessionTarget): void {
  this.replaceMain(target, this.lifetime.signal, 'reveal')
}

// :523-556（replaceMain，时序全在这里）
private replaceMain(target, signal, panel: 'reveal' | 'preserve', beforeOpen?) {
  signal.throwIfAborted()
  const reference = this.sessions.retain(target, { source: 'mainView' })
  try {
    signal.throwIfAborted()
    beforeOpen?.(reference.sessionId)
    if (signal.aborted) { reference.release(); return }
    const subagentAddress = typeof target === 'string'
      ? this.sessions.subagentAddress(reference.sessionId)
      : target
    this.selection.set({ sessionId: reference.sessionId, ...(subagentAddress === undefined ? {} : { subagentAddress }) })
  } catch (error: unknown) { reference.release(); throw error }
  const previous = this.mainReference
  this.mainReference = reference
  previous?.release()
  if (panel === 'reveal') this.ctx.layout.selectPanel(null)
}
```

要点：切换是**替换持有引用**（`retain` 新的、`release` 旧的），所以目标会话不必预先在列表里「选中」；但目标 `SessionId` 必须能被宿主 `retain`（不存在的 id 会抛）。

## 2. 同机样本（宿主自己的用法，最可信）

- `dsh-client-ui-subagent/src/client/index.ts`（+2815 字节处）：
  ```ts
  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
    openChild(address: SubagentAddress) { ctx.uiWorkspace.openSession(address) },
    ...
  ```
  同文件里 `export const inject = ['sessions', 'uiWorkspace', 'slots', 'locale', 'sidebarRight']` —— 宿主自己也是把 `uiWorkspace` 当必选服务声明。
- `dsh-client-ui-workspace/src/client/index.ts:188` / `:301`：`const openSession = (sessionId) => { uiWorkspace.openSession(sessionId) }`，用于会话列表行点击。
- 相关可选字段：`ctx.sessions.subagentAddress(id): SubagentAddress | undefined`（`ISessions` 声明，asar 偏移 23922753）。

## 3. 最小可运行示例（含「服务缺失 → false」回退）

写法与本仓库现有 `createOpenLibrary`（`src/client/slots.ts:615`）保持一致：apply 时用 `ctx.inject` 捕获服务，action 里同步调用并兜底。

```ts
/** 宿主 uiWorkspace 的只声明用到的成员（asar 内为私有类型，本地只依赖形状）。 */
export interface UiWorkspaceFace {
  openSession?(target: string | object): void
}

export interface SessionOpenerCtx {
  inject?: (deps: readonly string[], cb: (scope: { uiWorkspace?: UiWorkspaceFace }) => void) => unknown
}

/**
 * 生成「跳到某个成员会话」动作。
 * 返回 true  = 宿主已接受并切换（同步生效）；
 * 返回 false = 服务缺失 / 宿主抛错（调用方必须显示可见降级，不许静默）。
 */
export function createSessionOpener(ctx: SessionOpenerCtx): (memberId: string) => boolean {
  let uiWorkspace: UiWorkspaceFace | undefined
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['uiWorkspace'], (scope) => {
        if (scope.uiWorkspace !== undefined) uiWorkspace = scope.uiWorkspace
      })
    } catch {
      uiWorkspace = undefined // 服务不存在时 cordis 会 pending；只是少一条快路径
    }
  }
  return (memberId: string): boolean => {
    const face = uiWorkspace
    if (face === undefined || typeof face.openSession !== 'function') return false
    if (typeof memberId !== 'string' || memberId === '') return false
    try {
      face.openSession(memberId) // SessionId 直接传；成员 id 与 session id 同源
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[dsh-auto-team] 打开成员会话失败，已降级：${message}`)
      }
      return false
    }
  }
}
```

调用侧建议（不要只靠返回值，要给可见反馈）：

```tsx
const open = createSessionOpener(ctx) // apply 时创建一次，onClick 里复用
<button onClick={() => { if (!open(member.id)) setErr('无法切换到该成员会话（宿主未提供导航服务）') }}>
  查看会话
</button>
```

- 不需要 `await`；不需要先 `selectPanel(null)`；不需要右栏页签配合。
- 若要「子 Agent 地址更准确」（标题/血缘显示），可先取地址：`const addr = ctx.sessions?.subagentAddress?.(memberId)`，有则传 `addr`，否则传 `memberId`——非必需，传字符串已够用。

## 4. 已排除的路径（别重复试）

1. **`ctx.layout.selectPanel(id)` 不能切会话**。`dsh-client-ui-layout/src/client/service.ts` 的接口注释逐字写明：`Select a global central panel **without changing the current Session**`；`selectPanel` 只认已注册的 main key（未注册直接 `throw new Error('layout.selectPanel: main panel "..." is not registered')`），`null` 表示「回到会话」。`src/client/slots.ts:587` 的注释也说的是同一件事。→ 会话切换必须走 `uiWorkspace.openSession`，`selectPanel(null)` 只是它的副产物。
2. **`ctx.layout.beginNavigation()` 不是切换**。它只返回一个 `AbortSignal`（供上层做「后一次导航作废前一次」），本身不改变选中态（service.ts 中 `beginNavigation()` 只做 `abort` + 新建 `AbortController`）。
3. **`ctx.sessions` 没有切换方法**。`ISessions` 全量成员（asar 偏移 23922753 处声明）：`list` / `retain` / `using` / `retainInfo` / `searchResultLimit` / `create` / `subagentAddress` / `refreshProjections` / `refresh` / `search` / `fork` / `scope` / `scopeOf` / `sessionOf` / `binding` —— 无一能改当前选中会话。（`layout/service.ts` 头注释里「current-session selection lives with the runtime sessions service」是过期描述，别按它去 `ctx.sessions.select/selectSession` 找。）
4. **`selectSession` 这个名字在 asar 里不是导航 API**：7 处命中全在 `dsh-client-ui-schedule`，且是纯选择器 `selectSessionScheduleFacts` / `selectSession`（`src/client/session-schedule-state.ts` +2344）——与 UI 导航无关。
5. **`switchSession` / `navigateToSession` / `focusSession` 全包 0 命中**（对 209 MB asar 做 `indexOf` 全量扫描）：不存在这两个名字的公开入口，不要按关键词猜 API。
6. **`ctx.sidebarRight.openResource(subagentChatAddress(address), { kind: 'subagentchat', preferNewPane: true })`**（subagent 包同文件）是「把成员会话开在右栏资源位」，**不是主区切换**；本需求若要「主会话区跳到成员」不能用它（可作为「并排对照」形态另说）。
7. **URL / hash 路由或 `window.location` 切会话**：`openSession` 是 store 驱动（`selection.set`），没有对应可写的 URL 契约；拼 URL 只会刷新页面并丢状态。

## 5. 时序与并发注意

- `openSession` 的取消信号是 `this.lifetime.signal`（不是 `beginNavigation()`），即**连续两次调用不会互相作废**，后一次直接覆盖前一次（旧引用被 `release`）。连点多个成员 = 以最后一次为准，无竞态崩溃。
- 抛错只发生在 `retain` / 中止 / 回调阶段，此时旧选中态**保持不变**（`replaceMain` 在 `selection.set` 之前失败会 `release` 新引用并 rethrow），所以失败后界面停在原地是可接受语义，但必须给用户文案 + 重试。
- 同 tick 生效：`selection.set` 是 observable 写；若紧接 `openSession` 后同步读 `sessionId` prop，可能还是旧值（React 下一次渲染才更新）。**不要**在调用后同步断言「已切换」；需要确认就等渲染后的 sessionId 变化，或直接以返回 true 作为「宿主已接受」。

## 6. 挂载面建议（给实现者）

- 入口放在成员卡片/成员列表行（右栏面板内），用真 `<button>`；`onClick` 里调 action，**不要**用 `div onClick`。
- 服务缺失分支（返回 false）显示可见文案（如「宿主未提供会话导航，无法跳转」）+ 保留成员卡片可读信息，不要静默。
- 跳到成员后主区会从「自动团队」面板切回会话（`selectPanel(null)`），这是预期行为；若希望用户能一键切回面板，再补一个「返回面板」按钮（另开任务，不在本次结论内）。

## 7. 未验证项 / 风险

- **未做真机点击验证**（本次为只读侦察，未启动第二宿主）。以上时序结论来自宿主自带源码（`.tsx/.ts` 随 asar 一起发布，非反编译），但「点击后主区确实切换到成员会话」仍需一次真机 eyeline 确认。
- 类型来自宿主内部包，本项目未 import 其类型；示例里用本地 `interface` 只描述形状，避免引入宿主包依赖（与本仓库「host/client 零直接 import」及 asar 内包不可依赖的惯例一致）。
- 若宿主升级把 `openSession` 改名，症状是 `false` 分支（可见文案），不会静默——回退设计已覆盖。
