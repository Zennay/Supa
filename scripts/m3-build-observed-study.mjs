import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { matchIngredient } from '../src/domain/matching.ts'
import {
  M3_EXPECTED_RETAILERS,
  observationStoreMatchesExpectedRetailer,
} from '../src/domain/m3ObservationSheet.ts'
import { validateObservedWeekInput } from './m3-assess-observed-week.mjs'
import { buildObservationSheet } from './m3-create-observation-sheet.mjs'

const ALLOWED_SOURCES = new Set(['manual-cart', 'receipt', 'consented-export'])
const ALLOWED_PRICE_CONTEXTS = new Set(['in-store', 'online-order'])
const ALLOWED_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

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
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${path} must be a non-empty string`,
  )
}

function validCalendarDate(value) {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false
  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !validCalendarDate(match[1])) return false

  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return false

  if (match[5] !== 'Z') {
    const [offsetHour, offsetMinute] = match[5]
      .slice(1)
      .split(':')
      .map(Number)
    if (offsetHour > 23 || offsetMinute > 59) return false
  }

  // A future instant is not a completed human field observation. Treat the
  // explicit timezone offset as part of the instant, never as a clock label.
  const observedMs = Date.parse(value)
  return Number.isFinite(observedMs) && observedMs <= Date.now()
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function baseAmount(amount, unit) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null
  }
  if (unit === 'kg') return { amount: amount * 1000, family: 'mass' }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') return { amount: amount * 1000, family: 'volume' }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return null
}

function unresolvedLine(requirement, reasons, matchScore = null) {
  return {
    id: requirement.id,
    ingredientLabel: requirement.label,
    requirement: {
      amount: requirement.amount,
      unit: requirement.unit,
    },
    status: 'unresolved',
    reasons,
    matchScore,
  }
}

function validateSheetLine(line, requirement, path) {
  requireRecord(line, path)
  assert(
    line.ingredientId === requirement.id,
    `${path}.ingredientId must remain ${requirement.id}`,
  )
  assert(
    line.ingredientLabel === requirement.label,
    `${path}.ingredientLabel must remain ${requirement.label}`,
  )
  assert(
    sameJson(line.requirement, {
      amount: requirement.amount,
      unit: requirement.unit,
    }),
    `${path}.requirement must match the canonical planner demand`,
  )
  requireRecord(line.observedProduct, `${path}.observedProduct`)
  assert(
    typeof line.observedProduct.available === 'boolean',
    `${path}.observedProduct.available must be true or false`,
  )
}

function buildObservedLine(line, requirement, path) {
  validateSheetLine(line, requirement, path)
  const observed = line.observedProduct

  if (!observed.available) {
    return unresolvedLine(requirement, ['observed product unavailable'])
  }

  if (
    typeof observed.productName !== 'string' ||
    observed.productName.trim().length === 0
  ) {
    return unresolvedLine(requirement, ['observed product name is missing'])
  }

  if (
    observed.packAmount === null ||
    typeof observed.packAmount !== 'number' ||
    !Number.isFinite(observed.packAmount) ||
    observed.packAmount <= 0 ||
    observed.packUnit === null ||
    !ALLOWED_UNITS.has(observed.packUnit) ||
    observed.packUnit === 'unknown'
  ) {
    return unresolvedLine(requirement, ['observed pack quantity is unknown or invalid'])
  }

  const packCount = observed.packCount ?? 1
  if (!Number.isSafeInteger(packCount) || packCount <= 0) {
    return unresolvedLine(requirement, ['observed pack count is unknown or invalid'])
  }

  if (
    observed.priceCents === null ||
    !Number.isSafeInteger(observed.priceCents) ||
    observed.priceCents < 0
  ) {
    return unresolvedLine(requirement, ['observed price is unknown or invalid'])
  }

  const productId =
    typeof observed.productId === 'string' && observed.productId.trim().length > 0
      ? observed.productId.trim()
      : `observation-${requirement.id}`

  const decision = matchIngredient(
    {
      id: requirement.id,
      query: requirement.query,
      amount: requirement.amount,
      unit: requirement.unit,
    },
    [
      {
        id: productId,
        name: observed.productName.trim(),
        packAmount: observed.packAmount,
        packUnit: observed.packUnit,
        packCount,
        available: true,
      },
    ],
  )

  if (decision.type === 'abstain') {
    return unresolvedLine(
      requirement,
      [...decision.reasons, 'observed product mapping is not trusted'],
      decision.score,
    )
  }

  const required = baseAmount(requirement.amount, requirement.unit)
  const pack = baseAmount(observed.packAmount * packCount, observed.packUnit)

  if (!required || !pack || required.family !== pack.family) {
    return unresolvedLine(
      requirement,
      [...decision.reasons, 'observed pack cannot satisfy the requirement unit'],
      decision.score,
    )
  }

  const packs = Math.ceil(required.amount / pack.amount)
  const lineTotalCents = packs * observed.priceCents

  if (!Number.isSafeInteger(packs) || !Number.isSafeInteger(lineTotalCents)) {
    return unresolvedLine(requirement, [
      ...decision.reasons,
      'observed basket quantity or monetary total exceeds the safe integer range',
    ])
  }

  return {
    id: requirement.id,
    ingredientLabel: requirement.label,
    requirement: {
      amount: requirement.amount,
      unit: requirement.unit,
    },
    status: 'matched',
    productId,
    productName: observed.productName.trim(),
    packs,
    pack: {
      amount: observed.packAmount,
      unit: observed.packUnit,
      count: packCount,
    },
    pricePerPackCents: observed.priceCents,
    lineTotalCents,
    matchScore: decision.score,
    reasons: [
      ...decision.reasons,
      ...(productId.startsWith('observation-') && !observed.productId
        ? ['observation-local product key used; source product id unavailable']
        : []),
    ],
  }
}

function buildObservedBasket(observation, canonical, side) {
  requireRecord(observation, side)
  requireString(observation.evidenceId, `${side}.evidenceId`)
  requireString(observation.observedAt, `${side}.observedAt`)
  assert(
    validTimestamp(observation.observedAt),
    `${side}.observedAt must be a valid timestamp`,
  )
  assert(
    ALLOWED_SOURCES.has(observation.source),
    `${side}.source is not an allowed observed source`,
  )
  requireString(observation.provenanceNote, `${side}.provenanceNote`)
  requireRecord(observation.store, `${side}.store`)
  requireString(observation.store.id, `${side}.store.id`)
  requireString(observation.store.name, `${side}.store.name`)
  assert(
    observationStoreMatchesExpectedRetailer(side, observation.store.name),
    `${side}.store.name must identify ${M3_EXPECTED_RETAILERS[side]}`,
  )
  assert(Array.isArray(observation.lines), `${side}.lines must be an array`)
  assert(
    observation.lines.length === canonical.requirements.length,
    `${side}.lines must contain the exact canonical requirement count`,
  )

  const lines = canonical.requirements.map((requirement, index) =>
    buildObservedLine(
      observation.lines[index],
      requirement,
      `${side}.lines[${index}]`,
    ),
  )
  const matched = lines.filter((line) => line.status === 'matched')

  return {
    evidenceId: observation.evidenceId.trim(),
    observedAt: observation.observedAt.trim(),
    source: observation.source,
    provenanceNote: observation.provenanceNote.trim(),
    basket: {
      store: {
        id: observation.store.id.trim(),
        name: observation.store.name.trim(),
      },
      selectedMealCount: canonical.selectedMealCount,
      lines,
      totalCents: matched.reduce((sum, line) => sum + line.lineTotalCents, 0),
      matchedLineCount: matched.length,
      unresolvedLineCount: lines.length - matched.length,
    },
  }
}

export function buildWeeklyBasketStudyFromObservationSheet(sheet) {
  requireRecord(sheet, 'sheet')
  const canonical = buildObservationSheet()

  assert(sheet.schemaVersion === 1, 'sheet.schemaVersion must be 1')
  assert(
    sheet.sheetType === canonical.sheetType,
    `sheet.sheetType must be ${canonical.sheetType}`,
  )
  assert(
    sheet.evidenceStatus === canonical.evidenceStatus,
    `sheet.evidenceStatus must remain ${canonical.evidenceStatus}`,
  )
  assert(
    sheet.plannerFixture === canonical.plannerFixture,
    `sheet.plannerFixture must remain ${canonical.plannerFixture}`,
  )
  assert(
    sheet.selectedMealCount === canonical.selectedMealCount,
    'sheet.selectedMealCount must match the canonical planner fixture',
  )
  assert(
    sameJson(sheet.requirements, canonical.requirements),
    'sheet.requirements must exactly match the canonical planner demand',
  )

  requireRecord(sheet.study, 'sheet.study')
  assert(
    sheet.study.maxObservationWindowHours === 24,
    'sheet.study.maxObservationWindowHours must remain 24',
  )
  requireString(sheet.study.studyId, 'sheet.study.studyId')
  requireString(sheet.study.participantKey, 'sheet.study.participantKey')
  requireString(sheet.study.population, 'sheet.study.population')
  requireString(sheet.study.region, 'sheet.study.region')
  requireString(sheet.study.weekStart, 'sheet.study.weekStart')
  assert(
    validCalendarDate(sheet.study.weekStart),
    'sheet.study.weekStart must be a valid YYYY-MM-DD date',
  )
  assert(
    ALLOWED_PRICE_CONTEXTS.has(sheet.study.priceContext),
    'sheet.study.priceContext must be in-store or online-order',
  )

  const study = {
    schemaVersion: 1,
    studyId: sheet.study.studyId.trim(),
    participantKey: sheet.study.participantKey.trim(),
    population: sheet.study.population.trim(),
    region: sheet.study.region.trim(),
    weekStart: sheet.study.weekStart.trim(),
    priceContext: sheet.study.priceContext,
    baseline: buildObservedBasket(sheet.baseline, canonical, 'baseline'),
    candidate: buildObservedBasket(sheet.candidate, canonical, 'candidate'),
  }

  validateObservedWeekInput(study)
  return study
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

  assert(
    positional.length === 1,
    'usage: m3:build-observed-study <observation-sheet.json> [--output study.json]',
  )
  assert(!output || output.trim().length > 0, '--output requires a file path')

  return { input: positional[0], output }
}

export async function main(argv = process.argv.slice(2)) {
  const { input, output } = parseArgs(argv)
  let sheet

  try {
    sheet = JSON.parse(await readFile(input, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`observation sheet JSON could not be read/parsed: ${message}`)
  }

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const serialized = `${JSON.stringify(study, null, 2)}\n`

  if (output) {
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, serialized, 'utf8')
  } else {
    process.stdout.write(serialized)
  }

  return study
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
