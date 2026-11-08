/** Canonical, project-scoped model tools with pure host presentations. */
import type { Context } from '@deepseek-ai/cordis';
import type { DreamingService } from './index.ts';
/**
 * Register tools on the plugin context; dsh owns argument validation and disposal.
 * @param ctx Plugin-owned registry context.
 * @param service Shared operations used by automatic and manual runs.
 */
export declare function registerTools(ctx: Context, service: DreamingService): void;
