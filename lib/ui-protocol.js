/** Shared, browser-safe contracts for the existing Harness Remote carrier. */
import { z } from 'zod';
import { factSchema } from "./core/types.js";
const count = z.number().int().nonnegative().safe();
const root = z.string().min(1).max(4096);
const id = z.string().min(1).max(256);
export const projectRequest = z.object({ projectRoot: root }).strict();
export const searchRequest = projectRequest.extend({ query: z.string().max(12000), limit: z.number().int().positive().safe().optional() }).strict();
export const factRequest = projectRequest.extend({ id }).strict();
export const rollbackRequest = projectRequest.extend({ revision: count }).strict();
const revisionResult = z.object({ revision: count }).strict();
const statusResult = z.object({
    projectRoot: root, storageDirectory: z.string(), revision: count, facts: count, running: z.boolean(),
    lastRun: z.object({ at: z.iso.datetime(), error: z.string().nullable() }).strict().nullable(),
    revisions: z.array(z.object({ revision: count, createdAt: z.iso.datetime(), facts: count }).strict()),
    autoRunAfterTurn: z.boolean(), autoRunIntervalMinutes: count,
}).strict();
const snapshotResult = statusResult.extend({ memories: z.array(factSchema) }).strict();
const runResult = z.object({
    revision: count, processedSessions: count, created: count, updated: count, retired: count,
    unchanged: z.boolean(), sessionsRead: count, eventsSelected: count, deferred: z.boolean(),
}).strict();
function codec(name, schema) {
    return { mode: 'strict', typeSymbol: `dsh-plugin-dreaming/ui#${name}`, create: () => schema };
}
const definitions = {
    projects: { result: z.array(root) },
    snapshot: { request: projectRequest, result: snapshotResult },
    status: { request: projectRequest, result: statusResult },
    search: { request: searchRequest, result: z.array(factSchema) },
    read: { request: factRequest, result: factSchema },
    run: { request: projectRequest, result: runResult },
    forget: { request: factRequest, result: revisionResult },
    rollback: { request: rollbackRequest, result: revisionResult },
};
/** Mount on the Client and register on the Host; contains live parser functions. */
export const dreamingRemoteContribution = {
    package: 'dsh-plugin-dreaming',
    descriptors: Object.entries(definitions).map(([method, definition]) => ({
        id: `dsh-plugin-dreaming#dreamingUi/${method}`, service: 'dreamingUi', namespace: 'dreamingUi', method,
        invocation: { kind: 'direct' },
        parameters: 'request' in definition ? [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, definition.request) }] : [],
        cancellation: { parameter: 'signal' }, result: codec(`${method}Result`, definition.result),
    })),
};
/** Alias for the browser build; bundle this module, never JSON.stringify it. */
export const dreamingClientContribution = dreamingRemoteContribution;
//# sourceMappingURL=ui-protocol.js.map