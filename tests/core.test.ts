import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreError, DreamEngine, MemoryStore, containsSecret, evidenceBudget, readMemory, redactSecrets, renderIndex, searchMemory, type EngineConfig, type Generate, type Proposal, type TranscriptBatch } from '../src/core/index.ts'

const config: EngineConfig = { maxInputChars: 50000, maxProposalChars: 12000, maxFacts: 20, maxFactChars: 2000, maxFactsPerRun: 10, verify: true }
const batch: TranscriptBatch = { sessionId: 'session-a', throughSeq: 10, events: [{ sessionId: 'session-a', seq: 4, time: '2026-11-08T00:00:00Z', kind: 'tool', text: 'npm test completed: 8 tests passed.' }] }
const citation = { sessionId: 'session-a', seq: 4, quote: 'npm test completed: 8 tests passed.' }
const proposal: Proposal = { updates: [{ title: 'Test command', content: 'npm test passed all 8 tests in this session.', category: 'procedure', status: 'supported', evidence: [citation] }], retire: [] }
const code = (expected: CoreError['code']) => (error: unknown) => error instanceof CoreError && error.code === expected

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-dreaming-core-'))
  return { directory, store: new MemoryStore(directory, 'project-a'), cleanup: () => rm(directory, { recursive: true, force: true }) }
}
function responses(...values: unknown[]): Generate {
  return async () => { assert.ok(values.length > 0, 'unexpected extra model call'); return JSON.stringify(values.shift()) }
}

test('extracts cited memories, reviews them, persists restart-readable state, and skips processed prefixes', async () => {
  const f = await fixture()
  try {
    const engine = new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: 'Bounded observed result.' }))
    const run = await engine.run([batch])
    assert.deepEqual(run, { revision: 1, processedSessions: 1, created: 1, updated: 0, retired: 0, unchanged: false })
    const state = await new MemoryStore(f.directory, 'project-a').read()
    assert.equal(state.cursors['session-a'], 10)
    assert.deepEqual(state.facts[0].sources, [{ ...citation, observedAt: batch.events[0].time, kind: 'tool' }])
    assert.equal((await engine.run([batch])).unchanged, true)
    assert.equal((await f.store.revisions()).length, 1)
  } finally { await f.cleanup() }
})

test('corrections retain identity and rollback restores both facts and processing cursors', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    const original = await f.store.read()
    const nextBatch: TranscriptBatch = { sessionId: 'session-a', throughSeq: 20, events: [{ sessionId: 'session-a', seq: 14, time: '2026-11-08T01:00:00Z', kind: 'tool', text: 'pnpm test completed: 9 tests passed.' }] }
    const correction: Proposal = { updates: [{ ...proposal.updates[0], id: original.facts[0].id, content: 'pnpm test passed 9 tests in the latest session.', evidence: [{ sessionId: 'session-a', seq: 14, quote: 'pnpm test completed: 9 tests passed.' }] }], retire: [] }
    const result = await new DreamEngine(f.store, config, responses(correction, { approved: true, reason: '' })).run([nextBatch])
    assert.equal(result.updated, 1)
    assert.equal((await f.store.read()).facts[0].id, original.facts[0].id)
    assert.equal((await f.store.read()).cursors['session-a'], 20)
    const restored = await f.store.rollback(1)
    assert.equal(restored.revision, 3)
    assert.equal(restored.parentRevision, 2)
    assert.deepEqual(restored.facts, original.facts)
    assert.equal(restored.cursors['session-a'], 10)
    assert.deepEqual((await f.store.revisions()).map(r => r.revision), [3, 2, 1])
  } finally { await f.cleanup() }
})

