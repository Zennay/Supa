import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

function invalid() {
  throw new Error('Invalid frozen offline capture source')
}

function segment(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

// Pin ONE original root directory for the entire cohort. Each supermarket
// directory is opened once and cached by canonical name, not re-opened for
// later rows. Linux /proc/self/fd child lookups then remain anchored to the
// original inodes after a root/store pathname is renamed or replaced.
// Unsupported platforms fail closed; no fallback to mutable original paths.
export async function withPinnedCaptureTree(directory, inspectCohort) {
  if (process.platform !== 'linux' || typeof inspectCohort !== 'function') invalid()

  let rootHandle
  try {
    const originalRoot = await lstat(directory)
    if (!originalRoot.isDirectory() || originalRoot.isSymbolicLink() ||
        await realpath(directory) !== path.resolve(directory)) invalid()
    rootHandle = await open(directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const openedRoot = await rootHandle.stat()
    if (!openedRoot.isDirectory() ||
        openedRoot.dev !== originalRoot.dev ||
        openedRoot.ino !== originalRoot.ino) invalid()
  } catch {
    if (rootHandle) await rootHandle.close()
    invalid()
  }

  const stores = new Map()
  try {
    return await inspectCohort(async (storeName) => {
      if (!segment(storeName)) invalid()
      if (!stores.has(storeName)) {
        // Do not allow a direct helper user to exhaust descriptors beyond
        // M5's maximum of 100 manifest sources.
        if (stores.size >= 100) invalid()
        const storePath = '/proc/self/fd/' + rootHandle.fd + '/' + storeName
        let handle
        try {
          const before = await lstat(storePath)
          if (!before.isDirectory() || before.isSymbolicLink()) invalid()
          handle = await open(storePath,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
          const pinned = await handle.stat()
          if (!pinned.isDirectory() ||
              pinned.dev !== before.dev || pinned.ino !== before.ino) invalid()
        } catch {
          if (handle) await handle.close()
          invalid()
        }
        stores.set(storeName, handle)
      }
      const pinnedStore = stores.get(storeName)
      return (sourceId) => {
        if (!segment(sourceId)) invalid()
        return '/proc/self/fd/' + pinnedStore.fd + '/' + sourceId + '.html'
      }
    })
  } finally {
    try {
      for (const storeHandle of stores.values()) await storeHandle.close()
    } finally {
      await rootHandle.close()
    }
  }
}

// Compatibility convenience for exactly one store; preserve the published
// test seam while the product uses withPinnedCaptureTree across all stores.
export async function withPinnedCaptureStore(directory, storeName, useFilePath) {
  if (typeof useFilePath !== 'function') invalid()
  return withPinnedCaptureTree(directory, async (storeLookup) =>
    useFilePath(await storeLookup(storeName)))
}
