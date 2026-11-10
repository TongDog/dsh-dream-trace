import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test, { type TestContext } from 'node:test'
import { resolveConfig } from '../src/codex/config.ts'
import { createGenerator } from '../src/codex/model.ts'
import { CodexDreamService } from '../src/codex/service.ts'

async function fixture(t: TestContext, mode = 'success', configOverrides: object = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dream-codex-model-test-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const project = join(dir, 'project'), command = join(dir, 'fake-codex'), log = join(dir, 'calls.jsonl')
  await mkdir(project)
  await writeFile(command, `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
const argument = name => args[args.indexOf(name) + 1]
const input = await new Promise(resolve => { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => text += value); process.stdin.on('end', () => resolve(text)) })
const instructions = readFileSync(JSON.parse(args.find(value => value.startsWith('model_instructions_file=')).split('=').slice(1).join('=')), 'utf8')
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), input, instructions, pid: process.pid,
  worker: process.env.DREAM_TRACE_CODEX_WORKER, apiKey: process.env.DREAM_TRACE_API_KEY, config: process.env.DREAM_TRACE_CONFIG }) + '\\n')
const mode = ${JSON.stringify(mode)}
const emit = event => process.stdout.write(JSON.stringify(event) + '\\n')
emit({ type: 'thread.started', thread_id: 'fixture' })
emit({ type: 'item.completed', item: { type: 'error', message: 'Synthetic CLI startup warning' } })
emit({ type: 'turn.started' })
emit({ type: 'error', message: 'Synthetic reconnect notice' })
if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000) }
else if (mode === 'exit') { console.error('PRIVATE_PROVIDER_SECRET'); process.exitCode = 7 }
else if (mode === 'tools') { emit({ type: 'item.started', item: { type: 'command_execution', command: 'PRIVATE_COMMAND' } }); setInterval(() => {}, 1000) }
else if (mode === 'overflow') { process.stdout.write('x'.repeat(3 * 1024 * 1024)) }
else if (mode === 'failed') { emit({ type: 'turn.failed', error: { message: 'PRIVATE_PROVIDER_SECRET' } }) }
else {
  const data = JSON.parse(input)
  const event = data.events?.find(event => event.kind === 'user')
  const answer = instructions.startsWith('Review') ? { approved: mode !== 'reject', reason: 'Observed user evidence' } : {
    updates: event ? [{ title: '发布前验证', content: event.text, category: 'procedure', status: 'supported',
      evidence: [{ sessionId: event.sessionId, seq: event.seq, quote: event.text }] }] : [], retire: [] }
  if (mode !== 'missing') writeFileSync(argument('--output-last-message'), mode === 'malformed' ? '{' : mode === 'large-file' ? 'x'.repeat(3 * 1024 * 1024) : JSON.stringify({ result: JSON.stringify(answer) }))
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'result available' } })
  if (mode !== 'incomplete') emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })
}
`, { mode: 0o700 })
  const config = await resolveConfig({ projectRoots: [project], storageDirectory: join(dir, 'data'),
    model: { backend: 'codex', command, name: 'fixture-model', reasoningEffort: 'low' }, ...configOverrides })
  const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  return { config, project, dir, calls }
}

test('Codex backend is explicit and old API configurations remain compatible', async () => {
  assert.equal((await resolveConfig({ model: { baseUrl: 'https://example.com/v1', name: 'model' } })).model?.backend, 'api')
  assert.deepEqual((await resolveConfig({ model: { backend: 'codex' } })).model, { backend: 'codex', command: 'codex' })
  await assert.rejects(resolveConfig({ model: { backend: 'codex', command: 'codex; echo unsafe' } }))
  await assert.rejects(resolveConfig({ model: { backend: 'codex', baseUrl: 'https://example.com', apiKey: 'secret' } }))
})

test('Codex generation uses stdin, an isolated read-only ephemeral worker and removes temporary evidence', async t => {
  const f = await fixture(t)
  const payload = JSON.stringify({ events: [], text: 'Evidence with `commands` and $(substitution) stays data' })
  assert.deepEqual(JSON.parse(await createGenerator(f.config)('Memory extraction instructions', payload)), { updates: [], retire: [] })
  const [call] = await f.calls()
  assert.equal(call.input, payload)
  assert.equal(call.worker, '1')
  assert.equal(call.apiKey, undefined)
  assert.equal(call.config, undefined)
  assert.notEqual(call.cwd, f.project)
  assert.ok(!call.args.includes(payload))
  for (const flag of ['--no-daemon', '--ephemeral', '--ignore-user-config', '--output-schema']) assert.ok(call.args.includes(flag))
  assert.equal(call.args[call.args.indexOf('--sandbox') + 1], 'read-only')
  for (const feature of ['hooks', 'plugins', 'apps', 'shell_tool', 'multi_agent']) {
    assert.ok(call.args.some((arg: string, i: number) => arg === '--disable' && call.args[i + 1] === feature))
  }
  await assert.rejects(readdir(call.cwd), { code: 'ENOENT' })
})

