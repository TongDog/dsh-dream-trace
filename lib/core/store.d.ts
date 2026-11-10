import { type MemoryLevel, type MemoryState, type VisibleFact } from './types.ts';
/** One store belongs to exactly one canonical project. Reads see either entire revision. */
export declare class MemoryStore {
    readonly directory: string;
    readonly projectId: string;
    constructor(directory: string, projectId: string);
    private empty;
    private path;
    private loadRevision;
    private pointer;
    private current;
    private sharedCache?;
    /** Only re-read an enabled sibling's revision when its current pointer changes. */
    sharedFacts(): Promise<VisibleFact[]>;
    setLevel(id: string, level: MemoryLevel, expectedRevision: number | undefined, signal?: AbortSignal): Promise<MemoryState>;
    /** @returns The current immutable snapshot, or empty state before the first commit. */
    read(): Promise<MemoryState>;
    private atomicWrite;
    /** Execute one all-or-nothing operation while holding the cross-process writer lock.
     * @param operation Return a replacement state, or null for no commit.
     * @param signal Abort before publication; the caller also passes it to model requests.
     * @returns The published state.
     */
    transact(operation: (current: MemoryState) => Promise<MemoryState | null>, signal?: AbortSignal): Promise<MemoryState>;
    /** @returns Committed revisions, newest first. Orphaned interrupted writes are excluded. */
    revisions(): Promise<Array<{
        revision: number;
        createdAt: string;
        facts: number;
    }>>;
    /** Restore both knowledge and processing cursors as a new revision.
     * @param revision A committed revision number.
     * @param signal Optional cancellation.
     * @returns The newly published revision.
     */
    rollback(revision: number, signal?: AbortSignal): Promise<MemoryState>;
    /** Remove one fact from current memory; earlier revisions retain it for explicit rollback.
     * @param id Memory identifier.
     * @param signal Optional cancellation.
     * @returns The new current state. Processing cursors stay unchanged.
     */
    forget(id: string, signal?: AbortSignal): Promise<MemoryState>;
}
