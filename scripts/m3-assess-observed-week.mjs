import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

const ALLOWED_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])
const ALLOWED_SOURCES = new Set(['manual-cart', 'receipt', 'consented-export'])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, path) {
  assert(isRecord(value), `${path} must be an object`)
  return value
}

function requireString(value, path) {
  assert(typeof value === 'string' && value.trim().length > 0, `${path} must be a non-empty string`)
}

function requireNonNegativeInteger(value, path) {
  assert(Number.isInteger(value) && value >= 0, `${path} must be a non-negative integer`)
}

function requirePositiveInteger(value, path) {
  assert(Number.isInteger(value) && value > 0, `${path} must be a positive integer`)
}

function requirePositiveNumber(value, path) {
  assert(typeof value === 'number' && Number.isFinite(value) && value > 0, `${path} must be a positive finite number`)
}

function validateRequirement(requirement, path, { allowNullAmount = false } = {}) {
  requireRecord(requirement, path)
  const amountValid =
    (allowNullAmount && requirement.amount === null) ||
    (typeof requirement.amount === 'number' &&
      Number.isFinite(requirement.amount) &&
      requirement.amount > 0)
  assert(amountValid, `${path}.amount must be ${allowNullAmount ? 'null or ' : ''}a positive finite number`)
  assert(ALLOWED_UNITS.has(requirement.unit), `${path}.unit is not an allowed unit`)
}

function validateReasons(reasons, path) {
  assert(Array.isArray(reasons), `${path} must be an array`)
  assert(reasons.every((reason) => typeof reason === 'string'), `${path} must contain only strings`)
}

function validateMatchedLine(line, path) {
  requireString(line.productId, `${path}.productId`)
  requireString(line.productName, `${path}.productName`)
  requirePositiveInteger(line.packs, `${path}.packs`)
  requireRecord(line.pack, `${path}.pack`)
  requirePositiveNumber(line.pack.amount, `${path}.pack.amount`)
  assert(ALLOWED_UNITS.has(line.pack.unit), `${path}.pack.unit is not an allowed unit`)
  requirePositiveInteger(line.pack.count, `${path}.pack.count`)
  requireNonNegativeInteger(line.pricePerPackCents, `${path}.pricePerPackCents`)
  requireNonNegativeInteger(line.lineTotalCents, `${path}.lineTotalCents`)
  assert(
    line.lineTotalCents === line.packs * line.pricePerPackCents,
    `${path}.lineTotalCents must equal packs × pricePerPackCents`,
  )
  assert(
    typeof line.matchScore === 'number' && Number.isFinite(line.matchScore),
    `${path}.matchScore must be a finite number`,
  )
}

function validateBasketLine(line, path) {
  requireRecord(line, path)
  requireString(line.id, `${path}.id`)
  requireString(line.ingredientLabel, `${path}.ingredientLabel`)
  assert(line.status === 'matched' || line.status === 'unresolved', `${path}.status must be matched or unresolved`)
  validateRequirement(line.requirement, `${path}.requirement`, {
    allowNullAmount: line.status === 'unresolved',
  })
  validateReasons(line.reasons, `${path}.reasons`)

  if (line.status === 'matched') {
    validateMatchedLine(line, path)
  } else {
    assert(
      line.matchScore === null ||
        (typeof line.matchScore === 'number' && Number.isFinite(line.matchScore)),
      `${path}.matchScore must be null or a finite number`,
    )
  }
}

function validateBasket(basket, path) {
  requireRecord(basket, path)
  requireRecord(basket.store, `${path}.store`)
  requireString(basket.store.id, `${path}.store.id`)
  requireString(basket.store.name, `${path}.store.name`)
  requireNonNegativeInteger(basket.selectedMealCount, `${path}.selectedMealCount`)
  assert(Array.isArray(basket.lines), `${path}.lines must be an array`)
  basket.lines.forEach((line, index) => validateBasketLine(line, `${path}.lines[${index}]`))
  requireNonNegativeInteger(basket.totalCents, `${path}.totalCents`)
  requireNonNegativeInteger(basket.matchedLineCount, `${path}.matchedLineCount`)
  requireNonNegativeInteger(basket.unresolvedLineCount, `${path}.unresolvedLineCount`)
}

function validateEvidence(evidence, path) {
  requireRecord(evidence, path)
  requireString(evidence.evidenceId, `${path}.evidenceId`)
  requireString(evidence.observedAt, `${path}.observedAt`)
  assert(ALLOWED_SOURCES.has(evidence.source), `${path}.source is not an allowed observed source`)
  requireString(evidence.provenanceNote, `${path}.provenanceNote`)
  validateBasket(evidence.basket, `${path}.basket`)
}

export function validateObservedWeekInput(study) {
  requireRecord(study, 'study')
  assert(Number.isInteger(study.schemaVersion), 'schemaVersion must be an integer')
  requireString(study.studyId, 'studyId')
  requireString(study.participantKey, 'participantKey')
  requireString(study.population, 'population')
  requireString(study.region, 'region')
  requireString(study.weekStart, 'weekStart')
  validateEvidence(study.baseline, 'baseline')
  validateEvidence(study.candidate, 'candidate')
  if (study.attributionEvidence !== undefined) {
    assert(
      Array.isArray(study.attributionEvidence),
      'attributionEvidence must be an array when provided',
    )
  }
  return study
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
  validateObservedWeekInput(study)
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
    attribution: {
      status: assessment.attribution.status,
      fullyAttributed: assessment.attribution.fullyAttributed,
      comparisonDeltaCents: assessment.attribution.comparisonDeltaCents,
      effectTotals: assessment.attribution.effectTotals,
      reasons: assessment.attribution.reasons,
    },
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
  let study

  try {
    study = JSON.parse(await readFile(input, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`study JSON could not be read/parsed: ${message}`)
  }

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
