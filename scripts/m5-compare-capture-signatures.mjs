import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { inspectCaptureDirectory } from './m1-inspect-captures.mjs'

const MAX_SOURCES = 100
const RELEVANT_KEYS = new Set([
  '@context', '@type', '@graph', 'name', 'sku', 'gtin', 'gtin12',
  'gtin13', 'gtin14', 'offers', 'price', 'lowPrice', 'highPrice',
  'priceCurrency', 'priceSpecification', 'availability', 'weight',
  'value', 'unitCode', 'validFrom', 'priceValidUntil',
])
const KNOWN_TYPES = new Set(['Product', 'Offer', 'AggregateOffer', 'ItemList', 'WebPage'])

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// This fingerprint deliberately excludes names, prices, URLs, DOM text,
// embedded-state payloads, and unknown keys (which may include private data).
export function captureShape(source) {
  if (!source || typeof source !== 'object' || typeof source.id !== 'string') {
    throw new Error('Invalid inspected source')
  }
  if (!source.success) {
    return {
      id: source.id,
      supermarket: source.supermarket,
      kind: source.kind,
      captureStatus: 'unavailable',
      snapshotSha256: null,
      shapeSha256: null,
      schemaOrgStatus: 'unknown',
    }
  }
  if (source.integrity !== 'verified' || !/^[a-f0-9]{64}$/.test(source.manifestSha256 ?? '')) {
    throw new Error('Snapshot integrity verification required')
  }
  if (!source.html || !Array.isArray(source.html.jsonLd) ||
      !Array.isArray(source.html.applicationJsonScripts)) {
    throw new Error('Inspected HTML shape missing')
  }
  const shape = {
    hasNextData: source.html.hasNextData === true,
    applicationJsonScriptCount: source.html.applicationJsonScripts.length,
    jsonLd: source.html.jsonLd.map((record) => ({
      parseError: record.parseError === true,
      types: Array.isArray(record.type)
        ? record.type.filter((value) => KNOWN_TYPES.has(value)).sort()
        : [],
      keys: Array.isArray(record.keys)
        ? record.keys.filter((value) => RELEVANT_KEYS.has(value)).sort()
        : [],
    })),
  }

  return {
    id: source.id,
    supermarket: source.supermarket,
    kind: source.kind,
    captureStatus: 'verified',
    snapshotSha256: source.manifestSha256,
    shapeSha256: digest(shape),
    schemaOrgStatus: source.schemaOrgProduct?.type === 'observation'
      ? 'candidate_observation'
      : 'abstain',
    hasNextData: shape.hasNextData,
    jsonLdCount: shape.jsonLd.length,
    jsonLdParseErrors: shape.jsonLd.filter((part) => part.parseError).length,
  }
}

export function compareInspections(current, baseline = null) {
  if (!current || !Array.isArray(current.sources) ||
      current.sources.length > MAX_SOURCES ||
      current.sourceCount !== current.sources.length) {
    throw new Error('Invalid or unbounded current inspection')
  }
  if (baseline && (!Array.isArray(baseline.sources) ||
      baseline.sources.length > MAX_SOURCES ||
      baseline.sourceCount !== baseline.sources.length)) {
    throw new Error('Invalid or unbounded baseline inspection')
  }
  const map = (sources) => {
    const result = new Map()
    for (const source of sources) {
      const shape = captureShape(source)
      if (result.has(shape.id)) throw new Error('Duplicate capture source ID')
      result.set(shape.id, shape)
    }
    return result
  }
  const now = map(current.sources)
  const before = baseline ? map(baseline.sources) : new Map()
  const ids = [...new Set([...now.keys(), ...before.keys()])].sort()
  const changes = ids.map((id) => {
    const latest = now.get(id)
    const previous = before.get(id)
    let status
    // A failed first/new capture is a P1 failure to investigate, not P2
    // healthy-source onboarding, regardless of whether a baseline exists.
    if (!baseline) status = latest?.captureStatus === 'unavailable'
      ? 'unavailable' : 'baseline_missing'
    else if (!latest) status = 'removed'
    else if (!previous) status = latest.captureStatus === 'unavailable'
      ? 'unavailable' : 'added'
    // A reused source ID can conceal a different supermarket or capture type.
    // Treat provenance re-assignment as high-priority drift even when both HTML
    // and shape fingerprints are identical or one capture is unavailable.
    else if (latest.supermarket !== previous.supermarket || latest.kind !== previous.kind) {
      status = 'origin_changed'
    }
    else if (latest.captureStatus !== 'verified' || previous.captureStatus !== 'verified') {
      status = 'unavailable'
    } else if (latest.shapeSha256 !== previous.shapeSha256 ||
               latest.schemaOrgStatus !== previous.schemaOrgStatus) {
      status = 'shape_changed'
    } else if (latest.snapshotSha256 !== previous.snapshotSha256) {
      status = 'content_changed_shape_stable'
    } else {
      status = 'unchanged'
    }
    return { id, status, current: latest ?? null, baseline: previous ?? null }
  })

  return {
    contractVersion: 1,
    mode: 'offline_capture_signature_review_only',
    productionReady: false,
    m5Eligible: false,
    baselineProvided: Boolean(baseline),
    captureCount: now.size,
    changes,
    driftCount: changes.filter((value) =>
      ['removed', 'added', 'unavailable', 'shape_changed', 'origin_changed'].includes(value.status)).length,
    // Only same approved-origin, human-reviewed snapshots can justify selectors.
    reviewerActionRequired: true,
  }
}

export async function compareCaptureDirectories(currentDir, baselineDir = null) {
  const current = await inspectCaptureDirectory(currentDir)
  const baseline = baselineDir ? await inspectCaptureDirectory(baselineDir) : null
  return compareInspections(current, baseline)
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 2 || argv.some((arg) => !arg || arg.startsWith('--'))) {
    throw new Error('Usage: node scripts/m5-compare-capture-signatures.mjs <M1-capture-dir> [baseline-M1-capture-dir]')
  }
  const report = await compareCaptureDirectories(argv[0], argv[1] ?? null)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
