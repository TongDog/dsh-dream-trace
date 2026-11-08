import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { z } from 'zod'
import Dreaming, { type ConfigInput } from '../src/index.ts'

const instruction = 'For this project, run npm run test:unit to execute unit tests.'
const memoryTitle = 'Project unit test command'
const memoryContent = 'The project user specifies npm run test:unit as the unit test command.'
const pluginTools = ['dream_run', 'dream_status', 'dream_rollback', 'memory_search', 'memory_read', 'memory_forget']
const payloadSchema = z.object({
  events: z.array(z.object({ sessionId: z.string(), seq: z.number(), kind: z.string(), text: z.string() })),
  proposal: z.unknown().optional(),
})

function requestText(request: GenerateOptions): string {
  return request.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function* textResponse(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Exercises the production model interface without provider credentials. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  responder?: (request: GenerateOptions) => string | Promise<string>

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, contextWindow: 128000, defaultMaxTokens: 4096 })
  }

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    request.signal?.throwIfAborted()
    if (this.responder) {
      yield* textResponse(await this.responder(request))
      return
    }
    if (!String(request.sessionId).startsWith('dreaming-worker-')) {
      yield* textResponse('Understood. I will use the project unit test command.')
      return
    }
    assert.equal(request.tools?.length ?? 0, 0, 'memory workers must not receive executable tools')
    const candidate = request.messages.filter(message => message.role === 'user').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).find(text => text.startsWith('{"'))
    assert.ok(candidate, 'the worker request must carry a logged JSON payload')
    const payload = payloadSchema.parse(JSON.parse(candidate))
    if (payload.proposal !== undefined) {
      yield* textResponse(JSON.stringify({ approved: true, reason: 'The project user supplied the scoped command.' }))
      return
    }
    const event = payload.events.find(event => event.kind === 'user' && event.text.includes(instruction))
    assert.ok(event, 'the extractor must receive original user evidence')
    yield* textResponse(JSON.stringify({
      updates: [{ title: memoryTitle, content: memoryContent, category: 'procedure', status: 'supported', evidence: [{ sessionId: event.sessionId, seq: event.seq, quote: instruction }] }],
      retire: [],
    }))
  }
}

/** Only executor selection is under test; no model code may execute in this fixture. */
class NoExecutionPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test-no-execution'
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 1000 }
  }
  run(): Promise<PtcRunResult> {
    return Promise.reject(new Error('Dreaming fixtures must never execute generated code.'))
  }
}

