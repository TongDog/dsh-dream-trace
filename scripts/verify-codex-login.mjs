/** Explicit live check: consumes Codex usage, using only synthetic evidence in a temporary store. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/codex/config.ts'
import { CodexDreamService } from '../src/codex/service.ts'
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dream-trace-live-check-')))
let service
try {
  const project = join(temporary, 'project')
  await mkdir(project)
  const model = { backend: 'codex', ...(process.argv[2] ? { name: process.argv[2] } : {}) }
  const config = await resolveConfig({ projectRoots: [project], storageDirectory: join(temporary, 'data'), model, runTimeoutSeconds: 180 })
  service = new CodexDreamService(config)
  const prompt = 'For this synthetic test project, always include exact evidence quotes and observation times when summarizing project records.'
  await service.traces.capture({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 'synthetic-live-check', turn_id: '1', prompt })
  await service.traces.capture({ hook_event_name: 'Stop', cwd: project, session_id: 'synthetic-live-check', turn_id: '1', last_assistant_message: 'Acknowledged.' })
  const result = await service.run()
  assert.ok(result.created > 0)
  const facts = await service.search(project, '')
  assert.ok(facts.some(fact => fact.sources.some(source => source.kind === 'user' && prompt.includes(source.quote))))
  assert.equal((await service.run()).unchanged, true)
  console.log(JSON.stringify({ backend: (await service.status()).modelBackend, revision: result.revision, facts: facts.length, evidenceVerified: true, idempotent: true, syntheticOnly: true }))
} finally {
  await service?.close()
  await rm(temporary, { recursive: true, force: true })
}
