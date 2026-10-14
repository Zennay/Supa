import { lstat, open, stat, writeFile } from 'node:fs/promises'
import { dirname, parse, resolve, sep } from 'node:path'

// Reject untrusted directory aliases before creating a private derived artifact.
// This is a static preflight, not a defense against adversarial concurrent swaps
// (those require descriptor-relative atomic publication; tracked separately).
export async function assertNoSymlinkedM3OutputParents(output) {
  const parent = dirname(resolve(output))
  const root = parse(parent).root
  const segments = parent.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = resolve(current, segment)
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

// M3 field sheets and derived studies must never be replaced by their own
// derived output. A different pathname can be the same file via hardlinks or
// symlinks (including symlinks in parent directories).
//
// Open existing output *without truncating*, inspect the open descriptor's
// device/inode, and only then write. An output created concurrently with an
// ENOENT probe is refused by 'wx' rather than accidentally overwritten.
// This guards accidental aliasing, not adversarial concurrent filesystem races.
export async function writeDerivedM3Output(input, output, serialized) {
  await assertNoSymlinkedM3OutputParents(output)
  const source = await stat(input)
  let target
  try {
    target = await open(output, 'r+')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      await writeFile(output, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      return
    }
    throw error
  }

  try {
    const destination = await target.stat()
    if (source.dev === destination.dev && source.ino === destination.ino) {
      throw new Error('refusing to overwrite M3 evidence input with derived output')
    }

    await target.truncate(0)
    await target.writeFile(serialized, 'utf8')
  } finally {
    await target.close()
  }
}
