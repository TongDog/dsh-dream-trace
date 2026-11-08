#!/usr/bin/env node
/** Validate the built tarball and import its actual distributed entry with installed DSH peers. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createContext, Script } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Extraction remains below the project so Node resolves the real installed peer dependencies.
const temporary = await mkdtemp(join(root, '.package-check-'))
try {
  let archive = process.argv[2] ? resolve(process.argv[2]) : undefined
  if (!archive) {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, '--cache', join(temporary, 'npm-cache')], { cwd: root, encoding: 'utf8' }))
    assert.equal(packed.length, 1, 'npm pack must produce exactly one archive')
    archive = join(temporary, packed[0].filename)
  }
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
  for (const entry of entries) {
    assert.ok(entry.startsWith('package/'), `unexpected archive root: ${entry}`)
    assert.equal(isAbsolute(entry), false)
    assert.equal(entry.split('/').includes('..'), false)
    assert.equal(entry.includes('/node_modules/'), false, 'the package must not vendor development dependencies')
    assert.equal(entry.includes('/.git/'), false, 'the package must not contain repository internals')
  }
  const required = ['package.json', 'lib/index.js', 'lib/index.d.ts', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'LICENSE', 'README.md', 'docs/compatibility.md']
  for (const path of required) assert.ok(entries.includes(`package/${path}`), `tarball is missing ${path}`)

  execFileSync('tar', ['-xzf', archive, '-C', temporary])
  const packageRoot = join(temporary, 'package')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-plugin-dreaming')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.equal(manifest.exports['.'].types, './lib/index.d.ts')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(Array.isArray(manifest.dsh.client.inject), 'Client package dependencies must be declared')
  for (const name of ['@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar']) {
    assert.ok(manifest.dsh.client.inject.includes(name), `Client metadata must name ${name}`)
  }
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-tools']) {
    assert.ok(manifest.peerDependencies[name], `${name} must share the Host installation`)
    assert.ok(manifest.devDependencies[name], `${name} must support local checks`)
  }
  const uiLocales = {}
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(await readFile(join(packageRoot, 'locale', `${language}.json`), 'utf8'))
    assert.ok(typeof locale.meta.title === 'string' && locale.meta.title.trim())
    assert.ok(typeof locale.meta.description === 'string' && locale.meta.description.trim())
    assert.ok(locale.ui && typeof locale.ui === 'object' && !Array.isArray(locale.ui), `${language} must include the memory UI dictionary`)
    for (const [key, value] of Object.entries(locale.ui)) {
      assert.ok(typeof value === 'string' && value.trim(), `${language}.ui.${key} must be nonempty text`)
    }
    uiLocales[language] = locale.ui
  }
  assert.deepEqual(Object.keys(uiLocales.en).sort(), Object.keys(uiLocales.zh).sort(), 'English and Chinese UI dictionaries must have matching keys')
  assert.equal(uiLocales.en.panel, 'Memory')
  assert.equal(uiLocales.zh.panel, '记忆')

  // Materialize only the distributed lazy factory: component rendering and Host
  // integration are exercised separately in the real Harness browser.
  const clientCode = await readFile(join(packageRoot, 'client.js'), 'utf8')
  assert.doesNotMatch(clientCode, /(?:from\s*|import\s*\(|require\s*\()\s*['"]node:/, 'the browser bundle must not import Node modules')
  assert.doesNotMatch(clientCode, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED|__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE|ReactCurrentDispatcher|react\.(?:development|production(?:\.min)?)\.js/, 'the browser bundle must use the Host React runtime instead of bundling a second copy')
  assert.doesNotMatch(clientCode, /__LOCALES__|__PROTOCOL__/, 'the browser bundle must contain built dictionaries and Remote codecs')
  const loaded = []
  const requestedModules = []
  let renderedElements = 0
  const hostReact = Object.freeze({ createElement() { ++renderedElements } })
  const context = createContext({
    window: { __ModuleLoader__: { load(entry) { loaded.push(entry) } } },
    requireHostModule(name) {
      assert.equal(name, 'react', `unexpected browser runtime import: ${name}`)
      requestedModules.push(name)
      return hostReact
    },
  }, { codeGeneration: { strings: false, wasm: false } })
  new Script(clientCode, { filename: 'packed/client.js' }).runInContext(context, { timeout: 5000 })
  assert.equal(loaded.length, 1, 'the Client bundle must register exactly one lazy factory')
  assert.equal(loaded[0].id, manifest.name, 'the Client factory id must match the package name')
  assert.equal(typeof loaded[0].factory, 'function')
  assert.deepEqual(requestedModules, [], 'loading the bundle must not materialize its factory')
  context.clientFactory = loaded[0].factory
  const clientPlugin = new Script('clientFactory(requireHostModule)', { filename: 'packed/client-factory.js' }).runInContext(context, { timeout: 5000 })
  assert.deepEqual(requestedModules, ['react'], 'the Client must obtain React from the Host module table exactly once')
  assert.equal(renderedElements, 0, 'materializing a plugin must not render its components')
  assert.ok(Array.isArray(clientPlugin.inject))
  assert.deepEqual([...clientPlugin.inject].sort(), ['locale', 'remote', 'slots'])
  assert.equal(typeof clientPlugin.apply, 'function')
  const icon = await readFile(join(packageRoot, 'icon.svg'), 'utf8')
  assert.match(icon, /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.doesNotMatch(icon, /<script\b|\bonload\s*=|\bhref\s*=\s*["']https?:/i)
  assert.ok((await stat(join(packageRoot, 'icon.svg'))).size <= 256 * 1024)
  const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: dsh-plugin-dreaming/)
  assert.match(patch, /name: dsh-plugin-dreaming/)
  assert.match(patch, /projectRoots: \[\]/)

  async function inspectBuiltDirectory(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name)
      assert.equal(entry.isSymbolicLink(), false, 'runtime files must be ordinary packed files')
      if (entry.isDirectory()) await inspectBuiltDirectory(target)
      else if (entry.name.endsWith('.js')) {
        const code = await readFile(target, 'utf8')
        assert.doesNotMatch(code, /(?:from\s*|import\s*\()['"]\.{1,2}\/[^'"]+\.ts['"]/, `built JavaScript must not import TypeScript: ${entry.name}`)
      }
    }
  }
  await inspectBuiltDirectory(join(packageRoot, 'lib'))
  const plugin = await import(pathToFileURL(join(packageRoot, 'lib/index.js')).href)
  assert.equal(typeof plugin.default, 'function')
  assert.ok(Array.isArray(plugin.default.inject))
  assert.equal(typeof plugin.default.Config?.['~standard']?.validate, 'function', 'Cordis must receive a real Standard Schema Config')
  const validation = await plugin.default.Config['~standard'].validate({ projectRoots: [] })
  assert.equal(validation.issues, undefined, 'the installed default config must validate')
  console.log(`Verified ${manifest.name}@${manifest.version}: ${entries.length} packed files, metadata, bilingual UI dictionaries, lazy Client factory with Host React, icon, bundle patch, Config, and built ESM import against installed DSH peers.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
