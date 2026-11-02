<!-- meta: summary="r11 设计：计划页新增写域占用区块与任务行等待条（文案全由宿主出）、13 态徽标扩 3 态（等待中/已取消/已跳过，红只留失败）、任务行三紧凑动作按钮与 disabled 矩阵、卡内改验收浮层（空值 0 请求）、执行痕迹区块（空不渲染）；沿用 r7/r10 token 与非乐观纪律，零新增槽位" -->

# DESIGN · r11 简单任务接单 / 续派 / 写域互斥 / 单任务干预

基线：`docs/teamflow/20261101-r7-auto-team-panel-roles`（token 表、任务行四要素、非乐观纪律）+ `docs/teamflow/20261102-r10-autoteam-skills-toolbar`（工具条与面板头部纪律）。本文件只写**新增与修订**，未提到的部分逐条沿用基线。
取代：无设计级旧约定被推翻；`PlanTask.writeScopes`、`TaskStatus` 13 态、`PanelAction` 18 是**形状扩张**，UI 只是把它们显示出来。
零新增槽位（AC-21）：本轮所有改动都在既有 `sidebar.right.pane.tab` 面板内部。

---

## 0. 视觉与质感规范（先读这一节，开发只读到文件头）

### 0.1 硬规则（沿用 r10 §0.1，本轮追加两条）