async function fixture(overrides: ConfigInput = {}, mode: 'native' | 'ptc' = 'native') {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-dreaming-runtime-'))
  const root = await realpath(temporary)
  const projectRoot = join(root, 'project')
  const unrelatedRoot = join(root, 'unrelated')
  await mkdir(projectRoot)
  await mkdir(unrelatedRoot)
  const ctx = new Context()
  const adapter = new ScriptedAdapter()
  try {
    if (mode === 'ptc') await ctx.plugin(NoExecutionPtcRuntime)
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true, tools: { mode } })
    await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(SqliteSessionQuery, { path: join(root, 'search.sqlite'), openAt: 'never' })
    ctx.llm.registerAdapter(['test'], adapter)
    const harness = await mountAgentLoopTestHarness(ctx)
    const plugin = await ctx.plugin(Dreaming, {
      projectRoots: [projectRoot],
      storageDirectory: join(root, 'memory'),
      provider: 'test',
      model: 'test',
      autoRunIntervalMinutes: 0,
      autoRunAfterTurn: false,
      ...overrides,
    })
    return {
      ctx, adapter, harness, plugin, projectRoot, unrelatedRoot,
      async close() {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  assert.ok(end, 'a completed durable turn must exist')
}

test('real DSH sessions produce persistent memories and later logged recall without recursive workers', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const source = await f.harness.create(SessionId('source-conversation'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(source, instruction)
    await f.ctx.sessionPersistence.flush()

    const result = await f.ctx.dreaming.run(f.projectRoot)
    assert.equal(result.created, 1)
    assert.equal(result.updated, 0)
    assert.equal(result.revision, 1)
    const requestsAfterFirstRun = f.adapter.requests.length
    const again = await f.ctx.dreaming.run(f.projectRoot)
    assert.equal(again.unchanged, true)
    assert.equal(f.adapter.requests.length, requestsAfterFirstRun, 'processed history and workers must not cause more inference')

    const sessions = await f.ctx.sessionQuery.listSessions()
    const workers = sessions.filter(record => record.header.id.startsWith('dreaming-worker-'))
    assert.equal(workers.length, 2, 'extraction and semantic review each have an auditable session')
    for (const record of workers) {
      assert.equal(record.persisted, true)
      assert.equal(record.live, false)
      const replay = await f.ctx.sessionQuery.readSession(record.header.id)
      assert.ok(replay.events.some(event => event.type === 'user/message'))
      assert.ok(replay.events.some(event => event.type === 'assistant/message'))
      assert.ok(replay.events.some(event => event.type === 'turn/end'))
    }

    const next = await f.harness.create(SessionId('next-conversation'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(next, 'What should I remember before working on this project?')
    const nextRequest = f.adapter.requests.find(request => request.sessionId === next.id)
    assert.ok(nextRequest)
    assert.ok(requestText(nextRequest).includes(memoryTitle), 'later model requests receive the bounded memory index')
    const log = next.session.snapshotEvents()
    assert.ok(log.some(event => JSON.stringify(event).includes(memoryTitle)), 'injected memory must survive transcript replay')

    const outside = await f.harness.create(SessionId('unrelated-conversation'), { provider: 'test', model: 'test' }, { cwd: f.unrelatedRoot })
    await send(outside, 'What should I remember?')
    const outsideRequest = f.adapter.requests.find(request => request.sessionId === outside.id)
    assert.ok(outsideRequest)
    assert.equal(requestText(outsideRequest).includes(memoryTitle), false, 'unconfigured projects must not receive memory')
    await assert.rejects(f.ctx.dreaming.run(f.unrelatedRoot))
  } finally {
    await f.close()
  }
})

test('unloading the Cordis plugin removes its registered tools and future context contributions', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const source = await f.harness.create(SessionId('unload-source'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(source, instruction)
    await f.ctx.dreaming.run(f.projectRoot)
    const before = (await f.ctx.systemPrompt.assemble()).tools.map(tool => tool.name)
    assert.ok(pluginTools.every(name => before.includes(name)))
    await f.plugin.dispose()
    const after = (await f.ctx.systemPrompt.assemble()).tools.map(tool => tool.name)
    assert.equal(after.some(name => pluginTools.includes(name)), false)
    const fresh = await f.harness.create(SessionId('after-unload'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(fresh, 'Start another task.')
    const request = f.adapter.requests.find(request => request.sessionId === fresh.id)
    assert.ok(request)
    assert.equal(requestText(request).includes(memoryTitle), false)
  } finally {
    await f.close()
  }
})

test('cancelling a live worker leaves memory unpublished and permits a clean retry', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const source = await f.harness.create(SessionId('cancel-source'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(source, instruction)
    let markStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { markStarted = resolve })
    let observedAbort = false
    f.adapter.responder = request => new Promise<string>((_resolve, reject) => {
      assert.ok(request.signal)
      const abort = () => { observedAbort = true; reject(request.signal?.reason ?? new Error('aborted')) }
      request.signal.addEventListener('abort', abort, { once: true })
      if (request.signal.aborted) abort()
      markStarted?.()
    })
    const cancellation = new AbortController()
    const run = f.ctx.dreaming.run(f.projectRoot, cancellation.signal)
    const rejected = assert.rejects(run)
    await Promise.race([started, run.then(() => { throw new Error('The worker did not start before consolidation completed.') })])
    cancellation.abort(new Error('The user cancelled the memory pass.'))
    await rejected
    assert.equal(observedAbort, true, 'cancellation must reach the actual provider request')
    f.adapter.responder = undefined
    const retry = await f.ctx.dreaming.run(f.projectRoot)
    assert.equal(retry.revision, 1)
    assert.equal(retry.created, 1)
  } finally {
    await f.close()
  }
})

test('plugin disposal cancels an active model worker and waits for its cleanup', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const source = await f.harness.create(SessionId('dispose-source'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(source, instruction)
    let markStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { markStarted = resolve })
    let observedAbort = false
    f.adapter.responder = request => new Promise<string>((_resolve, reject) => {
      assert.ok(request.signal)
      const abort = () => { observedAbort = true; reject(request.signal?.reason ?? new Error('aborted')) }
      request.signal.addEventListener('abort', abort, { once: true })
      if (request.signal.aborted) abort()
      markStarted?.()
    })
    const run = f.ctx.dreaming.run(f.projectRoot)
    const rejected = assert.rejects(run)
    await Promise.race([started, run.then(() => { throw new Error('The worker did not start before consolidation completed.') })])
    await f.plugin.dispose()
    await rejected
    assert.equal(observedAbort, true)
    assert.equal(f.ctx.agents.list().some(agent => agent.id.startsWith('dreaming-worker-')), false)
  } finally {
    await f.close()
  }
})

test('registered DSH tools validate arguments and expose search, read, forget and rollback as canonical values', { timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const agent = await f.harness.create(SessionId('tool-consumer'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(agent, instruction)
    let callNumber = 0
    async function invoke(name: string, args: object) {
      const batch = await f.ctx.tools.execute({
        agent,
        calls: [{ type: 'tool-call', id: ToolCallId(`fixture-call-${++callNumber}`), name, arguments: JSON.stringify(args) }],
        signal: new AbortController().signal,
      })
      assert.equal(batch.results.length, 1)
      return batch.results[0].result
    }

    const run = await invoke('dream_run', {})
    assert.equal(run.isError, false)
    assert.equal(z.object({ revision: z.number() }).parse(run.value).revision, 1)
    const status = await invoke('dream_status', {})
    assert.equal(status.isError, false)
    assert.equal(z.object({ facts: z.number() }).parse(status.value).facts, 1)

    const search = await invoke('memory_search', { query: 'unit test' })
    assert.equal(search.isError, false)
    const matches = z.array(z.object({ id: z.string(), title: z.string() })).parse(search.value)
    assert.equal(matches.length, 1)
    assert.equal(matches[0].title, memoryTitle)
    const read = await invoke('memory_read', { id: matches[0].id })
    assert.equal(read.isError, false)
    const fact = z.object({ content: z.string(), sources: z.array(z.object({ sessionId: z.string(), seq: z.number(), quote: z.string() })) }).parse(read.value)
    assert.equal(fact.content, memoryContent)
    assert.equal(fact.sources[0].sessionId, agent.id)
    assert.equal(fact.sources[0].quote, instruction)

    const malformed = await invoke('memory_read', { id: 42 })
    assert.equal(malformed.isError, true, 'the production tool registry must reject a non-string memory id')
    const forgotten = await invoke('memory_forget', { id: matches[0].id })
    assert.equal(forgotten.isError, false)
    assert.equal((await f.ctx.dreaming.status(f.projectRoot)).facts, 0)
    const restored = await invoke('dream_rollback', { revision: 1 })
    assert.equal(restored.isError, false)
    assert.equal((await f.ctx.dreaming.status(f.projectRoot)).facts, 1)
    assert.equal((await f.ctx.dreaming.status(f.projectRoot)).revision, 3)
  } finally {
    await f.close()
  }
})

test('unloading before the after-turn delay cancels queued automatic consolidation', { timeout: 10000 }, async () => {
  const f = await fixture({ autoRunAfterTurn: true, afterTurnDelaySeconds: 1 })
  try {
    const agent = await f.harness.create(SessionId('queued-auto-run'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(agent, instruction)
    await f.plugin.dispose()
    await delay(1200)
    assert.equal(f.adapter.requests.length, 1, 'the queued timer must not create a worker after plugin disposal')
    assert.equal(f.ctx.agents.list().some(agent => agent.id.startsWith('dreaming-worker-')), false)
  } finally {
    await f.close()
  }
})

test('a completed turn triggers automatic consolidation and records its successful outcome', { timeout: 10000 }, async () => {
  const f = await fixture({ autoRunAfterTurn: true, afterTurnDelaySeconds: 1 })
  try {
    const agent = await f.harness.create(SessionId('successful-auto-run'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(agent, instruction)
    const deadline = Date.now() + 5000
    let status = await f.ctx.dreaming.status(f.projectRoot)
    while ((status.revision !== 1 || status.running || status.lastRun === null) && Date.now() < deadline) {
      await delay(10)
      status = await f.ctx.dreaming.status(f.projectRoot)
    }
    assert.equal(status.revision, 1, 'automatic consolidation must publish memory without a manual run')
    assert.equal(status.facts, 1)
    assert.equal(status.lastRun?.error, null)
    assert.equal(f.adapter.requests.filter(request => String(request.sessionId).startsWith('dreaming-worker-')).length, 2)
  } finally {
    await f.close()
  }
})

test('PTC callers keep their executor while memory workers expose neither tools nor code execution', { timeout: 30000 }, async () => {
  const f = await fixture({}, 'ptc')
  try {
    const source = await f.harness.create(SessionId('ptc-source'), { provider: 'test', model: 'test' }, { cwd: f.projectRoot })
    await send(source, instruction)
    const before = f.adapter.requests.find(request => request.sessionId === source.id)
    assert.deepEqual(before?.tools?.map(tool => tool.name), ['run_code'])
    const result = await f.ctx.dreaming.run(f.projectRoot)
    assert.equal(result.created, 1)
    const workers = f.adapter.requests.filter(request => String(request.sessionId).startsWith('dreaming-worker-'))
    assert.equal(workers.length, 2)
    for (const worker of workers) assert.equal(worker.tools?.length ?? 0, 0)
    await send(source, 'Continue the original conversation.')
    const after = f.adapter.requests.findLast(request => request.sessionId === source.id)
    assert.deepEqual(after?.tools?.map(tool => tool.name), ['run_code'], 'the worker must not change the parent executor')
  } finally {
    await f.close()
  }
})
