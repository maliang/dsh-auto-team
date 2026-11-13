#!/usr/bin/env node
/**
 * D1 复验脚本：复用成员路径不写「任务卡缺 path:line」软提示。
 *
 * 场景：t1 已 done 且 bindings 里有成员 m-old（idle、角色一致），t2 是首次派发、
 * 任务卡（title/writeScopes）没有任何 path:line 指针。此时 dispatchReady 会复用 m-old，
 * 而不是 spawn 新成员 —— AC③ 要求「首次派发且无指针」恰好多一条 captain→user 软提示。
 *
 * 现状（r31 t1 之后）：toUser = 0 → 本脚本 exit 1（缺陷复现）。
 * 修复后：toUser = 1 且带 taskId=t2 → exit 0。
 *
 * 运行：node docs/teamflow/2026-11-13-r31-read-discipline/repro-reuse-hint.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../../', import.meta.url)
const { RUN_STATE_VERSION, RunsStore } = await import(new URL('src/host/store.ts', root).href)
const { dispatchReady } = await import(new URL('src/host/team/dispatch.ts', root).href)

const NOW = 1_700_000_000_000
const dir = mkdtempSync(join(tmpdir(), 'r31-reuse-hint-'))
const store = new RunsStore(dir)
const role = { id: 'dev', name: '开发', duty: 'd', skillIds: [], builtin: true, updatedAt: NOW }
const tasks = [
  { id: 't1', title: '任务t1', roleId: 'dev', dependsOn: [], acceptance: 'true', status: 'done' },
  { id: 't2', title: '任务t2', roleId: 'dev', dependsOn: ['t1'], acceptance: 'true', status: 'pending' },
]
const state = {
  version: RUN_STATE_VERSION,
  plan: { runId: 'run', sessionId: 's', createdAt: NOW, status: 'dispatching', tasks, maxConcurrent: 3 },
  plannedAt: NOW,
  messages: [],
  routeAudits: [],
  bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'm-old', name: 'dev-t1', spawnedAt: NOW }],
}
const sent = []
const deps = {
  store,
  roles: {
    list: () => [role],
    get: (id) => (id === 'dev' ? role : undefined),
    save: (r) => ({ ok: true, role: r }),
    remove: () => ({ ok: true }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  },
  buildPrompt: () => 'P',
  listMembers: async () => [{ id: 'm-old', name: 'dev-t1', status: 'idle' }],
  spawn: async () => ({ ok: true, memberId: 'm-new' }),
  sendMessage: async (_id, text) => {
    sent.push(text)
    return { ok: true }
  },
  hostConcurrency: () => ({ limit: 8, source: 'host' }),
  now: () => NOW + 5,
}

const result = await dispatchReady(state, deps)
rmSync(dir, { recursive: true, force: true })

const toUser = result.state.messages.filter(
  (message) => message.from === 'captain' && message.to === 'user' && message.taskId === 't2',
)
console.log(`started=${JSON.stringify(result.started)} reuseMessages=${sent.length} toUser=${toUser.length}`)
for (const message of toUser) console.log(`  hint: ${message.body}`)

if (result.started.includes('t2') && toUser.length === 0) {
  console.error('D1 复现：t2 首次派发、任务卡无 path:line，但复用成员路径没有 captain→user 软提示')
  process.exit(1)
}
if (toUser.length === 1 && toUser[0].body.includes('t2')) {
  console.log('PASS：复用成员路径也写了带 taskId 的软提示')
  process.exit(0)
}
console.error(`异常：toUser=${toUser.length}，与预期（1 条带 t2 的提示）不符`)
process.exit(2)
