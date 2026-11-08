/** Immutable JSON revisions with one atomic, checksummed current pointer. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { CoreError, stateSchema } from "./types.js";
const pointerSchema = z.object({ revision: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function missing(error) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
const digest = (text) => createHash('sha256').update(text).digest('hex');
const writers = new Set();
/** One store belongs to exactly one canonical project. Reads see either entire revision. */
export class MemoryStore {
    directory;
    projectId;
    constructor(directory, projectId) {
        this.directory = directory;
        this.projectId = projectId;
        if (!projectId || projectId.length > 256)
            throw new TypeError('Invalid projectId');
    }
    empty() {
        return { schemaVersion: 1, projectId: this.projectId, revision: 0, parentRevision: null, parentHash: null, createdAt: new Date(0).toISOString(), facts: [], cursors: {} };
    }
    path(revision) { return join(this.directory, `revision-${revision}.json`); }
    async loadRevision(revision, hash) {
        try {
            const text = await readFile(this.path(revision), 'utf8');
            if (digest(text) !== hash)
                throw new Error('Revision checksum differs');
            const state = stateSchema.parse(JSON.parse(text));
            if (state.projectId !== this.projectId || state.revision !== revision || (state.parentRevision !== null && state.parentRevision >= revision))
                throw new Error('Revision identity differs');
            if ((state.parentRevision === null) !== (state.parentHash === null))
                throw new Error('Revision history pointer differs');
            if (new Set(state.facts.map(fact => fact.id)).size !== state.facts.length)
                throw new Error('Duplicate memory identifiers');
            return state;
        }
        catch (error) {
            throw new CoreError('CORRUPT_STORE', `Cannot validate memory revision ${revision}`, { cause: error });
        }
    }
    async current() {
        let pointer;
        try {
            pointer = await readFile(join(this.directory, 'current.json'), 'utf8');
        }
        catch (error) {
            if (missing(error))
                return { state: this.empty(), hash: null };
            throw error;
        }
        try {
            const parsed = pointerSchema.parse(JSON.parse(pointer));
            return { state: await this.loadRevision(parsed.revision, parsed.hash), hash: parsed.hash };
        }
        catch (error) {
            throw new CoreError('CORRUPT_STORE', 'Cannot validate current memory pointer', { cause: error });
        }
    }
    /** @returns The current immutable snapshot, or empty state before the first commit. */
    async read() { return (await this.current()).state; }
    async atomicWrite(path, text, publishes = false) {
        const temporary = `${path}.${randomUUID()}.tmp`;
        let renamed = false;
        try {
            const file = await open(temporary, 'wx', 0o600);
            try {
                await file.writeFile(text, 'utf8');
                await file.sync();
            }
            finally {
                await file.close();
            }
            await rename(temporary, path);
            renamed = true;
            // POSIX needs directory fsync as well as file fsync for rename durability.
            // Windows does not expose directory fsync through the Node filesystem API.
            if (process.platform !== 'win32') {
                const directory = await open(dirname(path), 'r');
                try {
                    await directory.sync();
                }
                finally {
                    await directory.close();
                }
            }
        }
        catch (error) {
            try {
                await unlink(temporary);
            }
            catch (cleanupError) {
                if (!missing(cleanupError))
                    throw new AggregateError([error, cleanupError], 'Commit and temporary-file cleanup failed');
            }
            if (renamed && publishes)
                throw new CoreError('COMMIT_UNKNOWN', 'The current revision was replaced but its durability could not be confirmed; re-read memory before retrying', { cause: error });
            throw error;
        }
    }
    /** Execute one all-or-nothing operation while holding the cross-process writer lock.
     * @param operation Return a replacement state, or null for no commit.
     * @param signal Abort before publication; the caller also passes it to model requests.
     * @returns The published state.
     */
    async transact(operation, signal) {
        signal?.throwIfAborted();
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const canonical = await realpath(this.directory);
        if (writers.has(canonical))
            throw new CoreError('BUSY', 'Another Dreaming run is writing this project');
        writers.add(canonical);
        let compromised;
        let heartbeatReleased = false;
        let identity;
        let published = false;
        let release;
        const lockPath = join(canonical, '.writer.lock');
        const sameLock = (current) => identity === undefined || (current.ino === identity.ino && current.dev === identity.dev);
        // Release stops the library heartbeat, but must never delete a successor's lock.
        const guardedFs = {
            ...fs,
            rmdir(path, callback) {
                fs.stat(path, { bigint: true }, (error, current) => {
                    if (error)
                        return callback(error.code === 'ENOENT' ? null : error);
                    if (!sameLock(current))
                        return callback(null);
                    fs.rmdir(path, callback);
                });
            },
            rmdirSync(path) {
                let current;
                try {
                    current = fs.statSync(path, { bigint: true });
                }
                catch (error) {
                    if (missing(error))
                        return;
                    throw error;
                }
                if (sameLock(current))
                    fs.rmdirSync(path);
            },
        };
        try {
            release = await lockfile.lock(canonical, { fs: guardedFs, realpath: true, lockfilePath: lockPath, retries: 0, onCompromised: error => { compromised = error; heartbeatReleased = true; } });
        }
        catch (error) {
            writers.delete(canonical);
            if (error instanceof Error && 'code' in error && error.code === 'ELOCKED')
                throw new CoreError('BUSY', 'Another Dreaming run is writing this project', { cause: error });
            throw error;
        }
        try {
            identity = await stat(lockPath, { bigint: true });
            const assertLock = async () => {
                if (compromised)
                    throw new CoreError('BUSY', 'The memory writer lock was lost; changes were not published', { cause: compromised });
                try {
                    const current = await stat(lockPath, { bigint: true });
                    if (!sameLock(current))
                        throw new Error('Writer lock directory was replaced');
                }
                catch (error) {
                    compromised = error instanceof Error ? error : new Error('Writer lock unavailable', { cause: error });
                    throw new CoreError('BUSY', 'The memory writer lock was lost; changes were not published', { cause: compromised });
                }
            };
            const committed = await this.current();
            const previous = committed.state;
            const replacement = await operation(structuredClone(previous));
            if (replacement === null)
                return previous;
            signal?.throwIfAborted();
            await assertLock();
            const next = stateSchema.parse({ ...replacement, projectId: this.projectId, schemaVersion: 1, revision: previous.revision + 1, parentRevision: previous.revision || null, parentHash: committed.hash, createdAt: new Date().toISOString() });
            const text = JSON.stringify(next, null, 2) + '\n';
            await this.atomicWrite(this.path(next.revision), text);
            signal?.throwIfAborted();
            await assertLock();
            await this.atomicWrite(join(this.directory, 'current.json'), JSON.stringify({ revision: next.revision, hash: digest(text) }) + '\n', true);
            published = true;
            return next;
        }
        finally {
            try {
                if (!heartbeatReleased)
                    await release();
            }
            catch (error) {
                if (!heartbeatReleased)
                    throw new CoreError(published ? 'COMMIT_UNKNOWN' : 'BUSY', published ? 'Memory was published but the writer lock could not be released; inspect current state before retrying' : 'The writer lock could not be released', { cause: error });
            }
            finally {
                writers.delete(canonical);
            }
        }
    }
    /** @returns Committed revisions, newest first. Orphaned interrupted writes are excluded. */
    async revisions() {
        const result = [];
        let state = await this.read();
        while (state.revision > 0) {
            result.push({ revision: state.revision, createdAt: state.createdAt, facts: state.facts.length });
            if (state.parentRevision === null || state.parentHash === null)
                break;
            state = await this.loadRevision(state.parentRevision, state.parentHash);
        }
        return result;
    }
    /** Restore both knowledge and processing cursors as a new revision.
     * @param revision A committed revision number.
     * @param signal Optional cancellation.
     * @returns The newly published revision.
     */
    async rollback(revision, signal) {
        return this.transact(async (current) => {
            let target = current;
            while (target.revision !== revision && target.parentRevision !== null && target.parentHash !== null)
                target = await this.loadRevision(target.parentRevision, target.parentHash);
            if (target.revision !== revision || revision < 1)
                throw new CoreError('NOT_FOUND', `Committed revision ${revision} does not exist`);
            return target;
        }, signal);
    }
    /** Remove one fact from current memory; earlier revisions retain it for explicit rollback.
     * @param id Memory identifier.
     * @param signal Optional cancellation.
     * @returns The new current state. Processing cursors stay unchanged.
     */
    async forget(id, signal) {
        return this.transact(async (current) => {
            if (!current.facts.some(fact => fact.id === id))
                throw new CoreError('NOT_FOUND', `Memory ${id} does not exist`);
            return { ...current, facts: current.facts.filter(fact => fact.id !== id) };
        }, signal);
    }
}
//# sourceMappingURL=store.js.map