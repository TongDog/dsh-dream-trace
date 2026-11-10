import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { resolveConfig } from '../src/codex/config.ts'
import { handleHook } from '../src/codex/hooks.ts'
import { createGenerator } from '../src/codex/model.ts'
import { createServer } from '../src/codex/server.ts'
import { CodexDreamService } from '../src/codex/service.ts'
import { TraceStore, traceId } from '../src/codex/traces.ts'
import type { Generate } from '../src/core/types.ts'

async function fixture(t: TestContext, overrides: object = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dream-codex-test-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = join(dir, 'project'), other = join(dir, 'other')
  await mkdir(root); await mkdir(other)
  const config = await resolveConfig({ projectRoots: [root], storageDirectory: join(dir, 'data'), ...overrides })
  const traces = new TraceStore(config)
  const capture = (hook_event_name: string, extra: object = {}) => traces.capture({ hook_event_name, cwd: root, session_id: 'session-1', turn_id: 'turn-1', ...extra })
  return { root, other, dir, config, traces, capture }
}

async function completed(f: Awaited<ReturnType<typeof fixture>>, extra: object = {}) {
  await f.capture('UserPromptSubmit', { prompt: 'Run npm test before publishing.', ...extra })
  await f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: 'call-1', tool_input: { command: 'npm test' }, tool_response: 'Tests passed', ...extra })
  await f.capture('Stop', { last_assistant_message: 'The tests passed.', ...extra })
}

function scriptedModel(calls: string[] = []): Generate {
  return async (system, payload) => {
    calls.push(payload)
    if (system.startsWith('Review')) return JSON.stringify({ approved: true, reason: 'The user explicitly stated this preference.' })
    const { events } = JSON.parse(payload)
    const event = events.find((e: { kind: string }) => e.kind === 'user')
    return JSON.stringify({ updates: event ? [{ title: 'Test before publishing', content: event.text, category: 'procedure', status: 'supported',
      evidence: [{ sessionId: event.sessionId, seq: event.seq, quote: event.text }] }] : [], retire: [] })
  }
}

test('Codex configuration is inert by default and rejects overlapping or unsafe routes', async t => {
  assert.deepEqual((await resolveConfig({})).projectRoots, [])
  const f = await fixture(t)
  await assert.rejects(resolveConfig({ projectRoots: [f.root, f.root] }), /overlap/)
  await assert.rejects(resolveConfig({ projectRoots: ['relative'] }))
  await assert.rejects(resolveConfig({ model: { baseUrl: 'http://example.com', name: 'model' } }))
  await assert.rejects(resolveConfig({ model: { baseUrl: 'https://user:secret@example.com', name: 'model' } }))
  await assert.rejects(resolveConfig({ apiKey: 'not-allowed' }))
  const inert = new TraceStore(await resolveConfig({ storageDirectory: join(f.dir, 'inert') }))
  assert.equal((await inert.capture({ hook_event_name: 'SessionStart', session_id: 'session', cwd: f.root })).captured, false)
  await assert.rejects(readdir(join(f.dir, 'inert')), { code: 'ENOENT' })
})

test('hooks capture evidence only through a stopped segment and namespace source IDs', async t => {
  const f = await fixture(t)
  await f.capture('UserPromptSubmit', { prompt: 'Use npm test.' })
  assert.equal((await f.traces.collect(f.root, {}, 60000)).batches.length, 0)
  await f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: 'call-1', tool_input: { command: 'npm test' }, tool_response: 'pass' })
  await f.capture('Stop', { last_assistant_message: 'Done' })
  const selected = await f.traces.collect(f.root, {}, 60000)
  assert.equal(selected.batches.length, 1)
  assert.equal(selected.batches[0].sessionId, 'codex:session-1')
  assert.deepEqual(selected.batches[0].events.map(e => e.kind), ['user', 'assistant', 'tool', 'assistant'])
  const cursor = { [selected.batches[0].sessionId]: selected.batches[0].throughSeq }
  assert.equal((await f.traces.collect(f.root, cursor, 60000)).batches.length, 0)
})

