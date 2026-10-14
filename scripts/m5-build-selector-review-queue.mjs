import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const STATUS_ACTION = Object.freeze({
  unavailable: ['P1', 'recapture_or_investigate_failure'],
  origin_changed: ['P1', 'investigate_source_origin_change'],
  removed: ['P1', 'investigate_missing_source'],
  shape_changed: ['P1', 'review_parser_and_selector_drift'],
  added: ['P2', 'review_new_source_and_rights'],
  baseline_missing: ['P2', 'establish_approved_baseline'],
  content_changed_shape_stable: ['P2', 'review_content_and_extraction'],
  unchanged: ['P3', 'manual_selector_review_before_reuse'],
})
const HEX_HASH = /^[a-f\d]{64}$/
const MAX_CHANGES = 200
const MAX_CAPTURE_SOURCES = 100
const MAX_SOURCE_ID_UNITS = 128
const MAX_JSON_LD_RECORDS = 128
const VERIFIED_SCHEMA_ORG_STATUSES = new Set(['candidate_observation', 'abstain'])

// Reject malformed UTF-16 before UTF-8 hashing: unpaired surrogates are
// replaced by the encoder and would alias two distinct source identities.
function validUnicodeSourceId(id) {
  for (let index = 0; index < id.length; index += 1) {
    const unit = id.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= id.length) return false
      const trailing = id.charCodeAt(index)
      if (trailing < 0xdc00 || trailing > 0xdfff) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

function invalid() {
  throw new Error('Invalid offline capture comparison report')
}

// The direct pure queue API must honour the same M1 origin contract as the
// upstream M5 capture comparer; equal missing or forged origins are not proof.
function canonicalOrigin(value) {
  return typeof value === 'string' && value.length >= 1 &&
    value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

// Only copy the canonical M1 own data fields. Reading an untrusted direct
// report with ordinary property access can execute accessors or observe a
// different value between admission and the later P1/P2/P3 comparisons.
function ownDataField(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid()
  return descriptor.value
}

const REQUIRED_SNAPSHOT_FIELDS = Object.freeze([
  'id', 'supermarket', 'kind', 'captureStatus', 'snapshotSha256',
  'shapeSha256', 'schemaOrgStatus',
])
const OPTIONAL_INSPECTION_FIELDS = Object.freeze([
  'hasNextData', 'jsonLdCount', 'jsonLdParseErrors',
])

function pinnedSnapshot(raw) {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid()
  const snapshot = Object.create(null)
  for (const field of REQUIRED_SNAPSHOT_FIELDS) {
    snapshot[field] = ownDataField(raw, field)
  }
  for (const field of OPTIONAL_INSPECTION_FIELDS) {
    if (Object.hasOwn(raw, field)) snapshot[field] = ownDataField(raw, field)
  }
  return snapshot
}

function sourceToken(id) {
  return createHash('sha256').update('supa-m5-source-v1\0' + id).digest('hex')
}

export function buildOfflineSelectorReviewQueue(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.contractVersion !== 1 ||
      report.mode !== 'offline_capture_signature_review_only' ||
      report.productionReady !== false || report.m5Eligible !== false ||
      report.reviewerActionRequired !== true ||
      typeof report.baselineProvided !== 'boolean' ||
      !Number.isSafeInteger(report.captureCount) || report.captureCount < 0 ||
      report.captureCount > MAX_CAPTURE_SOURCES ||
      !Number.isSafeInteger(report.driftCount) || report.driftCount < 0 ||
      !Array.isArray(report.changes) || report.changes.length > MAX_CHANGES) invalid()

  // Array#map skips holes. A sparse input previously survived all checks and
  // produced a seemingly legitimate queue containing undefined action slots
  // (serialized as null by JSON.stringify). Every declared slot must be real.
  const changes = []
  for (let index = 0; index < report.changes.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(report.changes, index)
    if (!slot || !Object.hasOwn(slot, 'value')) invalid()
    changes.push(slot.value)
  }

  const seen = new Set()
  let foundCurrent = 0
  let foundBaseline = 0
  let driftCount = 0
  const actions = changes.map((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) invalid()
    const id = ownDataField(change, 'id')
    const status = ownDataField(change, 'status')
    const current = pinnedSnapshot(ownDataField(change, 'current'))
    const baseline = pinnedSnapshot(ownDataField(change, 'baseline'))
    if (typeof id !== 'string' || !id || id.length > MAX_SOURCE_ID_UNITS ||
        !validUnicodeSourceId(id) ||
        typeof status !== 'string' || !Object.hasOwn(STATUS_ACTION, status) ||
        seen.has(id)) invalid()
    seen.add(id)
    // A physical M1 historical cohort is independently capped at 100, even
    // when the union with current sources contains up to 200 distinct IDs.
    // No-baseline reports must NEVER smuggle historical records inside a
    // nominally valid P1 unavailable state.
    if (baseline !== null) {
      if (!report.baselineProvided || ++foundBaseline > MAX_CAPTURE_SOURCES) invalid()
    }
    for (const snapshot of [current, baseline]) {
      if (snapshot === null) continue
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
          snapshot.id !== id ||
          !canonicalOrigin(snapshot.supermarket) ||
          !canonicalOrigin(snapshot.kind)) invalid()
      // Only metadata produced by the canonical M1 captureShape() contract is
      // eligible for a human-only queue. Inconsistent or invented provenance
      // cannot be upgraded to a nominal review action.
      if (snapshot.captureStatus === 'verified') {
        // Canonical M1->M5 captureShape() always emits these own, bounded
        // inspection signals on successful captures. Forged counts or a
        // fabricated parse-error majority must not become reviewable P1/P3.
        // Canonical M1 digests are own primitive data, never accessors or
        // inherited properties. Inspect descriptors first: direct typeof or
        // RegExp#test on the snapshot field would evaluate caller getters or
        // custom coercion and could expose private exception messages.
        const snapshotDigest = Object.getOwnPropertyDescriptor(
          snapshot, 'snapshotSha256',
        )
        const shapeDigest = Object.getOwnPropertyDescriptor(
          snapshot, 'shapeSha256',
        )
        if (!snapshotDigest || !Object.hasOwn(snapshotDigest, 'value') ||
            !shapeDigest || !Object.hasOwn(shapeDigest, 'value') ||
            typeof snapshotDigest.value !== 'string' ||
            typeof shapeDigest.value !== 'string' ||
            !HEX_HASH.test(snapshotDigest.value) ||
            !HEX_HASH.test(shapeDigest.value) ||
            !VERIFIED_SCHEMA_ORG_STATUSES.has(snapshot.schemaOrgStatus) ||
            !Object.hasOwn(snapshot, 'hasNextData') ||
            typeof snapshot.hasNextData !== 'boolean' ||
            !Object.hasOwn(snapshot, 'jsonLdCount') ||
            !Number.isSafeInteger(snapshot.jsonLdCount) ||
            snapshot.jsonLdCount < 0 ||
            snapshot.jsonLdCount > MAX_JSON_LD_RECORDS ||
            !Object.hasOwn(snapshot, 'jsonLdParseErrors') ||
            !Number.isSafeInteger(snapshot.jsonLdParseErrors) ||
            snapshot.jsonLdParseErrors < 0 ||
            snapshot.jsonLdParseErrors > snapshot.jsonLdCount ||
            // Canonical M1 cannot produce a positive Product observation
            // when no JSON-LD record parsed successfully. The exported
            // direct queue accepts prebuilt reports too, so it must apply
            // this necessary provenance check independently of captureShape.
            (snapshot.schemaOrgStatus === 'candidate_observation' &&
             snapshot.jsonLdCount === snapshot.jsonLdParseErrors)) invalid()
      } else if (snapshot.captureStatus === 'unavailable') {
        // Failed captures have no inspected HTML or successful M1 signals.
        if (snapshot.snapshotSha256 !== null ||
            snapshot.shapeSha256 !== null ||
            snapshot.schemaOrgStatus !== 'unknown' ||
            Object.hasOwn(snapshot, 'hasNextData') ||
            Object.hasOwn(snapshot, 'jsonLdCount') ||
            Object.hasOwn(snapshot, 'jsonLdParseErrors')) invalid()
      } else {
        invalid()
      }
    }
    if (current === null && baseline === null) invalid()
    // Both sides are parsed by the same deterministic M1 HTML inspector.
    // Identical SHA-verified HTML from the same origin cannot produce two
    // different structural/schema fingerprints. A forged P1 shape change
    // must not be laundered into manual reviewer work.
    if (current?.captureStatus === 'verified' &&
        baseline?.captureStatus === 'verified' &&
        current.supermarket === baseline.supermarket &&
        current.kind === baseline.kind &&
        current.snapshotSha256 === baseline.snapshotSha256 &&
        (current.shapeSha256 !== baseline.shapeSha256 ||
         current.schemaOrgStatus !== baseline.schemaOrgStatus ||
         current.hasNextData !== baseline.hasNextData ||
         current.jsonLdCount !== baseline.jsonLdCount ||
         current.jsonLdParseErrors !== baseline.jsonLdParseErrors)) invalid()
    // Do not trust a reported 'unchanged' state when its immutable source
    // origin differs, nor a forged P1 origin state for identical provenance.
    const originChanged = current !== null && baseline !== null &&
      (current.supermarket !== baseline.supermarket || current.kind !== baseline.kind)
    if ((status === 'origin_changed') !== originChanged) invalid()
    if (current !== null) foundCurrent += 1
    if (status === 'removed' && !(current === null && baseline !== null)) invalid()
    if (status === 'added' && !(current !== null && baseline === null &&
        current.captureStatus === 'verified')) invalid()
    if (status === 'baseline_missing' && !(current !== null && baseline === null &&
        !report.baselineProvided && current.captureStatus === 'verified')) invalid()
    if (!report.baselineProvided && !['baseline_missing', 'unavailable'].includes(status)) invalid()
    if (report.baselineProvided && status === 'baseline_missing') invalid()
    if (!report.baselineProvided && status === 'added') invalid()
    if (['shape_changed', 'content_changed_shape_stable', 'unchanged'].includes(status) &&
        (current === null || baseline === null)) invalid()
    // A first/new unavailable capture has no comparable same-ID baseline,
    // and is P1 even without that baseline. This must not be forged into P2.
    if (status === 'unavailable' && (current === null ||
        (baseline === null && current.captureStatus !== 'unavailable'))) invalid()
    if (['unchanged', 'content_changed_shape_stable', 'shape_changed'].includes(status) &&
        (current.captureStatus !== 'verified' || baseline.captureStatus !== 'verified')) invalid()
    if (status === 'unavailable' && current?.captureStatus === 'verified' &&
        baseline?.captureStatus === 'verified') invalid()
    if (status === 'unchanged' &&
        (current.snapshotSha256 !== baseline.snapshotSha256 ||
         current.shapeSha256 !== baseline.shapeSha256 ||
         current.schemaOrgStatus !== baseline.schemaOrgStatus)) invalid()
    if (status === 'content_changed_shape_stable' &&
        (current.snapshotSha256 === baseline.snapshotSha256 ||
         current.shapeSha256 !== baseline.shapeSha256 ||
         current.schemaOrgStatus !== baseline.schemaOrgStatus)) invalid()
    if (status === 'shape_changed' &&
        current.shapeSha256 === baseline.shapeSha256 &&
        current.schemaOrgStatus === baseline.schemaOrgStatus) invalid()
    if (['removed', 'added', 'unavailable', 'shape_changed', 'origin_changed'].includes(status)) driftCount += 1
    const [priority, action] = STATUS_ACTION[status]
    return { sourceToken: sourceToken(id), status, priority, action,
      selectorVerified: false, rightsVerified: false, productionEnabled: false }
  })

  if (foundCurrent !== report.captureCount || driftCount !== report.driftCount) invalid()
  actions.sort((a, b) => a.priority.localeCompare(b.priority) ||
    a.action.localeCompare(b.action) || a.sourceToken.localeCompare(b.sourceToken))

  // Aggregates are derived ONLY from canonical validated action rows. The
  // bounded 200-item report never needs to expose source IDs, URLs, prices,
  // DOM payloads or per-source metadata to show a human the review workload.
  const priorityCounts = { P1: 0, P2: 0, P3: 0 }
  const statusCounts = Object.fromEntries(Object.keys(STATUS_ACTION).map(
    (status) => [status, 0],
  ))
  for (const action of actions) {
    priorityCounts[action.priority] += 1
    statusCounts[action.status] += 1
  }

  return {
    contractVersion: 1,
    mode: 'offline_selector_review_queue_only',
    inputContract: report.mode,
    baselineProvided: report.baselineProvided,
    sourceCount: foundCurrent,
    driftCount,
    summary: {
      actionCount: actions.length,
      priorityCounts,
      statusCounts,
    },
    reviewerActionRequired: true,
    selectorVerified: false,
    rightsVerified: false,
    productionReady: false,
    m5Eligible: false,
    actions,
  }
}

