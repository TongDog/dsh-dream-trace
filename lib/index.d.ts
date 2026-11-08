import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ConfigInput, type DreamingConfig } from './config.ts';
export { Config } from './config.ts';
export type { DreamingConfig, ConfigInput } from './config.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        dreaming: DreamingService;
    }
}
export interface LastRun {
    at: string;
    error: string | null;
}
/** Owns memory operations, model sessions, context contribution, and timers. */
export declare class DreamingService extends Service {
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        projectRoots: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
        storageDirectory: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        autoRunIntervalMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoRunAfterTurn: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        afterTurnDelaySeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSessionsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxEventsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxProposalChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFacts: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFactChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFactsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxIndexChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        runTimeoutSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        searchLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        verify: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        projectRoots: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
        storageDirectory: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        provider: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        autoRunIntervalMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoRunAfterTurn: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        afterTurnDelaySeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxSessionsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxEventsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxProposalChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFacts: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFactChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxFactsPerRun: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxIndexChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        runTimeoutSeconds: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        searchLimit: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        verify: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    readonly config: DreamingConfig;
    private readonly projects;
    private readonly agentProjects;
    private readonly lifecycle;
    private readonly operations;
    private readonly lastRuns;
    private readonly delays;
    constructor(ctx: Context, config: ConfigInput);
    protected [Service.init](): Promise<void>;
    /** Resolve only the caller's current, explicitly enabled local project. */
    projectForAgent(agent: Agent | undefined): Promise<string>;
    /** Consolidate one bounded batch; concurrent runs for a project are rejected. */
    run(projectRoot: string, signal?: AbortSignal): Promise<{
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
    /** Current revision, recent failures and available rollback targets. */
    status(projectRoot: string): Promise<{
        projectRoot: string;
        storageDirectory: string;
        revision: number;
        facts: number;
        running: boolean;
        lastRun: LastRun | null;
        revisions: {
            revision: number;
            createdAt: string;
            facts: number;
        }[];
        autoRunAfterTurn: boolean;
        autoRunIntervalMinutes: number;
    }>;
    /** Canonical allowlisted roots exposed to the local management UI. */
    listProjects(): string[];
    /** A consistent current revision and its bounded notes, including retired notes. */
    snapshot(projectRoot: string): Promise<{
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
        lastRun: LastRun | null;
        revisions: {
            revision: number;
            createdAt: string;
            facts: number;
        }[];
        autoRunAfterTurn: boolean;
        autoRunIntervalMinutes: number;
    }>;
    private describe;
    /** Search current supported and uncertain observations within one project. */
    search(projectRoot: string, query: string, limit?: number): Promise<{
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
    /** Read a fact with exact source citations, including stale records. */
    read(projectRoot: string, id: string): Promise<{
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
    /** Restore a previous revision as a new revision, preserving the audit trail. */
    rollback(projectRoot: string, revision: number, signal?: AbortSignal): Promise<{
        revision: number;
    }>;
    /** Remove a fact from current memory; revision history remains available. */
    forget(projectRoot: string, id: string, signal?: AbortSignal): Promise<{
        revision: number;
    }>;
    private project;
    private projectForDirectory;
    private isWorker;
    private exclusive;
    private autoRun;
}
export default DreamingService;
