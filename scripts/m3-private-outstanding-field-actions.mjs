import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

/**
 * A read-only shopping-field to-do list for the exact canonical M3 demand.
 * Never echo free-form participant/store/product values, prices, evidence
 * identifiers, source URLs or timestamp strings from a private field draft.
 *
 * This is an operator aide, NOT independent proof of a genuine store visit.
 */
export function buildM3OutstandingFieldActions(serialized, referenceNowMs = Date.now()) {
  if (typeof serialized !== 'string' || !Number.isSafeInteger(referenceNowMs) ||
      referenceNowMs < 0) {
    throw new Error('invalid private M3 draft input or reference clock')
  }
  const sheet = restoreObservationSheetDraft(serialized)
  if (!sheet) throw new Error('private M3 draft is not a canonical collection sheet')

  const requirements = buildObservationSheet().requirements
  if (requirements.length !== 11 ||
      sheet.baseline.lines.length !== 11 || sheet.candidate.lines.length !== 11) {
    throw new Error('M3 paired eleven-line demand does not match the planner')
  }

  const toDo = (side, retailer) => {
    const pending = sheet[side].lines.flatMap((line, index) => {
      const expected = requirements[index]
      if (!expected || line.ingredientId !== expected.id ||
          line.requirement.amount !== expected.amount ||
          line.requirement.unit !== expected.unit) {
        throw new Error('M3 row differs from canonical planner requirement')
      }
      if (observationLineCollectionComplete(line)) return []
      return [{
        ingredientId: expected.id,
        ingredientLabel: expected.label,
        requiredAmount: expected.amount,
        requiredUnit: expected.unit,
        action: line.observedProduct.available === true
          ? 'complete-product-pack-and-price' : 'record-availability',
      }]
    })
    return {
      retailer,
      expectedLines: 11,
      completedLines: 11 - pending.length,
      remainingLines: pending.length,
      pending,
    }
  }
  const plus = toDo('baseline', 'PLUS')
  const dekamarkt = toDo('candidate', 'DekaMarkt')
  const readyForPrivateReview = plus.remainingLines === 0 &&
    dekamarkt.remainingLines === 0 &&
    observationSheetReadiness(sheet, referenceNowMs).ready

  return {
    schemaVersion: 1,
    reportType: 'm3-private-outstanding-field-actions',
    evidenceStatus: 'unverified-operator-draft',
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    readyForPrivateReview,
    observationWindowState: observationWindowSummary(sheet, referenceNowMs).state,
    expectedTotalLines: 22,
    completedTotalLines: plus.completedLines + dekamarkt.completedLines,
    remainingTotalLines: plus.remainingLines + dekamarkt.remainingLines,
    retailers: [plus, dekamarkt],
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || typeof argv[0] !== 'string' ||
      !argv[0].trim() || argv[0] !== argv[0].trim() ||
      argv[0].startsWith('-')) {
    throw new Error('usage: m3-private-outstanding-field-actions <private-sheet.json>')
  }
  let serialized
  try {
    serialized = await readFile(argv[0], 'utf8')
  } catch {
    throw new Error('could not read private M3 draft')
  }
  const result = buildM3OutstandingFieldActions(serialized)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print private source paths, observer identifiers, store metadata,
    // untrusted error messages or the sensitive draft itself.
    process.stderr.write('M3 private outstanding field actions could not be generated\n')
    process.exitCode = 1
  })
}
