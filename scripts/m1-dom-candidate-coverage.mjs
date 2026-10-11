import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RESEARCH_SOURCES } from './m1-multistore-research.mjs'

// Strictly offline, private-candidate progress only. Counts are never prices,
// product coverage, DOM semantic verification or source-use permission.
const STEM = /^capture-[0-9]{13}-[0-9]+-candidate-review\.json$/
const MAX_ROOT_ENTRIES = 100
const MAX_SOURCE_ENTRIES = 500
const MAX_BYTES = 64 * 1024
const FRESHNESS_MS = 24 * 60 * 60 * 1000

function entry(id) {
  return { sourceId: id, pendingHumanReview: 0, stale: 0, rejected: 0, unexpected: 0 }
}
function summary(sources, unexpectedRoot = 0) {
  const totals = { pendingHumanReview: 0, stale: 0, rejected: 0, unexpected: unexpectedRoot }
  for (const source of sources) {
    for (const key of Object.keys(totals)) totals[key] += source[key]
  }
  const status = totals.rejected || totals.unexpected ? 'rejected'
    : totals.pendingHumanReview ? 'pending-human-review'
      : totals.stale ? 'stale' : 'no-reviews'
  return { status, totals, sources, semanticVerified: false, livePriceVerified: false,
    retailerPermissionVerified: false, publicSavingsClaimEligible: false }
}
async function entries(path) {
  try {
    const meta = await lstat(path)
    if (!meta.isDirectory() || meta.isSymbolicLink() || (meta.mode & 0o077) !== 0) return false
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const millis = Date.parse(value)
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : null
}

async function classify(path, source, nowMs) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const meta = await handle.stat()
    if (!meta.isFile() || meta.size < 1 || meta.size > MAX_BYTES || (meta.mode & 0o077) !== 0) return 'rejected'
    const data = JSON.parse((await handle.readFile()).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'rejected'
    // A copied/renamed report must never be treated as the original capture
    // review, even when its store and public metadata are otherwise valid.
    if (typeof data.captureStem !== 'string' ||
        data.captureStem + '-candidate-review.json' !== basename(path)) return 'rejected'
    const keys = new Set([
      'version', 'kind', 'sourceId', 'store', 'observedAt', 'status',
      'selectors', 'actualClassCandidates', 'domCaptureIdentityVerified',
      'retailerPermissionVerified', 'semanticVerified', 'livePriceVerified',
      'publicSavingsClaimEligible', 'captureStem', 'captureAuditStatus',
    ])
    if (Object.keys(data).some(key => !keys.has(key))) return 'rejected'
    if (data.version !== 1 || data.kind !== 'private-dom-candidate-review' ||
        data.sourceId !== source.id || data.store !== source.store ||
        data.status !== 'human-semantic-review-required' ||
        data.captureAuditStatus !== 'manual-review' ||
        data.domCaptureIdentityVerified !== false ||
        data.retailerPermissionVerified !== false ||
        data.semanticVerified !== false || data.livePriceVerified !== false ||
        data.publicSavingsClaimEligible !== false ||
        !Array.isArray(data.selectors) || data.selectors.length > 11 ||
        !Array.isArray(data.actualClassCandidates) || data.actualClassCandidates.length > 25) return 'rejected'
    const time = canonicalTimestamp(data.observedAt)
    if (time === null || time > nowMs) return 'rejected'
    return nowMs - time > FRESHNESS_MS ? 'stale' : 'pendingHumanReview'
  } catch { return 'rejected' }
  finally { await handle?.close() }
}

/**
 * Enumerate only registered source folders and exact filename grammar.
 * Ignore the actual selector strings and never load or print captured HTML.
 */
export async function inventoryDomCandidateReviews({
  outputDir = join('artifacts', 'm1-dom-reviews'), nowMs = Date.now(),
} = {}) {
  const sources = RESEARCH_SOURCES.map(source => entry(source.id))
  if (!Number.isFinite(nowMs) || nowMs < 0) return summary(sources, 1)
  const root = await entries(outputDir)
  if (root === null) return summary(sources)
  if (root === false) return summary(sources, 1)
  if (root.length > MAX_ROOT_ENTRIES) return summary(sources, root.length)
  const known = new Set(sources.map(s => s.sourceId))
  const unexpectedRoot = root.filter(dir => !known.has(dir.name) || !dir.isDirectory()).length
  for (const source of sources) {
    const path = join(outputDir, source.sourceId)
    const children = await entries(path)
    if (children === null) continue
    if (children === false) { source.unexpected++; continue }
    if (children.length > MAX_SOURCE_ENTRIES) { source.unexpected += children.length; continue }
    for (const child of children) {
      if (!child.isFile() || !STEM.test(child.name)) { source.unexpected++; continue }
      // Counters carry only a sourceId; validate private records against the
      // immutable registered source instead of the public count-only summary.
      const registered = RESEARCH_SOURCES.find(item => item.id === source.sourceId)
      const result = await classify(join(path, child.name), registered, nowMs)
      source[result]++
    }
  }
  return summary(sources, unexpectedRoot)
}
export async function main(args = process.argv.slice(2), log = console.log) {
  if (args.length !== 1 || args[0] !== '--coverage') throw new Error('usage: --coverage')
  const result = await inventoryDomCandidateReviews()
  log(JSON.stringify(result))
  return result.status === 'pending-human-review' ? 0 : result.status === 'rejected' ? 1 : 2
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main() }
  catch {
    console.error('private candidate coverage failed')
    process.exitCode = 1
  }
}