1. 字号一律 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)`；**禁止** `font-size: var(--dsw-font-*)`（该 token 是 font 简写，写 font-size 是无效声明）。
2. 颜色只用语义 token / `color-mix(in srgb, var(--token) N%, transparent)`，不写字面色值。
3. **11px 文字禁用琥珀**：琥珀只做圆点、竖条、描边、8% 微底，文字用 `label-secondary`。
4. 变长文本容器一律 `min-width: 0`；该省略的用省略号，**该读全的（等待原因 / 文件路径 / 验收命令）改用 `overflow-wrap: anywhere` 折行，绝不 ellipsis**。
5. ★ **零拼装**：`waitReason`、`scopeLocks[].reason`、`deviations[].reason` 一律把快照字段**原文**渲染，client 不拼「等待 t2 释放…」这类中文（AC-19 判据落在宿主文案上）。
6. ★ **非乐观**：取消 / 跳过 / 改验收点击后，按钮组立即 `disabled` + 旋转环，等下一次快照回来才改徽标；失败则回滚可点并在行内出一句原因。

### 0.2 表面处理（数字直接抄；★=本轮新增，△=修订）

| 元素 | 半径 | 描边 | 底色 | 阴影 | 尺寸 |
| --- | --- | --- | --- | --- | --- |
| △ 任务卡 `[data-plan-row]` | `radius-md` 12 | 1px `border-l2` | `bg-layer-1` | `shadow-lv1` | `padding: 10px 12px`，卡间距 8（**新增**：常态高 ≤116，见 §0.6） |
| ★ 等待任务卡 | 12 | 1px `border-l2` **+ 左 3px `warn`** | `bg-layer-1` | `shadow-lv1`（**不取消阴影**，与暂停态区分） | 同上，高 ≤166 |
| ★ 等待条 `[data-wait-reason]` | `radius-xs` 4 | 1px `color-mix(warn 55%)`，左边 2px `warn` | `color-mix(warn 8%)` | 无 | 占满卡宽，`padding: 4px 6px`，12px/18px，最多 2 行（36px 文本 + 8 = 44） |
| ★ 写域占用区块 `[data-scope-locks]` | 0 | 顶部 1px `border-l2` + 组标题 11px `label-tertiary` | transparent | 无 | 与任务表之间 8px；列表 `max-height:180px` 内滚，`scrollbar-gutter: stable` |
| ★ 占用行 `[data-lock-row]` | `radius-sm` 8 | 1px `border-l2` | `bg-layer-1` | 无 | `padding: 8px 10px`，行间 6px，高 56（1 行路径）～96（2 行路径 + 2 个等待者） |
| ★ 任务动作按钮 `[data-task-action]` | `radius-xs` 4 | 1px `border-l2`（hover→`border-l3`） | transparent | 无 | 高 **20px**，`padding: 0 6px`，11px/18px，组内 gap 6 |
| ★ 改验收浮层 `[data-acceptance-editor]` | `radius-md` 12 | 1px `border-l2` | `bg-layer-2` | `shadow-lv3` | 宽 = 卡内宽 272，高 196，`padding: 10px 12px`，覆盖卡下方内容（z-index 5） |
| ★ 浮层输入 `[data-acceptance-input]` | `radius-sm` 8 | 1px `border-l2`，focus 转 `business` | `bg-layer-1` | 无 | 高 **96**（12px/18px ≈ 4 行），`resize: vertical`，`min-height: 72` |
| ★ 执行痕迹 `[data-deviation]` | 0 | 顶部 1px `border-l2` | transparent | 无 | 列表 `max-height:160px` 内滚，行高 20px |
| 状态徽标 13 态 | `radius-xs` 4 | 1px `border-l1`（warn/danger/success 用 45% tone 描边） | transparent | 无 | 高 20，`padding: 0 6px`，11px/18px（既有，只加 3 个态的值） |

### 0.3 状态反馈（缺一即不合格）

| 态 | 变化 | 时长 |
| --- | --- | --- |
| hover | 底 → `interactive-bg-hover`；描边 → `border-l3` | `120ms var(--ds-ease-in-out)` |
| active | 底 → `interactive-bg-active` | `80ms` |
| focus-visible | `outline: 2px solid business`，`offset: 1px` | 即时 |
| disabled | `opacity: .5` + `cursor: not-allowed`，**尺寸不变**，`title` 说明原因 + `aria-label` 附带原因 | 即时 |
| busy（动作在飞） | 三个动作按钮整组 `disabled`、`aria-busy="true"`、被点那个左侧 12px 旋转环（800ms linear），**文案逐字不变** | — |
| 成功 hit-flash | 徽标换成「已取消/已跳过」时，卡片 `data-flash="true"` 300ms：`color-mix(label 6%)` 底 → transparent | `300ms` |
| 动作失败 | 该卡 foot 下方一行 `[data-error]`（`role="alert"`，红，12px）+ 浮层不关闭、输入保留 | 淡入 `200ms` |
| 打开浮层 | `opacity 0→1` + `scale(.98→1)` | `140ms` |

### 0.4 动效 / 空 / 错误（只列本轮）

- **写域占用区块**：有占用时才挂载，首次出现 `opacity 0→1` 120ms；释放后整行立即移除，**不做退场动画**（退场会让任务表整体上跳）。
- **等待条**：与既有 stall 条同款 120ms 淡入；因快照 2s 轮询，等待条**不加** `aria-live`（否则每 2 秒播报一次）。
- **改验收浮层**：见 §0.3；`Esc` 与「取消」立即移除（无退出动画），点遮罩外/其他卡片的「验收」按钮切换目标。
- **执行痕迹**：新记录插到列表顶部，`opacity` 不闪；`×N` 增加只改数字（`tabular-nums`，宽度不跳）。
- **空态**：`scopeLocks.length === 0` → 区块 **0 个节点**；`deviations.length === 0` → 区块 **0 个节点**（AC-20 / AC-24）。不写「暂无占用」「暂无痕迹」空壳。
- **加载态**：无骨架（快照同步推送）。
- `@media (prefers-reduced-motion: reduce)`：关闭位移/缩放/淡入/旋转，只保留颜色变化。

### 0.5 排版角色与数字对齐

| 角色 | 字号/字重 | 说明 |
| --- | --- | --- |
| 任务标题 | 13px / 600 | 既有，单行省略 |
| 状态徽标 | 11px/18 | 文案全部来自 `progressOf`（唯一一份） |
| 等待条正文 | 12px/18 `label-secondary` | 宿主原文，2 行折行 |
| 锁路径 / 验收命令 / 痕迹路径 | 12px / `var(--ds-font-family-code)` | 等宽，`overflow-wrap: anywhere` |
| 锁持有者 | 12px / 600 `label-primary` + 前置 `●` `business` | 「谁占着」必须一眼看到 |
| 等待者 | 12px `label-secondary` + 前置 `○` `border-l3` | 与持有者靠实心/空心 + 字重区分 |
| 次数 `×N` / 计数 / 时间 | 11px `tabular-nums` | 数字位宽固定，轮询时不抖 |

### 0.6 几何自洽（按 320px 右栏算死的数字，不许再改）

- 面板内宽 **296**（320 − 12×2 padding），任务卡内宽 **272**（− 12×2 padding）。
- 任务卡常态高 = head 20 + 6 + 验收 2 行 36 + 6 + foot 24 + padding 20 = **112 → 上界 116**（**作废 r7「卡高 100px 上界」**）。
- 等待卡再加 6 + 等待条 44 = **≤166**；foot 折行再加 26 → **绝对上界 192**。
- 等待条 272 宽、12px 字 ≈ 21 字/行；最长样例「等待 t2 释放 src/host/plan/acceptance.ts」（28 字）→ 2 行 36px，位于 44px 内，成立。
- 三个动作按钮 3×34 + 2×6 = 114px，与 `role select`(≤140) 同排 **放不下 → 允许 foot 折行**（`flex-wrap: wrap` 既有），按钮永远排在 foot 末尾，不挤掉角色控件。
- 徽标「已取消」（3 字 ≈ 33 + padding 12 + 描边 2 = 47）与任务 id `t12`(≈21) 同排：47+8+21 = 76 < 272，成立。
- 浮层 272 宽、输入 248 宽：12px 等宽 ≈ 34 字符/行；最长模板命令 `grep -RIn --fixed-strings 'suggestAcceptance' src/host >/dev/null`（68 字符）→ 2 行 36px，96px 输入框容 4 行，成立。
- 占用行：276 可用宽、12px 等宽 ≈ 38 字符/行，40 字符路径 → 1～2 行；`max-height:180px` 容 2～3 行后内滚。

### 0.7 本产品反模式（出现任一条即打回）

1. 用红表达 waiting / cancelled / skipped —— 红只留给 `failed` / `interrupted`。
2. 空矩阵渲染「暂无占用」空壳，或把区块用 `display:none` 冒充「没渲染」（AC-20 判节点数）。
3. 把 `waitReason` / 锁路径省略号截断 —— 用户必须读到「等谁、等哪条路径」（反面目标 2 判据）。
4. 等待中的任务卡被重排到列表末尾或跳到最前 —— 顺序即计划顺序，位置稳定才看得出谁被挡住。
5. 三个动作按钮改成纯图标、或撑满整行把角色下拉挤没。
6. 改验收做成全屏模态 —— 320px 面板里会遮住它要对照的任务上下文。
7. 编辑器空值先发请求再红字报错 —— 必须按钮 disabled、**0 次请求**。
8. client 自己拼等待中文，或同一原因既写页级 `data-hint` 又写行内 `[data-error]`（重复归因）。
9. 写不存在的 token（`--text-1` 之类）或 `font-size: var(--dsw-font-*)` —— 静默失效，构建与 console 都不报错。
10. 新增 `slots.register` / 页签 / 路由来放这两块区域（AC-21 / AC-28 计数会红）。

---

## 1. 页面与模块清单（信息架构不变）

| 位置 | 本轮改动 | 槽位 |
| --- | --- | --- |
| 输入框左侧开关 | 无 | 既有 `conversation.input.left` |
| 会话头按钮 | 无 | 既有 `conversation.session.header.actions` |
| 右栏面板 · 页签条（计划/成员/记忆/角色） | **不新增页签** | 既有 `sidebar.right.pane.tab` `.title` |
| 右栏面板 · 计划页 | ★ 写域占用区块、★ 任务行等待条、★ 三个动作按钮、★ 改验收浮层、★ 执行痕迹区块；13 态徽标 | 同上 |
| 右栏面板 · 成员页 | 无结构改动（waiting 任务没有成员，成员页自然不出现） | — |
| 记忆页 / 角色页 / 设置页 | 无 | — |
| 队长提示词、工具文案、门禁文案 | 非 UI，但属用户可见文本：见 §5.4 文案口径 | — |

计划页纵向顺序（自上而下，**除最后一项外顺序不变**）：`meta 行 → 触发记录 → 动作行（开始派发/取消计划）→ hint → ★写域占用 → 任务表 → ★执行痕迹`。

---

## 2. 关键页面线框

### 2.1 计划页 · 常态（无冲突、无痕迹）

```
┌ 面板 320 ────────────────────────┐
│ 计划 | 成员 | 记忆 | 角色          │
├──────────────────────────────────┤
│ 运行 r-8f2 · 11-02 10:41         │
│ 并发 1/3 · 完成 2/5   ← title: 等待中的任务不占并发 │
│ [开始派发]  [取消计划]            │
├──────────────────────────────────┤
│ ┌ t1 修 order 校验       ✓已通过 ┐│
│ │ pnpm typecheck                ││
│ │ 架构师  退出码 0   [放行][续聊] ││
│ │              ★[取消][跳过][验收]││
│ └───────────────────────────────┘│
│ ┌ t2 补单测            ●运行中  ┐│
│ └───────────────────────────────┘│
└──────────────────────────────────┘
（写域占用区块 / 执行痕迹区块：0 个节点，完全不出现）
```

### 2.2 计划页 · 有写域占用 + 等待任务

```
├──────────────────────────────────┤
│ 写域占用 · 2 处                   │  ← 组标题 11px label-tertiary
│ ┌ src/host/bridge.ts             ┐│  ← [data-lock-path] 等宽，可折行
│ │ ● t2 · 架构师                  ││  ← [data-lock-holder] 600
│ │ ○ t4 · 等待中（等待 t2 释放 …） ││  ← [data-lock-waiter]，reason 原文
│ └───────────────────────────────┘│
│ ┌ src/host/plan                 ┐│
│ │ ● t3 · 高级全栈               ││
│ │ ○ t5 · 等待中（等待 t3 释放 …） ││
│ └───────────────────────────────┘│
├──────────────────────────────────┤
│ ┌ t4 改 planner        ⏳等待中  ┐│  ← 徽标 amber 描边 + label-secondary 字
│ │ 等待 t2 释放 src/host/bridge.ts ││  ← [data-wait-reason] 宿主原文
│ │ 架构师               [取消][跳过]││
│ └───────────────────────────────┘│
```

### 2.3 任务行 · 改验收浮层（`[data-acceptance-editor]`）

```
│ ┌ t2 补单测              ●运行中 ┐│
│ │ ┌────────────────────────────┐ ││  ← 浮层绝对定位覆盖卡内容，shadow-lv3
│ │ │ 改验收 · t2        ●运行中  │ ││
│ │ │ ┌────────────────────────┐ │ ││
│ │ │ │ pnpm typecheck         │ │ ││  ← textarea 96px，12px 等宽
│ │ │ └────────────────────────┘ │ ││
│ │ │ 一条能在本仓库真跑通的命令， │ ││  ← 11px label-tertiary
│ │ │ exit 0 才算过；空值不能保存 │ ││
│ │ │              [取消] [保存]  │ ││  ← 空输入时保存 disabled
│ │ └────────────────────────────┘ ││
│ └───────────────────────────────┘│
```

### 2.4 计划页 · 执行痕迹（有记录时才出现）

```
├──────────────────────────────────┤
│ 执行痕迹 · 队长亲手写了 3 次       │
│ 10:41:07 write  src/host/bridge.ts ×4 │  ← 行高 20，11px；路径等宽
│   原因：补一处类型守卫后立刻派成员    │
│ 10:39:12 edit   src/client/ui.ts      │
│   原因：修正文案                       │
└──────────────────────────────────┘
```

### 2.5 空 / 错误

- `runId === undefined`：沿用既有空态（「还没有计划。」+ 下一步说明），不新增节点。
- 任务表空：既有 `[data-empty]`。
- 任务级动作失败：该卡 foot 下一行红字 `[data-error]`，例「t2 正在运行，请先取消再跳过」；**不**再写页级 hint。
- 计划级动作失败（派发/取消计划）：沿用页级 `[data-hint]` / `[data-error]`，行为不变。

---

## 3. 组件规范

### 3.1 13 态徽标（只扩值，不扩映射点）

`BADGES` 追加三行（`viewmodel.ts` 仍是**唯一一份**文案，`progressOf` 仍是唯一一处状态→色调/进度）：

| status | icon | text | tone | 进度% |
| --- | --- | --- | --- | --- |
| waiting ★ | ⏳ | 等待中 | warn | 20 |
| cancelled ★ | ⊘ | 已取消 | neutral | 0 |
| skipped ★ | ↷ | 已跳过 | neutral | 0 |

- waiting 与 blocked 同进度（20，都是「被挡住、未开跑」）；cancelled / skipped 归 0 且 **neutral**（不是 danger，红只给失败）。
- 徽标视觉：既有 `[data-task-status-badge]`；`data-status="waiting"` 时文字用 `label-secondary`、描边 `warn 45%`、`⏳` 用 warn（**不做琥珀文字**，§0.1-3）。
- 任务卡额外属性：`data-status="waiting"` 时左 3px `warn` 竖条（与暂停态的琥珀左条**同色不同位**：暂停是整卡描边 40% + 去阴影，等待只加左条且保留阴影）。

### 3.2 任务行等待条

- 位置：`[data-task-acceptance]` 之后、`[data-task-foot]` 之前，占满卡宽。
- 结构：`<p data-wait-reason role="note" data-task-id="t4">{snapshot.tasks[i].waitReason}</p>`，**文本与快照逐字相同**（AC-20 逐字断言）。
- 仅 `status === 'waiting'` 且 `waitReason` 非空时渲染；其他 12 态 0 节点。
- 允许 2 行；超 2 行仍全文渲染（不 clamp）—— 等待原因读不全等于卡死（反面目标 2）。

### 3.3 写域占用区块 `[data-scope-locks]`

- 挂载条件：`snapshot.scopeLocks.length > 0`；空数组 → **不渲染**（节点 0，连组标题都没有）。
- 结构：
  ```
  <section data-scope-locks aria-label="写域占用">
    <div data-locks-head>写域占用 · {n} 处</div>   // role="status"，不加 aria-live
    <ul data-lock-list>
      <li data-lock-row data-task-id="t2">
        <code data-lock-path>{path}</code>
        <span data-lock-holder>{holderTaskId} · {holderMember ?? '未派成员'}</span>
        <ul data-lock-waiters>
          <li data-lock-waiter data-task-id="t4">{taskId} · {member ?? '未派成员'}（{reason}）</li>
        </ul>
      </li>
    </ul>
  </section>
  ```
- `reason` 是宿主给的整句中文，client 只在**前面**拼 `taskId · member`（这两项是快照里的结构化字段），不得改写 reason 正文。
- 持有者 `●` business 实心；等待者 `○` border-l3 空心；`aria-hidden` 于圆点。
- 一行只有一个 holder；同一路径多个等待者 → 同一 `<li>` 内多条 `[data-lock-waiter]`（不重复渲染路径行）。

### 3.4 任务行三个动作按钮（AC-27）

- 位置：`[data-task-foot]` **末尾**（在「放行 / 续聊」之后），组容器 `<span data-task-actions>`。
- 属性：`data-task-action="cancel|skip|edit-acceptance"`、`data-task-id`、`disabled`、`title`（原因）、`aria-label`（「取消任务 t2」/「跳过任务 t2」/「修改 t2 的验收命令」）。
- 文案：`取消` / `跳过` / `验收`（2 字，11px，`padding: 0 6px`，高 20）。
- **disabled 矩阵（13 态，逐格实现，禁止用 else 兜底）**：

| 状态 | 取消 | 跳过 | 改验收 |
| --- | --- | --- | --- |
| pending 待派发 | ✓ | ✓ | ✓ |
| ready 就绪 | ✓ | ✓ | ✓ |
| blocked 阻塞 | ✓ | ✓ | ✓ |
| waiting 等待中 | ✓ | ✓ | ✓ |
| running 运行中 | ✓（连带中断成员） | ✗「运行中请先取消」 | ✓ |
| rework 待返工 | ✓ | ✗「待返工：请重跑或取消」 | ✓ |
| failed 失败 | ✓ | ✗「已失败：请重跑或取消」 | ✓ |
| interrupted 已中断 | ✗「已中断：请续聊或改验收后重跑」 | ✗「已中断：请续聊」 | ✓ |
| gate 门禁中 | ✗「门禁执行中，等门禁结束」 | ✗「门禁执行中」 | ✓ |
| paused 已暂停 | ✗「已暂停：先点页头『继续任务』」 | ✗「已暂停：先继续任务」 | ✓ |
| done 已通过 | ✗「已完成，无需取消」 | ✗「已完成」 | ✗「已完成的任务证据不改写」 |
| cancelled 已取消 | ✗「已取消」 | ✗「已取消」 | ✗「已取消」 |
| skipped 已跳过 | ✗「已跳过」 | ✗「已跳过」 | ✗「已跳过」 |

> 说明（给技术方案的两处口径）：① 允许集严格照 PRD AC-26 白名单；`paused` / `gate` / `interrupted` 是否纳入允许集**由技术方案定一次**，若纳入只改这张表与 allow 表，UI 结构不动。② `disabled` 按钮的 `title` 在 Chromium 仍会弹；若真机实测不弹，退化方案是把按钮包进 `<span title>`（结构不变、样式不变），不要改成点击后才报错。

### 3.5 改验收浮层 `[data-acceptance-editor]`（AC-27）

- 同一时刻只允许一个；再次点别的「验收」= 切换目标（不影响未提交输入以外的状态）。
- 结构：`<div role="dialog" aria-modal="false" aria-label="修改 t2 的验收命令" data-acceptance-editor data-task-id="t2">`，内含标题行（`改验收 · t2` + 当前状态徽标，复用同一个徽标组件）、`<textarea data-acceptance-input>`（96px、等宽 12px、`aria-label="验收命令"`）、提示行（11px `label-tertiary`，逐字：「一条能在本仓库真跑通的命令，exit 0 才算过；空值不能保存」）、`<span data-acceptance-actions>`（`取消` / `保存`）、失败行 `[data-error]`。
- 打开时 `textarea` 预填当前 `acceptance`，光标置末；`autoFocus` 到 textarea，`Esc` 关闭。
- **空值 = 0 请求**：`value.trim() === ''` → 保存按钮 `disabled` + `aria-disabled="true"` + title「验收命令不能为空」；不发送、不弹提示。
- 保存成功：浮层关闭，任务卡 `[data-task-acceptance]` 下一帧刷新为新命令（快照回来才变，非乐观）。
- 保存失败：浮层**不关闭**，输入保留，底部 `[data-error]` 一句原因（沿用面板错误机制）。
- 关闭：`取消` / `Esc` / 点浮层外（`pointerdown` 落在浮层外且不在「验收」按钮上）。

### 3.6 执行痕迹区块 `[data-deviation]`（AC-24）

- 位置：任务表之后（页面最末）；`deviations` 为空 → **0 节点**。
- 结构：组标题「执行痕迹 · 队长亲手写了 N 次」+ `<ul data-deviation-list>`，每行：
  `<li data-deviation-row>` → `<time data-deviation-at>`（`HH:mm:ss`，`tabular-nums`）、`<span data-deviation-tool>`（`write`/`edit`，等宽）、`<code data-deviation-paths>`（多个路径用 `、` 连接，等宽折行）、`<span data-deviation-count>`（仅 `count > 1` 时渲染 `×N`，`tabular-nums`）、`<span data-deviation-reason>`（第二行，11px `label-tertiary`，宿主原因为准，≤120 字单行省略）。
- 语义：这是**审计**不是告警 —— 不用红、不用琥珀、不加 badge；行内 hover 底 `interactive-bg-hover` 100ms。
- 上限：快照已投影最近 50 条；列表 `max-height:160px` 内滚（≈8 行），不撑破页面。
- 若执行痕迹与任务表同屏确实挤（真机 320px 复核），唯一允许的降级：整块移到成员页末尾，**结构与文案不变**（不动其它判据）。

---

## 4. 交互与动效（本轮的完整动作流）

1. **取消任务**：点 `取消` → 三按钮组 disabled + 转环 → 快照回来：徽标变「已取消」、卡 `data-flash` 300ms、若该任务占着写域则占用区块对应行**同一帧消失**、下游任务徽标变「阻塞」且其等待条文案为宿主给的「上游 t2 已取消」→ 转环解除。
2. **跳过任务**：同上，徽标变「已跳过」（neutral），下游不受阻（继续推进）。
3. **改验收**：点 `验收` → 浮层 140ms 淡入 + 自动聚焦 → 输入 → `保存`（空值不可点）→ 浮层关闭、命令文本更新；失败则浮层留着并给原因。
4. **等待→可推进**：成员 A 完成 → 占用区块该行消失（或减少等待者）→ 等待卡徽标由「等待中」变「就绪」或「运行中」、等待条消失；**卡位置不动**，只换内容。
5. **键盘**：`Tab` 顺序 = 取消 → 跳过 → 验收（DOM 顺序）；`Esc` 只关浮层，不触发面板其他关闭。

---

## 5. 视觉规范（可直接抄的取值）

### 5.1 颜色（全部既有 token，不新增）

- 等待 / 占用：`--dsw-alias-state-warn-primary`（琥珀）→ 只做左竖条、圆点、45–55% 描边、8% 底；文字 `label-secondary`。
- 持有者 / 就绪：`--dsw-alias-state-business-primary`（蓝）。
- 取消 / 跳过：`label-tertiary` / `label-secondary`（中性，**无状态色**）。
- 失败 / 中断：`--dsw-alias-state-error-primary`（红），本轮只有既有 failed/interrupted 与 `[data-error]` 用它。
- 底与描边：`bg-layer-1`（卡、占用行）、`bg-layer-2`（浮层）、`border-l1/l2/l3`。

### 5.2 字号（一律 font 简写）

`--dsw-font-xs-13`（正文/标题）、`--dsw-font-xxs-12`（等待条、路径、锁次要行）、`--dsw-font-xxxs-11`（徽标、按钮、计数、痕迹行）、`--dsw-font-sm-14`（面板标题，既有）。

### 5.3 间距

面板 padding 12；卡 padding 10/12、卡间 8；块间 8；块内 gap 6（行内）4（行间）；按钮高 20（紧凑）/28（页面级）。

### 5.4 文案口径（用户可见文本，逐字）

- 等待条：「等待 t2 释放 src/host/bridge.ts」（宿主生成，含持锁任务 id 与冲突路径，两句都不可缺）。
- 占用组标题：「写域占用 · 2 处」；痕迹组标题：「执行痕迹 · 队长亲手写了 3 次」。
- 浮层提示：「一条能在本仓库真跑通的命令，exit 0 才算过；空值不能保存」。
- 三处工具/门禁文案（`auto_team_plan` / `auto_team_add_tasks` 空验收、`runGate('')`）：模板命令必须**逐字可执行**（`pnpm typecheck` / `grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null` / `test -n "$(git status --porcelain -- <paths>)"`），结构为「结论一句 + 三条模板原文 + 该补的参数名」；`runGate` 旧句「该任务没有验收命令，需要人工确认后放行」逐字保留在最前。**禁止**出现 `pnpm lint`（本仓无此脚本）。

---

## 6. 无障碍要点

- 三个动作按钮：`aria-label` 带任务 id 与全意（不能只读「取消」）；disabled 时 `aria-disabled="true"` 且 title/aria-label 含原因。
- 浮层：`role="dialog"` + `aria-modal="false"`（面板内浮层，不夺整页焦点）+ `aria-label` 含任务 id；打开即聚焦 textarea，`Esc` 关闭；关闭后焦点回到「验收」按钮。
- 空值保存按钮：`disabled` + `aria-disabled`，不靠颜色表达「不能点」。
- 等待条 `role="note"`、占用区块 `aria-label="写域占用"`；**均不加 `aria-live`**（2s 轮询会反复播报）。
- 13 态不只靠颜色：每态都有中文标签（等待中 / 已取消 / 已跳过），去色后可读。
- 对比度：11px 文本一律 `label-secondary`/`label-primary`，琥珀不做文字（§0.1-3）。
- 触控/鼠标目标：紧凑按钮 20px 高，命中区用 `::after { inset: -4px -2px }` 外扩到 28，不改布局高度。

---

## 7. 开发核对清单（改完逐条打勾）

1. `TaskStatus` 13 态全部有 `TASK_PROGRESS` 行，无 `undefined` 兜底（漏一族会表现为「任务永远待派发」）。
2. 徽标文案仍只来自 `statusBadge`、色调/进度仍只在 `progressOf`；组件里没有第二份 switch。
3. `[data-scope-locks]` / `[data-deviation]` 空数组时**不挂载**（渲染测试断言节点数 0）。
4. `[data-wait-reason]` 文本与快照 `waitReason` 逐字相等（不裁剪、不拼接）。
5. 13 态 × 3 动作的 disabled 矩阵逐格实现（渲染测试 39 格）。
6. 编辑器空值 0 请求（断言 `act` 调用次数为 0）。
7. 动作提交期间三按钮整组 disabled，快照回来才改文案（非乐观）。
8. 无新增 `slots.register` / `slots.inject`、无新增页签、无新增 HTTP 路由、无新 `PanelAction` beyond 3。
9. 只使用本文列出的 token；`font:` 简写；无 `font-size: var(--dsw-font-*)`。
10. 320px 下三处新增区块不横向溢出（`document.scrollWidth === 320`），任务卡高不超过 §0.6 的上界。
