import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function storeSummary(evidence) {
  return {
    evidenceId: evidence.evidenceId,
    observedAt: evidence.observedAt,
    source: evidence.source,
    storeId: evidence.basket.store.id,
    storeName: evidence.basket.store.name,
    totalCents: evidence.basket.totalCents,
    matchedLineCount: evidence.basket.matchedLineCount,
    unresolvedLineCount: evidence.basket.unresolvedLineCount,
  }
}

export function buildObservedWeekReport(study) {
  const assessment = assessWeeklyBasketStudy(study)

  return {
    schemaVersion: 1,
    reportType: 'm3-observed-week-assessment',
    studyId: study.studyId,
    population: study.population,
    region: study.region,
    weekStart: study.weekStart,
    baseline: storeSummary(study.baseline),
    candidate: storeSummary(study.candidate),
    claimable: assessment.claimable,
    outcome: assessment.comparison.outcome,
    baselineTotalCents: assessment.comparison.baselineTotalCents,
    candidateTotalCents: assessment.comparison.candidateTotalCents,
    deltaCents: assessment.comparison.deltaCents,
    savingsCents: assessment.comparison.savingsCents,
    observationWindowHours: assessment.observationWindowHours,
    reasons: assessment.reasons,
    publicSavingsClaimEligible: false,
    evidenceBoundary:
      'One observed week is study evidence only and never sufficient by itself for a public savings claim.',
  }
}

function parseArgs(argv) {
  const positional = []
  let output = null

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') {
      output = argv[index + 1] ?? null
      index += 1
      continue
    }
    positional.push(value)
  }

  assert(positional.length === 1, 'usage: m3-assess-observed-week <study.json> [--output report.json]')
  assert(!output || output.trim().length > 0, '--output requires a file path')

  return {
    input: positional[0],
    output,
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { input, output } = parseArgs(argv)
  const study = JSON.parse(await readFile(input, 'utf8'))
  const report = buildObservedWeekReport(study)
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  if (output) {
    await writeFile(output, serialized, 'utf8')
  } else {
    process.stdout.write(serialized)
  }

  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
