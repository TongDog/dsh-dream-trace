/** Persisted memory and the model-output parser. */
import { z } from 'zod'

/** Structured failures; COMMIT_UNKNOWN requires re-reading current state before retrying. */
export class CoreError extends Error {
  constructor(public readonly code: 'BUSY' | 'CORRUPT_STORE' | 'INVALID_PROPOSAL' | 'UNSUPPORTED_EVIDENCE' | 'SECRET_DETECTED' | 'INPUT_LIMIT' | 'MEMORY_LIMIT' | 'REVIEW_REJECTED' | 'NOT_FOUND' | 'INVALID_BATCH' | 'COMMIT_UNKNOWN', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DreamingError'
  }
}

const id = z.string().min(1).max(256)
export const citationSchema = z.object({ sessionId: id, seq: z.number().int().nonnegative(), quote: z.string().min(1).max(2000) }).strict()
export const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
export type MemoryLevel = z.infer<typeof levelSchema>
const projectLevel = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
const category = z.enum(['procedure', 'decision', 'preference', 'fact', 'pitfall'])
export const updateSchema = z.object({
  id: id.optional(), title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(12000),
  category, level: projectLevel.optional(), status: z.enum(['supported', 'uncertain']), evidence: z.array(citationSchema).min(1).max(12),
}).strict()
/** Only this data format can change memory; model output is never executable. */
export const proposalSchema = z.object({
  updates: z.array(updateSchema).max(100),
  // Models may omit a no-op retirement list; absence never retires existing notes.
  retire: z.array(z.object({ id, reason: z.string().trim().min(1).max(1000), evidence: z.array(citationSchema).min(1).max(12) }).strict()).max(100).default([]),
}).strict()
export type Proposal = z.infer<typeof proposalSchema>
export type Citation = z.infer<typeof citationSchema>
/** Source metadata is supplied by the host, never by model output. */
export const storedCitationSchema = citationSchema.extend({ observedAt: z.iso.datetime(), kind: z.enum(['user', 'assistant', 'tool']) })
export type StoredCitation = z.infer<typeof storedCitationSchema>
export const factSchema = z.object({
  id, title: z.string().min(1).max(160), content: z.string().min(1).max(12000), category,
  level: levelSchema.default(4), status: z.enum(['supported', 'uncertain', 'stale']), sources: z.array(storedCitationSchema).min(1).max(12),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), retiredReason: z.string().max(1000).optional(),
}).strict()
export type MemoryFact = z.infer<typeof factSchema>
// Projections shared with other projects never include source excerpts or session identifiers.
export const visibleFactSchema = z.union([factSchema, factSchema.extend({
  level: z.literal(1), status: z.literal('supported'), inherited: z.literal(true), sources: z.tuple([]),
})])
export type VisibleFact = MemoryFact & { inherited?: true }
/** Visibility is an owner preference. Missing preferences in older revisions mean visible. */
export function agentFacts<T extends { id: string }>(state: { facts: T[]; hiddenMemoryIds?: string[] }): T[] {
  if (!state.hiddenMemoryIds?.length) return state.facts
  const hidden = new Set(state.hiddenMemoryIds)
  return state.facts.filter(fact => !hidden.has(fact.id))
}

const cursorNumber = z.number().int().nonnegative()
// Zod's generic record parser omits __proto__; session IDs are opaque strings.
const cursorSchema = z.unknown().transform((value, context): Record<string, number> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    context.addIssue({ code: 'custom', message: 'Expected a session cursor map' })
    return z.NEVER
  }
  const result: Record<string, number> = {}
  for (const key of Object.keys(value)) {
    const parsed = cursorNumber.safeParse(Reflect.get(value, key))
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'Expected a nonnegative integer cursor', path: [key] })
      return z.NEVER
    }
    Object.defineProperty(result, key, { value: parsed.data, enumerable: true, writable: true, configurable: true })
  }
  return result
})
export const stateSchema = z.object({
  schemaVersion: z.literal(1), projectId: id, revision: z.number().int().nonnegative(),
  parentRevision: z.number().int().nonnegative().nullable(), parentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), createdAt: z.iso.datetime(),
  facts: z.array(factSchema), cursors: cursorSchema, hiddenMemoryIds: z.array(id).optional(),
}).strict()
export type MemoryState = z.infer<typeof stateSchema>
/** An observable event; private model reasoning must never be supplied. */
export interface EvidenceEvent { sessionId: string; seq: number; time: string; kind: 'user' | 'assistant' | 'tool'; text: string }
/** throughSeq is the immutable end of a completed prefix, including non-text events. */
export interface TranscriptBatch { sessionId: string; throughSeq: number; events: EvidenceEvent[] }
/** Every deployment-varying limit is supplied by the plugin configuration. */
export interface EngineConfig { maxInputChars: number; maxProposalChars: number; maxFacts: number; maxFactChars: number; maxFactsPerRun: number; verify: boolean }
/** The host owns route selection, usage accounting, cancellation and request logging. */
export type Generate = (system: string, payload: string, signal?: AbortSignal) => Promise<string>
export interface RunResult { revision: number; processedSessions: number; created: number; updated: number; retired: number; unchanged: boolean }
