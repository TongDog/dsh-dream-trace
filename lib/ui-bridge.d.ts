/** Owner-only visual memory operations over Harness's existing typed Remote API. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { DreamingService } from './index.ts';
import { type FactRequest, type LevelRequest, type ProjectRequest, type RollbackRequest, type SearchRequest, type UpdateCheckRequest, type VisibilityRequest } from './ui-protocol.ts';
export type DreamingUiOperations = Pick<DreamingService, 'organizeWiki' | 'listProjects' | 'snapshot' | 'status' | 'search' | 'read' | 'run' | 'setLevel' | 'setVisibility' | 'forget' | 'rollback' | 'checkUpdate'>;
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
    checkUpdate(request: UpdateCheckRequest, signal: AbortSignal): Promise<{
        currentVersion: string;
        latestVersion: string | null;
        updateAvailable: boolean;
        checkedAt: string;
        projectUrl: string;
        error: string | null;
    }>;
    snapshot(request: ProjectRequest, signal: AbortSignal): Promise<{
        wiki: {
            links: string[];
            sourceIds: string[];
            id: string;
            title: string;
        }[];
        memories: import("./core/types.ts").VisibleFact[];
        hiddenMemoryIds: string[];
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
    search(request: SearchRequest, signal: AbortSignal): Promise<import("./core/types.ts").VisibleFact[]>;
    read(request: FactRequest, signal: AbortSignal): Promise<import("./core/types.ts").VisibleFact>;
    organizeWiki(request: ProjectRequest, signal: AbortSignal): Promise<{
        revision: number;
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
    setVisibility(request: VisibilityRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    setLevel(request: LevelRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    forget(request: FactRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    rollback(request: RollbackRequest, signal: AbortSignal): Promise<{
        revision: number;
    }>;
    private owner;
    private scoped;
    /** Owner-guarded call for operations that are not scoped to one project. */
    private guarded;
    private execute;
}
