/**
 * 模型清单缓存单测（r10 AC-16：角色模型改成弹层选择器）。
 *
 * 为什么单独测：`view()` 是**同步**快照口，而宿主清单是异步的；TTL、在飞共享、
 * stale-while-revalidate、读取失败降级这四件事全靠注入的 `read` + 假时钟断言，
 * 真机只能看到「某个时刻列表里有几项」，看不出 TTL 到底生效没有（恒绿风险最高的地方）。
 *
 * 对应实现：`src/host/model-catalog.ts`（`createModelCatalogCache` / `toCatalogView`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createModelCatalogCache, toCatalogView, type ModelCatalogRaw } from '../src/host/model-catalog.ts'
import { MODEL_CATALOG_MAX, MODEL_CATALOG_TTL_MS } from '../src/host/config.ts'

function rawOf(providers: Array<{ id: string; name: string; models: string[] }>): ModelCatalogRaw {
  return {
    groups: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.map((model) => ({ id: model, name: model.toUpperCase() })),
    })),
    failures: [],
  }
}

/** 让已排队的微任务跑完（`refresh` 是 async 的，`view()` 触发的是后台刷新）。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('toCatalogView：分组拍平成选项，ready 且无 reason', () => {
  const view = toCatalogView(
    rawOf([
      { id: 'deepseek', name: 'DeepSeek', models: ['v4', 'v3'] },
      { id: 'openai', name: 'OpenAI', models: ['gpt-5'] },
    ]),
  )
  assert.equal(view.status, 'ready')
  assert.equal(view.options.length, 3)
  assert.deepEqual(view.options[0], {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    model: 'v4',
    modelName: 'V4',
  })
  assert.equal(view.reason, undefined, '全部读全了就不该带说明（否则面板永远挂一条黄字）')
})

test('toCatalogView：空目录必须带可读 reason（ready 之外的静默空列表是缺陷）', () => {
  const view = toCatalogView({ groups: [], failures: [] })
  assert.equal(view.status, 'empty')
  assert.deepEqual(view.options, [])
  assert.ok((view.reason ?? '').length > 0, '空目录必须解释原因')
})

test('toCatalogView：逐 provider 失败写进 reason，成功的照常显示（不整体失败）', () => {
  const view = toCatalogView({
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v4', name: 'v4' }] }],
    failures: [{ id: 'openai', name: 'OpenAI', message: 'timeout' }],
  })
  assert.equal(view.status, 'ready')
  assert.equal(view.options.length, 1)
  assert.match(view.reason ?? '', /OpenAI/)
  assert.match(view.reason ?? '', /timeout/)
})

test('toCatalogView：超过上限截断并在 reason 里说明真实总数', () => {
  const view = toCatalogView(rawOf([{ id: 'p', name: 'P', models: ['a', 'b', 'c', 'd'] }]), 2)
  assert.equal(view.options.length, 2)
  assert.match(view.reason ?? '', /共 4 个/)
})

test('createModelCatalogCache：首次 view() 立刻给 loading，随后转 ready（不阻塞快照）', async () => {
  let now = 1_000
  const cache = createModelCatalogCache({
    read: async () => rawOf([{ id: 'p', name: 'P', models: ['m1'] }]),
    now: () => now,
    ttlMs: MODEL_CATALOG_TTL_MS,
  })
  assert.equal(cache.view().status, 'loading', '第一次读必须立刻返回 loading（快照是同步的）')
  await flush()
  const view = cache.view()
  assert.equal(view.status, 'ready')
  assert.equal(view.options[0]?.model, 'm1')
  assert.ok(MODEL_CATALOG_MAX > 0)
})

test('createModelCatalogCache：TTL 内不重复打宿主，过期后先给旧值再后台换新', async () => {
  let now = 1_000
  let calls = 0
  const cache = createModelCatalogCache({
    read: async () => {
      calls += 1
      return rawOf([{ id: 'p', name: 'P', models: [`m${calls}`] }])
    },
    now: () => now,
    ttlMs: 60_000,
  })
  await cache.refresh(true)
  assert.equal(calls, 1)
  assert.equal(cache.view().options[0]?.model, 'm1')

  now += 60_000 - 1
  cache.view()
  await flush()
  assert.equal(calls, 1, 'TTL 内 view() 绝不能触发第二次读取')

  now += 1 // 正好到 TTL：过期
  const stale = cache.view()
  assert.equal(stale.options[0]?.model, 'm1', '过期时必须先给旧值（stale-while-revalidate）')
  await flush()
  assert.equal(calls, 2, '过期后必须触发一次后台刷新')
  assert.equal(cache.view().options[0]?.model, 'm2')
})

test('createModelCatalogCache：并发调用共享同一次读取（轮询不会打爆宿主）', async () => {
  let calls = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const cache = createModelCatalogCache({
    read: async () => {
      calls += 1
      await gate
      return rawOf([{ id: 'p', name: 'P', models: ['m1'] }])
    },
    now: () => 0,
    ttlMs: 60_000,
  })
  const first = cache.refresh(true)
  const second = cache.refresh(true)
  assert.equal(calls, 1, '在飞期间第二次 refresh 必须复用它，不许再打一次宿主')
  release?.()
  await Promise.all([first, second])
  assert.equal(calls, 1)
})

test('createModelCatalogCache：读取抛错降级成 empty + reason，绝不把异常抛给快照', async () => {
  const cache = createModelCatalogCache({
    read: async () => {
      throw new Error('宿主炸了')
    },
    now: () => 0,
    ttlMs: 60_000,
  })
  await cache.refresh(true)
  const view = cache.view()
  assert.equal(view.status, 'empty')
  assert.match(view.reason ?? '', /宿主炸了/)
})
