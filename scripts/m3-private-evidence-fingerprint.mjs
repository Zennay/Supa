#!/usr/bin/env node
/**
 * Fingerprint a local PRIVATE M3 observation draft without echoing its contents.
 *
 * This is a byte-integrity aid for a human field handoff, NOT a validator of
 * observed retail prices, source-use rights, or public savings claims.
 * Never upload the input or fingerprint as public retailer/user evidence.
 */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_PRIVATE_BYTES = 2 * 1024 * 1024
const REFUSAL = 'private M3 draft refused (regular 0600 single-link JSON file, maximum 2 MiB required)'

function refuse() { throw new Error(REFUSAL) }
function sameFile(before, after) {
  return before.isFile() && after.isFile() &&
    before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs
}
function privateRegular(stat) {
  return stat.isFile() && stat.nlink === 1 &&
    (stat.mode & 0o077) === 0 && stat.size >= 1 &&
    stat.size <= MAX_PRIVATE_BYTES
}

async function rejectSymlinkedParents(filename) {
  let parent = dirname(filename)
  const root = parse(parent).root
  while (true) {
    const stat = await lstat(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse()
    if (parent === root) break
    parent = dirname(parent)
  }
}

/** Return only byte length and digest; no original text or file path. */
export async function fingerprintPrivateM3Draft(path) {
  if (typeof path !== 'string' || !path || path !== path.trim() ||
      path.startsWith('-') || path.includes('\0') ||
      typeof constants.O_NOFOLLOW !== 'number') refuse()

  const filename = resolve(path)
  try {
    await rejectSymlinkedParents(filename)
    const link = await lstat(filename)
    if (link.isSymbolicLink() || !privateRegular(link)) refuse()

    const fd = await open(filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = await fd.stat({ bigint: true })
      if (!privateRegular(before) ||
          before.dev !== BigInt(link.dev) || before.ino !== BigInt(link.ino) ||
          before.size !== BigInt(link.size)) refuse()

      const chunks = []
      let total = 0
      const buffer = Buffer.alloc(64 * 1024)
      while (true) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        total += bytesRead
        if (total > MAX_PRIVATE_BYTES) refuse()
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      }
      const after = await fd.stat({ bigint: true })
      if (!sameFile(before, after) || BigInt(total) !== before.size) refuse()
      const bytes = Buffer.concat(chunks, total)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          parsed.schemaVersion !== 1 ||
          parsed.sheetType !== 'm3-manual-cart-observation-sheet' ||
          !Array.isArray(parsed.requirements) || parsed.requirements.length !== 11 ||
          !Array.isArray(parsed.baseline?.lines) ||
          parsed.baseline.lines.length !== 11 ||
          !Array.isArray(parsed.candidate?.lines) ||
          parsed.candidate.lines.length !== 11) refuse()

      return { bytes: total, sha256: createHash('sha256').update(bytes).digest('hex') }
    } finally {
      await fd.close()
    }
  } catch {
    refuse()
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === '--help') {
    if (argv.length === 1 && argv[0] === '--help') {
      process.stdout.write('Usage: node scripts/m3-private-evidence-fingerprint.mjs <private-0600-observation-draft.json>\n')
      return null
    }
    refuse()
  }
  const result = await fingerprintPrivateM3Draft(argv[0])
  process.stdout.write('PRIVATE M3 draft (not price verification, consent or savings proof)\n')
  process.stdout.write('bytes: ' + result.bytes + '\nsha256: ' + result.sha256 + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(REFUSAL)
    process.exitCode = 1
  })
}
