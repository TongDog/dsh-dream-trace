#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.ts'
import { handleHook } from './hooks.ts'
import { createServer } from './server.ts'
import { CodexDreamService } from './service.ts'
import { redactSecrets } from '../core/security.ts'

async function main() {
  const [command = 'serve', ...args] = process.argv.slice(2)
  // Defense in depth if a worker's host attempts to load a hook or this MCP server.
  if (process.env.DREAM_TRACE_CODEX_WORKER === '1') {
    if (command === 'hook') { console.log('{}'); return }
    if (command === 'serve' || command === 'run') throw new Error('Dream Trace cannot run recursively inside a Codex memory worker')
  }
  if (command === '--help' || command === 'help') {
    console.log('Dream Trace for Codex\n\n  serve                 Start the stdio MCP server\n  hook                  Capture one Codex hook JSON object from stdin\n  status [projectRoot]  Inspect memory\n  run [projectRoot]     Consolidate captured evidence\n\nConfig: DREAM_TRACE_CONFIG or $CODEX_HOME/dream-trace/config.json (~/.codex by default).')
    return
  }
  if (!['serve', 'hook', 'status', 'run'].includes(command) || args.length > (['run', 'status'].includes(command) ? 1 : 0)) throw new Error('Unknown command or arguments; use --help')
  const config = await loadConfig()
  if (command === 'hook') {
    let input = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (input.length > 16 * 1024 * 1024) throw new Error('Hook input exceeds 16 MiB')
    }
    console.log(JSON.stringify(await handleHook(config, JSON.parse(input))))
    return
  }
  const service = new CodexDreamService(config)
  if (command === 'serve') {
    const server = createServer(service)
    let closing = false
    const close = async () => {
      if (closing) return
      closing = true
      await service.close()
      await server.close()
    }
    server.server.onclose = () => { void close() }
    process.once('SIGINT', () => { void close() })
    process.once('SIGTERM', () => { void close() })
    await server.connect(new StdioServerTransport())
    service.start()
  } else {
    try { console.log(JSON.stringify(command === 'run' ? await service.run(args[0]) : args[0] || config.projectRoots.length === 1 ? await service.status(args[0]) : { projects: config.projectRoots }, null, 2)) }
    finally { await service.close() }
  }
}

main().catch(error => {
  const message = redactSecrets(error instanceof Error ? error.message : 'Dream Trace failed')
  if (process.argv[2] === 'hook') {
    // A memory failure must never block the user's tool or continue their turn.
    console.log(JSON.stringify({ systemMessage: `Dream Trace: ${message}` }))
  } else { console.error(message); process.exitCode = 1 }
})
