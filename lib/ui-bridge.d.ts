/** Owner-only visual memory operations over Harness's existing typed Remote API. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { DreamingService } from './index.ts';
import { type FactRequest, type ProjectRequest, type RollbackRequest, type SearchRequest } from './ui-protocol.ts';
export type DreamingUiOperations = Pick<DreamingService, 'listProjects' | 'snapshot' | 'status' | 'search' | 'read' | 'run' | 'forget' | 'rollback'>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dreamingUi: DreamingUiBridge;
    }
}
/** Optional dependency keeps terminal/headless profiles usable without the Gateway. */
export declare function registerUiBridge(ctx: Context, operations: DreamingUiOperations): void;
/** All writes delegate to the same service methods used by the model tools. */
export declare class DreamingUiBridge extends TypertRemoteService {
    private readonly operations;
    constructor(ctx: Context, operations: DreamingUiOperations);
    projects(signal: AbortSignal): string[];
    snapshot(request: ProjectRequest, signal: AbortSignal): Promise<{
        memories: {
            id: string;
            title: string;
            content: string;
            category: "procedure" | "decision" | "preference" | "fact" | "pitfall";
            status: "supported" | "uncertain" | "stale";
            sources: {
                sessionId: string;
                seq: number;
                quote: string;
                observedAt: string;
                kind: "user" | "assistant" | "tool";
            }[];
            createdAt: string;
            updatedAt: string;
            retiredReason?: string | undefined;
        }[];
        projectRoot: string;
        storageDirectory: string;
        revision: number;
        facts: number;
        running: boolean;
        lastRun: import("./index.ts").LastRun | null;
        revisions: {
            revision: number;
            createdAt: string;
            facts: number;
        }[];
        autoRunAfterTurn: boolean;
        autoRunIntervalMinutes: number;
    }>;
    status(request: ProjectRequest, signal: AbortSignal): Promise<{
        projectRoot: string;
        storageDirectory: string;
        revision: number;
        facts: number;
        running: boolean;
        lastRun: import("./index.ts").LastRun | null;
        revisions: {
            revision: number;
            createdAt: string;
            facts: number;
        }[];
        autoRunAfterTurn: boolean;
        autoRunIntervalMinutes: number;
    }>;
    search(request: SearchRequest, signal: AbortSignal): Promise<{
        id: string;
        title: string;
        content: string;
        category: "procedure" | "decision" | "preference" | "fact" | "pitfall";
        status: "supported" | "uncertain" | "stale";
        sources: {
            sessionId: string;
            seq: number;
            quote: string;
            observedAt: string;
            kind: "user" | "assistant" | "tool";
        }[];
        createdAt: string;
        updatedAt: string;
        retiredReason?: string | undefined;
    }[]>;
    read(request: FactRequest, signal: AbortSignal): Promise<{
        id: string;
        title: string;
        content: string;
        category: "procedure" | "decision" | "preference" | "fact" | "pitfall";
        status: "supported" | "uncertain" | "stale";
        sources: {
            sessionId: string;
            seq: number;
            quote: string;
            observedAt: string;
            kind: "user" | "assistant" | "tool";
        }[];
        createdAt: string;
        updatedAt: string;
        retiredReason?: string | undefined;
    }>;
    run(request: ProjectRequest, signal: AbortSignal): Promise<{
        sessionsRead: number;
        eventsSelected: number;
        deferred: boolean;
        revision: number;
        processedSessions: number;
        created: number;
        updated: number;
        retired: number;
        unchanged: boolean;
    }>;
    forget(request: FactRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    rollback(request: RollbackRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    private owner;
    private scoped;
}
