import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Anonymous device keys are random bearer secrets created by the browser. */
export function validDeviceKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)
}

const empty = () => ({ revision: 0, updatedAt: null, entries: {} })

/**
 * One JSON file per device. The file name is a hash of the key, so the bearer
 * secret itself never lands on disk. Writes are serialized per device and use
 * an atomic rename; `baseRevision` gives optimistic concurrency between tabs
 * and devices instead of last-writer-wins.
 */
export function createFileSyncStore({ dir }) {
  const queues = new Map()
  const fileFor = key => join(dir, `${createHash('sha256').update(key).digest('hex')}.json`)

  async function read(key) {
    try {
      const value = JSON.parse(await readFile(fileFor(key), 'utf8'))
      if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !value.entries || typeof value.entries !== 'object') throw new Error('corrupt sync record')
      return value
    } catch (error) {
      if (error?.code === 'ENOENT') return empty()
      throw error
    }
  }

  function exclusive(key, task) {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    queues.set(key, next)
    next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
    return next
  }

  function write(key, baseRevision, entries) {
    return exclusive(key, async () => {
      const current = await read(key)
      if (current.revision !== baseRevision) return { conflict: true, record: current }
      const record = { revision: current.revision + 1, updatedAt: new Date().toISOString(), entries }
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const file = fileFor(key)
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
      await rename(temporary, file)
      return { conflict: false, record }
    })
  }

  return { read: key => exclusive(key, () => read(key)), write }
}
