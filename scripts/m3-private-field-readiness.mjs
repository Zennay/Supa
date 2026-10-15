/**
 * Private, offline M3 field-intake progress check.
 * Additive product-only adapter: does not change the original collector,
 * converter, study or canonical assessment contract.
 */
import { open, constants } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
import {
  buildObservationSheet,
  restoreObservationSheetDraft,
  observationSheetProgress,
  observationStoreProgress,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from './m3-build-observed-study.mjs'
import { createPrivateM3StudyCodePin } from './m3-field-code-pin.mjs'
import {
  assertUnambiguousM3StudyJson,
  preflightPrivateM3Week,
} from './m3-verify-private-week-preflight.mjs'

const MAX_SHEET_BYTES = 4 * 1024 * 1024
const FAILURE = 'Private M3 field readiness refused'
const SHA = /^[0-9a-f]{40}$/
function refuse() {
  throw new Error(FAILURE)
}

async function readPrivateSheet(path) {
  if (typeof path !== 'string' || !path || path.startsWith('-')) refuse()
  let handle
  try {
    // O_NOFOLLOW guards only the final path component. Refuse statically
    // symlinked ancestor directories too (not an openat race-proof sandbox).
    await assertNoSymlinkedM3OutputParents(path)
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const st = await handle.stat()
    if (!st.isFile() || st.nlink !== 1 || st.size <= 0 ||
        st.size > MAX_SHEET_BYTES) refuse()
    const buffer = Buffer.alloc(st.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset < 1 || offset > MAX_SHEET_BYTES) refuse()
    return buffer.subarray(0, offset)
  } catch {
    refuse()
  } finally {
    await handle?.close().catch(() => {})
  }
}

export function reviewPrivateM3FieldSheet(rawSheetBytes, expectedMainSha) {
  try {
    if (!Buffer.isBuffer(rawSheetBytes) || rawSheetBytes.length === 0 ||
        rawSheetBytes.length > MAX_SHEET_BYTES ||
        typeof expectedMainSha !== 'string' ||
        !SHA.test(expectedMainSha) || /^0{40}$/.test(expectedMainSha)) refuse()
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawSheetBytes)
    assertUnambiguousM3StudyJson(raw)
    const sheet = restoreObservationSheetDraft(raw)
    if (!sheet) refuse()
    const progress = observationSheetProgress(sheet)
    const plusProgress = observationStoreProgress(sheet.baseline)
    const dekaProgress = observationStoreProgress(sheet.candidate)
    const expected = buildObservationSheet().requirements.length * 2
    if (progress.totalLines !== expected || expected !== 22 ||
        progress.completeLines > expected ||
        progress.metadataCompleted > progress.metadataTotal) refuse()

    const intakeComplete = progress.completeLines === expected &&
      progress.metadataCompleted === progress.metadataTotal

    let converted = false
    let baselineUnresolved = null
    let candidateUnresolved = null
    if (intakeComplete) {
      // Actual converter + *same-demand* private preflight, in-memory only.
      // Never serialize the private study, manifest, prices or participant.
      // Draft restoration intentionally normalizes recoverable user edits.
      // Conversion proof MUST use the raw, unmodified source, otherwise a
      // forged 24h gate or other mutated persisted field could be masked.
      const originalSheet = JSON.parse(raw)
      const study = buildWeeklyBasketStudyFromObservationSheet(originalSheet)
      const studyBytes = Buffer.from(JSON.stringify(study))
      const pinBytes = Buffer.from(JSON.stringify(
        createPrivateM3StudyCodePin(studyBytes, expectedMainSha),
      ))
      const result = preflightPrivateM3Week(studyBytes, pinBytes, expectedMainSha)
      if (result.status !== 'private-review-only' ||
          result.canonicalDemandLineCount !== 11 ||
          result.sourceCommitShaAuthenticated !== false ||
          result.publicSavingsClaimEligible !== false) refuse()
      converted = true
      baselineUnresolved = study.baseline.basket.unresolvedLineCount
      candidateUnresolved = study.candidate.basket.unresolvedLineCount
    }

    const nextAction = !intakeComplete
      ? (progress.metadataCompleted < progress.metadataTotal
        ? 'complete-private-study-metadata'
        : plusProgress.completeLines < 11
          ? 'complete-plus-observations'
          : 'complete-dekamarkt-observations')
      : (baselineUnresolved + candidateUnresolved > 0
        ? 'review-unavailable-or-unmatched-products'
        : 'retain-private-observation-and-obtain-human-rights-review')

    return Object.freeze({
      status: 'private-tooling-only',
      canonicalLineCount: expected,
      recordedAvailabilityCount: progress.availabilityRecorded,
      completeObservationLineCount: progress.completeLines,
      plusCompleteLineCount: plusProgress.completeLines,
      dekamarktCompleteLineCount: dekaProgress.completeLines,
      plusAvailabilityRecorded: plusProgress.availabilityRecorded,
      dekamarktAvailabilityRecorded: dekaProgress.availabilityRecorded,
      metadataCompleteCount: progress.metadataCompleted,
      metadataRequiredCount: progress.metadataTotal,
      technicalStudyConversionPossible: converted,
      baselineUnresolvedLineCount: baselineUnresolved,
      candidateUnresolvedLineCount: candidateUnresolved,
      nextAction,
      fieldObservationVerified: false,
      sourceCommitShaAuthenticated: false,
      codeRevisionVerified: false,
      retailerPermissionVerified: false,
      publicSavingsClaimEligible: false,
    })
  } catch {
    refuse()
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.length !== 3 ||
      argv[1] !== '--expect-main-sha' ||
      typeof argv[2] !== 'string') refuse()
  const bytes = await readPrivateSheet(argv[0])
  const result = reviewPrivateM3FieldSheet(bytes, argv[2])
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(FAILURE)
    process.exitCode = 1
  })
}
