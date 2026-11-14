/** Shared, browser-safe contracts for the existing Harness Remote carrier. */
import { z } from 'zod'
import type { RemoteResult, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { levelSchema, visibleFactSchema, wikiPageSchema } from './core/types.ts'

const count = z.number().int().nonnegative().safe()
const root = z.string().min(1).max(4096)
const id = z.string().min(1).max(256)
export const projectRequest = z.object({ projectRoot: root }).strict()
export const searchRequest = projectRequest.extend({ query: z.string().max(12000), limit: z.number().int().positive().safe().optional() }).strict()
export const factRequest = projectRequest.extend({ id }).strict()
export const visibilityRequest = factRequest.extend({ visible: z.boolean(), expectedRevision: count }).strict()
export const levelRequest = factRequest.extend({ level: levelSchema, expectedRevision: count.optional() }).strict()
export const rollbackRequest = projectRequest.extend({ revision: count }).strict()
export const updateCheckRequest = z.object({ force: z.boolean().default(false) }).strict()
const revisionResult = z.object({ revision: count }).strict()
const updateStatusResult = z.object({
  currentVersion: z.string().min(1).max(64), latestVersion: z.string().min(1).max(64).nullable(),
  updateAvailable: z.boolean(), checkedAt: z.iso.datetime(), projectUrl: z.string().min(1).max(2048),
  error: z.string().min(1).max(2000).nullable(),
}).strict()
const statusResult = z.object({
  projectRoot: root, storageDirectory: z.string(), revision: count, facts: count, running: z.boolean(),
  lastRun: z.object({ at: z.iso.datetime(), error: z.string().nullable() }).strict().nullable(),
  revisions: z.array(z.object({ revision: count, createdAt: z.iso.datetime(), facts: count }).strict()),
  autoRunAfterTurn: z.boolean(), autoRunIntervalMinutes: count,
}).strict()
const snapshotResult = statusResult.extend({ wiki: z.array(wikiPageSchema).default([]), memories: z.array(visibleFactSchema), hiddenMemoryIds: z.array(id).default([]) }).strict()
const runResult = z.object({
  revision: count, processedSessions: count, created: count, updated: count, retired: count,
  unchanged: z.boolean(), sessionsRead: count, eventsSelected: count, deferred: z.boolean(),
}).strict()

export type ProjectRequest = z.infer<typeof projectRequest>
export type SearchRequest = z.infer<typeof searchRequest>
export type FactRequest = z.infer<typeof factRequest>
export type VisibilityRequest = z.infer<typeof visibilityRequest>
export type LevelRequest = z.infer<typeof levelRequest>
export type RollbackRequest = z.infer<typeof rollbackRequest>
export type UpdateCheckRequest = z.infer<typeof updateCheckRequest>
export type MemorySnapshot = z.infer<typeof snapshotResult>
export type MemoryStatus = z.infer<typeof statusResult>
export type DreamingRunResult = z.infer<typeof runResult>
export type UpdateStatus = z.infer<typeof updateStatusResult>

export interface DreamingUiRemote {
  projects(signal?: AbortSignal): Promise<RemoteResult<string[]>>
  checkUpdate(request: UpdateCheckRequest, signal?: AbortSignal): Promise<RemoteResult<UpdateStatus>>
  snapshot(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<MemorySnapshot>>
  status(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<MemoryStatus>>
  search(request: SearchRequest, signal?: AbortSignal): Promise<RemoteResult<z.infer<typeof visibleFactSchema>[]>>
  read(request: FactRequest, signal?: AbortSignal): Promise<RemoteResult<z.infer<typeof visibleFactSchema>>>
  organizeWiki(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<{ revision: number }>>
  run(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<DreamingRunResult>>
  setVisibility(request: VisibilityRequest, signal?: AbortSignal): Promise<RemoteResult<{ revision: number }>>
  setLevel(request: LevelRequest, signal?: AbortSignal): Promise<RemoteResult<{ revision: number }>>
  forget(request: FactRequest, signal?: AbortSignal): Promise<RemoteResult<{ revision: number }>>
  rollback(request: RollbackRequest, signal?: AbortSignal): Promise<RemoteResult<{ revision: number }>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { dreamingUi: DreamingUiRemote }
  interface RemoteErrorDetailsMap {
    'dreaming/forbidden': {}
    'dreaming/project-not-enabled': {}
    'dreaming/operation-failed': { readonly code?: string }
  }
}

function codec(name: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol: `dsh-plugin-dreaming/ui#${name}`, create: () => schema }
}

const definitions = {
  projects: { result: z.array(root) },
  checkUpdate: { request: updateCheckRequest, result: updateStatusResult },
  snapshot: { request: projectRequest, result: snapshotResult },
  status: { request: projectRequest, result: statusResult },
  search: { request: searchRequest, result: z.array(visibleFactSchema) },
  read: { request: factRequest, result: visibleFactSchema },
  organizeWiki: { request: projectRequest, result: revisionResult },
  run: { request: projectRequest, result: runResult },
  setVisibility: { request: visibilityRequest, result: revisionResult },
  setLevel: { request: levelRequest, result: revisionResult },
  forget: { request: factRequest, result: revisionResult },
  rollback: { request: rollbackRequest, result: revisionResult },
} satisfies Record<string, { request?: z.ZodType; result: z.ZodType }>

/** Mount on the Client and register on the Host; contains live parser functions. */
export const dreamingRemoteContribution: TypertRemoteContribution = {
  package: 'dsh-plugin-dreaming',
  descriptors: Object.entries(definitions).map(([method, definition]) => ({
    id: `dsh-plugin-dreaming#dreamingUi/${method}`, service: 'dreamingUi', namespace: 'dreamingUi', method,
    invocation: { kind: 'direct' },
    parameters: 'request' in definition ? [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, definition.request) }] : [],
    cancellation: { parameter: 'signal' }, result: codec(`${method}Result`, definition.result),
  })),
}

/** Alias for the browser build; bundle this module, never JSON.stringify it. */
export const dreamingClientContribution = dreamingRemoteContribution
