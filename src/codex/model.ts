/** A tool-free OpenAI-compatible Chat Completions adapter. No Codex auth files are read. */
import type { Generate } from '../core/types.ts'
import type { CodexConfig } from './config.ts'

export function createGenerator(config: CodexConfig, request: typeof fetch = fetch): Generate {
  return async (system, payload, signal) => {
    if (!config.model) throw new Error('Configure model in Dream Trace config.json before running consolidation')
    const key = process.env[config.model.apiKeyEnv]
    if (!key) throw new Error(`Set ${config.model.apiKeyEnv} in the MCP server environment before running consolidation`)
    const response = await request(`${config.model.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.model.name, messages: [{ role: 'system', content: system }, { role: 'user', content: payload }],
        response_format: { type: 'json_object' }, [config.model.tokenLimitField]: config.maxOutputTokens, stream: false }),
    })
    // Provider error bodies may echo credentials or evidence; never surface them.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Dream Trace model request failed (HTTP ${response.status})`) }
    if (!response.body) throw new Error('Model returned an empty response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2 * 1024 * 1024) throw new Error('Model response exceeds the 2 MiB transport limit')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new Error('Model returned invalid JSON') }
    const choice = data?.choices?.[0]
    if (data?.choices?.length !== 1 || choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length ||
      choice.message?.function_call || choice.message?.refusal || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
      throw new Error('Expected one complete, non-refused text response without tool calls')
    }
    return choice.message.content
  }
}
