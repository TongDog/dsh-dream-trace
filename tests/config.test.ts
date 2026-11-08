import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import test from 'node:test'
import { Config, configSchema } from '../src/config.ts'

test('loader and direct configuration share defaults and install without scanning projects', () => {
  const direct = configSchema.parse({})
  assert.deepEqual(configSchema.parse(Config({})), direct)
  assert.deepEqual(direct.projectRoots, [])
  assert.equal(direct.autoRunAfterTurn, false)
  assert.equal(direct.autoRunIntervalMinutes, 0)
  assert.equal(direct.verify, true)
  assert.equal(isAbsolute(direct.storageDirectory), true)
})

test('rejects relative storage or project paths and unrecognized configuration', () => {
  for (const input of [
    { projectRoots: ['relative-project'] }, { projectRoots: [''] },
    { storageDirectory: './memory' }, { provider: '' }, { model: '' },
    { autoRnuAfterTurn: true },
  ]) assert.equal(configSchema.safeParse(input).success, false, JSON.stringify(input))
})

test('rejects unbounded, fractional, or disabled safety limits', () => {
  for (const input of [
    { autoRunIntervalMinutes: -1 }, { afterTurnDelaySeconds: 0 },
    { maxSessionsPerRun: 1.5 }, { maxEventsPerRun: 0 },
    { maxInputChars: Number.POSITIVE_INFINITY }, { maxFacts: 0 },
    { maxFactChars: 12001 }, { maxFactsPerRun: 101 },
    { maxOutputTokens: 0 }, { runTimeoutSeconds: 3601 },
    { searchLimit: -1 }, { maxIndexChars: 0 },
  ]) assert.equal(configSchema.safeParse(input).success, false, JSON.stringify(input))
})

test('proposal and input budgets must leave usable evidence capacity', () => {
  assert.equal(configSchema.safeParse({ maxInputChars: 13000, maxProposalChars: 12000 }).success, false)
  assert.equal(configSchema.safeParse({ maxInputChars: 13001, maxProposalChars: 12000 }).success, true)
  assert.equal(configSchema.safeParse({ maxInputChars: 4000, maxProposalChars: 500 }).success, true)
  assert.equal(configSchema.safeParse({ maxInputChars: 4000 }).success, false)
})
