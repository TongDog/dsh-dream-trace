import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { Session, SessionId, SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionLogSnapshot, SessionRecord } from '@deepseek-ai/dsh-session-query'
import { collectTranscripts, TranscriptError } from '../src/transcripts.ts'
import type { TranscriptOptions, TranscriptQuery } from '../src/transcripts.ts'

class Fixture {
  readonly session: Session
  readonly events: SessionEvent[]
  readonly header: SessionHeader
  constructor(cwd: string, id = 'test-session', extra: Partial<SessionHeader> = {}, seed: SessionEvent[] = [], inherited = 0) {
    this.header = { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd, isSeeded: inherited > 0, ...extra }
    this.session = Session.create(this.header.id, seed.length > 0 ? seed : undefined, this.header, SessionLogOffset(inherited))
    this.events = [...seed]
  }
  start(turn = 1) { this.events.push(this.session.append('turn/start', { turn })) }
  end(turn = 1, kind: 'completed' | 'interrupted' | 'aborted' = 'completed') {
    this.events.push(this.session.append('turn/end', { turn, reason: kind === 'aborted' ? { kind, reason: { kind: 'user' } } : { kind } }))
  }
  user(text: string, source: MessageSource = { kind: 'user' }) {
    this.events.push(this.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source }), { surfaceOp: 'append' }))
  }
  assistant(content: ContentBlock[]) {
    this.events.push(this.session.append('assistant/message', {
      turn: 1, step: 1, message: createAssistantMessage({ content, source: { provider: 'fixture', model: 'fixture' } }), stream: [],
    }, { surfaceOp: 'append' }))
  }
  tool(name: string, args: string, text: string, error = false) {
    const callId = ToolCallId(`${name}-${this.events.length}`)
    this.events.push(this.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: args }))
    this.events.push(this.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: error }),
    }, { surfaceOp: 'append' }))
  }
  cwd(path: string) { this.events.push(this.session.append('working-directory/change', { cwd: path })) }
  snapshot(): SessionLogSnapshot {
    // Each fixture is admitted by dsh itself before the query adapter returns it.
    Session.create(this.header.id, this.events, this.header, this.session.inheritedEventCount)
    return { session: this.header, inheritedEventCount: this.session.inheritedEventCount, events: [...this.events] }
  }
}

function queryOf(fixtures: Fixture[]): TranscriptQuery & { reads: string[] } {
  const snapshots = fixtures.map(f => f.snapshot())
  const reads: string[] = []
  return {
    reads,
    async listSessions(): Promise<SessionRecord[]> { return snapshots.map(s => ({ header: s.session, live: true, persisted: true })) },
    async readSession(id) {
      reads.push(id)
      const found = snapshots.find(s => s.session.id === id)
      assert.ok(found)
      return found
    },
  }
}

async function workspace(t: TestContext): Promise<{ root: string; other: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'dream-transcripts-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'project')
  const other = join(parent, 'project-other')
  await mkdir(root)
  await mkdir(other)
  return { root, other }
}

function options(projectRoot: string, overrides: Partial<TranscriptOptions> = {}): TranscriptOptions {
  return { projectRoot, cursors: {}, maxSessions: 10, maxChars: 60000, maxEvents: 100, ...overrides }
}

test('collects visible completed evidence and removes secrets, reasoning, and injected memory', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start()
  f.user('Use pnpm test for unit tests')
  f.user('Old memory said npm test', { kind: 'system-prompt' })
  f.assistant([{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'I will run the tests' }])
  f.tool('bash', '{"command":"pnpm test"}', 'password=supersecret test suite failed', true)
  f.tool('memory_read', '{}', 'This memory must not reinforce itself')
  f.end()
  const collected = await collectTranscripts(queryOf([f]), options(root))
  assert.equal(collected.batches.length, 1)
  assert.equal(collected.eventsSelected, 4)
  const text = JSON.stringify(collected.batches)
  assert.match(text, /pnpm test/)
  assert.match(text, /isError=true/)
  assert.match(text, /REDACTED/)
  assert.doesNotMatch(text, /supersecret|private reasoning|Old memory|reinforce itself/)
  assert.equal(collected.batches[0].throughSeq, f.events.at(-1)?.seq)
})

test('does not advance across the currently open turn', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start()
  f.user('First completed request')
  f.end()
  const closed = f.events.at(-1)!.seq
  f.start(2)
  f.user('The current turn is incomplete')
  const collected = await collectTranscripts(queryOf([f]), options(root))
  assert.equal(collected.batches[0].throughSeq, closed)
  assert.doesNotMatch(JSON.stringify(collected.batches), /incomplete/)
})

test('defers whole turns at the budget and resumes without dropping evidence', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start()
  f.user('First fact')
  f.end()
  const firstEnd = f.events.at(-1)!.seq
  f.start(2)
  f.user('Second fact')
  f.end(2)
  const first = await collectTranscripts(queryOf([f]), options(root, { maxEvents: 1 }))
  assert.equal(first.deferred, true)
  assert.equal(first.batches[0].throughSeq, firstEnd)
  assert.equal(first.eventsSelected, 1)
  const second = await collectTranscripts(queryOf([f]), options(root, { maxEvents: 1, cursors: { [f.header.id]: firstEnd } }))
  assert.equal(second.batches[0].events[0].text, 'Second fact')
  assert.equal(second.deferred, false)
})

test('a single oversized turn fails instead of truncating or advancing it', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start()
  f.user('x'.repeat(2000))
  f.end()
  const cursors = {}
  await assert.rejects(collectTranscripts(queryOf([f]), options(root, { maxChars: 100, cursors })), (error: Error) => error instanceof TranscriptError && error.code === 'BUDGET_EXCEEDED')
  assert.deepEqual(cursors, {})
})

