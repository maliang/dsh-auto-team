/**
 * 队长可用工具（ctx.tools.register），共 7 个（TECHNICAL §4.3）。
 *
 * 纪律：
 *  - 未启用时**不能静默不干活**：必须返回明确中文错误（AC-12），用户才知道是「没打开开关」而不是「插件坏了」；
 *  - 动作型工具（message / receipt / memory 写 / role 写）一律走 `bridge.act`，
 *    与面板 HTTP 入口共用同一套语义与拒绝码 —— 否则就是「工具能用、面板不能用」这个历史高频缺陷；
 *  - `auto_team_dispatch` **强制带 runId**：这是 AC-30「计划条目早于首个成员创建」的机械保证，
 *    不靠提示词自律（提示词只是第二道保险）。
 */
import type { ActResult, PanelSnapshot, PlanTask, RejectionCode, Result } from '../shared/types.ts'
import { MEMORY_LINES_PER_TASK, TOOL_PREFIX } from './config.ts'
import { blockedTasks, readyTasks } from './plan/graph.ts'
import { buildPlan, progressOf, type PlanDraftTask } from './plan/plan.ts'
import { RUN_STATE_VERSION, uniqueRunId, type RunState, type RunsStore } from './store.ts'
import type { Bridge } from './bridge.ts'
import type { RoleRepo } from './roles/repo.ts'
import { registerTool, type HostContext, type ToolSpec } from './adapters.ts'

export interface ToolsDeps {
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  now: () => number
}

const NOT_ENABLED = '自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。'

/** 当前会话 id：由工具调用元信息带入；缺失时退回 'current'（面板按会话隔离，不会串数据）。 */
export function sessionOf(meta: unknown): string {
  const value = meta as { sessionId?: string; session?: { id?: string } } | undefined
  return value?.sessionId ?? value?.session?.id ?? 'current'
}

function taskBrief(task: PlanTask): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    dependsOn: task.dependsOn,
    status: task.status,
    memberId: task.memberId,
    acceptance: task.acceptance,
  }
}

function rejectedOf(result: ActResult): Record<string, unknown> | null {
  if (!result.rejected) return null
  return { ok: false, code: result.rejected.code, error: result.rejected.message, notices: result.notices }
}