test('Codex proposal and independent review preserve evidence, recall, idempotence and rollback', async t => {
  const f = await fixture(t)
  const service = new CodexDreamService(f.config)
  t.after(() => service.close())
  const capture = (hook_event_name: string, extra: object = {}) => service.traces.capture({ hook_event_name, cwd: f.project, session_id: 'observed', turn_id: '1', ...extra })
  await capture('UserPromptSubmit', { prompt: '发布前运行 npm test。' })
  await capture('Stop', { last_assistant_message: '收到' })
  assert.equal((await service.run()).created, 1)
  const calls = await f.calls()
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].cwd, calls[1].cwd)
  assert.match(calls[1].instructions, /^Review/)
  assert.equal((await service.status()).modelBackend, 'codex')
  const [fact] = await service.search(f.project, 'npm test')
  assert.equal(fact.sources[0].kind, 'user')
  assert.equal(fact.sources[0].sessionId, 'codex:observed')
  assert.equal((await service.run()).unchanged, true)
  assert.equal((await f.calls()).length, 2)
  await service.forget(f.project, fact.id)
  await service.rollback(f.project, 1)
  assert.equal((await service.read(f.project, fact.id)).content, '发布前运行 npm test。')
})

test('Codex review rejection leaves memory and cursors unchanged', async t => {
  const f = await fixture(t, 'reject')
  const service = new CodexDreamService(f.config)
  t.after(() => service.close())
  for (const input of [{ hook_event_name: 'UserPromptSubmit', prompt: 'Run tests.' }, { hook_event_name: 'Stop' }]) {
    await service.traces.capture({ cwd: f.project, session_id: 'observed', turn_id: '1', ...input })
  }
  await assert.rejects(service.run(), /review rejected/)
  assert.equal((await service.status()).revision, 0)
  assert.deepEqual((await service.status()).cursors, {})
})

test('Codex rejects tools, incomplete or invalid results, oversized output and nonzero exits without echoing private text', async t => {
  for (const mode of ['tools', 'incomplete', 'malformed', 'missing', 'overflow', 'large-file', 'exit', 'failed']) {
    const f = await fixture(t, mode)
    await assert.rejects(createGenerator(f.config)('Memory extraction', '{"events":[]}'), error => {
      assert.doesNotMatch(String(error), /PRIVATE_/)
      return true
    })
    const [call] = await f.calls()
    await assert.rejects(readdir(call.cwd), { code: 'ENOENT' })
  }
})

test('Codex timeout terminates a worker that ignores SIGTERM and cleans its temporary files', async t => {
  const f = await fixture(t, 'hang', { runTimeoutSeconds: 1 })
  await assert.rejects(createGenerator(f.config)('Memory extraction', '{}'), /timed out/)
  const [call] = await f.calls()
  assert.throws(() => process.kill(call.pid, 0), { code: 'ESRCH' })
  await assert.rejects(readdir(call.cwd), { code: 'ENOENT' })
})

test('Codex cancellation and missing executable fail without publishing memory', async t => {
  const f = await fixture(t, 'hang')
  const controller = new AbortController()
  const generation = createGenerator(f.config)('Memory extraction', '{}', controller.signal)
  for (let i = 0; i < 100; i++) {
    try { await f.calls(); break } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  controller.abort()
  await assert.rejects(generation, /cancelled/)
  const [call] = await f.calls()
  assert.throws(() => process.kill(call.pid, 0), { code: 'ESRCH' })
  const bad = await resolveConfig({ model: { backend: 'codex', command: join(f.dir, 'does-not-exist') } })
  await assert.rejects(createGenerator(bad)('Memory extraction', '{}'), /Could not start Codex/)
})

test('worker marker prevents recursive CLI capture and MCP startup before reading configuration', async () => {
  const run = promisify(execFile)
  const cli = fileURLToPath(new URL('../src/codex/cli.ts', import.meta.url))
  const env = { ...process.env, DREAM_TRACE_CODEX_WORKER: '1', DREAM_TRACE_CONFIG: '/nonexistent-dream-trace-test-config.json' }
  const result = await run(process.execPath, ['--import', 'tsx', cli, 'hook'], { env })
  assert.equal(result.stdout.trim(), '{}')
  await assert.rejects(run(process.execPath, ['--import', 'tsx', cli, 'serve'], { env }), /cannot run recursively/)
})
