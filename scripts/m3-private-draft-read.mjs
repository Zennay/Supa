// Fail-closed byte admission for locally retained, privately collected M3 drafts.
// Private data is returned only to the caller; no filename or contents are logged.
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'

const MAX_DRAFT_BYTES = 2 * 1024 * 1024
const REFUSAL = 'private M3 field draft could not be read'

function refuse() { throw new Error(REFUSAL) }

function allowedFile(stat) {
  return stat.isFile() && Number(stat.nlink) === 1 &&
    (Number(stat.mode) & 0o077) === 0 &&
    stat.size >= 1 && stat.size <= MAX_DRAFT_BYTES
}

async function rejectSymlinkedParents(filename) {
  let parent = dirname(filename)
  const root = parse(parent).root
  while (true) {
    const stat = await lstat(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse()
    if (parent === root) return
    parent = dirname(parent)
  }
}

// A descriptor is pinned across all reads: a checked pathname may not
// silently resolve to a different inode or grow into an unbounded JSON blob.
export async function readPrivateM3Draft(path) {
  if (typeof path !== 'string' || !path || path !== path.trim() ||
      path.startsWith('-') || path.includes('\0') ||
      typeof constants.O_NOFOLLOW !== 'number') refuse()
  const filename = resolve(path)
  try {
    await rejectSymlinkedParents(filename)
    const link = await lstat(filename)
    if (link.isSymbolicLink() || !allowedFile(link)) refuse()

    const fd = await open(
      filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const before = await fd.stat({ bigint: true })
      if (!allowedFile(before) ||
          before.dev !== BigInt(link.dev) || before.ino !== BigInt(link.ino) ||
          before.size !== BigInt(link.size)) refuse()

      const buffer = Buffer.alloc(64 * 1024)
      const chunks = []
      let total = 0
      while (true) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        total += bytesRead
        if (total > MAX_DRAFT_BYTES) refuse()
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      }
      const after = await fd.stat({ bigint: true })
      if (!after.isFile() || after.dev !== before.dev ||
          after.ino !== before.ino || after.size !== before.size ||
          after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
          BigInt(total) !== before.size) refuse()
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, total),
      )
    } finally {
      await fd.close()
    }
  } catch {
    refuse()
  }
}
