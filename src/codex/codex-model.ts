/** Use Codex's own saved login; this adapter never reads or copies auth files. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Generate } from '../core/types.ts'
import type { CodexConfig } from './config.ts'

type CodexModel = Extract<NonNullable<CodexConfig['model']>, { backend: 'codex' }>
const transportLimit = 2 * 1024 * 1024
// A common envelope works for both extraction and review without changing the core schemas.
const responseSchema = { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false }
const disabledFeatures = ['hooks', 'plugins', 'remote_plugin', 'apps', 'shell_tool', 'unified_exec', 'multi_agent',
  'code_mode', 'code_mode_host', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'memories', 'skill_search', 'sleep_tool', 'goals']

export function createCodexGenerator(config: CodexConfig, model: CodexModel): Generate {
  return async (system, payload, signal) => {
    if (process.env.DREAM_TRACE_CODEX_WORKER === '1') throw new Error('Recursive Codex memory worker is not allowed')
    const control = AbortSignal.any([AbortSignal.timeout(config.runTimeoutSeconds * 1000), ...(signal ? [signal] : [])])
    control.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'dream-trace-codex-'))
    try {
      const schema = join(directory, 'response-schema.json'), output = join(directory, 'response.json'), instructions = join(directory, 'instructions.txt')
      await Promise.all([
        writeFile(schema, JSON.stringify(responseSchema), { mode: 0o600 }),
        writeFile(instructions, `${system}\n\nTransport requirement: put the complete JSON answer requested above inside the string field "result" of the final JSON object. Do not use tools. Only the supplied evidence is relevant.`, { mode: 0o600 }),
      ])
      const args = ['--no-daemon', '--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral',
        '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never', '--cd', directory,
        '--output-schema', schema, '--output-last-message', output,
        '-c', `model_instructions_file=${JSON.stringify(instructions)}`, '-c', 'project_doc_max_bytes=0',
        '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'skills.bundled.enabled=false',
        '-c', 'suppress_unstable_features_warning=true',
        ...disabledFeatures.flatMap(feature => ['--disable', feature]), '--enable', 'skip_host_skill_discovery',
        '--enable', 'respect_system_proxy']
      if (model.name) args.push('--model', model.name)
      if (model.reasoningEffort) args.push('-c', `model_reasoning_effort=${JSON.stringify(model.reasoningEffort)}`)
      args.push('-')
      const env: NodeJS.ProcessEnv = { ...process.env, DREAM_TRACE_CODEX_WORKER: '1' }
      // Use the saved Codex login, not an unrelated API key inherited by the parent.
      for (const key of ['DREAM_TRACE_API_KEY', 'DREAM_TRACE_CONFIG', 'CODEX_API_KEY', 'OPENAI_API_KEY']) delete env[key]
      await execute(model.command, args, directory, env, payload, control)
      control.throwIfAborted()
      if ((await stat(output)).size > transportLimit) throw new Error('Codex response exceeds the 2 MiB transport limit')
      let result: unknown
      try { result = JSON.parse(await readFile(output, 'utf8')) }
      catch { throw new Error('Codex did not return a complete JSON response') }
      if (!result || typeof result !== 'object' || !('result' in result) || typeof result.result !== 'string' || !result.result.trim() || Object.keys(result).length !== 1) {
        throw new Error('Codex did not return the required JSON result envelope')
      }
      return result.result
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}

/** No shell interpolation; cancellation kills the worker group before temporary files disappear. */
async function execute(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let failure: Error | undefined, killTimer: NodeJS.Timeout | undefined, pending = '', bytes = 0, started = false, completed = false
    const kill = (name: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name)
        else child.kill(name)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(name) }
    }
    const fail = (error: Error) => {
      if (failure) return
      failure = error
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 1000)
      killTimer.unref()
    }
    const abort = () => fail(new Error('Codex memory worker was cancelled or timed out'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.on('error', () => fail(new Error('Could not start Codex; check model.command and run codex login status')))
    child.stdin.on('error', () => fail(new Error('Codex closed its input before accepting the evidence')))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (failure) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > transportLimit) { fail(new Error('Codex event stream exceeds the 2 MiB transport limit')); return }
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        if (!line.trim()) continue
        let event
        try { event = JSON.parse(line) }
        catch { fail(new Error('Codex emitted an invalid JSON event')); return }
        if (event.type === 'turn.started') started = true
        else if (event.type === 'turn.completed') completed = true
        else if (event.type === 'turn.failed') fail(new Error('Codex generation failed; check login, model access and usage limits'))
        // CLI startup warnings use item.error; reconnect notices use top-level error.
        // Neither is a successful result: still require exit 0 and turn.completed.
        else if (event.type === 'error' || (!started && event.item?.type === 'error')) continue
        else if (typeof event.type === 'string' && event.type.startsWith('item.')) {
          if (!['agent_message', 'reasoning'].includes(event.item?.type)) {
            const kind = typeof event.item?.type === 'string' && /^[a-z_]{1,64}$/.test(event.item.type) ? event.item.type : 'unknown'
            fail(new Error(`Codex memory worker attempted a tool or other unsupported action (${kind})`))
          }
        } else if (!['thread.started', 'turn.started'].includes(event.type)) fail(new Error('Codex emitted an unsupported event'))
      }
    })
    // Do not echo provider errors, prompt text, account details, or reasoning into MCP logs.
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > transportLimit) fail(new Error('Codex diagnostic output exceeds the 2 MiB transport limit'))
    })
    child.on('close', code => {
      signal.removeEventListener('abort', abort)
      if (failure) kill('SIGKILL')
      if (killTimer) clearTimeout(killTimer)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Codex exited unsuccessfully (${code ?? 'signal'}); check login, model access and usage limits`))
      else if (!started || !completed || pending.trim()) reject(new Error('Codex exited without a complete successful turn'))
      else resolve()
    })
    child.stdin.end(input)
  })
}
