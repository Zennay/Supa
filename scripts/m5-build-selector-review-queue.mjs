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
  for (let index = 0; index < report.changes.length; index += 1) {
    if (!Object.hasOwn(report.changes, index)) invalid()
  }

  const seen = new Set()
  let foundCurrent = 0
  let foundBaseline = 0
  let driftCount = 0
  const actions = report.changes.map((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change) ||
        typeof change.id !== 'string' || !change.id || change.id.length > MAX_SOURCE_ID_UNITS ||
        !validUnicodeSourceId(change.id) ||
        typeof change.status !== 'string' || !Object.hasOwn(STATUS_ACTION, change.status) ||
        seen.has(change.id)) invalid()
    seen.add(change.id)
    const { current, baseline, status } = change
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
          snapshot.id !== change.id ||
          !canonicalOrigin(snapshot.supermarket) ||
          !canonicalOrigin(snapshot.kind)) invalid()
      // Only metadata produced by the canonical M1 captureShape() contract is
      // eligible for a human-only queue. Inconsistent or invented provenance
      // cannot be upgraded to a nominal review action.
      if (snapshot.captureStatus === 'verified') {
        if (!HEX_HASH.test(snapshot.snapshotSha256) ||
            !HEX_HASH.test(snapshot.shapeSha256) ||
            !VERIFIED_SCHEMA_ORG_STATUSES.has(snapshot.schemaOrgStatus)) invalid()
      } else if (snapshot.captureStatus === 'unavailable') {
        if (snapshot.snapshotSha256 !== null ||
            snapshot.shapeSha256 !== null ||
            snapshot.schemaOrgStatus !== 'unknown') invalid()
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
         current.schemaOrgStatus !== baseline.schemaOrgStatus)) invalid()
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
    return { sourceToken: sourceToken(change.id), status, priority, action,
      selectorVerified: false, rightsVerified: false, productionEnabled: false }
  })

  if (foundCurrent !== report.captureCount || driftCount !== report.driftCount) invalid()
  actions.sort((a, b) => a.priority.localeCompare(b.priority) ||
    a.action.localeCompare(b.action) || a.sourceToken.localeCompare(b.sourceToken))
  return {
    contractVersion: 1,
    mode: 'offline_selector_review_queue_only',
    inputContract: report.mode,
    baselineProvided: report.baselineProvided,
    sourceCount: foundCurrent,
    driftCount,
    reviewerActionRequired: true,
    selectorVerified: false,
    rightsVerified: false,
    productionReady: false,
    m5Eligible: false,
    actions,
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 2 || argv.some((arg) => !arg || arg.startsWith('--'))) {
    throw new Error('Usage: node scripts/m5-build-selector-review-queue.mjs <M1-capture-dir> [baseline-M1-capture-dir]')
  }
  // Delayed import keeps the pure queue logic independently testable.
  const { compareCaptureDirectories } = await import('./m5-compare-capture-signatures.mjs')
  const comparison = await compareCaptureDirectories(argv[0], argv[1] ?? null)
  process.stdout.write(JSON.stringify(buildOfflineSelectorReviewQueue(comparison), null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // M1 integrity errors may contain capture IDs; the operator CLI must not
  // repeat these source labels or private local paths in stderr.
  await main().catch(() => {
    process.stderr.write('Offline review failed: invalid capture or report\n')
    process.exitCode = 1
  })
}
