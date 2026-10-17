import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** Anonymous device keys are random bearer secrets created by the browser. */
export function validDeviceKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)
}

const empty = () => ({ revision: 0, updatedAt: null, entries: {} })
const LOCK_WAIT_MS = 5_000
// A lock older than this belongs to a crashed writer: a write holds it for
// one read + one small file write, far below this bound.
const STALE_LOCK_MS = 15_000

/**
 * One JSON file per device. The file name is a hash of the key, so the bearer
 * secret itself never lands on disk.
 *
 * Compare-and-swap on `baseRevision` must hold across every store instance,
 * process or server that shares `dir`, not just within one process. Each
 * write therefore takes an exclusive per-device lock file (O_EXCL create) on
 * the shared directory, re-reads the current revision under that lock, and
 * publishes the new record through a uniquely named O_EXCL temp file plus an
 * atomic rename. The losing writer gets `conflict` with the stored record.
 */
export function createFileSyncStore({ dir }) {
  const queues = new Map()
  const baseFor = key => join(dir, createHash('sha256').update(key).digest('hex'))

  /**
   * The storage directory must be a real directory owned by this process
   * user; a symlink is refused and group/other access is removed before any
   * private record is written. Returns false when it does not exist yet.
   */
  async function checkDir({ create }) {
    if (create) await mkdir(dir, { recursive: true, mode: 0o700 })
    let info
    try { info = await lstat(dir) } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('sync directory must be a real directory')
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('sync directory has a different owner')
    if (info.mode & 0o077) await chmod(dir, 0o700)
    return true
  }

  async function read(key) {
    if (!await checkDir({ create: false })) return empty()
    let handle
    try {
      // Never follow a symlinked record, and refuse hard-linked aliases.
      handle = await open(`${baseFor(key)}.json`, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (error?.code === 'ENOENT') return empty()
      throw error
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1) throw new Error('sync record must be a single private file')
      const value = JSON.parse(await handle.readFile('utf8'))
      if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !value.entries || typeof value.entries !== 'object') throw new Error('corrupt sync record')
      return value
    } finally { await handle.close() }
  }

  async function withFileLock(key, task) {
    const lock = `${baseFor(key)}.lock`
    const deadline = Date.now() + LOCK_WAIT_MS
    let handle
    for (let attempt = 0; !handle; attempt++) {
      try {
        handle = await open(lock, 'wx', 0o600)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > STALE_LOCK_MS) { await unlink(lock).catch(() => {}); continue }
        } catch (statError) { if (statError?.code === 'ENOENT') continue; throw statError }
        if (Date.now() > deadline) throw new Error('sync record is busy')
        await sleep(Math.min(5 + attempt * 5, 50))
      }
    }
    try { return await task() } finally {
      await handle.close().catch(() => {})
      await unlink(lock).catch(() => {})
    }
  }

  // In-process queue first (cheap fairness for one server), then the
  // cross-process file lock that makes the revision check global.
  function exclusive(key, task) {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    queues.set(key, next)
    next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
    return next
  }

  function write(key, baseRevision, entries) {
    return exclusive(key, async () => {
      await checkDir({ create: true })
      return withFileLock(key, async () => {
        const current = await read(key)
        if (current.revision !== baseRevision) return { conflict: true, record: current }
        const record = { revision: current.revision + 1, updatedAt: new Date().toISOString(), entries }
        const file = `${baseFor(key)}.json`
        const temporary = `${baseFor(key)}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
          await rename(temporary, file)
        } catch (error) {
          await unlink(temporary).catch(() => {})
          throw error
        }
        return { conflict: false, record }
      })
    })
  }

  return { read: key => exclusive(key, () => read(key)), write }
}