test('an omitted no-op retirement list still requires verified updates and independent review', async () => {
  const f = await fixture()
  try {
    for (const invalid of [{}, { updates: proposal.updates, retire: null }]) {
      await assert.rejects(new DreamEngine(f.store, config, responses(invalid)).run([batch]), code('INVALID_PROPOSAL'))
    }
    const compact = { updates: proposal.updates }
    await assert.rejects(new DreamEngine(f.store, config, responses(compact, { approved: false, reason: 'Rejected.' })).run([batch]), code('REVIEW_REJECTED'))
    assert.equal((await f.store.read()).revision, 0)
    const result = await new DreamEngine(f.store, config, responses(compact, { approved: true, reason: 'Supported.' })).run([batch])
    assert.equal(result.created, 1)
    assert.equal(result.retired, 0)
    assert.equal((await f.store.read()).facts[0].status, 'supported')
  } finally { await f.cleanup() }
})

test('retirement excludes obsolete memory from search and the context index', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    const id = (await f.store.read()).facts[0].id
    const event = { sessionId: 'session-b', seq: 2, time: '2026-11-08T00:00:00Z', kind: 'user' as const, text: 'This repository no longer uses npm test.' }
    const retire: Proposal = { updates: [], retire: [{ id, reason: 'Project test command changed.', evidence: [{ sessionId: event.sessionId, seq: event.seq, quote: event.text }] }] }
    await new DreamEngine(f.store, config, responses(retire, { approved: true, reason: '' })).run([{ sessionId: event.sessionId, throughSeq: 3, events: [event] }])
    const state = await f.store.read()
    assert.equal(readMemory(state, id).status, 'stale')
    assert.deepEqual(searchMemory(state, 'test', 5), [])
    assert.equal(renderIndex(state, 1000), '')
  } finally { await f.cleanup() }
})

test('forget preserves cursors and does not regenerate memory from the same old events', async () => {
  const f = await fixture()
  try {
    const engine = new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' }))
    await engine.run([batch])
    const id = (await f.store.read()).facts[0].id
    const forgotten = await f.store.forget(id)
    assert.equal(forgotten.facts.length, 0)
    assert.equal(forgotten.cursors['session-a'], 10)
    assert.equal((await engine.run([batch])).unchanged, true)
    assert.equal((await f.store.rollback(1)).facts.length, 1)
  } finally { await f.cleanup() }
})

test('missing or nonverbatim evidence cannot create a memory or advance a cursor', async () => {
  const f = await fixture()
  try {
    const bad: Proposal = structuredClone(proposal)
    bad.updates[0].evidence[0].quote = 'All future npm commands are safe.'
    await assert.rejects(new DreamEngine(f.store, config, responses(bad)).run([batch]), code('UNSUPPORTED_EVIDENCE'))
    assert.equal((await f.store.read()).revision, 0)
    assert.deepEqual((await f.store.read()).cursors, {})
  } finally { await f.cleanup() }
})

test('assistant-only assertions stay uncertain instead of becoming supported facts', async () => {
  const f = await fixture()
  try {
    const assistantBatch = structuredClone(batch)
    assistantBatch.events[0].kind = 'assistant'
    await assert.rejects(new DreamEngine(f.store, config, responses(proposal)).run([assistantBatch]), code('UNSUPPORTED_EVIDENCE'))
    const uncertain = structuredClone(proposal)
    uncertain.updates[0].status = 'uncertain'
    await new DreamEngine(f.store, config, responses(uncertain, { approved: true, reason: '' })).run([assistantBatch])
    assert.equal((await f.store.read()).facts[0].status, 'uncertain')
  } finally { await f.cleanup() }
})

test('malformed model JSON and semantic review rejection leave the current revision untouched', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, config, async () => 'not JSON').run([batch]), code('INVALID_PROPOSAL'))
    await assert.rejects(new DreamEngine(f.store, config, responses(proposal, { approved: false, reason: 'Overgeneralized result.' })).run([batch]), code('REVIEW_REJECTED'))
    assert.equal((await f.store.read()).revision, 0)
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    assert.equal((await f.store.read()).revision, 1)
  } finally { await f.cleanup() }
})

