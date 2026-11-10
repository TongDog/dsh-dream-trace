/** Project-scoped Dreaming plugin for DeepSeek Harness 0.2.2-rc.1. */
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { Config, configSchema } from "./config.js";
import { CoreError, DreamEngine, MemoryStore, evidenceBudget, readMemory, recallView, renderIndex, searchMemory } from "./core/index.js";
import { collectTranscripts } from "./transcripts.js";
import { generateInSession } from "./worker.js";
import { registerTools } from "./tools.js";
import { registerUiBridge } from "./ui-bridge.js";
export { Config } from "./config.js";
/** Match a canonical path without accepting sibling-prefix matches. */
function contains(root, path) {
    const tail = relative(root, path);
    return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`));
}
/** Owns memory operations, model sessions, context contribution, and timers. */
export class DreamingService extends Service {
    static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionQuery', 'systemPrompt', 'tools', 'workingDirectory'];
    static Config = Config;
    config;
    projects = new Map();
    agentIndexes = new WeakMap();
    lifecycle = new AbortController();
    operations = new Map();
    lastRuns = new Map();
    delays = new Map();
    constructor(ctx, config) {
        super(ctx, 'dreaming');
        this.config = configSchema.parse(config);
    }
    async [Service.init]() {
        const roots = await Promise.all(this.config.projectRoots.map(async (root) => {
            const canonical = await realpath(root);
            if (!(await stat(canonical)).isDirectory())
                throw new Error(`Dreaming project root is not a directory: ${root}`);
            return canonical;
        }));
        for (const root of roots) {
            if (roots.some(other => other !== root && (contains(root, other) || contains(other, root))))
                throw new Error('Dreaming projectRoots must not overlap; configure separate project roots.');
            if (this.projects.has(root))
                throw new Error('Dreaming projectRoots contains duplicate canonical directories.');
            const id = createHash('sha256').update(root).digest('hex');
            const store = new MemoryStore(join(this.config.storageDirectory, id), id);
            await store.read();
            this.projects.set(root, { root, store });
        }
        const ctx = this.ctx;
        ctx.effect(() => async () => {
            this.lifecycle.abort(new Error('Dreaming plugin unloaded'));
            for (const timeout of this.delays.values())
                clearTimeout(timeout);
            this.delays.clear();
            await Promise.allSettled(this.operations.values());
        });
        ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
            if (!this.isWorker(agent)) {
                this.agentIndexes.delete(agent);
                const project = await this.projectForDirectory(ctx.workingDirectory.get(agent.session));
                if (project) {
                    signal.throwIfAborted();
                    const view = await this.view(project);
                    this.agentIndexes.set(agent, renderIndex(view, this.config.maxIndexChars));
                }
            }
            return next();
        });
        ctx.systemPrompt.context({
            name: 'dreaming:memory-index', order: 900, interpolate: false,
            text: ({ agent }) => {
                if (!agent || this.isWorker(agent))
                    return '';
                return this.agentIndexes.get(agent) ?? '';
            },
        });
        registerTools(ctx, this);
        registerUiBridge(ctx, this);
        if (this.config.autoRunAfterTurn) {
            ctx.on('session/event', (session, event) => {
                if (event.type !== 'turn/end' || session.header.origin === 'subagent')
                    return;
                const directory = ctx.workingDirectory.get(session);
                for (const root of this.projects.keys()) {
                    if (!contains(root, directory))
                        continue;
                    const previous = this.delays.get(root);
                    if (previous)
                        clearTimeout(previous);
                    const timer = setTimeout(() => {
                        this.delays.delete(root);
                        void this.autoRun(root);
                    }, this.config.afterTurnDelaySeconds * 1000);
                    timer.unref();
                    this.delays.set(root, timer);
                }
            });
        }
        if (this.config.autoRunIntervalMinutes > 0) {
            ctx.effect(() => {
                const timer = setInterval(() => {
                    for (const root of this.projects.keys())
                        void this.autoRun(root);
                }, this.config.autoRunIntervalMinutes * 60000);
                timer.unref();
                return () => clearInterval(timer);
            });
        }
    }
    /** Resolve only the caller's current, explicitly enabled local project. */
    async projectForAgent(agent) {
        if (!agent)
            throw new Error('Dreaming tools require an active Agent session.');
        if (this.isWorker(agent))
            throw new Error('Dreaming workers cannot access memory tools.');
        const project = await this.projectForDirectory(this.ctx.workingDirectory.get(agent.session));
        if (!project)
            throw new Error('This directory is not enabled in Dreaming projectRoots. Configure the plugin with its absolute project directory.');
        return project.root;
    }
    /** Consolidate one bounded batch; concurrent runs for a project are rejected. */
    async run(projectRoot, signal) {
        return this.exclusive(projectRoot, signal, async (project, control) => {
            const state = await project.store.read();
            const engineConfig = {
                maxInputChars: this.config.maxInputChars, maxProposalChars: this.config.maxProposalChars,
                maxFacts: this.config.maxFacts, maxFactChars: this.config.maxFactChars,
                maxFactsPerRun: this.config.maxFactsPerRun, verify: this.config.verify,
            };
            const selected = await collectTranscripts(this.ctx.sessionQuery, {
                projectRoot: project.root, cursors: state.cursors, maxSessions: this.config.maxSessionsPerRun,
                maxEvents: this.config.maxEventsPerRun, maxChars: evidenceBudget(state, engineConfig),
            }, control);
            const engine = new DreamEngine(project.store, engineConfig, (system, payload, innerSignal) => generateInSession(this.ctx, this.config, project.root, system, payload, innerSignal ?? control));
            const result = await engine.run(selected.batches, control);
            return { ...result, sessionsRead: selected.sessionsRead, eventsSelected: selected.eventsSelected, deferred: selected.deferred };
        });
    }
    /** Current revision, recent failures and available rollback targets. */
    async status(projectRoot) {
        const project = this.project(projectRoot);
        const state = await project.store.read();
        return this.describe(project, state);
    }
    /** Canonical allowlisted roots exposed to the local management UI. */
    listProjects() { return [...this.projects.keys()]; }
    /** A consistent current revision and its bounded notes, including retired notes. */
    async snapshot(projectRoot) {
        const project = this.project(projectRoot);
        const state = await this.view(project);
        return { ...await this.describe(project, state), memories: state.facts, hiddenMemoryIds: state.hiddenMemoryIds ?? [] };
    }
    async describe(project, state) {
        const projectRoot = project.root;
        return { projectRoot, storageDirectory: project.store.directory, revision: state.revision,
            facts: state.facts.filter(fact => !fact.inherited && fact.status !== 'stale').length,
            running: this.operations.has(projectRoot), lastRun: this.lastRuns.get(projectRoot) ?? null,
            revisions: await project.store.revisions(), autoRunAfterTurn: this.config.autoRunAfterTurn,
            autoRunIntervalMinutes: this.config.autoRunIntervalMinutes };
    }
    /** Search current supported and uncertain observations within one project. */
    async search(projectRoot, query, limit = this.config.searchLimit) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.searchLimit)
            throw new Error(`limit must be between 1 and ${this.config.searchLimit}`);
        return searchMemory(await this.view(this.project(projectRoot)), query, limit);
    }
    /** Read a fact with exact source citations, including stale records. */
    async read(projectRoot, id) { return readMemory(await this.view(this.project(projectRoot)), id); }
    /** Restore a previous revision as a new revision, preserving the audit trail. */
    async rollback(projectRoot, revision, signal) {
        return this.exclusive(projectRoot, signal, async (project, control) => {
            const state = await project.store.rollback(revision, control);
            return { revision: state.revision };
        });
    }
    /** Remove a fact from current memory; revision history remains available. */
    async forget(projectRoot, id, signal) {
        return this.exclusive(projectRoot, signal, async (project, control) => {
            const state = await project.store.forget(id, control);
            return { revision: state.revision };
        });
    }
    view(project) {
        return recallView(project.store, [...this.projects.values()].map(item => item.store));
    }
    /** Owner-only Web operation. An inherited ID can be paused in the receiving project. */
    async setVisibility(projectRoot, id, visible, expectedRevision, signal) {
        return this.exclusive(projectRoot, signal, async (project, control) => {
            const state = await project.store.transact(async (current) => {
                if (current.revision !== expectedRevision)
                    throw new Error('Memory changed; refresh the project and retry.');
                if (!current.facts.some(fact => fact.id === id)) {
                    const view = await this.view(project);
                    if (!view.facts.some(fact => fact.inherited && fact.id === id))
                        throw new CoreError('NOT_FOUND', 'Memory is no longer available in this project.');
                }
                const hidden = new Set(current.hiddenMemoryIds);
                if (hidden.has(id) === !visible)
                    return null;
                if (visible)
                    hidden.delete(id);
                else
                    hidden.add(id);
                return { ...current, hiddenMemoryIds: hidden.size ? [...hidden] : undefined };
            }, control);
            return { revision: state.revision };
        });
    }
    async setLevel(projectRoot, id, level, expectedRevision, signal) {
        return this.exclusive(projectRoot, signal, async (project, control) => {
            const state = await project.store.setLevel(id, level, expectedRevision, control);
            return { revision: state.revision };
        });
    }
    project(root) {
        const project = this.projects.get(root);
        if (!project)
            throw new Error('Project is not enabled in Dreaming configuration.');
        return project;
    }
    async projectForDirectory(directory) {
        if (!isAbsolute(directory))
            return undefined;
        let canonical;
        try {
            canonical = await realpath(directory);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        return [...this.projects.values()].find(project => contains(project.root, canonical));
    }
    isWorker(agent) { return agent.session.header.agentPreset === 'dreaming-worker'; }
    exclusive(root, signal, action) {
        this.lifecycle.signal.throwIfAborted();
        const project = this.project(root);
        if (this.operations.has(root))
            return Promise.reject(new CoreError('BUSY', 'A Dreaming operation is already running for this project.'));
        const timeout = AbortSignal.timeout(this.config.runTimeoutSeconds * 1000);
        const control = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal ? [signal] : [])]);
        const operation = Promise.resolve().then(() => {
            control.throwIfAborted();
            return action(project, control);
        }).then(result => {
            this.lastRuns.set(root, { at: new Date().toISOString(), error: null });
            return result;
        }, (error) => {
            this.lastRuns.set(root, { at: new Date().toISOString(), error: error instanceof Error ? error.message : 'Unknown Dreaming failure' });
            throw error;
        }).finally(() => this.operations.delete(root));
        this.operations.set(root, operation);
        return operation;
    }
    async autoRun(root) {
        if (this.lifecycle.signal.aborted || this.operations.has(root))
            return;
        try {
            await this.run(root);
        }
        catch (error) {
            if (!this.lifecycle.signal.aborted)
                this.ctx.logger.warn(`Dreaming failed for ${root}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
export default DreamingService;
//# sourceMappingURL=index.js.map