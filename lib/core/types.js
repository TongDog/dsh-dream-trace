/** Persisted memory and the model-output parser. */
import { z } from 'zod';
/** Structured failures; COMMIT_UNKNOWN requires re-reading current state before retrying. */
export class CoreError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        this.name = 'DreamingError';
    }
}
const id = z.string().min(1).max(256);
export const citationSchema = z.object({ sessionId: id, seq: z.number().int().nonnegative(), quote: z.string().min(1).max(2000) }).strict();
const category = z.enum(['procedure', 'decision', 'preference', 'fact', 'pitfall']);
export const updateSchema = z.object({
    id: id.optional(), title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(12000),
    category, status: z.enum(['supported', 'uncertain']), evidence: z.array(citationSchema).min(1).max(12),
}).strict();
/** Only this data format can change memory; model output is never executable. */
export const proposalSchema = z.object({
    updates: z.array(updateSchema).max(100),
    // Models may omit a no-op retirement list; absence never retires existing notes.
    retire: z.array(z.object({ id, reason: z.string().trim().min(1).max(1000), evidence: z.array(citationSchema).min(1).max(12) }).strict()).max(100).default([]),
}).strict();
/** Source metadata is supplied by the host, never by model output. */
export const storedCitationSchema = citationSchema.extend({ observedAt: z.iso.datetime(), kind: z.enum(['user', 'assistant', 'tool']) });
export const factSchema = z.object({
    id, title: z.string().min(1).max(160), content: z.string().min(1).max(12000), category,
    status: z.enum(['supported', 'uncertain', 'stale']), sources: z.array(storedCitationSchema).min(1).max(12),
    createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), retiredReason: z.string().max(1000).optional(),
}).strict();
const cursorNumber = z.number().int().nonnegative();
// Zod's generic record parser omits __proto__; session IDs are opaque strings.
const cursorSchema = z.unknown().transform((value, context) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        context.addIssue({ code: 'custom', message: 'Expected a session cursor map' });
        return z.NEVER;
    }
    const result = {};
    for (const key of Object.keys(value)) {
        const parsed = cursorNumber.safeParse(Reflect.get(value, key));
        if (!parsed.success) {
            context.addIssue({ code: 'custom', message: 'Expected a nonnegative integer cursor', path: [key] });
            return z.NEVER;
        }
        Object.defineProperty(result, key, { value: parsed.data, enumerable: true, writable: true, configurable: true });
    }
    return result;
});
export const stateSchema = z.object({
    schemaVersion: z.literal(1), projectId: id, revision: z.number().int().nonnegative(),
    parentRevision: z.number().int().nonnegative().nullable(), parentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), createdAt: z.iso.datetime(),
    facts: z.array(factSchema), cursors: cursorSchema,
}).strict();
//# sourceMappingURL=types.js.map