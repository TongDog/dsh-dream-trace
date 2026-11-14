import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { CoreError } from "./core/types.js";
import { dreamingRemoteContribution, factRequest, levelRequest, projectRequest, rollbackRequest, searchRequest, updateCheckRequest, visibilityRequest, } from "./ui-protocol.js";
/** Optional dependency keeps terminal/headless profiles usable without the Gateway. */
export function registerUiBridge(ctx, operations) {
    ctx.inject(['typert'], child => { new DreamingUiBridge(child, operations); });
}
/** All writes delegate to the same service methods used by the model tools. */
export class DreamingUiBridge extends TypertRemoteService {
    operations;
    constructor(ctx, operations) {
        super(ctx, 'dreamingUi');
        this.operations = operations;
        ctx.typert.register({
            package: dreamingRemoteContribution.package, face: 'host', schemas: [],
            model: { services: [], events: [], objects: [] }, invocations: dreamingRemoteContribution.descriptors,
        });
    }
    projects(signal) {
        this.owner(signal);
        return this.operations.listProjects();
    }
    checkUpdate(request, signal) {
        return this.guarded(updateCheckRequest, request, signal, input => this.operations.checkUpdate(input.force, signal));
    }
    snapshot(request, signal) {
        return this.scoped(projectRequest, request, signal, input => this.operations.snapshot(input.projectRoot));
    }
    status(request, signal) {
        return this.scoped(projectRequest, request, signal, input => this.operations.status(input.projectRoot));
    }
    search(request, signal) {
        return this.scoped(searchRequest, request, signal, input => this.operations.search(input.projectRoot, input.query, input.limit));
    }
    read(request, signal) {
        return this.scoped(factRequest, request, signal, input => this.operations.read(input.projectRoot, input.id));
    }
    organizeWiki(request, signal) {
        return this.scoped(projectRequest, request, signal, input => this.operations.organizeWiki(input.projectRoot, signal));
    }
    run(request, signal) {
        return this.scoped(projectRequest, request, signal, input => this.operations.run(input.projectRoot, signal));
    }
    setVisibility(request, signal) {
        return this.scoped(visibilityRequest, request, signal, input => this.operations.setVisibility(input.projectRoot, input.id, input.visible, input.expectedRevision, signal));
    }
    setLevel(request, signal) {
        return this.scoped(levelRequest, request, signal, input => this.operations.setLevel(input.projectRoot, input.id, input.level, input.expectedRevision, signal));
    }
    forget(request, signal) {
        return this.scoped(factRequest, request, signal, input => this.operations.forget(input.projectRoot, input.id, signal));
    }
    rollback(request, signal) {
        return this.scoped(rollbackRequest, request, signal, input => this.operations.rollback(input.projectRoot, input.revision, signal));
    }
    owner(signal) {
        signal.throwIfAborted();
        // A shared-session guest must never enumerate the owner's other projects.
        if (this.ctx.invocation?.peer.principal.kind !== 'owner') {
            throw new RemoteError('dreaming/forbidden', 'Only the Harness owner can manage project memory.', {});
        }
    }
    async scoped(schema, raw, signal, operation) {
        this.owner(signal);
        const parsed = schema.safeParse(raw);
        if (!parsed.success)
            throw new RemoteError('gateway/bad-request', 'Invalid Dreaming request.', {});
        // No normalization or filesystem lookup: callers must select an exact configured root.
        if (!this.operations.listProjects().includes(parsed.data.projectRoot)) {
            throw new RemoteError('dreaming/project-not-enabled', 'Project is not enabled in Dreaming configuration.', {});
        }
        return this.execute(operation, parsed.data, signal);
    }
    /** Owner-guarded call for operations that are not scoped to one project. */
    async guarded(schema, raw, signal, operation) {
        this.owner(signal);
        const parsed = schema.safeParse(raw);
        if (!parsed.success)
            throw new RemoteError('gateway/bad-request', 'Invalid Dreaming request.', {});
        return this.execute(operation, parsed.data, signal);
    }
    async execute(operation, input, signal) {
        try {
            const result = await operation(input);
            signal.throwIfAborted();
            return result;
        }
        catch (error) {
            signal.throwIfAborted();
            if (error instanceof RemoteError)
                throw error;
            throw new RemoteError('dreaming/operation-failed', error instanceof Error ? error.message : 'Dreaming operation failed.', error instanceof CoreError ? { code: error.code } : {});
        }
    }
}
//# sourceMappingURL=ui-bridge.js.map