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
      report.captureCount > 100 ||
      !Number.isSafeInteger(report.driftCount) || report.driftCount < 0 ||
      !Array.isArray(report.changes) || report.changes.length > MAX_CHANGES) invalid()

  const seen = new Set()
  let foundCurrent = 0
  let driftCount = 0
  const actions = report.changes.map((change) => {
    if (!change || typeof change !== 'object' ||
        typeof change.id !== 'string' || !change.id || change.id.length > 512 ||
        !validUnicodeSourceId(change.id) ||
        typeof change.status !== 'string' || !Object.hasOwn(STATUS_ACTION, change.status) ||
        seen.has(change.id)) invalid()
    seen.add(change.id)
    const { current, baseline, status } = change
    for (const snapshot of [current, baseline]) {
      if (snapshot === null) continue
      if (!snapshot || typeof snapshot !== 'object' || snapshot.id !== change.id) invalid()
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
    // Do not trust a reported 'unchanged' state when its immutable source
    // origin differs, nor a forged P1 origin state for identical provenance.
    const originChanged = current !== null && baseline !== null &&
      (current.supermarket !== baseline.supermarket || current.kind !== baseline.kind)
    if ((status === 'origin_changed') !== originChanged) invalid()
    if (current !== null) foundCurrent += 1
    if (status === 'removed' && !(current === null && baseline !== null)) invalid()
    if (status === 'added' && !(current !== null && baseline === null)) invalid()
    if (status === 'baseline_missing' && !(current !== null && baseline === null && !report.baselineProvided)) invalid()
    if (!report.baselineProvided && status !== 'baseline_missing') invalid()
    if (report.baselineProvided && status === 'baseline_missing') invalid()
    if (!report.baselineProvided && status === 'added') invalid()
    if (['unavailable', 'shape_changed', 'content_changed_shape_stable', 'unchanged'].includes(status) &&
        (current === null || baseline === null)) invalid()
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
