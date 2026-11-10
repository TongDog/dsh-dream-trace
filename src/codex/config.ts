/** Codex configuration is independent of Harness and never contains credentials. */
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'

const absolute = z.string().min(1).refine(isAbsolute, 'Use an absolute path')
export const codexConfigSchema = z.object({
  projectRoots: z.array(absolute).default([]),
  storageDirectory: absolute.optional(),
  autoRun: z.boolean().default(false),
  autoRunIntervalSeconds: z.number().int().min(10).max(86400).default(30),
  model: z.union([z.object({
    backend: z.literal('api').default('api'),
    baseUrl: z.url().refine(value => {
      const url = new URL(value)
      return !url.username && !url.password && !url.search && !url.hash &&
        (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    }, 'Use HTTPS, or HTTP on loopback, without credentials/query/fragment'),
    name: z.string().min(1),
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('DREAM_TRACE_API_KEY'),
    tokenLimitField: z.enum(['max_completion_tokens', 'max_tokens']).default('max_completion_tokens'),
  }).strict(), z.object({
    backend: z.literal('codex'),
    command: z.string().min(1).refine(value => value === 'codex' || isAbsolute(value), 'Use codex or an absolute executable path').default('codex'),
    name: z.string().min(1).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  }).strict()]).optional(),
  verify: z.boolean().default(true),
  maxSessionsPerRun: z.number().int().min(1).max(1000).default(10),
  maxEventsPerRun: z.number().int().min(1).max(100000).default(2000),
  maxInputChars: z.number().int().min(4000).max(1000000).default(60000),
  maxProposalChars: z.number().int().min(500).max(200000).default(12000),
  maxFacts: z.number().int().min(1).max(10000).default(100),
  maxFactChars: z.number().int().min(100).max(12000).default(1800),
  maxFactsPerRun: z.number().int().min(1).max(100).default(20),
  maxIndexChars: z.number().int().min(256).max(32000).default(4000),
  maxOutputTokens: z.number().int().min(256).max(64000).default(6000),
  runTimeoutSeconds: z.number().int().min(1).max(3600).default(180),
  searchLimit: z.number().int().min(1).max(100).default(20),
  maxCaptureChars: z.number().int().min(1000).max(1000000).default(100000),
}).strict().refine(c => c.maxProposalChars + 1000 < c.maxInputChars, 'Leave at least 1000 input characters beyond the proposal budget')

export type CodexConfig = Omit<z.output<typeof codexConfigSchema>, 'storageDirectory'> & { storageDirectory: string }
export const defaultHome = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'dream-trace')
export const defaultConfigPath = () => process.env.DREAM_TRACE_CONFIG || join(defaultHome(), 'config.json')
export const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT'

export function contains(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export async function resolveConfig(input: unknown): Promise<CodexConfig> {
  const parsed = codexConfigSchema.parse(input)
  const roots = await Promise.all(parsed.projectRoots.map(async root => {
    const canonical = await realpath(root)
    if (!(await stat(canonical)).isDirectory()) throw new Error('A configured project root is not a directory')
    return canonical
  }))
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
    if (contains(roots[i], roots[j]) || contains(roots[j], roots[i])) throw new Error('Project roots must be distinct and must not overlap')
  }
  return { ...parsed, projectRoots: roots, storageDirectory: parsed.storageDirectory ?? join(defaultHome(), 'data') }
}

export async function loadConfig(path = defaultConfigPath()): Promise<CodexConfig> {
  if (!isAbsolute(path)) throw new Error('DREAM_TRACE_CONFIG must be an absolute path')
  let input: unknown
  try { input = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    // An absent default is inert. An explicitly selected missing file is a configuration error.
    if (!missing(error) || process.env.DREAM_TRACE_CONFIG || path !== defaultConfigPath()) throw error
    input = {}
  }
  return resolveConfig(input)
}

export async function projectForDirectory(config: CodexConfig, cwd: string): Promise<string | undefined> {
  if (!isAbsolute(cwd)) return
  let canonical: string
  try { canonical = await realpath(cwd) } catch (error) { if (missing(error)) return; throw error }
  return config.projectRoots.find(root => contains(root, canonical))
}
