/** Owner-only visual memory operations over Harness's existing typed Remote API. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'
import { CoreError } from './core/types.ts'
import type { DreamingService } from './index.ts'
import {
  dreamingRemoteContribution, factRequest, levelRequest, projectRequest, rollbackRequest, searchRequest, visibilityRequest,
  type FactRequest, type LevelRequest, type ProjectRequest, type RollbackRequest, type SearchRequest, type VisibilityRequest,
} from './ui-protocol.ts'

export type DreamingUiOperations = Pick<DreamingService, 'organizeWiki' | 'listProjects' | 'snapshot' | 'status' | 'search' | 'read' | 'run' | 'setLevel' | 'setVisibility' | 'forget' | 'rollback'>

declare module '@deepseek-ai/cordis' {
  interface Context { dreamingUi: DreamingUiBridge }
}

/** Optional dependency keeps terminal/headless profiles usable without the Gateway. */
export function registerUiBridge(ctx: Context, operations: DreamingUiOperations): void {
  ctx.inject(['typert'], child => { new DreamingUiBridge(child, operations) })
}

/** All writes delegate to the same service methods used by the model tools. */
export class DreamingUiBridge extends TypertRemoteService {
  constructor(ctx: Context, private readonly operations: DreamingUiOperations) {
    super(ctx, 'dreamingUi')
    ctx.typert.register({
      package: dreamingRemoteContribution.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: dreamingRemoteContribution.descriptors,
    })
  }

  projects(signal: AbortSignal): string[] {
    this.owner(signal)
    return this.operations.listProjects()
  }

  snapshot(request: ProjectRequest, signal: AbortSignal) {
    return this.scoped(projectRequest, request, signal, input => this.operations.snapshot(input.projectRoot))
  }

  status(request: ProjectRequest, signal: AbortSignal) {
    return this.scoped(projectRequest, request, signal, input => this.operations.status(input.projectRoot))
  }

  search(request: SearchRequest, signal: AbortSignal) {
    return this.scoped(searchRequest, request, signal, input => this.operations.search(input.projectRoot, input.query, input.limit))
  }

  read(request: FactRequest, signal: AbortSignal) {
    return this.scoped(factRequest, request, signal, input => this.operations.read(input.projectRoot, input.id))
  }

  organizeWiki(request: ProjectRequest, signal: AbortSignal) {
    return this.scoped(projectRequest, request, signal, input => this.operations.organizeWiki(input.projectRoot, signal))
  }

  run(request: ProjectRequest, signal: AbortSignal) {
    return this.scoped(projectRequest, request, signal, input => this.operations.run(input.projectRoot, signal))
  }

  setVisibility(request: VisibilityRequest, signal: AbortSignal) {
    return this.scoped(visibilityRequest, request, signal, input => this.operations.setVisibility(input.projectRoot, input.id, input.visible, input.expectedRevision, signal))
  }

  setLevel(request: LevelRequest, signal: AbortSignal) {
    return this.scoped(levelRequest, request, signal, input => this.operations.setLevel(input.projectRoot, input.id, input.level, input.expectedRevision, signal))
  }

  forget(request: FactRequest, signal: AbortSignal) {
    return this.scoped(factRequest, request, signal, input => this.operations.forget(input.projectRoot, input.id, signal))
  }

  rollback(request: RollbackRequest, signal: AbortSignal) {
    return this.scoped(rollbackRequest, request, signal, input => this.operations.rollback(input.projectRoot, input.revision, signal))
  }

  private owner(signal: AbortSignal): void {
    signal.throwIfAborted()
    // A shared-session guest must never enumerate the owner's other projects.
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') {
      throw new RemoteError('dreaming/forbidden', 'Only the Harness owner can manage project memory.', {})
    }
  }

  private async scoped<Input extends ProjectRequest, Output>(schema: z.ZodType<Input>, raw: unknown, signal: AbortSignal, operation: (input: Input) => Promise<Output>): Promise<Output> {
    this.owner(signal)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid Dreaming request.', {})
    // No normalization or filesystem lookup: callers must select an exact configured root.
    if (!this.operations.listProjects().includes(parsed.data.projectRoot)) {
      throw new RemoteError('dreaming/project-not-enabled', 'Project is not enabled in Dreaming configuration.', {})
    }
    try {
      const result = await operation(parsed.data)
      signal.throwIfAborted()
      return result
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof RemoteError) throw error
      throw new RemoteError('dreaming/operation-failed', error instanceof Error ? error.message : 'Dreaming operation failed.',
        error instanceof CoreError ? { code: error.code } : {})
    }
  }
}
