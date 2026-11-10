import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { PeerId, PeerScope, Principal, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import Dreaming from '../src/index.ts'
import { MemoryStore, type MemoryFact } from '../src/core/index.ts'
import { dreamingClientContribution, type DreamingUiRemote } from '../src/ui-protocol.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap { 'dreaming-test-guest': { kind: 'dreaming-test-guest' } }
}

type WireHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerScope) => Promise<unknown>
const neverAborted = new AbortController().signal
function peer(ctx: Context, principal: Principal = { kind: 'owner' }): PeerScope {
  return { id: 'dreaming-ui-test' as PeerId, ctx, principal, signal: neverAborted, interactions: 'none', async dispose() {} }
}
function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.code}: ${result.error.message}`)
  return result.value
}
function failure(result: RemoteResult<unknown>, code: string) {
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, code)
}
function fact(id: string, status: MemoryFact['status'] = 'supported'): MemoryFact {
  const time = '2026-01-01T00:00:00.000Z'
  return { id, level: 4, title: `Test command ${id}`, content: 'Run npm test in this project.', category: 'procedure', status,
    createdAt: time, updatedAt: time,
    sources: [{ sessionId: 'original-conversation', seq: 4, quote: 'Run npm test in this project.', kind: 'user', observedAt: time }],
    ...(status === 'stale' ? { retiredReason: 'Superseded by a later command.' } : {}),
  }
}

/** Real storage, tools, and both official Gateways; only the transport is in-process. */
async function fixture() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dsh-dreaming-ui-')))
  const projectRoot = join(temporary, 'project')
  const secondRoot = join(temporary, 'second')
  const storageDirectory = join(temporary, 'memory')
  await Promise.all([mkdir(projectRoot), mkdir(secondRoot)])
  const projectId = createHash('sha256').update(projectRoot).digest('hex')
  const store = new MemoryStore(join(storageDirectory, projectId), projectId)
  await store.transact(async current => ({ ...current, facts: [fact('first'), fact('second'), fact('retired', 'stale')] }))
  const host = new Context()
  const client = new Context()
  let handler: WireHandler | undefined
  let currentPeer = peer(host)
  try {
    await mountAgentLoopTestDependencies(host, { workingDirectory: true })
    await host.plugin(JsonlPersistence, { root: join(temporary, 'sessions'), compression: 'none' })
    await host.plugin(SqliteSessionQuery, { path: join(temporary, 'query.sqlite'), openAt: 'never' })
    await host.plugin(TypertRegistry)
    await host.plugin(RemoteAccess)
    host.provide('connection', { rpc: { intercept(_channel: string, _matches: unknown, handle: WireHandler) { handler = handle; return async () => { handler = undefined } } } })
    await host.plugin(Gateway)
    const harness = await mountAgentLoopTestHarness(host)
    const plugin = await host.plugin(Dreaming, { projectRoots: [projectRoot, secondRoot], storageDirectory, searchLimit: 1, autoRunAfterTurn: false, autoRunIntervalMinutes: 0 })
    await client.plugin(TypertRegistry)
    client.provide('connection', {
      interactions: 'none', isLoopback: true,
      generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
      rpc: {
        call: async (channel: string, endpoint: string, payload: unknown, signal: AbortSignal) => {
          assert.equal(channel, '/api')
          assert.ok(handler)
          return handler(endpoint, payload, signal, currentPeer)
        },
        async *open() { throw new Error('No streams expected in the memory UI.') },
      },
    })
    await client.plugin(ClientGateway)
    await client.remote.$mount(dreamingClientContribution)
    const agent = await harness.create(SessionId('memory-ui-tool-consumer'), { provider: 'unused', model: 'unused' }, { cwd: projectRoot })
    let callNumber = 0
    return {
      host, client, plugin, projectRoot, secondRoot, store,
      setPeer(principal: Principal) { currentPeer = peer(host, principal) },
      async tool(name: string, args: object) {
        const batch = await host.tools.execute({ agent, calls: [{ type: 'tool-call', id: ToolCallId(`ui-parity-${++callNumber}`), name, arguments: JSON.stringify(args) }], signal: neverAborted })
        assert.equal(batch.results.length, 1)
        return batch.results[0].result
      },
      async close() { await client.fiber.dispose(); await host.fiber.dispose(); await rm(temporary, { recursive: true, force: true }) },
    }
  } catch (error) {
    await client.fiber.dispose()
    await host.fiber.dispose()
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

test('official Client mount and Host gateway expose complete scoped snapshots and exact source evidence', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const ui = f.client.remote.dreamingUi
    assert.deepEqual(value(await ui.projects()), [f.projectRoot, f.secondRoot])
    const snapshot = value(await ui.snapshot({ projectRoot: f.projectRoot }))
    assert.equal(snapshot.revision, 1)
    assert.equal(snapshot.memories.length, 3, 'snapshot must not be capped by model searchLimit')
    assert.equal(snapshot.facts, 2)
    assert.equal(snapshot.memories.find(row => row.id === 'retired')?.status, 'stale')
    assert.deepEqual(snapshot.revisions.map(row => row.revision), [1])
    assert.deepEqual(value(await ui.read({ projectRoot: f.projectRoot, id: 'first' })), fact('first'))
    assert.equal(value(await ui.search({ projectRoot: f.projectRoot, query: 'test' })).length, 1)
    assert.equal(value(await ui.snapshot({ projectRoot: f.secondRoot })).memories.length, 0)
  } finally { await f.close() }
})

test('the bridge rejects guest users, path substitution, unknown fields, and malformed writes before changing memory', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const ui = f.client.remote.dreamingUi
    f.host.remoteAccess.registerPolicy('dreaming-test-guest', { bindings: () => [{
      resource: { kind: 'global' }, role: { name: 'test-broad-grant', resource: 'global', actions: ['dreamingUi/projects', 'dreamingUi/snapshot', 'dreamingUi/forget', 'dreamingUi/setLevel'] },
    }] })
    f.setPeer({ kind: 'dreaming-test-guest' })
    failure(await ui.projects(), 'dreaming/forbidden')
    failure(await ui.setLevel({ projectRoot: f.projectRoot, id: 'first', level: 1, expectedRevision: 1 }), 'dreaming/forbidden')
    failure(await ui.snapshot({ projectRoot: f.projectRoot }), 'dreaming/forbidden')
    failure(await ui.forget({ projectRoot: f.projectRoot, id: 'first' }), 'dreaming/forbidden')
    f.setPeer({ kind: 'owner' })
    for (const projectRoot of ['/', `${f.projectRoot}/..`, `${f.projectRoot}/`, `${f.projectRoot}-sibling`, f.store.directory]) {
      failure(await ui.snapshot({ projectRoot }), 'dreaming/project-not-enabled')
      failure(await ui.forget({ projectRoot, id: 'first' }), 'dreaming/project-not-enabled')
    }
    failure(await ui.rollback({ projectRoot: f.projectRoot, revision: -1 }), 'gateway/input-invalid')
    failure(await ui.rollback({ projectRoot: f.projectRoot, revision: 1.5 }), 'gateway/input-invalid')
    failure(await ui.forget({ projectRoot: f.projectRoot, id: '' }), 'gateway/input-invalid')
    failure(await ui.snapshot({ projectRoot: f.projectRoot, storageDirectory: '/tmp' } as { projectRoot: string }), 'gateway/input-invalid')
    const cancelled = AbortSignal.abort(new Error('User cancelled the operation.'))
    failure(await ui.forget({ projectRoot: f.projectRoot, id: 'first' }, cancelled), 'gateway/cancelled')
    assert.equal((await f.store.read()).revision, 1)
    assert.equal((await f.store.read()).facts.length, 3)
  } finally { await f.close() }
})

test('UI and registered model tools share read, run, forget and rollback semantics and surface failure reasons', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const ui = f.client.remote.dreamingUi
    const request = { projectRoot: f.projectRoot }
    for (const [name, args, uiResult] of [
      ['dream_status', {}, value(await ui.status(request))],
      ['memory_search', { query: 'test' }, value(await ui.search({ ...request, query: 'test' }))],
      ['memory_read', { id: 'first' }, value(await ui.read({ ...request, id: 'first' }))],
    ] as const) {
      const result = await f.tool(name, args)
      assert.equal(result.isError, false)
      assert.deepEqual(result.value, uiResult)
    }
    const toolRun = await f.tool('dream_run', {})
    assert.equal(toolRun.isError, false)
    assert.deepEqual(value(await ui.run(request)), toolRun.value, 'empty evidence must have the same no-op consolidation result')
    const removed = value(await ui.forget({ ...request, id: 'first' }))
    assert.equal(removed.revision, 2)
    const missingViaTool = await f.tool('memory_read', { id: 'first' })
    assert.equal(missingViaTool.isError, true)
    const missingViaUi = await ui.read({ ...request, id: 'first' })
    failure(missingViaUi, 'dreaming/operation-failed')
    if (!missingViaUi.ok) {
      assert.equal('code' in missingViaUi.error.details ? missingViaUi.error.details.code : undefined, 'NOT_FOUND')
      assert.match(missingViaUi.error.message, /first/)
    }
    const restored = await f.tool('dream_rollback', { revision: 1 })
    assert.equal(restored.isError, false)
    assert.deepEqual(restored.value, { revision: 3 })
    assert.deepEqual(value(await ui.read({ ...request, id: 'first' })), fact('first'))
    const removedViaTool = await f.tool('memory_forget', { id: 'first' })
    assert.deepEqual(removedViaTool.value, { revision: 4 })
    assert.equal(value(await ui.snapshot(request)).memories.some(row => row.id === 'first'), false)
    assert.deepEqual(value(await ui.rollback({ ...request, revision: 1 })), { revision: 5 })
    const snapshot = value(await ui.snapshot(request))
    assert.deepEqual(snapshot.memories, [fact('first'), fact('second'), fact('retired', 'stale')])
    assert.deepEqual(snapshot.revisions.map(row => row.revision), [5, 4, 3, 2, 1])
    const invalidLimit = await ui.search({ ...request, query: 'test', limit: 2 })
    failure(invalidLimit, 'dreaming/operation-failed')
    if (!invalidLimit.ok) assert.match(invalidLimit.error.message, /between 1 and 1/)
    assert.equal(value(await ui.snapshot({ projectRoot: f.secondRoot })).revision, 0)
  } finally { await f.close() }
})

test('unloading Dreaming withdraws the optional Host remote contribution', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    assert.ok(f.host.typert.local.get('dreamingUi/snapshot'))
    await f.plugin.dispose()
    assert.equal(f.host.typert.local.get('dreamingUi/snapshot'), undefined)
    const result = await f.client.remote.dreamingUi.snapshot({ projectRoot: f.projectRoot })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error.message, /withdrawn|unavailable/)
  } finally { await f.close() }
})

test('the actual Client factory activates under a plugin fiber with declared dynamic namespace access', { timeout: 30000 }, async () => {
  const ctx = new Context()
  let api: DreamingUiRemote | undefined
  let plugin: Parameters<Context['plugin']>[0] | undefined
  const source = (await readFile(new URL('../client/source.js', import.meta.url), 'utf8'))
    .replace('/*__PROTOCOL__*/ {}', 'protocol')
  runInNewContext(source, {
    protocol: dreamingClientContribution,
    window: { __ModuleLoader__: { load(definition: { factory(require: (id: string) => unknown): Parameters<Context['plugin']>[0] }) {
      plugin = definition.factory(id => {
        assert.equal(id, 'react')
        return { createElement() {} }
      })
    } } },
  })
  assert.ok(plugin)
  try {
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', { interactions: 'none', isLoopback: true, rpc: {
      async call() { return { ok: true, value: ['/configured/project'] } },
      async *open() { throw new Error('No streams expected.') },
    } })
    ctx.provide('locale', { register() { return () => {} }, bind() { return (key: string) => key } })
    ctx.provide('slots', {
      inject(_owner: string, install: () => void) { install() },
      register(definition: { name: string; inject?: () => { api: DreamingUiRemote } }) {
        if (definition.name === 'main') api = definition.inject?.().api
        return () => {}
      },
    })
    await ctx.plugin(ClientGateway)
    const mounted = await ctx.plugin(plugin)
    assert.ok(api, 'the plugin must mount its namespace, declare it in a child scope, and register the panel')
    assert.deepEqual(value(await api.projects()), ['/configured/project'])
    await mounted.dispose()
    assert.equal(ctx.typert.remotes.get('dreamingUi/projects'), undefined)
  } finally { await ctx.fiber.dispose() }
})

test('level changes through the UI and dsh tools share only the approved record across enabled projects', async () => {
  const f = await fixture()
  try {
    const ui = f.client.remote.dreamingUi
    const request = { projectRoot: f.projectRoot, id: 'first', level: 1 as const, expectedRevision: 1 }
    assert.equal((await ui.setLevel(request)).ok, true)
    const other = { projectRoot: f.secondRoot }
    const visible = value(await ui.snapshot(other)).memories
    assert.equal(visible.length, 1)
    const shared = visible[0]
    assert.equal(shared.level, 1)
    assert.deepEqual(shared.sources, [])
    assert.doesNotMatch(JSON.stringify(visible), /original-conversation|Test command second/)
    assert.deepEqual(value(await ui.read({ ...other, id: shared.id })), shared)
    assert.deepEqual(value(await ui.search({ ...other, query: 'npm' })), visible)
    failure(await ui.forget({ ...other, id: shared.id }), 'dreaming/operation-failed')
    assert.equal((await f.tool('memory_set_level', { id: 'first', level: 5 })).isError, false)
    assert.deepEqual(value(await ui.snapshot(other)).memories, [])
    assert.equal(value(await ui.read({ projectRoot: f.projectRoot, id: 'first' })).level, 5)
  } finally { await f.close() }
})
