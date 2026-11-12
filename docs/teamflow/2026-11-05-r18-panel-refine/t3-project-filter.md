# r18 t3 — 项目库左栏只显示「用过自动团队」的项目

- 任务夹：`docs/teamflow/2026-11-05-r18-panel-refine/`
- 日期：2026-11-05
- 改动范围：`src/client/project-filter.ts`（新建纯函数）、`src/client/LibraryPage.tsx`（接入）、`test/r18-project-filter.test.ts`（新建）

## 1. 需求与口径

用户原话：「左侧点击'自动团队'后出现的主界面中左侧应该以工作区的项目显示栏位（有用过自动团队的项目才显示）」。

已确认口径：主界面（`main` 槽位的项目库）左栏的项目列表**只显示有过 run 的项目**（`project.runs > 0`）。
0 次运行的项目整项隐藏；`unknown` 的「历史运行（未记录工作区）」桶同样按 `runs` 过滤，`runs === 0` 时连桶一起隐藏。

## 2. 实现

### 2.1 纯函数（单一事实源）

新文件 `src/client/project-filter.ts`：

```ts
export function visibleProjectsOf(list: readonly ProjectView[]): ProjectView[] {
  return list.filter((project) => project.runs > 0)
}
```

- 只 import `type ProjectView`（`src/shared/types.ts`），不 import host、不 import React；
- 保持入参顺序，不重排、不复制/改写对象；
- 「已知项目在前、历史桶固定末位」的分桶仍由调用方 `LibraryPage` 负责（该函数不碰顺序）。

### 2.2 LibraryPage 接入

- `projects` memo 先 `visibleProjectsOf(library?.projects ?? [])`，再按 `unknown` 分桶；`knownProjects` / `historyProjects` 由过滤后的列表派生，因此两个桶都不会出现 0 run 项。
- 顶部副标题 `` `${projects.length} 个项目` `` 与 `data-project-count={projects.length}` 都直接用过滤后的长度，列表与计数一致。
- 选中回落（r18 t3 新增）：

```ts
const storedId = picked !== '' ? picked : (library?.currentProject ?? 'global')
const selectedId =
  storedId === 'global' || projects.some((project) => project.id === storedId)
    ? storedId
    : (projects[0]?.id ?? 'global')
```

规则：
1. 选中 `global`：始终保留（固定行，不参与过滤）；
2. 选中项仍在过滤后的列表里：保持原选择；
3. 选中项被过滤掉（0 run 项目 / 被隐藏的历史桶）：回落到**过滤后列表的第一个项目**（即已知项目按宿主顺序的第一项；若只剩历史桶则是该历史桶）；
4. 一个项目都不剩：回落到「全局」视图。

`picked` 状态本身不改写（不动选择持久化）；若刷新后该项目重新有 run，它会自然恢复为选中。`library === null` 时行为不变：详情区仍显示「正在读取项目库…」。

## 3. 测试

`test/r18-project-filter.test.ts`（`node --test`，不加载 TSX）：

行为层（直接驱动纯函数）：
- `runs > 0` 保留、`runs = 0` 丢弃、顺序保持；
- `unknown` 桶按 `runs` 过滤（0 隐藏、>0 保留）；
- 空数组 / 全 0 run → `[]`；
- 不修改入参与对象，返回同一批对象引用。

契约层（fs 读 `LibraryPage.tsx` 去注释后断言）：
- 引入并调用 `visibleProjectsOf(library?.projects ?? [])`，页面内无第二份 `runs > 0`；
- 副标题与 `data-project-count` 用 `projects.length`，无 `library.projects.length`；
- 选中回落判断（`projects.some(...)` + `projects[0]?.id ?? 'global'`）存在。

## 4. 门禁

```bash
pnpm typecheck && node --test test/r18-project-filter.test.ts test/client-ui.test.ts
```

结果见本次交付回报（退出码与 pass/fail 数）。

## 5. 未改动

`styles.ts`、`nav.ts`、`viewmodel.ts`、`slots.ts`、宿主侧与接口契约均未改；「全局」行、记忆桶、选择持久化逻辑保持原样。
