import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildWeeklyBasketStudyFromObservationSheet } from './m3-build-observed-study.mjs'
import { buildObservedWeekReport } from './m3-assess-observed-week.mjs'
import {
  assertNoSymlinkedM3OutputParents,
  writeDerivedM3Output,
  privateM3OutputFailure,
} from './m3-source-output-preservation.mjs'

// Explicitly private, locally observed product detail, never an online price
// catalog, a licensed retailer feed, a public basket claim or a scraper.
function displayProduct(line) {
  if (line.status !== 'matched') {
    return { status: 'unresolved', productName: null, packages: null,
      pricePerPackageCents: null, lineTotalCents: null }
  }
  return {
    status: 'known',
    productName: line.productName,
    packages: line.packs,
    packAmount: line.pack.amount,
    packUnit: line.pack.unit,
    itemsPerPackage: line.pack.count,
    pricePerPackageCents: line.pricePerPackCents,
    lineTotalCents: line.lineTotalCents,
  }
}

export function buildPrivateM3ProductComparison(sheet) {
  // The canonical converter validates 11 identical ingredient requirements,
  // source/store provenance, amounts, packs and safe integer prices before
  // any per-line monetary values are allowed into this private output.
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)

  const baselineLines = study.baseline.basket.lines
  const candidateLines = study.candidate.basket.lines
  const lines = baselineLines.map((baseline, index) => {
    const candidate = candidateLines[index]
    if (!candidate || baseline.id !== candidate.id ||
        baseline.requirement.amount !== candidate.requirement.amount ||
        baseline.requirement.unit !== candidate.requirement.unit) {
      throw new Error('M3 product comparison requires identical canonical demands')
    }
    const plus = displayProduct(baseline)
    const deka = displayProduct(candidate)
    const bothKnown = plus.status === 'known' && deka.status === 'known'
    return {
      ingredientId: baseline.id,
      ingredientLabel: baseline.ingredientLabel,
      requiredAmount: baseline.requirement.amount,
      requiredUnit: baseline.requirement.unit,
      plus,
      dekamarkt: deka,
      // A partial row difference is only provisional; a FULL basket winner
      // still requires all 11 per-store lines and the observed-week gates.
      provisionalLineDeltaCents: bothKnown
        ? deka.lineTotalCents - plus.lineTotalCents
        : null,
    }
  })

  const full = report.claimable && report.baseline.matchedLineCount === 11 &&
    report.candidate.matchedLineCount === 11 && lines.length === 11
  return {
    schemaVersion: 1,
    reportType: 'm3-private-observed-product-comparison',
    evidenceStatus: 'unverified-local-observations',
    privateOnly: true,
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    priceContext: study.priceContext,
    knownSubtotalsCents: {
      plus: study.baseline.basket.totalCents,
      dekamarkt: study.candidate.basket.totalCents,
      // Known subtotals are never full basket prices if rows are missing.
      incompleteBasket: !full,
    },
    comparableLineCount: lines.filter(line => line.provisionalLineDeltaCents !== null).length,
    unmatchedLineCount: lines.filter(line => line.provisionalLineDeltaCents === null).length,
    fullBasket: full ? {
      comparable: true,
      outcome: report.outcome,
      plusTotalCents: report.baselineTotalCents,
      dekamarktTotalCents: report.candidateTotalCents,
      deltaCents: report.deltaCents,
      provisionalSavingsCents: report.savingsCents,
    } : {
      comparable: false,
      outcome: 'unknown',
      plusTotalCents: null,
      dekamarktTotalCents: null,
      deltaCents: null,
      provisionalSavingsCents: null,
    },
    lines,
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || argv[1] !== '--output' ||
      !argv[0] || argv[0].startsWith('-') ||
      !argv[2] || argv[2] !== argv[2].trim() || argv[2].startsWith('-')) {
    throw new Error('usage: m3-private-product-comparison <observation-sheet.json> --output <private-comparison.json>')
  }
  let raw
  try {
    raw = JSON.parse(await readFile(argv[0], 'utf8'))
  } catch {
    throw new Error('private M3 observation input could not be read')
  }
  // Errors from malformed user-supplied data must not reach the CLI stderr.
  const comparison = buildPrivateM3ProductComparison(raw)
  const serialized = JSON.stringify(comparison, null, 2) + '\n'
  try {
    await assertNoSymlinkedM3OutputParents(argv[2])
    await mkdir(dirname(argv[2]), { recursive: true, mode: 0o700 })
    await writeDerivedM3Output(argv[0], argv[2], serialized)
  } catch (error) {
    throw privateM3OutputFailure(error)
  }
  return comparison
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('M3 private product comparison could not be generated\n')
    process.exitCode = 1
  })
}