test('never opens another project or workers and drops turns that cross project scope', async t => {
  const { root, other } = await workspace(t)
  const foreign = new Fixture(other, 'foreign')
  foreign.start(); foreign.user('Unrelated confidential project'); foreign.end()
  const worker = new Fixture(root, 'worker', { agentPreset: 'dreaming-worker' })
  worker.start(); worker.user('Generated memory'); worker.end()
  const child = new Fixture(root, 'child', { origin: 'subagent' })
  child.start(); child.user('Child task'); child.end()
  const mixed = new Fixture(root, 'mixed')
  mixed.start(); mixed.user('This entire mixed turn is excluded'); mixed.cwd(other)
  mixed.tool('read', '{}', 'Foreign project source'); mixed.cwd(root); mixed.end()
  mixed.start(2); mixed.user('Local project fact'); mixed.end(2)
  const query = queryOf([foreign, worker, child, mixed])
  const collected = await collectTranscripts(query, options(root))
  assert.deepEqual(query.reads, ['mixed'])
  assert.equal(collected.skippedCrossProjectTurns, 1)
  assert.deepEqual(collected.batches[0].events.map(e => e.text), ['Local project fact'])
})

test('a symlink inside the project does not admit sessions belonging outside it', async t => {
  const { root, other } = await workspace(t)
  const escaped = join(root, 'linked')
  await symlink(other, escaped, 'dir')
  const f = new Fixture(escaped)
  f.start(); f.user('Outside'); f.end()
  const query = queryOf([f])
  const result = await collectTranscripts(query, options(root))
  assert.equal(result.batches.length, 0)
  assert.deepEqual(query.reads, [])
})

test('forks contribute only their owned completed turns', async t => {
  const { root } = await workspace(t)
  const parent = new Fixture(root, 'parent')
  parent.start(); parent.user('Inherited fact'); parent.end()
  const seed = buildForkSeed(parent.events, parent.events.at(-1)!.seq)
  const child = new Fixture(root, 'fork', {}, seed, parent.events.length)
  child.start(2); child.user('New child fact'); child.end(2)
  const result = await collectTranscripts(queryOf([child]), options(root))
  assert.deepEqual(result.batches[0].events.map(e => e.text), ['New child fact'])
})

test('synthetic interrupted turn closers never become processed cursors', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start(); f.user('Orphaned request'); f.end(1, 'interrupted')
  const result = await collectTranscripts(queryOf([f]), options(root))
  assert.deepEqual(result.batches, [])
  assert.equal(result.skippedSyntheticTurns, 1)
})

test('empty evidence still advances the intentionally excluded completed prefix', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start(); f.user('Injected context', { kind: 'system-prompt' }); f.end()
  const result = await collectTranscripts(queryOf([f]), options(root))
  assert.deepEqual(result.batches, [{ sessionId: f.header.id, throughSeq: f.events.at(-1)!.seq, events: [] }])
})

test('session limit allows already processed sessions to be passed on subsequent runs', async t => {
  const { root } = await workspace(t)
  const first = new Fixture(root, 'old', { createdAt: 1 })
  first.start(); first.user('Old fact'); first.end()
  const second = new Fixture(root, 'new', { createdAt: 2 })
  second.start(); second.user('New fact'); second.end()
  const query = queryOf([second, first])
  const initial = await collectTranscripts(query, options(root, { maxSessions: 1 }))
  assert.equal(initial.batches[0].sessionId, 'old')
  assert.equal(initial.deferred, true)
  const continued = await collectTranscripts(query, options(root, { maxSessions: 1, cursors: { old: initial.batches[0].throughSeq } }))
  assert.equal(continued.batches[0].sessionId, 'new')
})

test('rejects invalid mid-turn and beyond-log cursors', async t => {
  const { root } = await workspace(t)
  const f = new Fixture(root)
  f.start(); f.user('Fact'); f.end()
  for (const cursor of [1, 999]) {
    await assert.rejects(collectTranscripts(queryOf([f]), options(root, { cursors: { [f.header.id]: cursor } })), (error: Error) => error instanceof TranscriptError && error.code === 'INVALID_CURSOR')
  }
})

test('cancellation stops before reading any session', async t => {
  const { root } = await workspace(t)
  const query = queryOf([])
  const controller = new AbortController()
  controller.abort(new Error('Cancelled'))
  await assert.rejects(collectTranscripts(query, options(root), controller.signal), /Cancelled/)
  assert.deepEqual(query.reads, [])
})

test('dsh restore rejects invalid event timestamps before evidence extraction', () => {
  const event: SessionEvent<'turn/start'> = { seq: SessionSeq(0), time: Number.NaN, type: 'turn/start', data: { turn: 1 } }
  assert.throws(() => Session.create(SessionId('invalid-time'), [event]))
})

test('valid session ids that match prototype names retain their evidence and cursors', async t => {
  const { root } = await workspace(t)
  for (const id of ['toString', '__proto__', 'constructor']) {
    const f = new Fixture(root, id)
    f.start(); f.user(`Evidence for ${id}`); f.end()
    const result = await collectTranscripts(queryOf([f]), options(root))
    assert.deepEqual(result.batches[0].events.map(e => e.text), [`Evidence for ${id}`])
    const cursors: Record<string, number> = Object.fromEntries([[id, result.batches[0].throughSeq]])
    const repeated = await collectTranscripts(queryOf([f]), options(root, { cursors }))
    assert.deepEqual(repeated.batches, [])
  }
})
