import type { Context } from '@deepseek-ai/cordis';
import type { DreamingConfig } from './config.ts';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** Input to a plugin-owned consolidation session; never fresh user evidence. */
        'dreaming-input': {
            kind: 'dreaming-input';
        };
    }
}
/**
 * Execute one bounded model response. The production Agent loop owns logging.
 * @param ctx Plugin-owned context with an Agent factory and persistence.
 * @param config Model route and output limit.
 * @param projectRoot The already-authorized project directory.
 * @param system Consolidation instructions.
 * @param payload Redacted evidence and previous memory, treated as data.
 * @param signal Caller and plugin lifecycle cancellation.
 * @returns The one model response, after a durable session flush.
 */
export declare function generateInSession(ctx: Context, config: DreamingConfig, projectRoot: string, system: string, payload: string, signal: AbortSignal): Promise<string>;
