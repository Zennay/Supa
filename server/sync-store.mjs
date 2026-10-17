import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** Anonymous device keys are random bearer secrets created by the browser. */
export function validDeviceKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)
}

const empty = () => ({ revision: 0, updatedAt: null, entries: {} })
const LOCK_WAIT_MS = 5_000
// A lock is only considered for recovery once it is older than this; it is
// then removed only if no live process still holds it (see lockHolderAlive).
const STALE_LOCK_MS = 15_000

/**
 * Is any live process still holding this lock? On Linux, a holder keeps the
 * lock file open, so look for an open descriptor on the same inode in /proc
 * (only this user's processes are readable, and the storage directory must
 * belong to this user). Elsewhere, fall back to the pid/host written in the
 * lock; a lock that cannot be attributed is treated as live (fail closed).
 */
async function lockHolderAlive(lock, info) {
  let pids = null
  try { pids = (await readdir('/proc')).filter(name => /^\d+$/.test(name)) } catch { /* not Linux */ }
  if (pids) {
    for (const pid of pids) {
      let fds
      try { fds = await readdir(`/proc/${pid}/fd`) } catch { continue }
      for (const fd of fds) {
        try {
          const target = await stat(`/proc/${pid}/fd/${fd}`)
          if (target.ino === info.ino && target.dev === info.dev) return true
        } catch { /* fd closed meanwhile */ }
      }
    }
    return false
  }
  try {
    const owner = JSON.parse(await readFile(lock, 'utf8'))
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid)) return true
    try { process.kill(owner.pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
  } catch { return true }
}

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
  async function checkAncestors() {
    // Every existing component of the configured path, ancestors included,
    // must not be a symlink: an alias could redirect or import private
    // records. Only root-owned system links (macOS /var -> /private/var) are
    // allowed, and only when the server itself does not run as root, since
    // a root server could not tell those apart from links it planted itself.
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1
    const components = []
    for (let path = resolve(dir); ; path = dirname(path)) {
      components.unshift(path)
      if (dirname(path) === path) break
    }
    for (const path of components) {
      let info
      try { info = await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
      if (info.isSymbolicLink() && !(info.uid === 0 && uid !== 0)) throw new Error('sync directory path must not contain symlinks')
    }
  }

  async function checkDir({ create }) {
    await checkAncestors()
    if (create) { await mkdir(dir, { recursive: true, mode: 0o700 }); await checkAncestors() }
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
    const token = randomUUID()
    const deadline = Date.now() + LOCK_WAIT_MS
    let handle
    for (let attempt = 0; !handle; attempt++) {
      try {
        handle = await open(lock, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), token }))
      } catch (error) {
        if (handle) { await handle.close().catch(() => {}); await unlink(lock).catch(() => {}); throw error }
        if (error?.code !== 'EEXIST') throw error
        try {
          const info = await lstat(lock)
          if (Date.now() - info.mtimeMs > STALE_LOCK_MS && !await lockHolderAlive(lock, info)) {
            // Re-check it is still the same abandoned lock before removing it.
            const again = await lstat(lock)
            if (again.ino === info.ino && again.dev === info.dev) await unlink(lock).catch(() => {})
            continue
          }
        } catch (statError) { if (statError?.code === 'ENOENT') continue; throw statError }
        if (Date.now() > deadline) throw new Error('sync record is busy')
        await sleep(Math.min(5 + attempt * 5, 50))
      }
    }
    // Fencing: publish only while the lock on disk is still this writer's.
    const stillOwned = async () => {
      try { return JSON.parse(await readFile(lock, 'utf8')).token === token } catch { return false }
    }
    try { return await task(stillOwned) } finally {
      await handle.close().catch(() => {})
      if (await stillOwned()) await unlink(lock).catch(() => {})
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
      return withFileLock(key, async stillOwned => {
        const current = await read(key)
        if (current.revision !== baseRevision) return { conflict: true, record: current }
        const record = { revision: current.revision + 1, updatedAt: new Date().toISOString(), entries }
        const file = `${baseFor(key)}.json`
        const temporary = `${baseFor(key)}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
          if (!await stillOwned()) throw new Error('sync lock was lost before publishing')
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
