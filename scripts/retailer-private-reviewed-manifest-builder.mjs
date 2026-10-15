/**
 * Turn explicitly staged, already reviewed retailer JSON evidence into a
 * SHA-pinned PRIVATE replay manifest. No HTML conversion, HTTP, or permission
 * promotion. Never overwrite an existing manifest or emit capture contents.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdir, lstat, open, writeFile, link, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ingestReviewedBatch } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const FILE = /^capture-[a-z0-9][a-z0-9_-]{0,100}\.json$/
const fail = () => { throw new Error('Private reviewed manifest builder refused') }
function validateDirPath(dir) {
  if (typeof dir !== 'string' || !dir.trim() ||
      dir.startsWith('-') || dir.length > 500) fail()
  return resolve(dir)
}
async function directoryTrust(directory) {
  let cur = directory
  for (;;) {
    const s = await lstat(cur)
    if (s.isSymbolicLink()) fail()
    if (cur === directory && (!s.isDirectory() || (s.mode & 0o077))) fail()
    const parent = dirname(cur)
    if (cur === parent) break
    cur = parent
  }
}
async function boundedEvidence(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      (info.mode & 0o077) || info.size < 2 || info.size > 1024 * 1024) fail()
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await fd.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) ||
        stat.size < 2 || stat.size > 1024 * 1024) fail()
    const bytes = await fd.readFile()
    if (bytes.length > 1024 * 1024) fail()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { bytes, record: JSON.parse(text) }
  } catch { fail() }
  finally { await fd.close() }
}
/**
 * Manifest itself is a private local file and contains hashed file names,
 * while stdout only says how many reviewed source files were pinned.
 */
export async function buildPrivateReviewedManifest(directory) {
  const root = validateDirPath(directory)
  await directoryTrust(root)
  const files = (await readdir(root)).filter(name => FILE.test(name)).sort()
  if (files.length < 6 || files.length > 32) fail()
  const rows = []
  const records = []
  const seen = new Set()
  for (const name of files) {
    if (basename(name) !== name || name.includes('..')) fail()
    const { bytes, record } = await boundedEvidence(join(root, name))
    const key = record?.source?.supermarket + ':' + record?.source?.kind
    if (!SHAPES.includes(key)) fail()
    seen.add(key)
    records.push(record)
    rows.push({
      file: name, sha256: createHash('sha256').update(bytes).digest('hex'),
      key,
    })
  }
  if (SHAPES.some(shape => !seen.has(shape))) fail()
  try {
    const batch = ingestReviewedBatch(records)
    if (batch.summary.rejectedSources !== 0 ||
        batch.summary.acceptedSources !== files.length ||
        batch.summary.productionEnabled !== false ||
        batch.summary.permissionVerified !== false ||
        batch.summary.publicSavingsClaimEligible !== false) fail()
    const catalog = buildUniversalRetailerCatalog(batch)
    if (catalog.status !== 'private-review-only' ||
        catalog.productionEnabled !== false ||
        catalog.publicSavingsClaimEligible !== false) fail()
  } catch { fail() }
  await directoryTrust(root)
  // O_EXCL initial temporary write + atomic hardlink to target (no replace).
  // The last operation never follows or overwrites an existing manifest.
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    productionEnabled: false, permissionVerified: false,
    publicSavingsClaimEligible: false, sources: rows,
  }
  const destination = join(root, 'manifest.json')
  const temp = join(root, '.manifest-' + randomUUID() + '.tmp')
  try {
    await writeFile(temp, JSON.stringify(manifest) + '\n', {
      mode: 0o600, flag: 'wx',
    })
    await link(temp, destination)
  } catch { fail() }
  finally { await unlink(temp).catch(() => {}) }
  return {
    mode: 'private-reviewed-manifest-created',
    filesPinned: rows.length,
    sourceKinds: SHAPES.length,
    manifestCreated: true,
    humanReviewRequired: true,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
}
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--dir') fail()
  const result = await buildPrivateReviewedManifest(argv[1])
  write(JSON.stringify(result) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Private reviewed manifest builder refused'); process.exitCode = 2 })
}