test('provider failure and cancellation before publication preserve cursors and release locks', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, config, async () => { throw new Error('provider offline') }).run([batch]), /provider offline/)
    const controller = new AbortController()
    await assert.rejects(new DreamEngine(f.store, config, async () => { controller.abort(); return JSON.stringify(proposal) }).run([batch], controller.signal), { name: 'AbortError' })
    assert.equal((await f.store.read()).revision, 0)
    await new DreamEngine(f.store, config, responses({ updates: [], retire: [] })).run([batch])
    assert.equal((await f.store.read()).revision, 1)
  } finally { await f.cleanup() }
})

test('an overlapping writer receives BUSY while the first model call is in flight', async () => {
  const f = await fixture()
  let finish: (value: string) => void = () => { throw new Error('not started') }
  let entered: () => void = () => { throw new Error('not awaited') }
  const ready = new Promise<void>(resolve => { entered = resolve })
  try {
    const first = new DreamEngine(f.store, config, () => new Promise<string>(resolve => { finish = resolve; entered() })).run([batch])
    await ready
    await assert.rejects(new DreamEngine(new MemoryStore(f.directory, 'project-a'), config, responses(proposal)).run([batch]), code('BUSY'))
    finish(JSON.stringify({ updates: [], retire: [] }))
    await first
    assert.equal((await f.store.read()).revision, 1)
  } finally { await f.cleanup() }
})

test('known credentials are redacted before model calls and cannot be persisted in a proposal', async () => {
  const f = await fixture()
  try {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    assert.equal(containsSecret(secret), true)
    assert.ok(!redactSecrets(`API_KEY=${secret}\nBearer abcdefghijklmn`).includes(secret))
    const secretBatch = structuredClone(batch)
    secretBatch.events[0].text += ` API_KEY=${secret}`
    let captured = ''
    await new DreamEngine(f.store, config, async (_system, payload) => { captured = payload; return JSON.stringify({ updates: [], retire: [] }) }).run([secretBatch])
    assert.ok(captured.includes('[REDACTED]'))
    assert.ok(!captured.includes(secret))
    const bad = structuredClone(proposal)
    bad.updates[0].content = `Use ${secret}`
    const later = { ...batch, throughSeq: 20, events: [{ ...batch.events[0], seq: 14 }] }
    bad.updates[0].evidence[0].seq = 14
    await assert.rejects(new DreamEngine(f.store, config, responses(bad)).run([later]), code('SECRET_DETECTED'))
    assert.equal((await f.store.read()).cursors['session-a'], 10)
  } finally { await f.cleanup() }
})

test('oversized inputs and memory counts fail without consuming source events', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, { ...config, maxInputChars: 10, maxProposalChars: 5 }, async () => { throw new Error('must not call model') }).run([batch]), code('INPUT_LIMIT'))
    const oversized: Proposal = { updates: [proposal.updates[0], { ...proposal.updates[0], title: 'Another fact' }], retire: [] }
    await assert.rejects(new DreamEngine(f.store, { ...config, maxFacts: 1 }, responses(oversized, { approved: true, reason: '' })).run([batch]), code('MEMORY_LIMIT'))
    assert.equal((await f.store.read()).revision, 0)
  } finally { await f.cleanup() }
})

test('empty completed prefixes advance once without a model call and invalid prefix evidence fails', async () => {
  const f = await fixture()
  try {
    const engine = new DreamEngine(f.store, config, async () => { throw new Error('must not call model') })
    await engine.run([{ sessionId: 'session-a', throughSeq: 10, events: [] }])
    assert.equal((await f.store.read()).cursors['session-a'], 10)
    assert.equal((await engine.run([{ sessionId: 'session-a', throughSeq: 10, events: [] }])).unchanged, true)
    await assert.rejects(engine.run([{ sessionId: 'session-b', throughSeq: 2, events: batch.events }]), code('INVALID_BATCH'))
    assert.equal((await f.store.read()).revision, 1)
  } finally { await f.cleanup() }
})

