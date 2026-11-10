/** Own a versioned hook journal instead of depending on Codex's private transcript format. */
import { mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import lockfile from 'proper-lockfile'
import { z } from 'zod'
import { CoreError, type EvidenceEvent, type TranscriptBatch } from '../core/types.ts'
import { redactSecrets } from '../core/security.ts'
import { missing, projectForDirectory, type CodexConfig } from './config.ts'
import { atomicJson, hash, readPrivateJson } from './files.ts'

const id = z.string().min(1).max(200)
export const hookSchema = z.object({
  hook_event_name: z.enum(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'Interrupt']),
  session_id: id, cwd: z.string().min(1), turn_id: id.optional(),
  source: z.string().optional(), prompt: z.string().optional(),
  tool_name: z.string().optional(), tool_use_id: id.optional(),
  tool_input: z.unknown().optional(), tool_response: z.unknown().optional(),
  last_assistant_message: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(), agent_type: z.string().nullable().optional(),
  stop_hook_active: z.boolean().optional(),
}) // Strip unknown fields: transcript paths, model internals and future fields are never persisted.
export type HookInput = z.infer<typeof hookSchema>

const recordSchema = z.object({
  seq: z.number().int().nonnegative(), time: z.iso.datetime(), turnId: id,
  type: z.enum(['begin', 'evidence', 'end', 'discard']), key: z.string(),
  kind: z.enum(['user', 'assistant', 'tool']).optional(), text: z.string().optional(),
}).strict()
const traceSchema = z.object({
  schemaVersion: z.literal(1), sessionId: id, projectRoot: z.string().nullable(),
  records: z.array(recordSchema), warning: z.string().nullable(),
}).strict()
type Trace = z.infer<typeof traceSchema>
type Record = z.infer<typeof recordSchema>
export const traceId = (sessionId: string) => `codex:${sessionId}`

const ownTool = (name: string) => /(?:^|__)(?:dream_run|dream_status|dream_rollback|memory_search|memory_read|memory_set_level|memory_forget|memory_index)$/.test(name)
const opaqueKeys = /^(?:reasoning(?:_.*)?|thinking|encrypted_content|image(?:_.*)?|audio(?:_.*)?|base64|data)$/i

/** Keep visible tool data; binary/image/reasoning blocks never become evidence. */
function visible(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new Error('Tool output nesting exceeds capture limit')
  if (typeof value === 'string') return /^(?:data:|[A-Za-z0-9+/]{2000,}={0,2}$)/.test(value) ? undefined : value
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.map(v => visible(v, depth + 1)).filter(v => v !== undefined)
  if (typeof value !== 'object') return
  const object = value as { [key: string]: unknown }
  if (typeof object.type === 'string' && /reasoning|thinking|image|audio|resource|video/i.test(object.type)) return
  return Object.fromEntries(Object.entries(object).filter(([key]) => !opaqueKeys.test(key)).map(([key, v]) => [key, visible(v, depth + 1)]).filter(([, v]) => v !== undefined))
}
const visibleText = (value: unknown): string => {
  const selected = visible(value)
  return selected === undefined ? '' : typeof selected === 'string' ? selected : JSON.stringify(selected)
}

export class TraceStore {
  readonly directory: string
  constructor(private readonly config: CodexConfig) { this.directory = join(config.storageDirectory, 'traces') }

  private async read(path: string): Promise<Trace> {
    const trace = traceSchema.parse(await readPrivateJson(path))
    if (trace.records.some((record, i) => record.seq !== i)) throw new Error('Trace sequence is corrupt')
    return trace
  }

