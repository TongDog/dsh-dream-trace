import { MemoryStore } from './store.ts';
import { type EngineConfig, type Generate, type MemoryState, type RunResult, type TranscriptBatch } from './types.ts';
/** Reserve space for old memory, metadata and the maximum proposal before collecting evidence.
 * @param state Current memory snapshot.
 * @param config Explicit input and output budgets.
 * @returns Conservative available characters for serialized evidence, excluding prompts.
 */
export declare function evidenceBudget(state: MemoryState, config: EngineConfig): number;
/** All model work occurs under the project writer lock and cannot partially commit. */
export declare class DreamEngine {
    private readonly store;
    private readonly config;
    private readonly generate;
    constructor(store: MemoryStore, config: EngineConfig, generate: Generate);
    /** @param batches Complete immutable session prefixes selected by the host.
     * @param signal Optional cancellation, also passed to both model calls.
     * @returns Counts and the committed revision; unchanged for already-processed inputs.
     */
    run(batches: TranscriptBatch[], signal?: AbortSignal): Promise<RunResult>;
}
