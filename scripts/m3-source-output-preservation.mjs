import { open, stat, writeFile } from 'node:fs/promises'

// M3 field sheets and derived studies must never be replaced by their own
// derived output. A different pathname can be the same file via hardlinks or
// symlinks (including symlinks in parent directories).
//
// Open existing output *without truncating*, inspect the open descriptor's
// device/inode, and only then write. An output created concurrently with an
// ENOENT probe is refused by 'wx' rather than accidentally overwritten.
// This guards accidental aliasing, not adversarial concurrent filesystem races.
export async function writeDerivedM3Output(input, output, serialized) {
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