test('capture redacts secrets and filters memory tools, hidden reasoning and media', async t => {
  const f = await fixture(t)
  await f.capture('UserPromptSubmit', { prompt: 'Use token sk-abcdefghijklmnopqrstuvwxyz0123456789 in the fixture.' })
  await f.capture('PostToolUse', { tool_name: 'mcp__dream_trace__memory_read', tool_use_id: 'memory', tool_response: 'OLD_MEMORY' })
  await f.capture('PostToolUse', { tool_name: 'mcp__docs__read', tool_use_id: 'docs', tool_input: {}, tool_response: { content: [
    { type: 'text', text: 'VISIBLE' }, { type: 'image', data: 'PRIVATE_IMAGE' }, { type: 'reasoning', text: 'PRIVATE_REASONING' },
  ], reasoning_content: 'PRIVATE_THOUGHTS' } })
  await f.capture('Stop', { last_assistant_message: 'Done' })
  const serialized = JSON.stringify(await f.traces.collect(f.root, {}, 60000))
  assert.match(serialized, /VISIBLE/)
  assert.match(serialized, /REDACTED/)
  assert.doesNotMatch(serialized, /OLD_MEMORY|PRIVATE_|sk-abcdefghijklmnopqrstuvwxyz/)
  const raw = await readFile(join(f.traces.directory, (await readdir(f.traces.directory)).find(n => n.endsWith('.json'))!), 'utf8')
  assert.doesNotMatch(raw, /PRIVATE_|sk-abcdefghijklmnopqrstuvwxyz/)
})

test('interrupt and cross-project cwd exclude the entire pending segment', async t => {
  const f = await fixture(t)
  await f.capture('UserPromptSubmit', { prompt: 'Must be excluded' })
  await f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: 'outside', tool_input: { workdir: f.other }, tool_response: 'Foreign content' })
  await f.capture('Stop', { last_assistant_message: 'Untrusted success' })
  let selected = await f.traces.collect(f.root, {}, 60000)
  assert.equal(selected.eventsSelected, 0)
  await f.capture('UserPromptSubmit', { turn_id: 'turn-2', prompt: 'Interrupted prompt' })
  await f.capture('Interrupt', { turn_id: 'turn-2' })
  await f.capture('Stop', { turn_id: 'turn-2', last_assistant_message: 'Late stop' })
  selected = await f.traces.collect(f.root, {}, 60000)
  assert.equal(selected.eventsSelected, 0)
})

test('a session originating outside the allowlist never contributes after switching in', async t => {
  const f = await fixture(t)
  await f.capture('SessionStart', { cwd: f.other })
  await completed(f)
  assert.equal((await f.traces.collect(f.root, {}, 60000)).batches.length, 0)
})

test('symlink escapes, orphan stops and subagents do not enter project memory', async t => {
  const f = await fixture(t)
  await symlink(f.other, join(f.root, 'outside'))
  await f.capture('Stop', { last_assistant_message: 'No prompt captured' })
  await completed(f, { session_id: 'child', agent_id: 'subagent' })
  await f.capture('UserPromptSubmit', { prompt: 'Excluded after symlink escape' })
  await f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: 'link', tool_input: { cwd: join(f.root, 'outside') } })
  await f.capture('Stop', { last_assistant_message: 'Done' })
  assert.equal((await f.traces.collect(f.root, {}, 60000)).eventsSelected, 0)
})

test('forks record only their own hooks and repeated hook delivery is idempotent', async t => {
  const f = await fixture(t)
  await completed(f)
  const first = await f.traces.collect(f.root, {}, 60000)
  await completed(f)
  assert.deepEqual(await f.traces.collect(f.root, {}, 60000), first)
  await f.capture('SessionStart', { source: 'fork', session_id: 'fork' })
  await completed(f, { session_id: 'fork', turn_id: 'fork-turn' })
  const selected = await f.traces.collect(f.root, {}, 60000)
  assert.equal(selected.batches.length, 2)
  assert.equal(selected.batches.find(b => b.sessionId === 'codex:fork')!.events.length, 4)
})

test('continued prompts from an already-seen turn are not authoritative user evidence', async t => {
  const f = await fixture(t)
  await completed(f)
  await f.capture('UserPromptSubmit', { prompt: 'Synthetic Stop-hook continuation' })
  await f.capture('Stop', { last_assistant_message: 'Continued', stop_hook_active: true })
  const events = (await f.traces.collect(f.root, {}, 60000)).batches[0].events
  assert.equal(events.find(e => e.text === 'Synthetic Stop-hook continuation')!.kind, 'assistant')
})

test('a second prompt inside an active turn preserves the earlier observed input', async t => {
  const f = await fixture(t)
  await f.capture('UserPromptSubmit', { prompt: 'Original user request' })
  await f.capture('UserPromptSubmit', { prompt: 'Additional in-turn input' })
  await f.capture('UserPromptSubmit', { prompt: 'Additional in-turn input' })
  await f.capture('Stop', { last_assistant_message: 'Done' })
  const events = (await f.traces.collect(f.root, {}, 60000)).batches[0].events
  assert.equal(events.length, 3)
  assert.equal(events[0].text, 'Original user request')
  assert.equal(events[0].kind, 'user')
  assert.equal(events[1].text, 'Additional in-turn input')
})