export function buildToolSpecs(deps: ToolsDeps): ToolSpec[] {
  return [
    {
      name: `${TOOL_PREFIX}plan`,
      description:
        '把一个目标拆成有依赖的任务图并生成执行计划（不创建任何成员）。每个任务需要 roleId 与 acceptance（可执行的验收命令）。返回 runId，派发时必须带上它。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '要达成的目标' },
          maxConcurrent: { type: 'integer', description: '并发上限，默认 3，硬上限 8' },
          tasks: {
            type: 'array',
            description: '任务列表（依赖必须指向同一列表里的 id）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '任务 id，缺省按 t1/t2… 生成' },
                title: { type: 'string' },
                roleId: { type: 'string', description: '执行该任务的角色 id' },
                dependsOn: { type: 'array', items: { type: 'string' } },
                acceptance: { type: 'string', description: '验收命令（门禁据此产出证据）' },
              },
              required: ['title', 'roleId'],
            },
          },
        },
        required: ['goal', 'tasks'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const at = deps.now()
        const draft = buildPlan(
          {
            sessionId,
            goal: typeof args.goal === 'string' ? args.goal : '',
            maxConcurrent: typeof args.maxConcurrent === 'number' ? args.maxConcurrent : undefined,
            tasks: Array.isArray(args.tasks) ? (args.tasks as PlanDraftTask[]) : [],
          },
          uniqueRunId(deps.store, sessionId, at),
          at,
        )
        if (!draft.ok) return { ok: false, error: draft.reason }

        const state: RunState = {
          version: RUN_STATE_VERSION,
          plan: draft.plan,
          plannedAt: at,
          messages: [],
          bindings: [],
          routeAudits: [],
        }
        deps.store.save(state)

        return {
          ok: true,
          runId: draft.plan.runId,
          plannedAt: state.plannedAt,
          maxConcurrent: draft.plan.maxConcurrent,
          tasks: draft.plan.tasks.map(taskBrief),
          ready: readyTasks(draft.plan.tasks),
          blocked: blockedTasks(draft.plan.tasks),
          members: 0,
          note: '计划已保存，尚未创建任何成员；用户确认后调用 auto_team_dispatch（必须带 runId）。',
        }
      },
    },
    {
      name: `${TOOL_PREFIX}dispatch`,
      description:
        '按依赖顺序派发就绪任务并创建成员（并发受 maxConcurrent 与宿主上限限制）。必须带 plan 返回的 runId。',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'auto_team_plan 返回的 runId（必填）' } },
        required: ['runId'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''
        if (runId === '') {
          return {
            ok: false,
            error:
              'auto_team_dispatch 必须带 runId：先调用 auto_team_plan 生成计划，再用它返回的 runId 派发（计划必须早于成员创建）。',
          }
        }
        const state = deps.store.load(runId)
        if (!state || state.plan.sessionId !== sessionId) {
          return { ok: false, error: `找不到运行 ${runId}：当前会话没有这个 runId（重新调用 auto_team_plan）` }
        }

        const result = await deps.bridge.act(sessionId, { type: 'dispatch', runId })
        const rejected = rejectedOf(result)
        if (rejected) return rejected

        const snapshot = result.snapshot
        return {
          ok: true,
          runId: snapshot.runId,
          planStatus: snapshot.planStatus,
          concurrency: snapshot.concurrency,
          tasks: snapshot.tasks.map(taskBrief),
          members: snapshot.members.map((member) => ({
            memberId: member.memberId,
            name: member.name,
            roleId: member.roleId,
            taskId: member.taskId,
            status: member.status,
            modelRoute: member.modelRoute,
          })),
          notices: result.notices,
        }
      },
    },
    {
      name: `${TOOL_PREFIX}status`,
      description: '读取当前会话的执行计划、成员状态、门禁证据、消息账本、记忆注入预算与角色列表。',
      parameters: { type: 'object', properties: {}, required: [] },
      async handler(_args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }
        const snapshot: PanelSnapshot = deps.bridge.snapshot(sessionId)
        return {
          ok: true,
          enabled: snapshot.enabled,
          runId: snapshot.runId,
          planStatus: snapshot.planStatus,
          plannedAt: snapshot.plannedAt,
          progress: progressOf(snapshot.tasks),
          concurrency: snapshot.concurrency,
          tasks: snapshot.tasks.map((task) => ({
            ...taskBrief(task),
            evidence: task.evidence
              ? { exitCode: task.evidence.exitCode, command: task.evidence.command, at: task.evidence.at }
              : undefined,
          })),
          members: snapshot.members,
          messages: snapshot.messages.slice(-20),
          routeAudits: snapshot.routeAudits,
          memory: {
            injectedChars: snapshot.memory.injectedChars,
            budget: snapshot.memory.budget,
            truncated: snapshot.memory.truncated,
            files: snapshot.memory.files.map((file) => `${file.track}/${file.name}`),
          },
          roles: snapshot.roles.map((role) => ({ id: role.id, name: role.name, model: role.model })),
        }
      },
    },
    {
      name: `${TOOL_PREFIX}message`,
      description: '给指定成员发直达消息（按 taskId 或成员名定位）。成员可续聊；中断后用同一成员继续。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '按任务定位成员' },
          memberName: { type: 'string', description: '按成员名定位（优先于 taskId）' },
          text: { type: 'string' },
        },
        required: ['text'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const text = typeof args.text === 'string' ? args.text : ''
        if (text.trim() === '') return { ok: false, error: 'text 不能为空' }
        const taskId = typeof args.taskId === 'string' && args.taskId.trim() !== '' ? args.taskId.trim() : undefined
        const memberName = typeof args.memberName === 'string' ? args.memberName.trim() : ''

        const snapshot = deps.bridge.snapshot(sessionId)
        const byName = memberName === '' ? undefined : snapshot.members.find((member) => member.name === memberName)
        if (memberName !== '' && !byName) {
          return { ok: false, error: `找不到成员 ${memberName}：可用成员 ${snapshot.members.map((m) => m.name).join('、') || '（无）'}` }
        }
        const memberId = byName?.memberId

        const result = await deps.bridge.act(sessionId, { type: 'message', memberId, taskId, text })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return { ok: true, notices: result.notices }
      },
    },
    {
      name: `${TOOL_PREFIX}receipt`,
      description:
        '提交任务回执：跑该任务的验收命令（门禁），通过则任务完成、失败则转返工并把证据回发给同一成员。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 id' },
          note: { type: 'string', description: '成员自述（写入证据说明）' },
        },
        required: ['taskId'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (taskId === '') return { ok: false, error: 'taskId 不能为空' }
        const note = typeof args.note === 'string' && args.note.trim() !== '' ? args.note : undefined

        const result = await deps.bridge.act(sessionId, { type: 'receipt', taskId, note })
        const rejected = rejectedOf(result)
        if (rejected) return rejected

        const task = result.snapshot.tasks.find((item) => item.id === taskId)
        return {
          ok: true,
          taskId,
          status: task?.status,
          evidence: task?.evidence
            ? {
                command: task.evidence.command,
                exitCode: task.evidence.exitCode,
                tail: task.evidence.tail,
                artifacts: task.evidence.artifacts,
              }
            : undefined,
          notices: result.notices,
        }
      },
    },
    {
      name: `${TOOL_PREFIX}memory`,
      description:
        '读写团队记忆（双轨 md）：track=public 为跨项目公共记忆，track=project 为当前项目记忆。写入自动限制行数并落来源标注。'
        + 'action=expand 按内联索引里的 ID（mem://<track>/<stem>）取回原文——上下文里只内联了 ID+标题+首句，'
        + '要读完整内容必须显式展开，不要凭标题猜正文。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'expand'] },
          track: { type: 'string', enum: ['public', 'project'] },
          name: { type: 'string', description: '文件名（单段，自动补 .md）' },
          body: { type: 'string' },
          id: { type: 'string', description: 'action=expand 的记忆 ID（mem://<track>/<stem>，来自内联索引）' },
          depth: { type: 'number', description: 'action=expand 顺着关联 ID 继续展开的跳数（1~2，缺省 1）' },
        },
        // expand 只需要 id（track/name 由 ID 自带）：把它俩设成 required 会逼模型为展开动作编一个 track。
        // read/write 缺 name 的情况下面按业务拒绝，原因文案反而更可读。
        required: ['action'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const track = args.track === 'public' ? 'public' : 'project'
        const name = typeof args.name === 'string' ? args.name.trim() : ''

        if (args.action === 'list') {
          const snapshot = deps.bridge.snapshot(sessionId)
          return {
            ok: true,
            budget: snapshot.memory.budget,
            injectedChars: snapshot.memory.injectedChars,
            truncated: snapshot.memory.truncated,
            files: snapshot.memory.files,
            inline: snapshot.memory.inline ?? [],
            omitted: snapshot.memory.omitted ?? [],
          }
        }

        if (args.action === 'expand') {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (id === '') {
            return { ok: false, code: 'EXPAND_BAD_ID', error: 'expand 需要 id（形如 mem://project/<文件名>）' }
          }
          const depth = typeof args.depth === 'number' ? args.depth : undefined
          const expanded = deps.bridge.expandMemory(id, depth)
          if (expanded.error !== undefined) return { ok: false, error: expanded.error }
          // 失败码原样透出（AC-11）：模型要能区分「ID 写错 / 越权 / 不存在 / 跳数超限」，
          // 压成一句「展开失败」它只会盲试。
          const payload = expanded.data
          return {
            ok: payload.code === 'OK',
            code: payload.code,
            message: payload.message,
            id: payload.id,
            track: payload.track,
            name: payload.name,
            body: payload.body,
            chars: payload.chars,
            truncated: payload.truncated,
            depth: payload.depth,
            related: payload.related,
          }
        }

        if (name === '') return { ok: false, error: 'name 不能为空' }

        if (args.action === 'read') {
          const read: Result<{ track: string; name: string; body: string; chars: number }> =
            await deps.bridge.readMemoryFile(track, name)
          if (read.error !== undefined) return { ok: false, error: read.error }
          return { ok: true, ...read.data }
        }

        const body = typeof args.body === 'string' ? args.body : ''
        if (body.trim() === '') return { ok: false, error: 'body 不能为空' }
        const lines = body.split('\n')
        const clipped = lines.slice(0, MEMORY_LINES_PER_TASK).join('\n')

        const result = await deps.bridge.act(sessionId, { type: 'saveMemory', track, name, body: clipped })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return {
          ok: true,
          track,
          name,
          lines: Math.min(lines.length, MEMORY_LINES_PER_TASK),
          truncated: lines.length > MEMORY_LINES_PER_TASK,
          notices: result.notices,
        }
      },
    },
    {
      name: `${TOOL_PREFIX}role`,
      description: '查看或修改角色（含为角色指定 provider/model）。内置角色可改不可删。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'save', 'remove'] },
          role: {
            type: 'object',
            description: '角色对象（save 时必填）',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              duty: { type: 'string' },
              skillIds: { type: 'array', items: { type: 'string' } },
              model: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  reasoningEffort: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
              },
            },
            required: ['id', 'name'],
          },
          roleId: { type: 'string' },
        },
        required: ['action'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        if (args.action === 'list') {
          return {
            ok: true,
            roles: deps.roles.list().map((role) => ({
              id: role.id,
              name: role.name,
              duty: role.duty,
              skillIds: role.skillIds,
              model: role.model,
              builtin: role.builtin,
              modelNote: role.model ? undefined : '未指定模型：按会话默认模型派发',
            })),
          }
        }

        if (args.action === 'remove') {
          const roleId = typeof args.roleId === 'string' ? args.roleId.trim() : ''
          if (roleId === '') return { ok: false, error: 'roleId 不能为空' }
          const result = await deps.bridge.act(sessionId, { type: 'deleteRole', roleId })
          const rejected = rejectedOf(result)
          if (rejected) return rejected
          return { ok: true, roleId, notices: result.notices }
        }

        const role = args.role as Parameters<RoleRepo['save']>[0] | undefined
        if (!role) return { ok: false, error: 'save 需要 role 对象' }
        const result = await deps.bridge.act(sessionId, { type: 'saveRole', role })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return { ok: true, role: deps.roles.get(role.id), notices: result.notices }
      },
    },
  ]
}

/** 注册全部工具（宿主缺 tools 服务时由 adapters 静默跳过）。 */
export function registerTools(ctx: HostContext, deps: ToolsDeps): void {
  for (const spec of buildToolSpecs(deps)) registerTool(ctx, spec)
}

/** 供 QA 与单测使用的「未启用」文案（唯一来源，避免两处措辞漂移）。 */
export const NOT_ENABLED_MESSAGE = NOT_ENABLED

export type { RejectionCode }
