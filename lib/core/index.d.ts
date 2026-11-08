/** Public memory engine API; independent of the host harness. */
export * from './types.ts';
export * from './store.ts';
export * from './engine.ts';
export * from './security.ts';
import { type MemoryFact, type MemoryState } from './types.ts';
/** @param state Current memory. @param id Fact identifier. @returns A detached fact. */
export declare function readMemory(state: MemoryState, id: string): MemoryFact;
/** Literal keyword search, including Chinese substrings; stale entries are excluded.
 * @param state Current memory.
 * @param query Keywords, or empty text to list current entries.
 * @param limit Maximum returned facts.
 * @returns Detached facts ordered by keyword matches and update time.
 */
export declare function searchMemory(state: MemoryState, query: string, limit: number): MemoryFact[];
/** Render a bounded index as data, not instructions; no fact content is injected.
 * @param state Current memory.
 * @param maxChars Maximum index length.
 * @returns A complete line-delimited index fitting maxChars, or empty text.
 */
export declare function renderIndex(state: MemoryState, maxChars: number): string;