  /** Capture synchronously so Stop cannot overtake delayed tool/prompt capture. */
  async capture(raw: unknown): Promise<{ projectRoot?: string; captured: boolean; warning?: string }> {
    const input = hookSchema.parse(raw)
    if (!this.config.projectRoots.length || input.agent_id || input.agent_type) return { captured: false }
    const root = await projectForDirectory(this.config, input.cwd)
    const path = join(this.directory, `${hash(input.session_id)}.json`)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const release = await lockfile.lock(path, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 }, stale: 10000 })
    try {
      let trace: Trace
      try { trace = await this.read(path) } catch (error) {
        if (!missing(error)) throw error
        // Missing SessionStart is allowed only at a new prompt, never a tool/Stop halfway through a turn.
        if (!['SessionStart', 'UserPromptSubmit'].includes(input.hook_event_name)) return { captured: false }
        trace = { schemaVersion: 1, sessionId: input.session_id, projectRoot: root ?? null, records: [], warning: null }
      }
      if (trace.sessionId !== input.session_id) throw new Error('Trace identity mismatch')
      const allowedRoot = trace.projectRoot && this.config.projectRoots.includes(trace.projectRoot) ? trace.projectRoot : undefined
      if (input.hook_event_name === 'SessionStart') {
        // A fork has a new session ID; no inherited history is copied into its journal.
        await atomicJson(path, trace)
        return { projectRoot: root === allowedRoot ? allowedRoot : undefined, captured: false }
      }
      if (!input.turn_id) throw new Error('This Codex hook version does not supply turn_id; capture was skipped')
      const turnId = input.turn_id
      const last = trace.records.at(-1)
      const active = last && last.type !== 'end' && last.type !== 'discard' && last.turnId === turnId
      const add = (type: Record['type'], key: string, kind?: Record['kind'], text?: string) => {
        trace.records.push({ seq: trace.records.length, time: new Date().toISOString(), turnId, type, key, ...(kind ? { kind } : {}), ...(text !== undefined ? { text: redactSecrets(text) } : {}) })
      }
      let scoped = root === allowedRoot && allowedRoot !== undefined
      if (input.hook_event_name === 'PostToolUse' && input.tool_input && typeof input.tool_input === 'object') {
        const args = input.tool_input as { cwd?: unknown; workdir?: unknown }
        for (const workdir of [args.cwd, args.workdir]) if (typeof workdir === 'string') {
          const directory = isAbsolute(workdir) ? workdir : resolve(input.cwd, workdir)
          if (await projectForDirectory(this.config, directory) !== allowedRoot) scoped = false
        }
      }
      if (!scoped || input.hook_event_name === 'Interrupt') {
        if (active) add('discard', `discard:${turnId}`)
        await atomicJson(path, trace)
        return { captured: false }
      }
      if (input.hook_event_name === 'PostToolUse' && ownTool(input.tool_name ?? '')) return { projectRoot: allowedRoot, captured: false }

      const key = hash(JSON.stringify([input.hook_event_name, turnId, input.tool_use_id, input.prompt, input.last_assistant_message]))
      if (trace.records.some(record => record.key === key)) return { projectRoot: allowedRoot, captured: false }
      let additions: Array<{ kind: EvidenceEvent['kind']; text: string }> = []
      try {
        if (input.hook_event_name === 'UserPromptSubmit') {
          if (typeof input.prompt !== 'string') throw new Error('UserPromptSubmit is missing prompt')
          const repeated = trace.records.some(record => record.turnId === turnId && record.type === 'begin')
          // Stop continuations can create synthetic user prompts for the same turn.
          additions = [{ kind: repeated ? 'assistant' : 'user', text: input.prompt }]
        } else if (input.hook_event_name === 'PostToolUse' && active) {
          if (!input.tool_name || !input.tool_use_id) throw new Error('PostToolUse is missing tool identity')
          additions = [{ kind: 'assistant', text: `Tool call: ${input.tool_name}\n${visibleText(input.tool_input)}` },
            { kind: 'tool', text: `Tool result: ${input.tool_name}\n${visibleText(input.tool_response)}` }]
        } else if (input.hook_event_name === 'Stop' && active) {
          additions = input.last_assistant_message ? [{ kind: 'assistant', text: input.last_assistant_message }] : []
        } else return { projectRoot: allowedRoot, captured: false }
        if (additions.reduce((sum, item) => sum + item.text.length, 0) > this.config.maxCaptureChars) throw new Error('Hook content exceeds maxCaptureChars')
      } catch {
        // Persist the exclusion, so a later Stop cannot publish an incomplete turn.
        if (active) add('discard', key)
        trace.warning = 'A turn was excluded because a hook was malformed or exceeded capture limits.'
        await atomicJson(path, trace)
        return { projectRoot: allowedRoot, captured: false, warning: trace.warning }
      }
      if (input.hook_event_name === 'UserPromptSubmit' && !active) add('begin', key)
      for (let i = 0; i < additions.length; i++) add('evidence', `${key}:${i}`, additions[i].kind, additions[i].text)
      if (input.hook_event_name === 'Stop') add('end', key)
      // Tool identity is the deduplication key, independent of the text it returned.
      if ((input.hook_event_name === 'PostToolUse' || (input.hook_event_name === 'UserPromptSubmit' && active)) && additions.length) trace.records[trace.records.length - 1].key = key
      await atomicJson(path, trace)
      return { projectRoot: allowedRoot, captured: true }
    } finally { await release() }
  }

  async collect(projectRoot: string, cursors: Readonly<{ [key: string]: number }>, maxChars: number, signal?: AbortSignal) {
    let names: string[]
    try { names = await readdir(this.directory) } catch (error) { if (!missing(error)) throw error; names = [] }
    const traces: Trace[] = []
    for (const name of names.sort()) {
      signal?.throwIfAborted()
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const trace = await this.read(join(this.directory, name))
      if (hash(trace.sessionId) + '.json' !== name) throw new Error('Trace filename does not match its session')
      if (trace.projectRoot === projectRoot) traces.push(trace)
    }
    for (const sessionId of Object.keys(cursors)) {
      if (sessionId.startsWith('codex:') && !traces.some(t => traceId(t.sessionId) === sessionId)) throw new CoreError('INVALID_BATCH', 'A previously processed trace is missing; restore matching trace data before consolidating')
    }
    traces.sort((a, b) => (a.records[0]?.time ?? '').localeCompare(b.records[0]?.time ?? '') || a.sessionId.localeCompare(b.sessionId))
    const batches: TranscriptBatch[] = []
    let deferred = false
    for (const trace of traces) {
      signal?.throwIfAborted()
      const sessionId = traceId(trace.sessionId)
      const cursor = Object.hasOwn(cursors, sessionId) ? cursors[sessionId] : -1
      if (cursor >= trace.records.length || (cursor >= 0 && !['end', 'discard'].includes(trace.records[cursor].type))) throw new CoreError('INVALID_BATCH', 'Trace cursor does not end at a complete captured segment')
      let pending: EvidenceEvent[] | undefined
      let batch: TranscriptBatch | undefined
      for (const record of trace.records) {
        if (record.seq <= cursor) continue
        if (record.type === 'begin') pending = []
        if (record.type === 'evidence' && pending && record.kind && record.text?.trim()) {
          pending.push({ sessionId, seq: record.seq, time: record.time, kind: record.kind, text: record.text })
        }
        if (record.type !== 'end' && record.type !== 'discard') continue
        const next = { sessionId, throughSeq: record.seq, events: [...(batch?.events ?? []), ...(record.type === 'end' ? pending ?? [] : [])] }
        pending = undefined
        const selected = [...batches, next]
        if (selected.length > this.config.maxSessionsPerRun || JSON.stringify(selected).length > maxChars ||
          selected.reduce((sum, b) => sum + b.events.length, 0) > this.config.maxEventsPerRun) {
          if (batch) batches.push(batch)
          if (!batches.length) throw new CoreError('INPUT_LIMIT', 'One complete captured segment exceeds the input budget; increase limits and retry')
          deferred = true
          break
        }
        batch = next
      }
      if (deferred) break
      if (batch) batches.push(batch)
    }
    return { batches, deferred, sessionsRead: traces.length, eventsSelected: batches.reduce((sum, b) => sum + b.events.length, 0),
      warnings: traces.flatMap(t => t.warning ? [{ sessionId: traceId(t.sessionId), warning: t.warning }] : []) }
  }
}
