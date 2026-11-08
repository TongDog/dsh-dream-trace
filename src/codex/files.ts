/** Private atomic snapshots. Readers never observe a partially written trace. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export const hash = (text: string) => createHash('sha256').update(text).digest('hex')

export async function readPrivateJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Trace is not a regular file or exceeds 64 MiB')
    return JSON.parse(await file.readFile('utf8'))
  } finally { await file.close() }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } finally { await unlink(temporary).catch(() => {}) }
}
