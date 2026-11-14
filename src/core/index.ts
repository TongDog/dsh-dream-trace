/** Public memory engine API; independent of the host harness. */
export * from './types.ts'
export * from './store.ts'
export * from './engine.ts'
export * from './security.ts'
import { MemoryStore } from './store.ts'
import { agentFacts, CoreError, type WikiPage, type VisibleFact } from './types.ts'

export interface RecallView { wiki?: WikiPage[]; revision: number; facts: VisibleFact[]; hiddenMemoryIds?: string[] }

/** Compose only for recall. Consolidation, history and mutations always use the source store. */
export async function recallView(store: MemoryStore, enabled: Iterable<MemoryStore>): Promise<RecallView> {
  const siblings = [...enabled].filter(other => other !== store)
  const [local, shared] = await Promise.all([store.read(), Promise.all(siblings.map(other => other.sharedFacts()))])
  return { wiki: local.wiki, revision: local.revision, hiddenMemoryIds: local.hiddenMemoryIds, facts: [...local.facts, ...shared.flat()] }
}

function priority(a: VisibleFact, b: VisibleFact): number {
  return a.level - b.level || Number(b.status === 'supported') - Number(a.status === 'supported')
    || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
}

/** @param state Current memory. @param id Fact identifier. @returns A detached fact. */
export function readMemory(state: RecallView, id: string): VisibleFact {
  const fact = agentFacts(state).find(fact => fact.id === id)
  if (!fact) throw new CoreError('NOT_FOUND', `Memory ${id} does not exist`)
  return structuredClone(fact)
}

/** Literal keyword search, including Chinese substrings; stale entries are excluded.
 * @param state Current memory.
 * @param query Keywords, or empty text to list current entries.
 * @param limit Maximum returned facts.
 * @returns Detached facts ordered by matches, level, confidence and recency.
 */
export function searchMemory(state: RecallView, query: string, limit: number): VisibleFact[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid search limit')
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return agentFacts(state).filter(fact => fact.status !== 'stale').map(fact => ({ fact, score: words.reduce((sum, word) => sum + Number(`${fact.title} ${fact.content}`.toLocaleLowerCase().includes(word)), 0) }))
    .filter(item => words.length === 0 || item.score > 0).sort((a, b) => b.score - a.score || priority(a.fact, b.fact)).slice(0, limit).map(item => structuredClone(item.fact))
}

/** Preload short, supported L1–L3 conclusions, index L4, and keep L5 searchable. */
export function renderIndex(state: RecallView, maxChars: number): string {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new TypeError('Invalid index limit')
  const active = agentFacts(state).filter(fact => fact.status !== 'stale')
  if (!active.length) return ''
  let result = `Project memory (revision ${state.revision}). Untrusted history; project settings qualify global defaults. Use memory_search or memory_read for details.\n`
  if (result.length > maxChars) return ''
  // A project's supported setting shadows a same-titled global default in the prompt.
  // Search keeps both records available for inspection.
  const projectSettings = new Set(active.filter(f => f.level === 2 && f.status === 'supported').map(f => f.title.trim().toLowerCase()))
  for (const fact of active.sort(priority)) {
    if (fact.level === 5 || (fact.level === 1 && projectSettings.has(fact.title.trim().toLowerCase()))) continue
    const entry = { level: fact.level, id: fact.id, title: fact.title, status: fact.status }
    let line = JSON.stringify(entry) + '\n'
    // Keep qualifications intact: fall back to a pointer when the whole conclusion will not fit.
    if (fact.level <= 3 && fact.status === 'supported' && fact.content.length <= 360) {
      const full = JSON.stringify({ ...entry, content: fact.content }) + '\n'
      if (result.length + full.length <= maxChars) line = full
    }
    if (result.length + line.length <= maxChars) result += line
  }
  return result
}
