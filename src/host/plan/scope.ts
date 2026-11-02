/**
 * 写域（write scope）纯函数（r11 F4）：归一、目录边界冲突判定、锁视图派生、等待文案。
 *
 * 为什么单独成模块、且零 IO：AC-13 的判据是「把裸 `startsWith` 改回去必须让测试变红」——
 * 只有把判定做成可被单测直接调用的纯函数，这条判据才有信息量。混进 store/dispatch 里，
 * 测试就得先攒一个 RunState 才能问一句「这两条路径冲不冲突」。
 *
 * 归一与冲突都只有这一份实现：工具入口（plan/add_tasks）、派发循环、锁视图全调这里，
 * 任何一处内联 `startsWith` 都会绕过「目录边界」规则（`src/host` 与 `src/hostile.ts`
 * 必须**不**冲突，这是本轮最容易写错的一行）。
 */
import type { MemberBinding, PlanTask, ScopeLockView, ScopeLockWaiterView } from '../../shared/types.ts'

/** 视为「正占着写域」的状态：running 与它的门禁子阶段 gate。 */
const HOLDER_STATUSES: ReadonlySet<PlanTask['status']> = new Set<PlanTask['status']>(['running', 'gate'])

/** 一次归一失败的形态：可读原因码 + 人话（AC-12 要求「给可读原因码」）。 */
interface NormalizeFailure {
  ok: false
  error: string
}

function fail(code: string, detail: string): NormalizeFailure {
  return { ok: false, error: `${code}：${detail}` }
}

/** `describe` 只用于错误文案：把任意值渲染成短小的可读形式。 */
function describe(value: unknown): string {
  if (typeof value === 'string') return `「${value}」`
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return '数组'
  return typeof value
}

/**
 * 单条写域归一（TECHNICAL §3.1）：`\` → `/`、折叠 `//`、去 `./` 前缀、去尾 `/`。
 *
 * 拒绝三类非法输入（AC-12）：空串元素 / 绝对路径（`/x` 或 `C:`）/ 含 `..` 段（会逃出仓库根）。
 * 归一后必须是「相对仓库根」的路径——所以 `去首 /` 与「拒绝绝对路径」不并存，
 * 以 AC-12 的显式列举为准：绝对路径一律拒绝，而不是悄悄剁掉前导斜杠。
 */
function normalizeOne(raw: unknown): { ok: true; scope: string } | NormalizeFailure {
  if (typeof raw !== 'string') {
    return fail('WRITE_SCOPE_TYPE', `写域元素必须是字符串（收到 ${describe(raw)}）`)
  }
  const trimmed = raw.trim()
  if (trimmed === '') return fail('WRITE_SCOPE_EMPTY', '写域里不能有空串元素')

  let path = trimmed.replace(/\\/g, '/')
  if (path.startsWith('/')) {
    return fail('WRITE_SCOPE_ABSOLUTE', `写域必须是相对仓库根的路径，不能是绝对路径（收到 ${describe(raw)}）`)
  }
  if (/^[A-Za-z]:(\/|$)/.test(path)) {
    return fail('WRITE_SCOPE_ABSOLUTE', `写域不能是盘符路径（收到 ${describe(raw)}）`)
  }

  path = path.replace(/\/{2,}/g, '/')
  while (path.startsWith('./')) path = path.slice(2)
  path = path.replace(/\/+$/, '')

  if (path === '' || path === '.') {
    return fail('WRITE_SCOPE_EMPTY', `写域不能是仓库根本身（收到 ${describe(raw)}）`)
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '..')) {
    return fail('WRITE_SCOPE_ESCAPE', `写域不能含 ".." 逃出仓库根（收到 ${describe(raw)}）`)
  }
  if (segments.some((segment) => segment === '')) {
    return fail('WRITE_SCOPE_EMPTY', `写域里有空的路径段（收到 ${describe(raw)}）`)
  }
  return { ok: true, scope: path }
}

/**
 * 归一一批写域：`undefined`/`null` → 空数组（= 不限，不参与互斥）。
 *
 * 结果**去重并按字典序排序**——排序让「同内容不同顺序」得到同一个数组，
 * 追加任务的内容指纹（AC-9 幂等）才稳定。
 */
export function normalizeWriteScopes(
  input: unknown,
): { ok: true; scopes: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, scopes: [] }
  if (!Array.isArray(input)) {
    return fail('WRITE_SCOPE_TYPE', `写域必须是字符串数组（收到 ${describe(input)}）`)
  }
  const seen = new Set<string>()
  for (const raw of input) {
    const one = normalizeOne(raw)
    if (!one.ok) return one
    seen.add(one.scope)
  }
  return { ok: true, scopes: [...seen].sort() }
}