test('parallel tool captures preserve unique contiguous evidence and do not lose writes', async t => {
  const f = await fixture(t)
  await f.capture('UserPromptSubmit', { prompt: 'Run checks' })
  await Promise.all(Array.from({ length: 5 }, (_, i) => f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: `call-${i}`, tool_input: {}, tool_response: `result-${i}` })))
  await f.capture('Stop', { last_assistant_message: 'Done' })
  const events = (await f.traces.collect(f.root, {}, 60000)).batches[0].events
  assert.equal(events.filter(e => e.kind === 'tool').length, 5)
  assert.equal(new Set(events.map(e => e.seq)).size, events.length)
})

test('oversized tool capture excludes its segment and reports a durable warning', async t => {
  const f = await fixture(t, { maxCaptureChars: 1000 })
  await f.capture('UserPromptSubmit', { prompt: 'Must not be partially remembered' })
  const result = await f.capture('PostToolUse', { tool_name: 'Bash', tool_use_id: 'large', tool_response: 'x '.repeat(600) })
  assert.ok(result.warning)
  await f.capture('Stop', { last_assistant_message: 'Partial' })
  const selected = await f.traces.collect(f.root, {}, 60000)
  assert.equal(selected.eventsSelected, 0)
  assert.equal(selected.warnings.length, 1)
})

test('collection defers whole segments at budget and rejects split or missing cursors', async t => {
  const f = await fixture(t, { maxEventsPerRun: 4 })
  await completed(f)
  await completed(f, { turn_id: 'turn-2', tool_use_id: 'call-2' })
  const first = await f.traces.collect(f.root, {}, 60000)
  assert.equal(first.deferred, true)
  assert.equal(first.eventsSelected, 4)
  const second = await f.traces.collect(f.root, { [first.batches[0].sessionId]: first.batches[0].throughSeq }, 60000)
  assert.equal(second.eventsSelected, 4)
  assert.equal(second.deferred, false)
  await assert.rejects(f.traces.collect(f.root, {}, 10), /budget/)
  await assert.rejects(f.traces.collect(f.root, { [traceId('session-1')]: 1 }, 60000), /cursor/)
  await assert.rejects(f.traces.collect(f.root, { 'codex:missing': 5 }, 60000), /missing/)
})

test('service consolidates with review, recalls evidence, loads later hook context and rolls back', async t => {
  const f = await fixture(t)
  await completed(f)
  const calls: string[] = []
  const service = new CodexDreamService(f.config, scriptedModel(calls))
  t.after(() => service.close())
  const result = await service.run()
  assert.equal(result.created, 1)
  assert.equal(calls.length, 2)
  assert.equal((await service.run()).unchanged, true)
  assert.equal(calls.length, 2)
  const [fact] = await service.search(f.root, 'npm')
  assert.equal(fact.sources[0].sessionId, 'codex:session-1')
  assert.equal((await service.read(f.root, fact.id)).content, 'Run npm test before publishing.')
  const context = await handleHook(f.config, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'later', cwd: f.root })
  assert.match(JSON.stringify(context), /Test before publishing/)
  await service.forget(f.root, fact.id)
  assert.equal((await service.search(f.root, '')).length, 0)
  assert.equal((await service.rollback(f.root, 1)).revision, 3)
  assert.equal((await service.search(f.root, '')).length, 1)
  await assert.rejects(service.status(f.other), /allowlist/)
})

test('review rejection and cancellation preserve memory and processing cursors', async t => {
  const f = await fixture(t)
  await completed(f)
  const model = scriptedModel()
  const rejected = new CodexDreamService(f.config, (system, payload, signal) => system.startsWith('Review') ? Promise.resolve('{"approved":false,"reason":"unsupported"}') : model(system, payload, signal))
  t.after(() => rejected.close())
  await assert.rejects(rejected.run(), /rejected/)
  assert.equal((await rejected.status()).revision, 0)
  assert.deepEqual((await rejected.status()).cursors, {})
  const cancellation = new AbortController()
  const cancelled = new CodexDreamService(f.config, async (_system, _payload, signal) => {
    cancellation.abort()
    signal!.throwIfAborted()
    return ''
  })
  t.after(() => cancelled.close())
  await assert.rejects(cancelled.run(f.root, cancellation.signal), /abort/i)
  assert.equal((await cancelled.status()).revision, 0)
})

test('automatic consolidation processes the durable backlog when the server starts', async t => {
  const f = await fixture(t, { autoRun: true })
  await completed(f)
  const calls: string[] = []
  const service = new CodexDreamService(f.config, scriptedModel(calls))
  t.after(() => service.close())
  service.start()
  for (let i = 0; i < 100 && (await service.status()).revision === 0; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await service.status()).revision, 1)
  assert.equal(calls.length, 2)
  await service.close()
  assert.equal((await service.status()).running, false)
})

