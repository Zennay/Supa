import { decodeExactRetailerHtmlBytes } from './retailer-private-html-byte-identity.mjs'
import { open, lstat } from 'node:fs/promises'
import { constants as fsFlags } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { proposeOfflineRetailerSelectors, summarizeOfflineSelectorProposals } from './retailer-offline-selector-discovery.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

// A reviewer can run this ONLY on a locally saved HTML snapshot with a pinned
// SHA from an approved capture manifest. No browser/network/scrape entrypoint.
export async function main(argv = process.argv.slice(2), writeOutput = text => process.stdout.write(text)) {
  if (argv.length !== 5) {
    throw new Error('Usage: inspect-snapshot <retailerId> <https-source-url> <capturedAt> <sha256> <html-file>')
  }
  const [retailerId, url, capturedAt, expectedSha256, filename] = argv
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('Offline source SHA-256 required')
  }
  const path = resolve(filename)
  await assertNoSymlinkedM3OutputParents(path)
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) {
    throw new Error('Private HTML snapshot directory must have exclusive 0700 permissions')
  }
  // Bind size/SHA validation to the same open file descriptor. Path-based
  // lstat() followed by readFile(path) admitted a symlink/filename swap.
  // O_NONBLOCK also avoids waiting forever on a malicious FIFO.
  const fd = await open(path, fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW | fsFlags.O_NONBLOCK)
  let raw
  try {
    const before = await fd.stat()
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0 ||
        before.size > 2 * 1024 * 1024) {
      throw new Error('Offline input must be a bounded regular single-link HTML file')
    }
    raw = await fd.readFile()
    const after = await fd.stat()
    const named = await lstat(path)
    const parentAfter = await lstat(dirname(path))
    if (!parentAfter.isDirectory() || parentAfter.dev !== parent.dev ||
        parentAfter.ino !== parent.ino || (parentAfter.mode & 0o077) !== 0) {
      throw new Error('Private HTML snapshot directory changed during inspection')
    }
    if (!named.isFile() || named.isSymbolicLink() ||
        named.dev !== after.dev || named.ino !== after.ino || after.nlink !== 1 ||
        (after.mode & 0o077) !== 0 || (named.mode & 0o077) !== 0 ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== raw.length || after.size !== raw.length ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Offline snapshot identity changed during inspection')
    }
  } finally {
    await fd.close()
  }
  if (raw.length > 2 * 1024 * 1024 ||
      createHash('sha256').update(raw).digest('hex') !== expectedSha256) {
    throw new Error('Offline snapshot SHA does not match capture manifest')
  }
  const html = decodeExactRetailerHtmlBytes(raw)
  const report = proposeOfflineRetailerSelectors({
    html, origin: { retailerId, url, capturedAt },
  })
  const safe = summarizeOfflineSelectorProposals(report)
  writeOutput(JSON.stringify(safe, null, 2) + '\n')
  return safe
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Offline HTML selector inspection refused; no product data was published')
    process.exitCode = 2
  })
}
