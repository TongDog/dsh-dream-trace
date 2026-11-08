import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { TranscriptBatch } from './core/types.ts';
/** Query-only dependencies keep collection independent from a live Agent. */
export type TranscriptQuery = Pick<SessionQueryEngine, 'listSessions' | 'readSession'>;
/** Limits apply to complete selected turns, never to silently truncated text. */
export interface TranscriptOptions {
    projectRoot: string;
    cursors: Readonly<Record<string, number>>;
    maxSessions: number;
    maxChars: number;
    maxEvents: number;
}
/** Accounting describes evidence selection, including intentional scope exclusions. */
export interface TranscriptCollection {
    batches: TranscriptBatch[];
    sessionsRead: number;
    eventsSelected: number;
    charsSelected: number;
    skippedCrossProjectTurns: number;
    skippedSyntheticTurns: number;
    deferred: boolean;
}
/** A complete turn must fit before any of its event positions can be committed. */
export declare class TranscriptError extends Error {
    readonly code: 'BUDGET_EXCEEDED' | 'INVALID_CURSOR';
    constructor(code: 'BUDGET_EXCEEDED' | 'INVALID_CURSOR', message: string);
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
export declare function collectTranscripts(query: TranscriptQuery, options: TranscriptOptions, signal?: AbortSignal): Promise<TranscriptCollection>;
