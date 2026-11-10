/** Persisted memory and the model-output parser. */
import { z } from 'zod';
/** Structured failures; COMMIT_UNKNOWN requires re-reading current state before retrying. */
export declare class CoreError extends Error {
    readonly code: 'BUSY' | 'CORRUPT_STORE' | 'INVALID_PROPOSAL' | 'UNSUPPORTED_EVIDENCE' | 'SECRET_DETECTED' | 'INPUT_LIMIT' | 'MEMORY_LIMIT' | 'REVIEW_REJECTED' | 'NOT_FOUND' | 'INVALID_BATCH' | 'COMMIT_UNKNOWN';
    constructor(code: 'BUSY' | 'CORRUPT_STORE' | 'INVALID_PROPOSAL' | 'UNSUPPORTED_EVIDENCE' | 'SECRET_DETECTED' | 'INPUT_LIMIT' | 'MEMORY_LIMIT' | 'REVIEW_REJECTED' | 'NOT_FOUND' | 'INVALID_BATCH' | 'COMMIT_UNKNOWN', message: string, options?: ErrorOptions);
}
export declare const citationSchema: z.ZodObject<{
    sessionId: z.ZodString;
    seq: z.ZodNumber;
    quote: z.ZodString;
}, z.core.$strict>;
export declare const levelSchema: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>;
export type MemoryLevel = z.infer<typeof levelSchema>;
export declare const updateSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    content: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    category: z.ZodEnum<{
        procedure: "procedure";
        decision: "decision";
        preference: "preference";
        fact: "fact";
        pitfall: "pitfall";
    }>;
    level: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>>;
    status: z.ZodEnum<{
        supported: "supported";
        uncertain: "uncertain";
    }>;
    evidence: z.ZodArray<z.ZodObject<{
        sessionId: z.ZodString;
        seq: z.ZodNumber;
        quote: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Only this data format can change memory; model output is never executable. */
export declare const proposalSchema: z.ZodObject<{
    updates: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
        content: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        category: z.ZodEnum<{
            procedure: "procedure";
            decision: "decision";
            preference: "preference";
            fact: "fact";
            pitfall: "pitfall";
        }>;
        level: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>>;
        status: z.ZodEnum<{
            supported: "supported";
            uncertain: "uncertain";
        }>;
        evidence: z.ZodArray<z.ZodObject<{
            sessionId: z.ZodString;
            seq: z.ZodNumber;
            quote: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    retire: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        evidence: z.ZodArray<z.ZodObject<{
            sessionId: z.ZodString;
            seq: z.ZodNumber;
            quote: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Citation = z.infer<typeof citationSchema>;
/** Source metadata is supplied by the host, never by model output. */
export declare const storedCitationSchema: z.ZodObject<{
    sessionId: z.ZodString;
    seq: z.ZodNumber;
    quote: z.ZodString;
    observedAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
        tool: "tool";
    }>;
}, z.core.$strict>;
export type StoredCitation = z.infer<typeof storedCitationSchema>;
export declare const factSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
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
}, z.core.$strict>;
export type MemoryFact = z.infer<typeof factSchema>;
export declare const visibleFactSchema: z.ZodUnion<readonly [z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
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
    summary: z.ZodOptional<z.ZodString>;
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
}, z.core.$strict>]>;
export type VisibleFact = MemoryFact & {
    inherited?: true;
};
/** Visibility is an owner preference. Missing preferences in older revisions mean visible. */
export declare function agentFacts<T extends {
    id: string;
}>(state: {
    facts: T[];
    hiddenMemoryIds?: string[];
}): T[];
export declare const stateSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    projectId: z.ZodString;
    revision: z.ZodNumber;
    parentRevision: z.ZodNullable<z.ZodNumber>;
    parentHash: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodISODateTime;
    facts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        content: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
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
    }, z.core.$strict>>;
    cursors: z.ZodPipe<z.ZodUnknown, z.ZodTransform<Record<string, number>, unknown>>;
    hiddenMemoryIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type MemoryState = z.infer<typeof stateSchema>;
/** An observable event; private model reasoning must never be supplied. */
export interface EvidenceEvent {
    sessionId: string;
    seq: number;
    time: string;
    kind: 'user' | 'assistant' | 'tool';
    text: string;
}
/** throughSeq is the immutable end of a completed prefix, including non-text events. */
export interface TranscriptBatch {
    sessionId: string;
    throughSeq: number;
    events: EvidenceEvent[];
}
/** Every deployment-varying limit is supplied by the plugin configuration. */
export interface EngineConfig {
    maxInputChars: number;
    maxProposalChars: number;
    maxFacts: number;
    maxFactChars: number;
    maxFactsPerRun: number;
    verify: boolean;
}
/** The host owns route selection, usage accounting, cancellation and request logging. */
export type Generate = (system: string, payload: string, signal?: AbortSignal) => Promise<string>;
export interface RunResult {
    revision: number;
    processedSessions: number;
    created: number;
    updated: number;
    retired: number;
    unchanged: boolean;
}
