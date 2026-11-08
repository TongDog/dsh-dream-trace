/** Run model-only consolidation in a replayable, isolated dsh Agent session. */
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
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
export async function generateInSession(ctx, config, projectRoot, system, payload, signal) {
    signal.throwIfAborted();
    const handle = await ctx.agents.create({
        sessionId: SessionId(`dreaming-worker-${randomUUID()}`),
        meta: { cwd: projectRoot, origin: 'subagent', agentPreset: 'dreaming-worker' },
        agentOptions: { provider: config.provider, model: config.model, maxTokens: config.maxOutputTokens },
        signal,
        setup(agentCtx) {
            // The Agent is owned by this plugin's create() call, so both lifetimes unwind these effects.
            agentCtx.tools.restrict({ allow: [] });
            agentCtx.tools.guard(() => 'Dreaming workers cannot execute tools.');
            agentCtx.tools.setExecutor(new NativeToolExecutor(agentCtx));
            agentCtx.systemPrompt.suppressRuntimeContext();
            agentCtx.systemPrompt.section({ name: 'dreaming:worker', order: 0, complete: true, interpolate: false, text: system });
            agentCtx.on('agent/pre-step', async ({ step }, next) => step > 1 ? { kind: 'reject' } : next());
        },
    });
    const { agent } = handle;
    const cancel = () => agent.cancel({ kind: 'hook', reason: 'Dreaming cancelled' });
    signal.addEventListener('abort', cancel, { once: true });
    try {
        signal.throwIfAborted();
        agent.followup(createUserMessage({ content: [{ type: 'text', text: payload }], source: { kind: 'dreaming-input' } }));
        // This dedicated Agent receives exactly one input and is never exposed for reuse.
        await agent.whenIdle();
        signal.throwIfAborted();
        const { events } = await ctx.sessionQuery.readSession(agent.id);
        const endings = events.filter(event => event.type === 'turn/end');
        if (endings.length !== 1 || endings[0].data.reason.kind !== 'completed')
            throw new Error('Dreaming model session did not complete successfully; inspect its session log.');
        const replies = events.filter(event => event.type === 'assistant/message');
        if (replies.length !== 1)
            throw new Error('Dreaming requires exactly one model response.');
        const content = replies[0].data.message.content;
        if (content.some(block => block.type === 'tool-call'))
            throw new Error('Dreaming model attempted a tool call; memory was not changed.');
        const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
        if (!text.trim())
            throw new Error('Dreaming model returned no text.');
        const flushed = await ctx.sessions.flush(agent.session);
        if (!flushed)
            throw new Error('Dreaming model session has no durable persistence acknowledgement.');
        signal.throwIfAborted();
        return text;
    }
    finally {
        signal.removeEventListener('abort', cancel);
        await handle.dispose();
    }
}
//# sourceMappingURL=worker.js.map