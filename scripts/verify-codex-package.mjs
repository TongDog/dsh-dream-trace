/** Exercise the distributed plugin in isolation with the real MCP stdio protocol. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dream-trace-package-')))
let client, transport, provider, appServer
try {
  let archive = process.argv[2] ? resolve(process.argv[2]) : undefined
  if (!archive) {
    const packed = JSON.parse(execFileSync('npm', ['pack', './codex-plugin', '--json', '--ignore-scripts', '--pack-destination', temporary, '--cache', join(temporary, 'npm-cache')], { cwd: root, encoding: 'utf8' }))
    archive = join(temporary, packed[0].filename)
  }
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
  for (const name of ['dist/cli.mjs', 'dist/THIRD_PARTY_NOTICES.txt', '.codex-plugin/plugin.json', '.claude-plugin/marketplace.json', '.mcp.json', 'hooks/hooks.json', 'skills/dream-trace/SKILL.md', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(`package/${name}`), `Missing ${name}`)
  }
  assert.ok(files.every(path => path.startsWith('package/') && !path.split('/').includes('..') && !path.includes('/node_modules/') && !path.includes('/.git/')))
  execFileSync('tar', ['-xzf', archive, '-C', temporary])
  const pluginRoot = join(temporary, 'package')
  const entry = join(pluginRoot, 'dist/cli.mjs')
  const bundle = await readFile(entry, 'utf8')
  assert.doesNotMatch(bundle, /@deepseek-ai\/dsh-|@deepseek-ai\/cordis/)
  const projects = [join(temporary, 'project'), join(temporary, 'other')]
  const codexHome = join(temporary, 'codex-home')
  await Promise.all([...projects, codexHome].map(path => mkdir(path)))
  const calls = []
  provider = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions')
      assert.equal(req.headers.authorization, 'Bearer synthetic-test-key')
      let body = ''
      for await (const chunk of req) body += chunk
      const request = JSON.parse(body)
      assert.equal(request.tools, undefined)
      calls.push(request)
      const payload = JSON.parse(request.messages[1].content)
      const event = payload.events.find(event => event.kind === 'user')
      const content = request.messages[0].content.startsWith('Review') ? { approved: true, reason: 'Explicit observed user instruction' } : {
        updates: [{ title: '发布前运行测试', content: event.text, category: 'procedure', status: 'supported',
          evidence: [{ sessionId: event.sessionId, seq: event.seq, quote: event.text }] }], retire: [],
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }))
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve) })
  const configPath = join(temporary, 'config.json')
  await writeFile(configPath, JSON.stringify({ projectRoots: [projects[0]], storageDirectory: join(temporary, 'data'),
    model: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, name: 'scripted-fixture' } }))
  const env = { PATH: process.env.PATH, CODEX_HOME: codexHome, DREAM_TRACE_CONFIG: configPath, DREAM_TRACE_API_KEY: 'synthetic-test-key' }
  const hook = (hook_event_name, extra = {}) => JSON.parse(execFileSync(process.execPath, [entry, 'hook'], {
    cwd: temporary, env, encoding: 'utf8', input: JSON.stringify({ hook_event_name, cwd: projects[0], session_id: 'packed-session', turn_id: 'packed-turn', ...extra }),
  }))
  hook('SessionStart', { source: 'startup' })
  hook('UserPromptSubmit', { prompt: '发布前运行 npm test，并保留验证结果。' })
  hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'test-call', tool_input: { command: 'npm test' }, tool_response: 'Tests passed' })
  hook('Stop', { last_assistant_message: '测试已通过。' })

  transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'serve'], cwd: temporary, env, stderr: 'pipe' })
  client = new Client({ name: 'package-verifier', version: '1.0.0' })
  await client.connect(transport)
  assert.equal((await client.listTools()).tools.length, 8)
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    assert.notEqual(result.isError, true, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
  assert.equal((await call('dream_run')).created, 1)
  assert.equal(calls.length, 2)
  assert.equal((await call('dream_run')).unchanged, true)
  assert.equal(calls.length, 2)
  const [fact] = await call('memory_search', { query: 'npm' })
  assert.equal(fact.sources[0].sessionId, 'codex:packed-session')
  assert.equal(fact.content, '发布前运行 npm test，并保留验证结果。')
  assert.equal((await call('memory_read', { id: fact.id })).id, fact.id)
  assert.match(hook('SessionStart', { session_id: 'new-session', source: 'resume' }).hookSpecificOutput.additionalContext, /发布前运行测试/)
  const denied = await client.callTool({ name: 'memory_index', arguments: { projectRoot: projects[1] } })
  assert.equal(denied.isError, true)
  await call('memory_forget', { id: fact.id })
  assert.equal((await call('memory_search', { query: '' })).length, 0)
  assert.equal((await call('dream_rollback', { revision: 1 })).revision, 3)
  assert.equal((await call('dream_status')).facts, 1)

  // Exercise the official installer only in an isolated home, never the user's settings.
  const marketplace = JSON.parse(execFileSync('codex', ['plugin', 'marketplace', 'add', pluginRoot, '--json'], { env, encoding: 'utf8' }))
  assert.equal(marketplace.marketplaceName, 'dream-trace-local')
  const installed = JSON.parse(execFileSync('codex', ['plugin', 'add', 'dream-trace@dream-trace-local', '--json'], { env, encoding: 'utf8' }))
  assert.equal(installed.pluginId, 'dream-trace@dream-trace-local')
  assert.match(execFileSync(process.execPath, [join(installed.installedPath, 'dist/cli.mjs'), '--help'], { env, encoding: 'utf8' }), /Dream Trace/)

  // Installation alone is insufficient: prove the host discovers hooks and launches the bundled MCP.
  appServer = spawn('codex', ['app-server', '--stdio'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  const pending = new Map()
  const lines = createInterface({ input: appServer.stdout })
  lines.on('line', line => {
    const value = JSON.parse(line)
    const entry = pending.get(value.id)
    if (entry) { pending.delete(value.id); clearTimeout(entry.timer); value.error ? entry.reject(new Error(JSON.stringify(value.error))) : entry.resolve(value.result) }
  })
  let rpcId = 0
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++rpcId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex App Server timed out: ${method}`)) }, 20000)
    pending.set(id, { resolve, reject, timer })
    appServer.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  await request('initialize', { clientInfo: { name: 'dream-trace-verifier', version: '1' }, capabilities: { experimentalApi: true } })
  appServer.stdin.write('{"method":"initialized"}\n')
  const details = await request('plugin/read', { marketplacePath: join(pluginRoot, '.claude-plugin/marketplace.json'), pluginName: 'dream-trace' })
  assert.equal(details.plugin.hooks.length, 5)
  assert.equal(details.plugin.skills.length, 1)
  assert.deepEqual(details.plugin.mcpServers, ['dream-trace'])
  const inventory = await request('mcpServerStatus/list', {})
  const loaded = inventory.data.find(server => server.name === 'dream-trace')
  assert.ok(loaded, 'Codex must load the bundled MCP server')
  assert.equal(loaded.toolsError, null)
  assert.equal(Object.keys(loaded.tools).length, 8)
  console.log(`Verified ${files.length} packaged files, real stdio MCP, hook capture and recall, two scripted model calls, idempotence, scope, forget/rollback, official installation, and Codex discovery of 5 hooks / 8 tools.`)
} finally {
  if (appServer && appServer.exitCode === null) {
    const exited = new Promise(resolve => appServer.once('exit', resolve))
    appServer.kill('SIGTERM')
    const timer = setTimeout(() => appServer.kill('SIGKILL'), 3000)
    await exited
    clearTimeout(timer)
  }
  await client?.close()
  await transport?.close()
  if (provider?.listening) await new Promise(resolve => provider.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
