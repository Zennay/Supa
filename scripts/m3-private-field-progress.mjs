import { pathToFileURL } from 'node:url'
import { readPrivateM3Draft } from './m3-private-draft-read.mjs'

import {
  restoreObservationSheetDraft,
  observationSheetProgress,
  observationStoreProgress,
  observationSheetReadiness,
  observationWindowSummary,
  nextIncompleteObservationLine,
} from '../src/domain/m3ObservationSheet.ts'

// A safe operator summary only. No product prices, names, participant keys,
// raw field times, store IDs, provenance notes or input paths are displayed.
export function buildPrivateM3FieldProgress(serialized, referenceNowMs = Date.now()) {
  if (typeof serialized !== 'string' || !Number.isSafeInteger(referenceNowMs) ||
      referenceNowMs < 0) {
    throw new Error('private M3 progress input or reference clock is invalid')
  }
  const sheet = restoreObservationSheetDraft(serialized)
  if (!sheet) return null

  const progress = observationSheetProgress(sheet)
  const baseline = observationStoreProgress(sheet.baseline)
  const candidate = observationStoreProgress(sheet.candidate)
  const readiness = observationSheetReadiness(sheet, referenceNowMs)
  const timeWindow = observationWindowSummary(sheet, referenceNowMs)
  const next = nextIncompleteObservationLine(sheet)

  // The planner demand is pinned by the canonical draft restoration.
  // "Ready" is only permission to perform private human review, not proof
  // that the shopper visited both stores, prices were genuine or saved money.
  const readyForPrivateReview = readiness.ready &&
    progress.totalLines === 22 &&
    baseline.totalLines === 11 &&
    candidate.totalLines === 11

  return {
    schemaVersion: 1,
    reportType: 'm3-private-field-progress',
    evidenceStatus: 'unverified-operator-draft',
    readyForPrivateReview,
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    baseline: {
      retailer: 'PLUS',
      expectedLines: 11,
      availabilityRecorded: baseline.availabilityRecorded,
      completeLines: baseline.completeLines,
    },
    candidate: {
      retailer: 'DekaMarkt',
      expectedLines: 11,
      availabilityRecorded: candidate.availabilityRecorded,
      completeLines: candidate.completeLines,
    },
    progress: {
      expectedLines: 22,
      availabilityRecorded: progress.availabilityRecorded,
      completeLines: progress.completeLines,
      incompleteLines: progress.totalLines - progress.completeLines,
      metadataCompleted: progress.metadataCompleted,
      metadataTotal: progress.metadataTotal,
      readinessIssueCount: readiness.issues.length,
    },
    observationWindow: {
      state: timeWindow.state,
      // Never include raw participant observation timestamps or dates in a
      // shareable status summary; this is strictly a coarse aggregate.
      ...(timeWindow.state === 'within-window' ||
          timeWindow.state === 'outside-window'
        ? { deltaHours: timeWindow.deltaHours } : {}),
    },
    nextIncomplete: next === null ? null : {
      retailer: next.side === 'baseline' ? 'PLUS' : 'DekaMarkt',
      // Ingredient IDs come from the canonical planner, never caller text.
      ingredientId: next.ingredientId,
    },
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || typeof argv[0] !== 'string' ||
      !argv[0].trim() || argv[0].startsWith('-')) {
    throw new Error('usage: m3-private-field-progress <local-observation-sheet.json>')
  }

  // Only private, single-link, bounded regular 0600 draft files may inform
  // operator progress. Canonical content restoration remains unchanged.
  const serialized = await readPrivateM3Draft(argv[0])

  const report = buildPrivateM3FieldProgress(serialized)
  if (report === null) {
    throw new Error('M3 field draft is not a recognized canonical sheet')
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never log a path or untrusted parser exception, even if a local file
    // happens to contain malicious pseudo-identities in a field key.
    console.error('M3 private field progress could not be generated')
    process.exitCode = 1
  })
}
