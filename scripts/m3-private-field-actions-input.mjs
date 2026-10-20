import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'

import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

// This is a local operator draft, never an approved observed-price dataset.
// Bound the bytes read, not just the preflight size: a file can grow after
// fstat. Reject symlinks, hardlinks and public permissions before inspecting
// even the private sheet metadata. Ancestor-path checks are best-effort; this
// path-based utility is not a hostile concurrent-filesystem sandbox.
const MAX_PRIVATE_ACTION_DRAFT_BYTES = 2 * 1024 * 1024
const CHUNK_BYTES = 16 * 1024

function validPrivateInputFile(stat) {
  return stat.isFile() &&
    stat.nlink === 1 &&
    (stat.mode & 0o077) === 0 &&
    stat.size >= 0 &&
    stat.size <= MAX_PRIVATE_ACTION_DRAFT_BYTES
}

function sameInode(a, b) {
  return a.dev === b.dev && a.ino === b.ino
}

export async function readPrivateM3ActionDraft(path) {
  if (typeof path !== 'string' || !path.trim() ||
      path !== path.trim() || path.startsWith('-')) {
    throw new Error('unsafe private M3 input path')
  }
  await assertNoSymlinkedM3OutputParents(path)
  const initial = await lstat(path)
  if (!validPrivateInputFile(initial)) throw new Error('unsafe private M3 input file')

  // Refuse a final-component symlink swap. Linux also refuses symbolic links
  // when O_NOFOLLOW is specified, even if they appear after lstat.
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('private M3 no-follow input unavailable')
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const pinned = await handle.stat()
    if (!validPrivateInputFile(pinned) || !sameInode(initial, pinned)) {
      throw new Error('private M3 input changed')
    }
    const chunks = []
    const buffer = Buffer.alloc(CHUNK_BYTES)
    let total = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > MAX_PRIVATE_ACTION_DRAFT_BYTES) {
        throw new Error('private M3 input too large')
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    const finished = await handle.stat()
    await assertNoSymlinkedM3OutputParents(path)
    const final = await lstat(path)
    if (!validPrivateInputFile(finished) || !validPrivateInputFile(final) ||
        !sameInode(pinned, finished) || !sameInode(pinned, final) ||
        finished.size !== total || final.size !== total ||
        pinned.mtimeMs !== finished.mtimeMs ||
        pinned.ctimeMs !== finished.ctimeMs ||
        pinned.mtimeMs !== final.mtimeMs ||
        pinned.ctimeMs !== final.ctimeMs) {
      throw new Error('private M3 input changed during read')
    }
    // Buffer.toString('utf8') silently replaces malformed bytes. A local
    // operator draft must not pass a damaged byte stream as a valid capture.
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
  } finally {
    await handle.close()
  }
}
