import { lstat, open, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, parse, sep } from 'node:path'

// Reject untrusted directory aliases before creating a private derived artifact.
// This is a static preflight, not a guarantee against concurrent parent
// directory replacement (requires descriptor-relative openat/renameat).
export async function assertNoSymlinkedM3OutputParents(output) {
  // Do not lexically resolve ".." before walking: doing so can hide a
  // symlink that the kernel would follow before processing the parent segment.
  const parent = dirname(output)
  const absolute = isAbsolute(parent)
  const root = absolute ? parse(parent).root : process.cwd()
  const segments = (absolute ? parent.slice(root.length) : parent).split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') {
      current = dirname(current)
      continue
    }
    current = join(current, segment)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
    if (info.isSymbolicLink()) {
      throw new Error('refusing symlinked M3 output parent directory')
    }
    if (!info.isDirectory()) {
      throw new Error('refusing non-directory M3 output parent')
    }
  }
}

// Atomic private publication for locally derived M3 JSON. Never truncate an
// existing report: readers must see the complete previous inode until the new
// private file is fully written, synced, and renamed into place.
//
// These path checks protect against accidental aliases and final-component
// symlink swaps. Node's path-based API cannot guarantee protection against a
// hostile process replacing ancestor directories between preflight and rename.
// Do not present this as a descriptor-relative hostile-filesystem sandbox.
export async function writeDerivedM3Output(input, output, serialized) {
  await assertNoSymlinkedM3OutputParents(output)
  const source = await stat(input)
  const parent = dirname(output)
  const pinnedParent = await lstat(parent)
  if (!pinnedParent.isDirectory()) {
    throw new Error('refusing non-directory M3 output parent')
  }

  function samePhysicalFile(left, right) {
    return left && right && left.dev === right.dev && left.ino === right.ino
  }

  async function assertUnchangedParent() {
    const current = await lstat(parent)
    if (!current.isDirectory() || !samePhysicalFile(pinnedParent, current)) {
      throw new Error('M3 output parent changed during private report publication')
    }
  }

  async function unchangedStagingFile(identity, path) {
    const current = await lstat(path)
    return current.isFile() && samePhysicalFile(identity, current)
  }

  async function checkDestination() {
    let existing
    try {
      existing = await lstat(output)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      return
    }
    if (existing.isSymbolicLink()) {
      throw new Error('refusing symlinked M3 derived output file')
    }
    if (!existing.isFile()) {
      throw new Error('refusing nonregular M3 derived output file')
    }
    if (source.dev === existing.dev && source.ino === existing.ino) {
      throw new Error('refusing to overwrite M3 evidence input with derived output')
    }
  }

  // Check prior to writing, and again just before publication. Replacing a
  // link between these checks is caught or atomically replaces the link itself
  // without writing to its target.
  await checkDestination()
  const staged = join(parent, `.${basename(output)}.${randomUUID()}.m3-tmp`)
  let handle
  let stagedCreated = false
  let stagedIdentity
  let published = false
  try {
    handle = await open(staged, 'wx', 0o600)
    stagedCreated = true
    stagedIdentity = await handle.stat()
    // writeFile accepts both strings and async iterables. In particular an
    // interrupted async serialization may not expose partial final output.
    await handle.writeFile(serialized, { encoding: 'utf8' })
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = undefined

    await assertNoSymlinkedM3OutputParents(output)
    await assertUnchangedParent()
    await checkDestination()
    if (!(await unchangedStagingFile(stagedIdentity, staged))) {
      throw new Error('M3 staging file changed before report publication')
    }
    await rename(staged, output)
    published = true
  } finally {
    try {
      if (handle) await handle.close()
    } finally {
      // A moved/replaced parent or stolen staging pathname must never cause
      // cleanup to unlink an unrelated private file. In such a hostile race
      // the original staging inode may remain at its moved location: a
      // path-only Node API cannot safely locate or remove that original.
      if (stagedCreated && stagedIdentity && !published) {
        try {
          await assertNoSymlinkedM3OutputParents(output)
          await assertUnchangedParent()
          if (await unchangedStagingFile(stagedIdentity, staged)) {
            await rm(staged, { force: true })
          }
        } catch {
          // Refuse unsafe path-based cleanup, preserving unrelated files.
        }
      }
    }
  }
}
