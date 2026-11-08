import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const locales = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => [language, JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8')).ui])))
const source = await readFile(new URL('client/source.js', root), 'utf8')
// Bundle strict codec closures; React still comes exclusively from the Host's module table.
const result = await build({
  stdin: { contents: `import { dreamingClientContribution } from './src/ui-protocol.ts';\n${source.replace('/*__LOCALES__*/ {}', JSON.stringify(locales)).replace('/*__PROTOCOL__*/ {}', 'dreamingClientContribution')}`, resolveDir: fileURLToPath(root), sourcefile: 'dreaming-client.js' },
  bundle: true, platform: 'browser', target: 'es2022', format: 'iife', minify: true, write: false,
})
await writeFile(new URL('client.js', root), result.outputFiles[0].contents)
