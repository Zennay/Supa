#!/usr/bin/env node
// Opt-in, entirely local QA check: is a private M3 CSV *exactly* the CSV for
// this private comparison JSON, rather than merely financially self-consistent?
// Never authenticates observation provenance, retailer rights or real savings.
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { timingSafeEqual } from 'node:crypto'

import { renderPrivateM3ComparisonCsv } from './m3-private-comparison-csv.mjs'
import { auditPrivateM3CsvLedger } from './qa-m3-private-csv-ledger-check.mjs'

const REFUSAL = 'M3 private CSV/source binding refused'
const MAX_JSON = 2 * 1024 * 1024
const MAX_CSV = 1024 * 1024
const refuse = () => { throw new Error(REFUSAL) }

function validateName(path) {
  if (typeof path !== 'string' || !path || path !== path.trim() ||
      path.startsWith('-') || path.includes('\0')) refuse()
  return resolve(path)
}

async function checkParents(file) {
  let parent = dirname(file)
  const root = parse(parent).root
  while (true) {
    const s = await lstat(parent)
    if (!s.isDirectory() || s.isSymbolicLink()) refuse()
    if (parent === root) break
    parent = dirname(parent)
  }
}

function privateFile(stat, max) {
  return stat.isFile() && stat.nlink === 1n &&
    stat.size >= 1n && stat.size <= BigInt(max) &&
    (stat.mode & 0o077n) === 0n &&
    (typeof process.getuid !== 'function' ||
      stat.uid === BigInt(process.getuid()))
}

function unchanged(a, b) {
  return a.dev === b.dev && a.ino === b.ino &&
    a.mode === b.mode && a.uid === b.uid &&
    a.size === b.size && a.nlink === b.nlink &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

async function readPrivateFile(filename, max) {
  const absolute = validateName(filename)
  if (typeof constants.O_NOFOLLOW !== 'number' ||
      typeof constants.O_NONBLOCK !== 'number') refuse()
  await checkParents(absolute)
  const source = await lstat(absolute, { bigint: true })
  if (source.isSymbolicLink() || !privateFile(source, max)) refuse()
  const descriptor = await open(absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await descriptor.stat({ bigint: true })
    if (!privateFile(before, max) || !unchanged(source, before)) refuse()
    const buffer = Buffer.alloc(Number(before.size))
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await descriptor.read(
        buffer, read, buffer.length - read, read)
      if (bytesRead <= 0) refuse()
      read += bytesRead
    }
    // Detect extension while we were reading, including a same-inode append.
    const probe = Buffer.alloc(1)
    if ((await descriptor.read(probe, 0, 1, read)).bytesRead !== 0) refuse()
    const after = await descriptor.stat({ bigint: true })
    if (!privateFile(after, max) || !unchanged(before, after)) refuse()
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(buffer)
  } finally {
    await descriptor.close()
  }
}

/**
 * Compare the bytes of an already exported CSV to the canonical CSV produced
 * from the specific private comparison JSON supplied in the same local run.
 * The original JSON is NOT cryptographically signed, so this is artifact
 * consistency only, not observation provenance or licensing verification.
 */
export function checkPrivateM3CsvReportBinding(reportJson, csv) {
  try {
    if (typeof reportJson !== 'string' || typeof csv !== 'string' ||
        Buffer.byteLength(reportJson, 'utf8') > MAX_JSON ||
        Buffer.byteLength(csv, 'utf8') > MAX_CSV) refuse()
    const ledger = auditPrivateM3CsvLedger(csv)
    const report = JSON.parse(reportJson)
    const expected = renderPrivateM3ComparisonCsv(report)
    const left = Buffer.from(csv, 'utf8')
    const right = Buffer.from(expected, 'utf8')
    if (left.length !== right.length || !timingSafeEqual(left, right)) refuse()
    return Object.freeze({
      sourceBound: true,
      privateOnly: true,
      ledgerConsistent: ledger.ledgerConsistent,
      physicalPackConsistent: ledger.physicalPackConsistent,
      canonicalShoppingRows: ledger.canonicalShoppingRows,
      comparableRows: ledger.comparableRows,
      verifiedRetailerObservations: false,
      publicSavingsClaimEligible: false,
    })
  } catch {
    refuse() // Never leak any private product, price, identifier, or JSON error.
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.length !== 2 ||
      argv.some(value => typeof value !== 'string')) refuse()
  try {
    const reportPath = validateName(argv[0])
    const csvPath = validateName(argv[1])
    if (reportPath === csvPath) refuse()
    // Before accepting JSON, require both artifacts to be private regular
    // owner-owned single-link files; never follow symlinked parents or leaves.
    const reportJson = await readPrivateFile(reportPath, MAX_JSON)
    const csv = await readPrivateFile(csvPath, MAX_CSV)
    const proof = checkPrivateM3CsvReportBinding(reportJson, csv)
    process.stdout.write(JSON.stringify(proof) + '\n')
    return proof
  } catch {
    refuse()
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSAL + '\n')
    process.exitCode = 1
  })
}
