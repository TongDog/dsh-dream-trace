/** Public memory engine API; independent of the host harness. */
export * from './types.ts';
export * from './store.ts';
export * from './engine.ts';
export * from './security.ts';
import { MemoryStore } from './store.ts';
import { type VisibleFact } from './types.ts';
export interface RecallView {
    revision: number;
    facts: VisibleFact[];
}
/** Compose only for recall. Consolidation, history and mutations always use the source store. */
export declare function recallView(store: MemoryStore, enabled: Iterable<MemoryStore>): Promise<RecallView>;
/** @param state Current memory. @param id Fact identifier. @returns A detached fact. */
export declare function readMemory(state: RecallView, id: string): VisibleFact;
/** Literal keyword search, including Chinese substrings; stale entries are excluded.
 * @param state Current memory.
 * @param query Keywords, or empty text to list current entries.
 * @param limit Maximum returned facts.
 * @returns Detached facts ordered by matches, level, confidence and recency.
 */
export declare function searchMemory(state: RecallView, query: string, limit: number): VisibleFact[];
/** Preload short, supported L1–L3 conclusions, index L4, and keep L5 searchable. */
export declare function renderIndex(state: RecallView, maxChars: number): string;
