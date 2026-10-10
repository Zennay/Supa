import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  nextIncompleteObservationLine,
  observationSheetProgress,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from './m3-build-observed-study.mjs'

// Privacy boundary: do not print raw input, participant keys, store identifiers,
// prices, source URLs or provenance notes. A structurally ready sheet is never
// proof that measurements were genuinely made.
const EVIDENCE_BOUNDARY =
  'Structure only: real retailer observations, permission and financial claims require independent human verification.'

function invalid(reason) {
  return {
    status: 'invalid',
    readyForHumanReview: false,
    verifiedFieldEvidence: false,
    publicSavingsClaimEligible: false,
    issues: [reason],
    evidenceBoundary: EVIDENCE_BOUNDARY,
  }
}

export function checkFieldSheet(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('Observation sheet must be a canonical JSON object.')
  }

  let restored
  try {
    restored = restoreObservationSheetDraft(JSON.stringify(raw))
  } catch {
    return invalid('Observation sheet cannot be safely inspected.')
  }

  // Draft restoration deliberately repairs bad user input for the UI. For
  // an actual evidence handoff, silently repairing it would be misleading.
  if (!restored || !isDeepStrictEqual(raw, restored)) {
    return invalid('Observation sheet is malformed or differs from the canonical field contract; preserve and review the original.')
  }

  let progress
  let readiness
  let window
  let next
  try {
    progress = observationSheetProgress(restored)
    readiness = observationSheetReadiness(restored)
    window = observationWindowSummary(restored)
    next = nextIncompleteObservationLine(restored)
  } catch {
    return invalid('Observation sheet failed its read-only collection checks.')
  }

  const issues = [...readiness.issues]
  if (readiness.ready) {
    try {
      // The canonical converter is stricter than UI collection readiness.
      // Run it without persisting the returned study or printing its values.
      buildWeeklyBasketStudyFromObservationSheet(restored)
    } catch {
      issues.push('Canonical study conversion preflight failed; inspect the original sheet locally.')
    }
  }

  return {
    status: issues.length === 0 ? 'ready-for-human-review' : 'needs-field-input',
    readyForHumanReview: issues.length === 0,
    verifiedFieldEvidence: false,
    publicSavingsClaimEligible: false,
    progress: {
      totalLines: progress.totalLines,
      availabilityRecorded: progress.availabilityRecorded,
      completeLines: progress.completeLines,
      metadataCompleted: progress.metadataCompleted,
      metadataTotal: progress.metadataTotal,
    },
    observationWindowState: window.state,
    nextIncomplete: next
      ? { retailerSide: next.side, ingredientId: next.ingredientId }
      : null,
    issues,
    evidenceBoundary: EVIDENCE_BOUNDARY,
  }
}

export async function main(argv = process.argv.slice(2)) {
  assert(
    argv.length === 1 && typeof argv[0] === 'string' &&
      argv[0].trim() !== '' && !argv[0].startsWith('-'),
    'usage: node --experimental-strip-types scripts/m3-check-field-readiness.mjs <observation-sheet.json>',
  )

  let raw
  try {
    raw = JSON.parse(await readFile(argv[0], 'utf8'))
  } catch {
    const result = invalid('The observation sheet could not be read as JSON.')
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = 1
    return result
  }

  const result = checkFieldSheet(raw)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === 'invalid') process.exitCode = 1
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
