import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RESEARCH_SOURCES } from './m1-multistore-research.mjs'

// Offline M1 research integrity gate only. Never parse price, infer DOM selectors,
// grant retailer permission or promote synthetic captures to financial evidence.
const MAX_BYTES = 5 * 1024 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_META_BYTES = 64 * 1024
const STEM_RE = /^capture-[0-9]{13}-[0-9]+$/

function outcome(sourceId, reasons, ageHours = null) {
  return {
    status: reasons.length ? 'rejected' : 'manual-review',
    sourceId,
    ageHours,
    reasons: [...new Set(reasons)],
    semanticVerified: false,
    livePriceVerified: false,
    publicSavingsClaimEligible: false,
  }
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return null
  return new Date(millis).toISOString() === value ? millis : null
}

function ownCaptureMetadata(metadata) {
  try {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    const proto = Object.getPrototypeOf(metadata)
    if (proto !== Object.prototype && proto !== null) return null
    const record = Object.create(null)
    for (const field of ['version', 'type', 'sourceId', 'store', 'url',
      'observedAt', 'httpStatus', 'mediaType', 'bytes', 'sha256', 'proxyMode']) {
      const descriptor = Object.getOwnPropertyDescriptor(metadata, field)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
      record[field] = descriptor.value
    }
    // Reflection can be trapped on a Proxy; a transparent get-only Proxy
    // cannot safely be distinguished from a record, but no get trap runs.
    return record
  } catch { return null }
}

/**
 * Compare the private capture bytes to their own metadata, without returning
 * raw HTML, extracted prices, page titles, URLs or participant information.
 * A passing audit only permits human review, never ingestion or a savings claim.
 */
export function auditResearchSnapshot({ sourceId, metadata, body, nowMs = Date.now() } = {}) {
  const registered = RESEARCH_SOURCES.find(source => source.id === sourceId)
  const safeSourceId = registered ? registered.id : null
  const reasons = []
  const capture = ownCaptureMetadata(metadata)
  if (!registered) reasons.push('unknown-source')
  if (!Number.isFinite(nowMs) || nowMs < 0) reasons.push('invalid-clock')
  if (!capture) {
    reasons.push('invalid-metadata')
  } else if (registered) {
    if (capture.version !== 1 || capture.type !== 'research-only-not-price-proof' ||
        capture.sourceId !== registered.id || capture.store !== registered.store ||
        capture.url !== registered.url) reasons.push('metadata-provenance-mismatch')
    if (capture.httpStatus !== 200 ||
        !['text/html', 'application/xhtml+xml'].includes(capture.mediaType) ||
        !['direct', 'approved-fixed-egress'].includes(capture.proxyMode)) {
      reasons.push('invalid-capture-transport')
    }
  }

  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BYTES) {
    reasons.push('invalid-capture-bytes')
  } else if (capture) {
    const digest = createHash('sha256').update(body).digest('hex')
    if (capture.bytes !== body.length ||
        typeof capture.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(capture.sha256) || capture.sha256 !== digest) {
      reasons.push('capture-integrity-mismatch')
    }
  }

  let ageHours = null
  if (capture) {
    const captureTime = canonicalTimestamp(capture.observedAt)
    if (captureTime === null || !Number.isFinite(nowMs)) {
      reasons.push('invalid-capture-time')
    } else {
      const elapsed = nowMs - captureTime
      if (elapsed < 0) reasons.push('future-capture')
      else if (elapsed > MAX_AGE_MS) reasons.push('stale-capture')
      else ageHours = elapsed / 3_600_000
    }
  }
  return outcome(safeSourceId, reasons, ageHours)
}

async function readBoundedRegularFile(path, maxBytes) {
  // Descriptor-level O_NOFOLLOW keeps a symlink swap between stat and read
  // from turning this private verifier into an arbitrary-file reader.
  let handle
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch { throw new Error('capture audit requires bounded regular files') }
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size <= 0 || details.size > maxBytes) {
      throw new Error('capture audit requires bounded regular files')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/**
 * Audit an already saved private research pair. Caller selects a registered
 * source and an exact capture stem; no crawling or outbound requests occur.
 */
export async function auditCaptureFiles({
  sourceId, stem, outputDir = join('artifacts', 'm1-multistore-research'), nowMs = Date.now(),
} = {}) {
  if (!RESEARCH_SOURCES.some(source => source.id === sourceId)) throw new Error('unknown source')
  if (typeof stem !== 'string' || !STEM_RE.test(stem)) throw new Error('invalid capture stem')
  const dir = join(outputDir, sourceId)
  for (const path of [outputDir, dir]) {
    const details = await lstat(path)
    if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('capture audit requires real directories')
  }
  const bodyPath = join(dir, stem + '.html')
  const metaPath = join(dir, stem + '.json')
  const body = await readBoundedRegularFile(bodyPath, MAX_BYTES)
  const metadataBytes = await readBoundedRegularFile(metaPath, MAX_META_BYTES)
  let metadata
  try { metadata = JSON.parse(metadataBytes.toString('utf8')) }
  catch { return outcome(sourceId, ['invalid-metadata-json']) }
  return auditResearchSnapshot({ sourceId, metadata, body, nowMs })
}

export async function main(args = process.argv.slice(2), log = console.log) {
  if (args.length !== 3 || args[0] !== '--audit') {
    throw new Error('usage: --audit <registered-source-id> <capture-stem>')
  }
  const result = await auditCaptureFiles({ sourceId: args[1], stem: args[2] })
  log(JSON.stringify(result))
  return result.status === 'manual-review' ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main() }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'private capture audit failed')
    process.exitCode = 1
  }
}
