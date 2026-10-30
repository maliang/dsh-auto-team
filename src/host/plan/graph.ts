/**
 * 纯函数：任务依赖图。全部为纯计算，无 IO、无本地 import —— 可被 `node --test` 直接跑。
 *
 * 三件事：
 *  1. validateGraph：结构合法性（空、重复 id、未知依赖、自依赖、环）；
 *  2. readyTasks：当前可派发的集合（依赖全部 done 且自身未开始）；
 *  3. blockedTasks：依赖未全部 done 的集合（面板显示「被谁挡着」）。
 */

export interface GraphNode {
  id: string
  dependsOn: string[]
}

export type GraphCheck = { ok: true } | { ok: false; reason: string }

/** 结构校验。返回第一个问题即停（面板只展示一条明确原因，不堆栈）。 */
export function validateGraph(nodes: GraphNode[]): GraphCheck {
  if (nodes.length === 0) return { ok: false, reason: '计划为空：至少需要一个任务' }

  const ids = new Set<string>()
  for (const node of nodes) {
    const id = (node.id ?? '').trim()
    if (id === '') return { ok: false, reason: '存在 id 为空的任务' }
    if (ids.has(id)) return { ok: false, reason: `任务 id 重复：${id}` }
    ids.add(id)
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (dep === node.id) return { ok: false, reason: `任务 ${node.id} 依赖了自己` }
      if (!ids.has(dep)) return { ok: false, reason: `任务 ${node.id} 依赖了不存在的任务：${dep}` }
    }
  }

  const cycle = findCycle(nodes)
  if (cycle) return { ok: false, reason: `依赖成环：${cycle.join(' → ')}` }

  return { ok: true }
}

/**
 * 找出一条环（用于报错信息）。Kahn 拓扑排序剥不掉的节点集合即「在环上或依赖环」，
 * 再在其中沿依赖走一圈取真实环路，保证提示可定位。
 */
export function findCycle(nodes: GraphNode[]): string[] | null {
  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!indegree.has(node.id)) indegree.set(node.id, 0)
    children.set(node.id, children.get(node.id) ?? [])
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!indegree.has(node.id) || !indegree.has(dep)) continue
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      const list = children.get(dep) ?? []
      list.push(node.id)
      children.set(dep, list)
    }
  }

  const queue: string[] = []
  for (const [id, degree] of indegree) if (degree === 0) queue.push(id)

  const removed = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift() as string
    removed.add(id)
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
  }

  if (removed.size === nodes.length) return null

  const remaining = nodes.filter((node) => !removed.has(node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: string[] = []
  const seen = new Map<string, number>()
  let cursor: string | undefined = remaining[0]?.id

  while (cursor !== undefined) {
    const at = seen.get(cursor)
    if (at !== undefined) return [...path.slice(at), cursor]
    seen.set(cursor, path.length)
    path.push(cursor)
    const node: GraphNode | undefined = byId.get(cursor)
    // 只在「仍在剩余集合里」的依赖上继续走，才能保证下一步仍在环内。
    cursor = (node?.dependsOn ?? []).find((dep) => !removed.has(dep))
  }

  return remaining.map((node) => node.id)
}

export interface TaskLike extends GraphNode {
  status: string
}

/** 可派发集合：自身状态为 pending/ready/rework，且所有依赖都是 done。 */
export function readyTasks(tasks: TaskLike[]): string[] {
  const doneIds = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks
    .filter((task) => task.status === 'pending' || task.status === 'ready' || task.status === 'rework')
    .filter((task) => (task.dependsOn ?? []).every((dep) => doneIds.has(dep)))
    .map((task) => task.id)
}

/** 被阻塞集合 → 阻挡它的未完成依赖列表。 */
export function blockedTasks(tasks: TaskLike[]): Array<{ id: string; waitingOn: string[] }> {
  const doneIds = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks
    .filter((task) => task.status === 'pending' || task.status === 'ready' || task.status === 'rework')
    .map((task) => ({
      id: task.id,
      waitingOn: (task.dependsOn ?? []).filter((dep) => !doneIds.has(dep)),
    }))
    .filter((entry) => entry.waitingOn.length > 0)
}

/** 拓扑层（并行度参考）：同一层内任务互不依赖，可同时派发。 */
export function topoLayers(tasks: GraphNode[]): string[][] {
  const done = new Set<string>()
  const layers: string[][] = []
  let guard = 0
  while (done.size < tasks.length && guard <= tasks.length) {
    guard += 1
    const layer = tasks
      .filter((task) => !done.has(task.id))
      .filter((task) => (task.dependsOn ?? []).every((dep) => done.has(dep)))
      .map((task) => task.id)
    if (layer.length === 0) break
    for (const id of layer) done.add(id)
    layers.push(layer)
  }
  return layers
}
