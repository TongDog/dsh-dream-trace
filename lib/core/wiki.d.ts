import { type Generate, type EngineConfig } from './types.ts';
import type { RecallView } from './index.ts';
import type { MemoryStore } from './store.ts';
export declare function visiblePages(state: RecallView): {
    links: string[];
    sourceIds: string[];
    id: string;
    title: string;
}[];
export declare function organizeWiki(store: MemoryStore, limits: Pick<EngineConfig, 'maxInputChars' | 'maxProposalChars'>, generate: Generate, signal?: AbortSignal): Promise<{
    schemaVersion: 1;
    projectId: string;
    revision: number;
    parentRevision: number | null;
    parentHash: string | null;
    createdAt: string;
    facts: {
        id: string;
        title: string;
        content: string;
        category: "procedure" | "decision" | "preference" | "fact" | "pitfall";
        level: 1 | 4 | 2 | 3 | 5;
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
        summary?: string | undefined;
        retiredReason?: string | undefined;
    }[];
    cursors: Record<string, number>;
    wiki?: {
        id: string;
        title: string;
        sourceIds: string[];
        links: string[];
    }[] | undefined;
    hiddenMemoryIds?: string[] | undefined;
}>;