export async function main(argv = process.argv.slice(2)) {
  // The optional flag is permitted ONLY in first position, before paths.
  // Reject all other flags before touching a private capture directory.
  const summaryOnly = argv[0] === '--summary-only'
  const captureDirectories = summaryOnly ? argv.slice(1) : argv
  if (captureDirectories.length < 1 || captureDirectories.length > 2 ||
      captureDirectories.some((arg) =>
        typeof arg !== 'string' || !arg || arg.startsWith('--'))) {
    throw new Error('Usage: node scripts/m5-build-selector-review-queue.mjs [--summary-only] <M1-capture-dir> [baseline-M1-capture-dir]')
  }
  // Delayed import keeps the pure queue logic independently testable.
  const { compareCaptureDirectories } = await import('./m5-compare-capture-signatures.mjs')
  const comparison = await compareCaptureDirectories(
    captureDirectories[0], captureDirectories[1] ?? null,
  )
  // Always validate every action, including in aggregate-only mode. A forged
  // or invalid comparison cannot be promoted to a seemingly valid summary.
  const queue = buildOfflineSelectorReviewQueue(comparison)
  const output = summaryOnly
    ? {
        contractVersion: queue.contractVersion,
        mode: 'offline_selector_review_summary_only',
        inputContract: queue.inputContract,
        baselineProvided: queue.baselineProvided,
        sourceCount: queue.sourceCount,
        driftCount: queue.driftCount,
        summary: queue.summary,
        reviewerActionRequired: queue.reviewerActionRequired,
        selectorVerified: queue.selectorVerified,
        rightsVerified: queue.rightsVerified,
        productionReady: queue.productionReady,
        m5Eligible: queue.m5Eligible,
      }
    : queue
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // M1 integrity errors may contain capture IDs; the operator CLI must not
  // repeat these source labels or private local paths in stderr.
  await main().catch(() => {
    process.stderr.write('Offline review failed: invalid capture or report\n')
    process.exitCode = 1
  })
}
