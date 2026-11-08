/** Project-scoped evidence from complete, non-inherited dsh conversation turns. */
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { redactSecrets } from "./core/security.js";
/** A complete turn must fit before any of its event positions can be committed. */
export class TranscriptError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TranscriptError';
    }
}
const ownTools = new Set(['dream_run', 'dream_status', 'dream_rollback', 'memory_search', 'memory_read', 'memory_forget']);
function textBlocks(blocks) {
    return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
}
function inside(root, path) {
    const rel = relative(root, path);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
/**
 * Select oldest unprocessed complete turns from sessions created in one project.
 * Sessions created elsewhere are never opened, even if they later changed directory.
 * Within an eligible session, any turn that enters another project is excluded whole.
 * @param query Official dsh query service (raw event snapshots, not compacted summaries).
 * @param options Canonical local project, committed cursors, and evidence budgets.
 * @param signal Cancellation before or after each query or filesystem operation.
 * @returns One complete-prefix batch per selected session and selection accounting.
 * @throws TranscriptError when a single pending turn cannot fit or a cursor splits a turn.
 */
export async function collectTranscripts(query, options, signal) {
    signal?.throwIfAborted();
    const root = await realpath(options.projectRoot);
    signal?.throwIfAborted();
    const scopedPaths = new Map();
    const inProject = async (cwd) => {
        if (cwd === undefined || !isAbsolute(cwd))
            return false;
        const cached = scopedPaths.get(cwd);
        if (cached !== undefined)
            return cached;
        let resolved;
        try {
            resolved = await realpath(cwd);
        }
        catch (error) {
            // Removed directories cannot safely be mapped into a current project.
            if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
                scopedPaths.set(cwd, false);
                return false;
            }
            throw error;
        }
        signal?.throwIfAborted();
        const result = inside(root, resolved);
        scopedPaths.set(cwd, result);
        return result;
    };
    const result = {
        batches: [], sessionsRead: 0, eventsSelected: 0, charsSelected: 2,
        skippedCrossProjectTurns: 0, skippedSyntheticTurns: 0, deferred: false,
    };
    const records = await query.listSessions(signal);
    records.sort((a, b) => a.header.createdAt - b.header.createdAt || a.header.id.localeCompare(b.header.id));
    for (const record of records) {
        signal?.throwIfAborted();
        const header = record.header;
        if (header.origin === 'subagent' || header.agentPreset === 'dreaming-worker')
            continue;
        if (!await inProject(header.cwd))
            continue;
        const snapshot = await query.readSession(header.id);
        signal?.throwIfAborted();
        result.sessionsRead++;
        // Re-check the atomic snapshot; list results are not an authorization lease.
        if (snapshot.session.origin === 'subagent' || snapshot.session.agentPreset === 'dreaming-worker' || !await inProject(snapshot.session.cwd))
            continue;
        const cursor = Object.hasOwn(options.cursors, header.id) ? options.cursors[header.id] : -1;
        if (cursor >= snapshot.events.length) {
            throw new TranscriptError('INVALID_CURSOR', `Memory cursor for ${header.id} is beyond its current log; restore matching memory or reset this project's memory.`);
        }
        const inherited = snapshot.inheritedEventCount;
        let allowed = true;
        let pending;
        let batch;
        const toolNames = new Map();
        for (const event of snapshot.events) {
            signal?.throwIfAborted();
            if (event.type === 'working-directory/change') {
                allowed = await inProject(event.data.cwd);
                if (pending !== undefined && !allowed)
                    pending.foreign = true;
            }
            if (event.type === 'tool/call')
                toolNames.set(event.data.callId, event.data.name);
            if (event.type === 'turn/start')
                pending = { start: event.seq, foreign: !allowed, events: [] };
            if (pending === undefined)
                continue;
            if (event.seq >= inherited && event.seq > cursor) {
                const evidence = eventEvidence(event, header.id, toolNames);
                if (evidence !== undefined)
                    pending.events.push(evidence);
            }
            if (event.type !== 'turn/end')
                continue;
            const turn = pending;
            pending = undefined;
            if (event.seq <= cursor || turn.start < inherited)
                continue;
            if (event.data.reason.kind === 'interrupted' || event.data.reason.kind === 'forked') {
                result.skippedSyntheticTurns++;
                continue;
            }
            if (cursor >= turn.start) {
                throw new TranscriptError('INVALID_CURSOR', `Memory cursor for ${header.id} splits a turn; restore a complete-prefix revision.`);
            }
            if (turn.foreign)
                result.skippedCrossProjectTurns++;
            const additions = turn.foreign ? [] : turn.events;
            const next = {
                sessionId: header.id,
                throughSeq: event.seq,
                events: [...(batch?.events ?? []), ...additions],
            };
            const selected = [...result.batches, next];
            const chars = JSON.stringify(selected).length;
            const eventCount = result.eventsSelected + next.events.length;
            if (chars > options.maxChars || eventCount > options.maxEvents || selected.length > options.maxSessions) {
                if (batch !== undefined)
                    result.batches.push(batch);
                if (result.batches.length === 0) {
                    throw new TranscriptError('BUDGET_EXCEEDED', `Completed turn ending at ${header.id}:${event.seq} exceeds the evidence budget. Increase maxInputChars or maxEventsPerRun; no text or cursor was discarded.`);
                }
                result.deferred = true;
                return accounting(result);
            }
            batch = next;
        }
        if (batch !== undefined) {
            result.batches.push(batch);
            result.eventsSelected += batch.events.length;
        }
    }
    return accounting(result);
}
function accounting(result) {
    result.eventsSelected = result.batches.reduce((sum, batch) => sum + batch.events.length, 0);
    result.charsSelected = JSON.stringify(result.batches).length;
    return result;
}
function eventEvidence(event, sessionId, toolNames) {
    let kind;
    let text;
    switch (event.type) {
        case 'user/message':
            // All injected contexts, recalled sessions, schedules, and memory are excluded.
            if (event.data.source.kind !== 'user' || event.sourceEventSeqs !== undefined || event.surfaceOp !== 'append')
                return;
            kind = 'user';
            text = textBlocks(event.data.content);
            break;
        case 'assistant/message':
            if (event.data.interrupted)
                return;
            kind = 'assistant';
            text = textBlocks(event.data.message.content);
            break;
        case 'tool/call':
            if (ownTools.has(event.data.name))
                return;
            kind = 'assistant';
            text = `Tool call: ${event.data.name}\nArguments: ${event.data.arguments}`;
            break;
        case 'tool/result': {
            const name = toolNames.get(event.data.message.toolCallId);
            if (name === undefined || ownTools.has(name))
                return;
            kind = 'tool';
            text = `Tool result: ${name}; isError=${event.data.message.isError === true}\n${textBlocks(event.data.message.content)}`;
            break;
        }
        default:
            // The event vocabulary is merge-extensible. Only explicit visible sources qualify.
            return;
    }
    if (text.trim().length === 0)
        return;
    return { sessionId, seq: event.seq, time: new Date(event.time).toISOString(), kind, text: redactSecrets(text) };
}
//# sourceMappingURL=transcripts.js.map