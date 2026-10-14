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

// Linux's /proc/self/fd child lookup is anchored to a *previously opened*
// directory inode. The original pathname can be renamed or replaced with a
// symlink after these handles are opened without redirecting any HTML read.
// O_NOFOLLOW alone on HTML is not sufficient: it doesn't protect parent names.
// Never fall back to unpinned original source paths on unsupported platforms.
export async function withPinnedCaptureStore(directory, store, useFilePath) {
  if (process.platform !== 'linux' || !segment(store) ||
      typeof useFilePath !== 'function') invalid()

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

  try {
    // The original-root path is no longer consulted for source child lookup.
    // In particular, /proc/self/fd/<fd>/<store> is safe against subsequent
    // root-path replacement while this descriptor is held open.
    const storePath = '/proc/self/fd/' + rootHandle.fd + '/' + store
    let storeHandle
    try {
      const originalStore = await lstat(storePath)
      if (!originalStore.isDirectory() || originalStore.isSymbolicLink()) invalid()
      storeHandle = await open(storePath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      const openedStore = await storeHandle.stat()
      if (!openedStore.isDirectory() ||
          openedStore.dev !== originalStore.dev ||
          openedStore.ino !== originalStore.ino) invalid()
    } catch {
      if (storeHandle) await storeHandle.close()
      invalid()
    }

    try {
      return await useFilePath((sourceId) => {
        if (!segment(sourceId)) invalid()
        return '/proc/self/fd/' + storeHandle.fd + '/' + sourceId + '.html'
      })
    } finally {
      await storeHandle.close()
    }
  } finally {
    await rootHandle.close()
  }
}
