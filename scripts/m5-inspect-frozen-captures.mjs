import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod, mkdir, mkdtemp, open, rm, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { inspectCaptureDirectory } from './m1-inspect-captures.mjs'
import { withPinnedCaptureTree } from './m5-pin-capture-store.mjs'

const HTML_BYTE_LIMIT = 8 * 1024 * 1024
const HTML_COHORT_BYTE_LIMIT = 8 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

function invalid() {
  throw new Error('Invalid frozen offline capture source')
}

function safeSegment(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

// Open the original file exactly once and inspect its inode, not a pathname
// followed by a separate pathname read. The bytes are also bounded *during*
// reads in case the file grows after fstat(). A matching original-byte SHA is
// required before any private snapshot is created for this source.
async function readVerifiedHtml(sourcePath, declaredSha, remainingBytes) {
  let handle
  try {
    handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    const limit = Math.min(HTML_BYTE_LIMIT, remainingBytes)
    if (!info.isFile() || info.nlink !== 1 ||
        !Number.isSafeInteger(info.size) || info.size < 0 ||
        info.size > limit) invalid()

    const chunks = []
    let size = 0
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit + 1 - size))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      size += bytesRead
      if (size > limit) invalid()
      chunks.push(chunk.subarray(0, bytesRead))
    }
    const bytes = Buffer.concat(chunks, size)
    // Preserve the established direct comparator integrity-mismatch contract,
    // but never echo capture IDs, HTML, URLs or local filesystem paths.
    if (createHash('sha256').update(bytes).digest('hex') !== declaredSha) {
      throw new Error('Capture integrity mismatch')
    }
    // M1's canonical inspector hashes the UTF-8 decoded HTML text. Refuse a
    // lossy decode here, otherwise raw-byte SHA and later inspector SHA could
    // silently refer to different representations of the same source file.
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return bytes
  } catch (error) {
    if (error?.message === 'Capture integrity mismatch') throw error
    invalid()
  } finally {
    if (handle) await handle.close()
  }
}

// This helper accepts the already-preflighted bounded M1 manifest object.
// It snapshots only approved, SHA-matching local HTML, runs the *unchanged*
// M1 inspector against the owned private copy, and always removes that copy.
// The optional inspector argument permits synthetic deterministic race tests;
// product callers always use the original M1 inspector.
export async function inspectFrozenCaptureDirectory(
  directory, manifest, inspector = inspectCaptureDirectory,
) {
  if (!manifest || !Array.isArray(manifest.results) ||
      manifest.milestone !== 'M1 Data Feasibility' ||
      manifest.bounded !== true || manifest.results.length > 100 ||
      manifest.sourceCount !== manifest.results.length) invalid()
  const sources = manifest.results
  // Reject unsafe entire manifest inputs before opening any HTML.
  const ids = new Set()
  for (const row of sources) {
    if (!row || !safeSegment(row.id) || !safeSegment(row.supermarket) ||
        !safeSegment(row.kind) || typeof row.success !== 'boolean' ||
        ids.has(row.id) ||
        (row.success && (typeof row.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.sha256)))) invalid()
    ids.add(row.id)
  }

  // mkdtemp creates an unpredictable 0700 root. Re-assert permission before
  // writing private source bytes; owned files are created with 0600 + wx.
  const privateRoot = await mkdtemp(path.join(tmpdir(), 'supa-m5-private-inspection-'))
  try {
    await chmod(privateRoot, 0o700)
    await writeFile(path.join(privateRoot, 'manifest.json'),
      JSON.stringify(manifest), { mode: 0o600, flag: 'wx' })
    let total = 0
    const madeFolders = new Set()
    // One original root handle, with one cached store descriptor per name,
    // survives the complete successful-source cohort. It is not safe to
    // reopen a changed supermarket path for the next source in that cohort.
    // P1-only cohorts require no HTML or original-store access.
    if (sources.some((row) => row.success)) {
      await withPinnedCaptureTree(directory, async (getStorePath) => {
        for (const row of sources) {
          if (!row.success) continue
          const pinnedFilePath = await getStorePath(row.supermarket)
          const bytes = await readVerifiedHtml(
            pinnedFilePath(row.id), row.sha256, HTML_COHORT_BYTE_LIMIT - total,
          )
          total += bytes.length
          if (!madeFolders.has(row.supermarket)) {
            await mkdir(path.join(privateRoot, row.supermarket), { mode: 0o700 })
            madeFolders.add(row.supermarket)
          }
          await writeFile(path.join(privateRoot, row.supermarket, row.id + '.html'),
            bytes, { mode: 0o600, flag: 'wx' })
        }
      })
    }
    return await inspector(privateRoot)
  } finally {
    await rm(privateRoot, { recursive: true, force: true })
  }
}
