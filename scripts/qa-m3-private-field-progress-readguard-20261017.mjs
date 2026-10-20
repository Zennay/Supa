#!/usr/bin/env node
/**
 * Independent QA-only SAFE LOCAL READER for a private M3 field progress draft.
 * This does not replace the product-owned m3-private-field-progress CLI and
 * cannot verify real retailer observations, permissions or savings.
 */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPrivateM3FieldProgress } from './m3-private-field-progress.mjs'

const MAX_BYTES = 2 * 1024 * 1024
const REFUSAL = 'Private M3 operator draft refused (regular, private single-link JSON <=2MiB required)'

function refuse() { throw new Error(REFUSAL) }

function privateRegular(stat, operatorUid) {
  return stat.isFile() &&
    Number(stat.nlink) === 1 &&
    (Number(stat.mode) & 0o077) === 0 &&
    BigInt(stat.uid) === operatorUid &&
    Number(stat.size) >= 1 &&
    Number(stat.size) <= MAX_BYTES
}

async function checkPathParents(file) {
  let parent = dirname(file)
  const root = parse(parent).root
  while (true) {
    const entry = await lstat(parent)
    if (!entry.isDirectory() || entry.isSymbolicLink()) refuse()
    if (parent === root) return
    parent = dirname(parent)
  }
}

function stable(before, after, operatorUid) {
  return privateRegular(before, operatorUid) && privateRegular(after, operatorUid) &&
    before.uid === after.uid &&
    before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.ctimeNs === after.ctimeNs && before.mtimeNs === after.mtimeNs
}

/** Read a bounded private draft through ONE pinned descriptor; never emit bytes or path. */
export async function safePrivateM3Progress(filename, referenceNowMs = Date.now()) {
  if (typeof filename !== 'string' || !filename || filename !== filename.trim() ||
      filename.startsWith('-') || filename.includes('\0') ||
      !Number.isSafeInteger(referenceNowMs) || referenceNowMs < 0 ||
      typeof constants.O_NOFOLLOW !== 'number' ||
      typeof constants.O_NONBLOCK !== 'number') refuse()

  const absolute = resolve(filename)
  try {
    // A mode-0600 file owned by *another* UID is not this operator's
    // evidence, even if elevated access or an ACL makes it readable.
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
    if (!Number.isSafeInteger(currentUid) || currentUid < 0) refuse()
    const operatorUid = BigInt(currentUid)
    await checkPathParents(absolute)
    const entry = await lstat(absolute)
    if (entry.isSymbolicLink() || !privateRegular(entry, operatorUid)) refuse()

    const fd = await open(absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let bytes
    try {
      const before = await fd.stat({ bigint: true })
      if (!privateRegular(before, operatorUid) ||
          before.uid !== BigInt(entry.uid) ||
          before.dev !== BigInt(entry.dev) || before.ino !== BigInt(entry.ino) ||
          before.size !== BigInt(entry.size) ||
          before.mode !== BigInt(entry.mode) ||
          before.nlink !== BigInt(entry.nlink)) refuse()

      const chunks = []
      const buffer = Buffer.alloc(64 * 1024)
      let total = 0
      while (true) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        total += bytesRead
        if (total > MAX_BYTES) refuse()
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      }
      const after = await fd.stat({ bigint: true })
      if (!stable(before, after, operatorUid) || BigInt(total) !== before.size) refuse()
      bytes = Buffer.concat(chunks, total)
    } finally {
      await fd.close()
    }

    // Preserve an invalid UTF-8 BOM and reject it like JSON.parse(readFile()).
    const data = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const report = buildPrivateM3FieldProgress(data, referenceNowMs)
    if (!report || report.verifiedRetailerObservations !== false ||
        report.publicSavingsClaimEligible !== false ||
        report.evidenceStatus !== 'unverified-operator-draft' ||
        report.progress?.expectedLines !== 22) refuse()
    return report
  } catch {
    refuse()
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.length !== 1 ||
      typeof argv[0] !== 'string' || !argv[0].trim()) refuse()
  const report = await safePrivateM3Progress(argv[0])
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(REFUSAL)
    process.exitCode = 1
  })
}
