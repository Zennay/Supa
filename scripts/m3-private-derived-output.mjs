import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, parse, resolve, sep } from 'node:path'

/**
 * M3 derived artifacts carry field-run metadata. An existing directory
 * symlink must never silently redirect a requested artifact destination.
 *
 * This checks the directory hierarchy immediately before exclusive creation.
 * It does not claim to defend against an adversarial concurrent same-user
 * process replacing directories between filesystem operations.
 */
async function ensurePrivateOutputParents(canonicalOutput) {
  const parent = dirname(canonicalOutput)
  const { root } = parse(parent)
  const components = parent.slice(root.length).split(sep).filter(Boolean)
  let current = root

  for (const component of components) {
    current = join(current, component)
    let currentStat
    try {
      currentStat = await lstat(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (mkdirError) {
        // A concurrent creator must still pass the independent lstat check.
        if (mkdirError?.code !== 'EEXIST') throw mkdirError
      }
      currentStat = await lstat(current)
    }

    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw new Error('M3 output parent must be a real directory without symlinks')
    }
  }
}

export async function writeNewPrivateM3Artifact(output, serialized, alreadyExistsMessage) {
  // Always write the same canonical path whose components were inspected:
  // never inspect resolved "a/../b" but write the noncanonical alias.
  const canonicalOutput = resolve(output)
  await ensurePrivateOutputParents(canonicalOutput)
  try {
    await writeFile(canonicalOutput, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(alreadyExistsMessage)
    throw error
  }
}
