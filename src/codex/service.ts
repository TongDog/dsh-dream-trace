import { join } from 'node:path'
import { CoreError, DreamEngine, MemoryStore, evidenceBudget, readMemory, renderIndex, searchMemory, type Generate, type EngineConfig } from '../core/index.ts'
import { type CodexConfig } from './config.ts'
import { hash } from './files.ts'
import { createGenerator } from './model.ts'
import { TraceStore } from './traces.ts'

export class CodexDreamService {
  readonly traces: TraceStore
  private readonly stores = new Map<string, MemoryStore>()
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly lastRuns = new Map<string, { at: string; error: string | null }>()
  private readonly lifecycle = new AbortController()
  private timer?: NodeJS.Timeout
  private readonly engineConfig: EngineConfig

  constructor(readonly config: CodexConfig, private readonly generate: Generate = createGenerator(config)) {
    this.traces = new TraceStore(config)
    this.engineConfig = { maxInputChars: config.maxInputChars, maxProposalChars: config.maxProposalChars, maxFacts: config.maxFacts,
      maxFactChars: config.maxFactChars, maxFactsPerRun: config.maxFactsPerRun, verify: config.verify }
    for (const root of config.projectRoots) {
      const projectId = hash(root)
      this.stores.set(root, new MemoryStore(join(config.storageDirectory, 'memory', projectId), projectId))
    }
  }

  project(root?: string): string {
    const selected = root ?? (this.config.projectRoots.length === 1 ? this.config.projectRoots[0] : undefined)
    if (!selected || !this.stores.has(selected)) throw new Error('Select an exact projectRoot from the configured projectRoots allowlist')
    return selected
  }
  private store(root?: string) { return this.stores.get(this.project(root))! }

  async status(root?: string) {
    const projectRoot = this.project(root)
    const store = this.store(projectRoot)
    const state = await store.read()
    return { projectRoot, revision: state.revision, facts: state.facts.filter(f => f.status !== 'stale').length,
      running: this.operations.has(projectRoot), lastRun: this.lastRuns.get(projectRoot) ?? null,
      revisions: await store.revisions(), autoRun: this.config.autoRun, modelConfigured: !!this.config.model,
      capture: 'Codex hooks observed after installation; private historical transcripts are not imported.',
      cursors: state.cursors }
  }

  async search(root: string | undefined, query: string, limit = this.config.searchLimit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.searchLimit) throw new Error(`limit must be between 1 and ${this.config.searchLimit}`)
    return searchMemory(await this.store(root).read(), query, limit)
  }
  async read(root: string | undefined, id: string) { return readMemory(await this.store(root).read(), id) }
  async index(root?: string) { return renderIndex(await this.store(root).read(), this.config.maxIndexChars) }

  async run(root?: string, signal?: AbortSignal) {
    const projectRoot = this.project(root)
    return this.exclusive(projectRoot, signal, async control => {
      const store = this.store(projectRoot)
      const state = await store.read()
      const selected = await this.traces.collect(projectRoot, state.cursors, evidenceBudget(state, this.engineConfig), control)
      const engine = new DreamEngine(store, this.engineConfig, this.generate)
      const result = await engine.run(selected.batches, control)
      return { ...result, sessionsRead: selected.sessionsRead, eventsSelected: selected.eventsSelected, deferred: selected.deferred, warnings: selected.warnings }
    })
  }
  async forget(root: string | undefined, id: string, signal?: AbortSignal) {
    return this.exclusive(this.project(root), signal, async control => ({ revision: (await this.store(root).forget(id, control)).revision }))
  }
  async rollback(root: string | undefined, revision: number, signal?: AbortSignal) {
    return this.exclusive(this.project(root), signal, async control => ({ revision: (await this.store(root).rollback(revision, control)).revision }))
  }

  private exclusive<T>(root: string, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.lifecycle.signal.throwIfAborted()
    if (this.operations.has(root)) return Promise.reject(new CoreError('BUSY', 'A Dream Trace operation is already running for this project'))
    const control = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(this.config.runTimeoutSeconds * 1000), ...(signal ? [signal] : [])])
    const operation = Promise.resolve().then(() => { control.throwIfAborted(); return action(control) }).then(result => {
      this.lastRuns.set(root, { at: new Date().toISOString(), error: null })
      return result
    }, (error: unknown) => {
      this.lastRuns.set(root, { at: new Date().toISOString(), error: error instanceof Error ? error.message : 'Dream Trace operation failed' })
      throw error
    }).finally(() => this.operations.delete(root))
    this.operations.set(root, operation)
    return operation
  }

  /** Poll captured evidence while the MCP server is alive. Persistent cursors survive restarts. */
  start() {
    if (!this.config.autoRun || this.timer) return
    const tick = () => {
      for (const root of this.config.projectRoots) if (!this.operations.has(root) && !this.lifecycle.signal.aborted) {
        void this.run(root).catch(() => { /* Available via dream_status; never corrupt stdio. */ })
      }
    }
    this.timer = setInterval(tick, this.config.autoRunIntervalSeconds * 1000)
    this.timer.unref()
    tick()
  }
  async close() {
    if (this.timer) clearInterval(this.timer)
    this.lifecycle.abort(new Error('Dream Trace stopped'))
    await Promise.allSettled(this.operations.values())
  }
}