test('checksums detect altered revision content and project identity cannot cross stores', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    await assert.rejects(new MemoryStore(f.directory, 'project-b').read(), code('CORRUPT_STORE'))
    const path = join(f.directory, 'revision-1.json')
    await writeFile(path, (await readFile(path, 'utf8')).replace('all 8', 'all 9'))
    await assert.rejects(f.store.read(), code('CORRUPT_STORE'))
  } finally { await f.cleanup() }
})

test('context index stays bounded and search results cannot mutate stored state', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    const state = await f.store.read()
    const index = renderIndex(state, 350)
    assert.ok(index.length <= 350)
    assert.ok(index.includes('Test command'))
    assert.ok(!index.includes('passed all 8'))
    assert.equal(renderIndex(state, 10), '')
    const result = searchMemory(state, 'test', 2)
    result[0].title = 'changed'
    assert.equal(state.facts[0].title, 'Test command')
    assert.throws(() => readMemory(state, 'missing'), code('NOT_FOUND'))
  } finally { await f.cleanup() }
})

test('unrecognized proposal fields and duplicate memory changes are rejected', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, config, responses({ ...proposal, execute: 'shell command' })).run([batch]), code('INVALID_PROPOSAL'))
    await assert.rejects(new DreamEngine(f.store, config, responses({ updates: [proposal.updates[0], proposal.updates[0]], retire: [] })).run([batch]), code('INVALID_PROPOSAL'))
    assert.equal((await f.store.read()).revision, 0)
  } finally { await f.cleanup() }
})

test('merges old and new evidence while preserving the original observation time and source kind', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    const id = (await f.store.read()).facts[0].id
    const later: TranscriptBatch = { sessionId: 'session-b', throughSeq: 5, events: [{ sessionId: 'session-b', seq: 3, time: '2026-11-08T02:00:00Z', kind: 'user', text: 'Run npm test before submitting changes.' }] }
    const merged: Proposal = { updates: [{ ...proposal.updates[0], id, content: 'Run npm test before submitting changes. It passed all 8 tests in the earlier session.', evidence: [citation, { sessionId: 'session-b', seq: 3, quote: later.events[0].text }] }], retire: [] }
    await new DreamEngine(f.store, config, responses(merged, { approved: true, reason: '' })).run([later])
    const sources = (await f.store.read()).facts[0].sources
    assert.equal(sources[0].kind, 'tool')
    assert.equal(sources[0].observedAt, batch.events[0].time)
    assert.equal(sources[1].kind, 'user')
    assert.equal(sources[1].observedAt, later.events[0].time)
  } finally { await f.cleanup() }
})

test('historical assistant-only evidence cannot be promoted from uncertain to supported', async () => {
  const f = await fixture()
  try {
    const assistantBatch = structuredClone(batch)
    assistantBatch.events[0].kind = 'assistant'
    const uncertain = structuredClone(proposal)
    uncertain.updates[0].status = 'uncertain'
    await new DreamEngine(f.store, config, responses(uncertain, { approved: true, reason: '' })).run([assistantBatch])
    const id = (await f.store.read()).facts[0].id
    const promoted: Proposal = { updates: [{ ...proposal.updates[0], id }], retire: [] }
    const later: TranscriptBatch = { sessionId: 'session-b', throughSeq: 2, events: [{ sessionId: 'session-b', seq: 1, time: '2026-11-08T02:00:00Z', kind: 'user', text: 'Check the project.' }] }
    await assert.rejects(new DreamEngine(f.store, config, responses(promoted)).run([later]), code('UNSUPPORTED_EVIDENCE'))
    assert.equal((await f.store.read()).revision, 1)
    assert.equal((await f.store.read()).facts[0].status, 'uncertain')
  } finally { await f.cleanup() }
})