test('MCP client discovers tools, calls them, enforces project scope and returns structured errors', async t => {
  const f = await fixture(t)
  await completed(f)
  const service = new CodexDreamService(f.config, scriptedModel())
  const server = createServer(service)
  const client = new Client({ name: 'test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => { await client.close(); await server.close(); await service.close() })
  await server.connect(serverTransport); await client.connect(clientTransport)
  assert.equal((await client.listTools()).tools.length, 8)
  const run = await client.callTool({ name: 'dream_run', arguments: { projectRoot: f.root } })
  assert.equal(run.isError, undefined)
  assert.match(JSON.stringify(run), /created.*1/)
  const search = await client.callTool({ name: 'memory_search', arguments: { query: 'npm', projectRoot: f.root } })
  assert.match(JSON.stringify(search), /Test before publishing/)
  const denied = await client.callTool({ name: 'memory_index', arguments: { projectRoot: f.other } })
  assert.equal(denied.isError, true)
  const invalid = await client.callTool({ name: 'dream_rollback', arguments: { revision: -1 } })
  assert.equal(invalid.isError, true)
})

test('model adapter sends bounded tool-free requests and rejects truncation, tools and provider errors', async t => {
  const f = await fixture(t, { model: { baseUrl: 'https://example.com/v1/', name: 'fixture-model', apiKeyEnv: 'DREAM_TRACE_TEST_KEY' } })
  const prior = process.env.DREAM_TRACE_TEST_KEY
  process.env.DREAM_TRACE_TEST_KEY = 'fake-fixture-key'
  t.after(() => { if (prior === undefined) delete process.env.DREAM_TRACE_TEST_KEY; else process.env.DREAM_TRACE_TEST_KEY = prior })
  let requestBody: { [key: string]: unknown } = {}
  const generate = createGenerator(f.config, async (url, init) => {
    assert.equal(url, 'https://example.com/v1/chat/completions')
    assert.equal(init?.redirect, 'error')
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"updates":[]}' } }] }))
  })
  assert.equal(await generate('system', 'payload'), '{"updates":[]}')
  assert.equal(requestBody.max_completion_tokens, 6000)
  assert.equal(requestBody.tools, undefined)
  for (const choice of [
    { finish_reason: 'length', message: { content: '{}' } },
    { finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } },
    { finish_reason: 'stop', message: { content: '{}', refusal: 'No' } },
  ]) await assert.rejects(createGenerator(f.config, async () => new Response(JSON.stringify({ choices: [choice] })))('a', 'b'), /complete/)
  await assert.rejects(createGenerator(f.config, async () => new Response('PRIVATE_PROVIDER_ERROR', { status: 401 }))('a', 'b'), error => {
    assert.match(String(error), /HTTP 401/); assert.doesNotMatch(String(error), /PRIVATE/); return true
  })
})

test('no model or credential is needed for empty runs and recall', async t => {
  const f = await fixture(t)
  const service = new CodexDreamService(f.config)
  t.after(() => service.close())
  assert.equal((await service.run()).unchanged, true)
  assert.equal(await service.index(), '')
  await completed(f)
  await assert.rejects(service.run(), /Configure model/)
  assert.equal((await service.status()).revision, 0)
})

test('fresh Codex hooks and MCP recall the explicitly shared conclusion without leaking source evidence', async t => {
  const f = await fixture(t)
  const config = await resolveConfig({ ...f.config, projectRoots: [f.root, f.other] })
  const service = new CodexDreamService(config, scriptedModel())
  const server = createServer(service)
  const client = new Client({ name: 'levels-test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  await client.connect(a)
  try {
    await completed(f)
    await service.run(f.root)
    const [fact] = await service.search(f.root, 'npm')
    assert.equal(fact.level, 4)
    assert.equal(await service.index(f.other), '')
    const shared = await client.callTool({ name: 'memory_set_level', arguments: { projectRoot: f.root, id: fact.id, level: 1, expectedRevision: 1 } })
    assert.notEqual(shared.isError, true)
    const start = { cwd: f.other, hook_event_name: 'SessionStart', session_id: 'inheriting', source: 'startup' }
    const context = JSON.stringify(await handleHook(config, start))
    assert.ok(context.includes(fact.content))
    assert.ok(!context.includes('codex:session-1'))
    const [inherited] = await service.search(f.other, 'npm')
    assert.deepEqual((await service.read(f.other, inherited.id)).sources, [])
    await service.setLevel(f.root, fact.id, 3)
    assert.deepEqual(await handleHook(config, start), {})
    assert.ok((await service.index(f.root)).includes(fact.content))
  } finally { await client.close(); await server.close(); await service.close() }
})
