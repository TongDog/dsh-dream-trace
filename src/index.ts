/** Project-scoped Dreaming plugin for DeepSeek Harness 0.2.2-rc.1. */
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Config, configSchema, type ConfigInput, type DreamingConfig } from './config.ts'
import { CoreError, DreamEngine, MemoryStore, evidenceBudget, readMemory, recallView, renderIndex, searchMemory, type MemoryLevel, type RecallView } from './core/index.ts'
import { collectTranscripts } from './transcripts.ts'
import { generateInSession } from './worker.ts'
import { registerTools } from './tools.ts'
import { registerUiBridge } from './ui-bridge.ts'

export { Config } from './config.ts'
export type { DreamingConfig, ConfigInput } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dreaming: DreamingService }
}

interface Project { root: string; store: MemoryStore }
export interface LastRun { at: string; error: string | null }

/** Match a canonical path without accepting sibling-prefix matches. */
function contains(root: string, path: string): boolean {
  const tail = relative(root, path)
  return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))
}

/** Owns memory operations, model sessions, context contribution, and timers. */
export class DreamingService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionQuery', 'systemPrompt', 'tools', 'workingDirectory']
  static Config = Config
  readonly config: DreamingConfig
  private readonly projects = new Map<string, Project>()
  private readonly agentIndexes = new WeakMap<Agent, string>()
  private readonly lifecycle = new AbortController()
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly lastRuns = new Map<string, LastRun>()
  private readonly delays = new Map<string, NodeJS.Timeout>()

  constructor(ctx: Context, config: ConfigInput) {
    super(ctx, 'dreaming')
    this.config = configSchema.parse(config)
  }

  protected async [Service.init](): Promise<void> {
    const roots = await Promise.all(this.config.projectRoots.map(async root => {
      const canonical = await realpath(root)
      if (!(await stat(canonical)).isDirectory()) throw new Error(`Dreaming project root is not a directory: ${root}`)
      return canonical
    }))
    for (const root of roots) {
      if (roots.some(other => other !== root && (contains(root, other) || contains(other, root)))) throw new Error('Dreaming projectRoots must not overlap; configure separate project roots.')
      if (this.projects.has(root)) throw new Error('Dreaming projectRoots contains duplicate canonical directories.')
      const id = createHash('sha256').update(root).digest('hex')
      const store = new MemoryStore(join(this.config.storageDirectory, id), id)
      await store.read()
      this.projects.set(root, { root, store })
    }
    const ctx = this.ctx
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('Dreaming plugin unloaded'))
      for (const timeout of this.delays.values()) clearTimeout(timeout)
      this.delays.clear()
      await Promise.allSettled(this.operations.values())
    })
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      if (!this.isWorker(agent)) {
        this.agentIndexes.delete(agent)
        const project = await this.projectForDirectory(ctx.workingDirectory.get(agent.session))
        if (project) {
          signal.throwIfAborted()
          const view = await this.view(project)
          this.agentIndexes.set(agent, renderIndex(view, this.config.maxIndexChars))
        }
      }
      return next()
    })
    ctx.systemPrompt.context({
      name: 'dreaming:memory-index', order: 900, interpolate: false,
      text: ({ agent }) => {
        if (!agent || this.isWorker(agent)) return ''
        return this.agentIndexes.get(agent) ?? ''
      },
    })
    registerTools(ctx, this)
    registerUiBridge(ctx, this)
    if (this.config.autoRunAfterTurn) {
      ctx.on('session/event', (session, event) => {
        if (event.type !== 'turn/end' || session.header.origin === 'subagent') return
        const directory = ctx.workingDirectory.get(session)
        for (const root of this.projects.keys()) {
          if (!contains(root, directory)) continue
          const previous = this.delays.get(root)
          if (previous) clearTimeout(previous)
          const timer = setTimeout(() => {
            this.delays.delete(root)
            void this.autoRun(root)
          }, this.config.afterTurnDelaySeconds * 1000)
          timer.unref()
          this.delays.set(root, timer)
        }
      })
    }
    if (this.config.autoRunIntervalMinutes > 0) {
      ctx.effect(() => {
        const timer = setInterval(() => {
          for (const root of this.projects.keys()) void this.autoRun(root)
        }, this.config.autoRunIntervalMinutes * 60000)
        timer.unref()
        return () => clearInterval(timer)
      })
    }
  }

  /** Resolve only the caller's current, explicitly enabled local project. */
  async projectForAgent(agent: Agent | undefined): Promise<string> {
    if (!agent) throw new Error('Dreaming tools require an active Agent session.')
    if (this.isWorker(agent)) throw new Error('Dreaming workers cannot access memory tools.')
    const project = await this.projectForDirectory(this.ctx.workingDirectory.get(agent.session))
    if (!project) throw new Error('This directory is not enabled in Dreaming projectRoots. Configure the plugin with its absolute project directory.')
    return project.root
  }

  /** Consolidate one bounded batch; concurrent runs for a project are rejected. */
  async run(projectRoot: string, signal?: AbortSignal) {
    return this.exclusive(projectRoot, signal, async (project, control) => {
      const state = await project.store.read()
      const engineConfig = {
        maxInputChars: this.config.maxInputChars, maxProposalChars: this.config.maxProposalChars,
        maxFacts: this.config.maxFacts, maxFactChars: this.config.maxFactChars,
        maxFactsPerRun: this.config.maxFactsPerRun, verify: this.config.verify,
      }
      const selected = await collectTranscripts(this.ctx.sessionQuery, {
        projectRoot: project.root, cursors: state.cursors, maxSessions: this.config.maxSessionsPerRun,
        maxEvents: this.config.maxEventsPerRun, maxChars: evidenceBudget(state, engineConfig),
      }, control)
      const engine = new DreamEngine(project.store, engineConfig, (system, payload, innerSignal) =>
        generateInSession(this.ctx, this.config, project.root, system, payload, innerSignal ?? control))
      const result = await engine.run(selected.batches, control)
      return { ...result, sessionsRead: selected.sessionsRead, eventsSelected: selected.eventsSelected, deferred: selected.deferred }
    })
  }

  /** Current revision, recent failures and available rollback targets. */
  async status(projectRoot: string) {
    const project = this.project(projectRoot)
    const state = await project.store.read()
    return this.describe(project, state)
  }

  /** Canonical allowlisted roots exposed to the local management UI. */
  listProjects(): string[] { return [...this.projects.keys()] }

  /** A consistent current revision and its bounded notes, including retired notes. */
  async snapshot(projectRoot: string) {
    const project = this.project(projectRoot)
    const state = await this.view(project)
    return { ...await this.describe(project, state), memories: state.facts }
  }

  private async describe(project: Project, state: RecallView) {
    const projectRoot = project.root
    return { projectRoot, storageDirectory: project.store.directory, revision: state.revision,
      facts: state.facts.filter(fact => !fact.inherited && fact.status !== 'stale').length,
      running: this.operations.has(projectRoot), lastRun: this.lastRuns.get(projectRoot) ?? null,
      revisions: await project.store.revisions(), autoRunAfterTurn: this.config.autoRunAfterTurn,
      autoRunIntervalMinutes: this.config.autoRunIntervalMinutes }
  }

  /** Search current supported and uncertain observations within one project. */
  async search(projectRoot: string, query: string, limit = this.config.searchLimit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.searchLimit) throw new Error(`limit must be between 1 and ${this.config.searchLimit}`)
    return searchMemory(await this.view(this.project(projectRoot)), query, limit)
  }

  /** Read a fact with exact source citations, including stale records. */
  async read(projectRoot: string, id: string) { return readMemory(await this.view(this.project(projectRoot)), id) }

  /** Restore a previous revision as a new revision, preserving the audit trail. */
  async rollback(projectRoot: string, revision: number, signal?: AbortSignal) {
    return this.exclusive(projectRoot, signal, async (project, control) => {
      const state = await project.store.rollback(revision, control)
      return { revision: state.revision }
    })
  }

  /** Remove a fact from current memory; revision history remains available. */
  async forget(projectRoot: string, id: string, signal?: AbortSignal) {
    return this.exclusive(projectRoot, signal, async (project, control) => {
      const state = await project.store.forget(id, control)
      return { revision: state.revision }
    })
  }

  private view(project: Project) {
    return recallView(project.store, [...this.projects.values()].map(item => item.store))
  }

  async setLevel(projectRoot: string, id: string, level: MemoryLevel, expectedRevision?: number, signal?: AbortSignal) {
    return this.exclusive(projectRoot, signal, async (project, control) => {
      const state = await project.store.setLevel(id, level, expectedRevision, control)
      return { revision: state.revision }
    })
  }

  private project(root: string): Project {
    const project = this.projects.get(root)
    if (!project) throw new Error('Project is not enabled in Dreaming configuration.')
    return project
  }

  private async projectForDirectory(directory: string): Promise<Project | undefined> {
    if (!isAbsolute(directory)) return undefined
    let canonical: string
    try { canonical = await realpath(directory) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    return [...this.projects.values()].find(project => contains(project.root, canonical))
  }

  private isWorker(agent: Agent): boolean { return agent.session.header.agentPreset === 'dreaming-worker' }

  private exclusive<T>(root: string, signal: AbortSignal | undefined, action: (project: Project, signal: AbortSignal) => Promise<T>): Promise<T> {
    this.lifecycle.signal.throwIfAborted()
    const project = this.project(root)
    if (this.operations.has(root)) return Promise.reject(new CoreError('BUSY', 'A Dreaming operation is already running for this project.'))
    const timeout = AbortSignal.timeout(this.config.runTimeoutSeconds * 1000)
    const control = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal ? [signal] : [])])
    const operation = Promise.resolve().then(() => {
      control.throwIfAborted()
      return action(project, control)
    }).then(result => {
      this.lastRuns.set(root, { at: new Date().toISOString(), error: null })
      return result
    }, (error: unknown) => {
      this.lastRuns.set(root, { at: new Date().toISOString(), error: error instanceof Error ? error.message : 'Unknown Dreaming failure' })
      throw error
    }).finally(() => this.operations.delete(root))
    this.operations.set(root, operation)
    return operation
  }

  private async autoRun(root: string): Promise<void> {
    if (this.lifecycle.signal.aborted || this.operations.has(root)) return
    try { await this.run(root) } catch (error) {
      if (!this.lifecycle.signal.aborted) this.ctx.logger.warn(`Dreaming failed for ${root}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export default DreamingService