test('rollback validates checksums of historical revisions rather than trusting valid JSON', async () => {
  const f = await fixture()
  try {
    await new DreamEngine(f.store, config, responses(proposal, { approved: true, reason: '' })).run([batch])
    await f.store.forget((await f.store.read()).facts[0].id)
    const history = join(f.directory, 'revision-1.json')
    await writeFile(history, (await readFile(history, 'utf8')).replace('all 8', 'all 9'))
    assert.equal((await f.store.read()).revision, 2)
    await assert.rejects(f.store.rollback(1), code('CORRUPT_STORE'))
    await assert.rejects(f.store.revisions(), code('CORRUPT_STORE'))
    assert.equal((await f.store.read()).revision, 2)
  } finally { await f.cleanup() }
})

test('prototype-shaped session identifiers remain own cursors and are not processed repeatedly', async () => {
  const f = await fixture()
  try {
    const engine = new DreamEngine(f.store, config, async () => { throw new Error('empty evidence needs no model') })
    const batches = ['toString', '__proto__'].map(sessionId => ({ sessionId, throughSeq: 8, events: [] }))
    await engine.run(batches)
    const state = await f.store.read()
    for (const sessionId of ['toString', '__proto__']) {
      assert.equal(Object.hasOwn(state.cursors, sessionId), true)
      assert.equal(state.cursors[sessionId], 8)
    }
    assert.equal((await engine.run(batches)).unchanged, true)
  } finally { await f.cleanup() }
})

test('evidence budgeting reserves the entire proposal so a near-limit extraction can still be reviewed', async () => {
  const f = await fixture()
  try {
    const compactConfig = { ...config, maxInputChars: 3200, maxProposalChars: 1200 }
    const available = evidenceBudget(await f.store.read(), compactConfig)
    const padded = structuredClone(batch)
    const overhead = JSON.stringify(padded.events).length
    padded.events[0].text += ' '.repeat(available - overhead)
    const sizes: number[] = []
    const responseQueue = responses(proposal, { approved: true, reason: '' })
    await new DreamEngine(f.store, compactConfig, async (system, payload, signal) => { sizes.push(payload.length); return responseQueue(system, payload, signal) }).run([padded])
    assert.equal(sizes.length, 2)
    assert.ok(sizes.every(size => size <= compactConfig.maxInputChars))
    assert.equal((await f.store.read()).revision, 1)
    assert.throws(() => evidenceBudget(awaitState(), { ...compactConfig, maxInputChars: 500 }), code('INPUT_LIMIT'))
    function awaitState() { return { schemaVersion: 1 as const, projectId: 'p', revision: 0, parentRevision: null, parentHash: null, createdAt: new Date(0).toISOString(), facts: [], cursors: {} } }
  } finally { await f.cleanup() }
})

test('an over-budget raw proposal fails before review and leaves cursors untouched', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, { ...config, maxProposalChars: 100 }, responses(proposal)).run([batch]), code('INVALID_PROPOSAL'))
    assert.equal((await f.store.read()).revision, 0)
  } finally { await f.cleanup() }
})

test('a writer whose lock disappears cannot publish its model result', async () => {
  const f = await fixture()
  try {
    await assert.rejects(new DreamEngine(f.store, config, async () => {
      await rm(join(f.directory, '.writer.lock'), { recursive: true })
      return JSON.stringify({ updates: [], retire: [] })
    }).run([batch]), code('BUSY'))
    assert.equal((await f.store.read()).revision, 0)
    await new DreamEngine(f.store, config, responses({ updates: [], retire: [] })).run([batch])
    assert.equal((await f.store.read()).revision, 1)
  } finally { await f.cleanup() }
})

test('losing writer cleanup does not remove a replacement lock owned by another writer', async () => {
  const f = await fixture()
  try {
    const path = join(f.directory, '.writer.lock')
    await assert.rejects(new DreamEngine(f.store, config, async () => {
      await rename(path, join(f.directory, '.displaced-lock'))
      await mkdir(path)
      await writeFile(join(path, 'owner'), 'successor')
      return JSON.stringify({ updates: [], retire: [] })
    }).run([batch]), code('BUSY'))
    assert.equal(await readFile(join(path, 'owner'), 'utf8'), 'successor')
    assert.equal((await f.store.read()).revision, 0)
  } finally { await f.cleanup() }
})
