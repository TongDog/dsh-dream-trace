/** Produce a self-contained local Codex plugin without Harness runtime peers. */
import { build } from 'esbuild'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'codex-plugin', 'dist')
await mkdir(out, { recursive: true })
const result = await build({
  entryPoints: [join(root, 'src/codex/cli.ts')], outfile: join(out, 'cli.mjs'), bundle: true,
  platform: 'node', format: 'esm', target: 'node24', sourcemap: false, metafile: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: 'eof',
})
await chmod(join(out, 'cli.mjs'), 0o755)
await copyFile(join(root, 'LICENSE'), join(root, 'codex-plugin', 'LICENSE'))
const packages = new Set(Object.keys(result.metafile.inputs).flatMap(path => {
  const match = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  return match ? [match[1]] : []
}))
const notices = []
for (const name of [...packages].sort()) {
  const directory = join(root, 'node_modules', name)
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  let license = ''
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try { license = await readFile(join(directory, candidate), 'utf8'); break } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!license) throw new Error(`Missing bundled license for ${name}`)
  notices.push(`${name}@${pkg.version} (${pkg.license})\n${license}`)
}
await writeFile(join(out, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n-----\n\n'))
console.log(`Built standalone Dream Trace plugin (${packages.size} bundled dependencies).`)
