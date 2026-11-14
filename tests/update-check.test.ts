import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { checkForUpdate, compareVersions, installedVersion } from '../src/update-check.ts'

function response(body: unknown, options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): typeof fetch {
  return (async () => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: (name: string) => options.headers?.[name.toLowerCase()] ?? null },
    json: async () => body,
  })) as unknown as typeof fetch
}

test('semantic version comparison handles core, prerelease, and build parts', () => {
  assert.equal(compareVersions('0.3.2', '0.3.1'), 1)
  assert.equal(compareVersions('0.3.1', '0.3.1'), 0)
  assert.equal(compareVersions('0.2.9', '0.3.1'), -1)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('v0.4.0', '0.4.0'), 0)
  assert.equal(compareVersions('0.4.0-beta.1', '0.4.0'), -1)
  assert.equal(compareVersions('0.4.0', '0.4.0-beta.1'), 1)
  assert.equal(compareVersions('0.4.0-beta.2', '0.4.0-beta.10'), -1)
  assert.equal(compareVersions('0.4.0-alpha', '0.4.0-alpha.1'), -1)
  assert.equal(compareVersions('0.4.0+build.7', '0.4.0'), 0)
})

test('the installed version comes from the packaged manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(installedVersion(), manifest.version)
})

test('a strictly newer published version is reported as an update', async () => {
  let requested: string | undefined
  const stubFetch = (async (url: string) => {
    requested = url
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ name: 'dsh-plugin-dreaming', version: '9.9.9' }) }
  }) as unknown as typeof fetch
  const result = await checkForUpdate({ version: '0.3.1', feeds: ['https://example.test/package.json'], fetch: stubFetch })
  assert.equal(requested, 'https://example.test/package.json')
  assert.equal(result.currentVersion, '0.3.1')
  assert.equal(result.latestVersion, '9.9.9')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.error, null)
  assert.match(result.projectUrl, /^https:\/\/github\.com\//)
  assert.doesNotThrow(() => new Date(result.checkedAt).toISOString())
})

test('equal or older published versions are not an update', async () => {
  for (const version of ['0.3.1', '0.3.0']) {
    const result = await checkForUpdate({ version: '0.3.1', feeds: ['https://example.test/package.json'], fetch: response({ version }) })
    assert.equal(result.updateAvailable, false)
    assert.equal(result.latestVersion, version)
    assert.equal(result.error, null)
  }
})

test('feed fallbacks are tried in order and a later success clears earlier failures', async () => {
  const seen: string[] = []
  const stubFetch = (async (url: string) => {
    seen.push(url)
    if (url.endsWith('/first')) throw new Error('offline')
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ version: '1.0.0' }) }
  }) as unknown as typeof fetch
  const result = await checkForUpdate({ version: '0.9.0', feeds: ['https://example.test/first', 'https://example.test/second'], fetch: stubFetch })
  assert.deepEqual(seen, ['https://example.test/first', 'https://example.test/second'])
  assert.equal(result.latestVersion, '1.0.0')
  assert.equal(result.error, null)
})

test('network, HTTP, and malformed feed failures are data, never throws', async () => {
  const offline = await checkForUpdate({
    version: '0.3.1', feeds: ['https://example.test/package.json'],
    fetch: (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch,
  })
  assert.equal(offline.latestVersion, null)
  assert.equal(offline.updateAvailable, false)
  assert.match(offline.error ?? '', /ENOTFOUND/)

  const limited = await checkForUpdate({
    version: '0.3.1', feeds: ['https://example.test/package.json'],
    fetch: response({ message: 'API rate limit exceeded' }, { ok: false, status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
  })
  assert.equal(limited.latestVersion, null)
  assert.match(limited.error ?? '', /rate limit/)

  const malformed = await checkForUpdate({ version: '0.3.1', feeds: ['https://example.test/package.json'], fetch: response({ version: 'not-a-version' }) })
  assert.equal(malformed.latestVersion, null)
  assert.match(malformed.error ?? '', /valid version/)
})

test('every failing feed is reported when no source answers', async () => {
  const result = await checkForUpdate({
    version: '0.3.1', feeds: ['https://example.test/one', 'https://example.test/two'],
    fetch: response({}, { ok: false, status: 500 }),
  })
  assert.equal(result.latestVersion, null)
  assert.match(result.error ?? '', /example\.test\/one/)
  assert.match(result.error ?? '', /example\.test\/two/)
})