/**
 * 两条写域是否冲突（AC-13）：相等，或一方是另一方的**目录边界**前缀。
 *
 * 反例（必测）：`src/host` 与 `src/hostile.ts` 不冲突 —— 裸 `startsWith` 会误判成冲突，
 * 于是两个毫不相干的任务被串行化，症状是「并发莫名其妙变成 1」。
 */
export function scopesConflict(a: string, b: string): boolean {
  const left = String(a ?? '').trim().replace(/\/+$/, '')
  const right = String(b ?? '').trim().replace(/\/+$/, '')
  if (left === '' || right === '') return false
  if (left === right) return true
  return right.startsWith(`${left}/`) || left.startsWith(`${right}/`)
}

/**
 * 持有者的哪些路径挡住了目标写域（按 holder 的声明顺序返回，去重）。
 *
 * 返回值用于两件事：判定要不要等（非空即冲突），以及把**冲突的那条路径**写进等待原因
 * （「等待 t2 释放 src/host/bridge.ts」——面板据此逐字显示）。
 */
export function conflictingScopes(holder: readonly string[], target: readonly string[]): string[] {
  const conflicts: string[] = []
  const seen = new Set<string>()
  for (const held of holder) {
    const path = String(held ?? '').trim()
    if (path === '' || seen.has(path)) continue
    if (target.some((candidate) => scopesConflict(path, candidate))) {
      seen.add(path)
      conflicts.push(path)
    }
  }
  return conflicts
}

/** 任务写域（容错：脏数据里的非字符串直接丢弃，不抛异常）。 */
function scopesOf(task: PlanTask): string[] {
  const scopes: string[] = []
  const seen = new Set<string>()
  for (const raw of task.writeScopes ?? []) {
    if (typeof raw !== 'string') continue
    const scope = raw.trim()
    if (scope === '' || seen.has(scope)) continue
    seen.add(scope)
    scopes.push(scope)
  }
  return scopes
}

/**
 * 等待原因（AC-14 逐字样例）：「等待 t2 释放 src/host/bridge.ts」。
 *
 * 这是**宿主生成**的中文，客户端必须原样渲染（零拼装）；改这里就等于改面板文案，
 * 所以只写一句话、不带标点之外的修饰。
 */
export function waitReasonOf(holderTaskId: string, path: string): string {
  return `等待 ${holderTaskId} 释放 ${path}`
}

/** 任务 → 成员名（优先取未 retired 的绑定；绑定缺失时不猜 memberId，留给调用方显示「未派成员」）。 */
function memberNamesOf(bindings: readonly MemberBinding[] | undefined): Map<string, string> {
  const names = new Map<string, string>()
  for (const binding of bindings ?? []) {
    if (binding.retired === true) continue
    const name = typeof binding.name === 'string' ? binding.name.trim() : ''
    if (name === '') continue
    if (!names.has(binding.taskId)) names.set(binding.taskId, name)
  }
  return names
}

/**
 * 由计划现算锁视图（AC-16/AC-19）：**没有锁表**，每次从 `status + writeScopes` 派生。
 *
 * 持有者 = `running`/`gate` 且写了非空写域；等待者 = `waiting` 且与持有路径冲突。
 * 同一路径上的多个等待者合进同一条（`waiters` 数组），面板不重复渲染路径行。
 */
export function deriveScopeLocks(
  tasks: readonly PlanTask[],
  bindings?: readonly MemberBinding[],
): ScopeLockView[] {
  const members = memberNamesOf(bindings)
  const holders = tasks.filter((task) => HOLDER_STATUSES.has(task.status) && scopesOf(task).length > 0)
  if (holders.length === 0) return []
  const waiters = tasks.filter((task) => task.status === 'waiting')

  const views: ScopeLockView[] = []
  for (const holder of holders) {
    const holderMember = members.get(holder.id)
    for (const path of scopesOf(holder)) {
      const row: ScopeLockView = { path, holderTaskId: holder.id, waiters: [] }
      if (holderMember !== undefined) row.holderMember = holderMember

      for (const waiter of waiters) {
        if (waiter.id === holder.id) continue
        if (!scopesOf(waiter).some((scope) => scopesConflict(scope, path))) continue
        const reason = typeof waiter.waitReason === 'string' ? waiter.waitReason : ''
        const waiterRow: ScopeLockWaiterView = {
          taskId: waiter.id,
          // 快照里的等待原因原样透传；缺省时才现算（同一个文案函数，避免两种措辞）
          reason: reason.trim() !== '' ? reason : waitReasonOf(holder.id, path),
        }
        const waiterMember = members.get(waiter.id)
        if (waiterMember !== undefined) waiterRow.member = waiterMember
        row.waiters.push(waiterRow)
      }
      views.push(row)
    }
  }
  return views
}
