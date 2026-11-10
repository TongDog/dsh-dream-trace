/** Shared, browser-safe contracts for the existing Harness Remote carrier. */
import { z } from 'zod';
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { visibleFactSchema } from './core/types.ts';
export declare const projectRequest: z.ZodObject<{
    projectRoot: z.ZodString;
}, z.core.$strict>;
export declare const searchRequest: z.ZodObject<{
    projectRoot: z.ZodString;
    query: z.ZodString;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const factRequest: z.ZodObject<{
    projectRoot: z.ZodString;
    id: z.ZodString;
}, z.core.$strict>;
export declare const levelRequest: z.ZodObject<{
    projectRoot: z.ZodString;
    id: z.ZodString;
    level: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>;
    expectedRevision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const rollbackRequest: z.ZodObject<{
    projectRoot: z.ZodString;
    revision: z.ZodNumber;
}, z.core.$strict>;
declare const statusResult: z.ZodObject<{
    projectRoot: z.ZodString;
    storageDirectory: z.ZodString;
    revision: z.ZodNumber;
    facts: z.ZodNumber;
    running: z.ZodBoolean;
    lastRun: z.ZodNullable<z.ZodObject<{
        at: z.ZodISODateTime;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    revisions: z.ZodArray<z.ZodObject<{
        revision: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        facts: z.ZodNumber;
    }, z.core.$strict>>;
    autoRunAfterTurn: z.ZodBoolean;
    autoRunIntervalMinutes: z.ZodNumber;
}, z.core.$strict>;
declare const snapshotResult: z.ZodObject<{
    projectRoot: z.ZodString;
    storageDirectory: z.ZodString;
    revision: z.ZodNumber;
    facts: z.ZodNumber;
    running: z.ZodBoolean;
    lastRun: z.ZodNullable<z.ZodObject<{
        at: z.ZodISODateTime;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    revisions: z.ZodArray<z.ZodObject<{
        revision: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        facts: z.ZodNumber;
    }, z.core.$strict>>;
    autoRunAfterTurn: z.ZodBoolean;
    autoRunIntervalMinutes: z.ZodNumber;
    memories: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        content: z.ZodString;
        category: z.ZodEnum<{
            procedure: "procedure";
            decision: "decision";
            preference: "preference";
            fact: "fact";
            pitfall: "pitfall";
        }>;
        level: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>>;
        status: z.ZodEnum<{
            supported: "supported";
            uncertain: "uncertain";
            stale: "stale";
        }>;
        sources: z.ZodArray<z.ZodObject<{
            sessionId: z.ZodString;
            seq: z.ZodNumber;
            quote: z.ZodString;
            observedAt: z.ZodISODateTime;
            kind: z.ZodEnum<{
                user: "user";
                assistant: "assistant";
                tool: "tool";
            }>;
        }, z.core.$strict>>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        retiredReason: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        content: z.ZodString;
        category: z.ZodEnum<{
            procedure: "procedure";
            decision: "decision";
            preference: "preference";
            fact: "fact";
            pitfall: "pitfall";
        }>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        retiredReason: z.ZodOptional<z.ZodString>;
        level: z.ZodLiteral<1>;
        status: z.ZodLiteral<"supported">;
        inherited: z.ZodLiteral<true>;
        sources: z.ZodTuple<[], null>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
declare const runResult: z.ZodObject<{
    revision: z.ZodNumber;
    processedSessions: z.ZodNumber;
    created: z.ZodNumber;
    updated: z.ZodNumber;
    retired: z.ZodNumber;
    unchanged: z.ZodBoolean;
    sessionsRead: z.ZodNumber;
    eventsSelected: z.ZodNumber;
    deferred: z.ZodBoolean;
}, z.core.$strict>;
export type ProjectRequest = z.infer<typeof projectRequest>;
export type SearchRequest = z.infer<typeof searchRequest>;
export type FactRequest = z.infer<typeof factRequest>;
export type LevelRequest = z.infer<typeof levelRequest>;
export type RollbackRequest = z.infer<typeof rollbackRequest>;
export type MemorySnapshot = z.infer<typeof snapshotResult>;
export type MemoryStatus = z.infer<typeof statusResult>;
export type DreamingRunResult = z.infer<typeof runResult>;
export interface DreamingUiRemote {
    projects(signal?: AbortSignal): Promise<RemoteResult<string[]>>;
    snapshot(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<MemorySnapshot>>;
    status(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<MemoryStatus>>;
    search(request: SearchRequest, signal?: AbortSignal): Promise<RemoteResult<z.infer<typeof visibleFactSchema>[]>>;
    read(request: FactRequest, signal?: AbortSignal): Promise<RemoteResult<z.infer<typeof visibleFactSchema>>>;
    run(request: ProjectRequest, signal?: AbortSignal): Promise<RemoteResult<DreamingRunResult>>;
    setLevel(request: LevelRequest, signal?: AbortSignal): Promise<RemoteResult<{
        revision: number;
    }>>;
    forget(request: FactRequest, signal?: AbortSignal): Promise<RemoteResult<{
        revision: number;
    }>>;
    rollback(request: RollbackRequest, signal?: AbortSignal): Promise<RemoteResult<{
        revision: number;
    }>>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        dreamingUi: DreamingUiRemote;
    }
    interface RemoteErrorDetailsMap {
        'dreaming/forbidden': {};
        'dreaming/project-not-enabled': {};
        'dreaming/operation-failed': {
            readonly code?: string;
        };
    }
}
/** Mount on the Client and register on the Host; contains live parser functions. */
export declare const dreamingRemoteContribution: TypertRemoteContribution;
/** Alias for the browser build; bundle this module, never JSON.stringify it. */
export declare const dreamingClientContribution: TypertRemoteContribution;
export {};
