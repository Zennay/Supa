import { aggregatePlanIngredients } from './basket.ts'
import type { MatchUnit } from './matching.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../data/m2Fixture.ts'

export type PriceContext = 'in-store' | 'online-order'

export type ObservationSource =
  | 'manual-cart'
  | 'receipt'
  | 'consented-export'

export const M3_EXPECTED_RETAILERS = {
  baseline: 'PLUS',
  candidate: 'DekaMarkt',
} as const

export type M3ObservationSide = keyof typeof M3_EXPECTED_RETAILERS

function normalizedRetailerName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function observationStoreMatchesExpectedRetailer(
  side: M3ObservationSide,
  storeName: string,
) {
  const normalized = normalizedRetailerName(storeName)
  if (side === 'baseline') {
    return normalized.split(/\s+/).includes('plus')
  }
  return normalized.replace(/\s+/g, '').includes('dekamarkt')
}

export type ObservationRequirement = {
  id: string
  label: string
  query: string
  amount: number
  unit: MatchUnit
}

export type ObservedProduct = {
  productId: string
  productName: string
  packAmount: number | null
  packUnit: MatchUnit | null
  packCount: number
  priceCents: number | null
  available: boolean | null
  sourceUrl: string
  note: string
}

function blankObservedProduct(
  available: ObservedProduct['available'] = null,
): ObservedProduct {
  return {
    productId: '',
    productName: '',
    packAmount: null,
    packUnit: null,
    packCount: 1,
    priceCents: null,
    available,
    sourceUrl: '',
    note: '',
  }
}

export function withObservedProductAvailability(
  product: ObservedProduct,
  available: ObservedProduct['available'],
): ObservedProduct {
  return available === true
    ? { ...product, available: true }
    : blankObservedProduct(available)
}

export type StoreObservation = {
  evidenceId: string
  observedAt: string
  source: ObservationSource
  provenanceNote: string
  store: {
    id: string
    name: string
  }
  lines: {
    ingredientId: string
    ingredientLabel: string
    requirement: {
      amount: number
      unit: MatchUnit
    }
    observedProduct: ObservedProduct
  }[]
}

export type ObservationSheet = {
  schemaVersion: 1
  sheetType: 'm3-manual-cart-observation-sheet'
  evidenceStatus: 'collection-template-not-evidence'
  plannerFixture: 'm2-default-week'
  selectedMealCount: number
  study: {
    studyId: string
    participantKey: string
    population: string
    region: string
    weekStart: string
    priceContext: PriceContext | ''
    maxObservationWindowHours: 24
  }
  requirements: ObservationRequirement[]
  baseline: StoreObservation
  candidate: StoreObservation
  instructions: string[]
}

function blankStoreObservation(
  requirements: ObservationRequirement[],
): StoreObservation {
  return {
    evidenceId: '',
    observedAt: '',
    source: 'manual-cart',
    provenanceNote: '',
    store: {
      id: '',
      name: '',
    },
    lines: requirements.map((requirement) => ({
      ingredientId: requirement.id,
      ingredientLabel: requirement.label,
      requirement: {
        amount: requirement.amount,
        unit: requirement.unit,
      },
      observedProduct: blankObservedProduct(),
    })),
  }
}

export function buildObservationSheet(): ObservationSheet {
  const requirements = aggregatePlanIngredients(
    m2InitialPlan,
    m2Recipes,
    m2DefaultActiveDays,
  ).map(({ id, label, query, amount, unit }) => {
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`M3 observation demand requires a positive amount: ${id}`)
    }

    return {
      id,
      label,
      query,
      amount,
      unit,
    }
  })

  return {
    schemaVersion: 1,
    sheetType: 'm3-manual-cart-observation-sheet',
    evidenceStatus: 'collection-template-not-evidence',
    plannerFixture: 'm2-default-week',
    selectedMealCount: m2InitialPlan.filter((meal) =>
      m2DefaultActiveDays.includes(meal.day),
    ).length,
    study: {
      studyId: '',
      participantKey: '',
      population: '',
      region: '',
      weekStart: '',
      priceContext: '',
      maxObservationWindowHours: 24,
    },
    requirements,
    baseline: blankStoreObservation(requirements),
    candidate: blankStoreObservation(requirements),
    instructions: [
      'Collect the baseline at PLUS and the candidate at DekaMarkt; do not substitute another retailer.',
      'Observe both stores for the exact same requirement list.',
      'Use one shared price context for both stores: in-store or online order.',
      'Record actual pack, price and availability; do not guess missing values.',
      'Keep baseline and candidate observations within 24 hours.',
      'Use a pseudonymous participant key and never store names, email addresses or account IDs.',
      'This sheet is collection support only. Convert verified observations into the WeeklyBasketStudy contract, then run npm run m3:assess-observed-week.',
    ],
  }
}


export const OBSERVATION_DRAFT_STORAGE_KEY = 'supa:m3-observation-draft:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrBlank(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function restoredPackUnit(value: unknown): MatchUnit | null {
  return value === 'g' ||
    value === 'kg' ||
    value === 'ml' ||
    value === 'l' ||
    value === 'piece' ||
    value === 'unknown'
    ? value
    : null
}

function restoredSource(value: unknown): ObservationSource {
  return value === 'receipt' || value === 'consented-export'
    ? value
    : 'manual-cart'
}

function hasCanonicalRequirements(
  value: unknown,
  canonical: ObservationRequirement[],
): boolean {
  return (
    Array.isArray(value) &&
    value.length === canonical.length &&
    value.every((item, index) => {
      if (!isRecord(item)) return false
      const expected = canonical[index]
      return (
        item.id === expected.id &&
        item.label === expected.label &&
        item.query === expected.query &&
        item.amount === expected.amount &&
        item.unit === expected.unit
      )
    })
  )
}

function restoreStoreObservation(
  value: unknown,
  canonical: StoreObservation,
): StoreObservation | null {
  if (!isRecord(value) || !isRecord(value.store) || !Array.isArray(value.lines)) {
    return null
  }
  const rawLines = value.lines
  if (rawLines.length !== canonical.lines.length) return null

  const lines = canonical.lines.map((expectedLine, index) => {
    const line = rawLines[index]
    if (!isRecord(line) || !isRecord(line.requirement) || !isRecord(line.observedProduct)) {
      return null
    }
    if (
      line.ingredientId !== expectedLine.ingredientId ||
      line.ingredientLabel !== expectedLine.ingredientLabel ||
      line.requirement.amount !== expectedLine.requirement.amount ||
      line.requirement.unit !== expectedLine.requirement.unit
    ) {
      return null
    }

    const product = line.observedProduct
    const available =
      product.available === true || product.available === false
        ? product.available
        : null
    const packCount =
      typeof product.packCount === 'number' &&
      Number.isSafeInteger(product.packCount) &&
      product.packCount > 0
        ? product.packCount
        : 1

    return {
      ...expectedLine,
      observedProduct:
        available === true
          ? {
              productId: stringOrBlank(product.productId),
              productName: stringOrBlank(product.productName),
              packAmount: optionalNonNegativeNumber(product.packAmount),
              packUnit: restoredPackUnit(product.packUnit),
              packCount,
              priceCents:
                typeof product.priceCents === 'number' &&
                Number.isSafeInteger(product.priceCents) &&
                product.priceCents >= 0
                  ? product.priceCents
                  : null,
              available: true,
              sourceUrl: stringOrBlank(product.sourceUrl),
              note: stringOrBlank(product.note),
            }
          : blankObservedProduct(available),
    }
  })

  if (lines.some((line) => line === null)) return null

  return {
    evidenceId: stringOrBlank(value.evidenceId),
    observedAt: stringOrBlank(value.observedAt),
    source: restoredSource(value.source),
    provenanceNote: stringOrBlank(value.provenanceNote),
    store: {
      id: stringOrBlank(value.store.id),
      name: stringOrBlank(value.store.name),
    },
    lines: lines as StoreObservation['lines'],
  }
}

export function restoreObservationSheetDraft(
  serialized: string | null,
): ObservationSheet | null {
  if (!serialized) return null

  try {
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value) || !isRecord(value.study)) return null

    const canonical = buildObservationSheet()
    if (
      value.schemaVersion !== canonical.schemaVersion ||
      value.sheetType !== canonical.sheetType ||
      value.evidenceStatus !== canonical.evidenceStatus ||
      value.plannerFixture !== canonical.plannerFixture ||
      value.selectedMealCount !== canonical.selectedMealCount ||
      !hasCanonicalRequirements(value.requirements, canonical.requirements)
    ) {
      return null
    }

    const baseline = restoreStoreObservation(value.baseline, canonical.baseline)
    const candidate = restoreStoreObservation(value.candidate, canonical.candidate)
    if (!baseline || !candidate) return null

    return {
      ...canonical,
      study: {
        studyId: stringOrBlank(value.study.studyId),
        participantKey: stringOrBlank(value.study.participantKey),
        population: stringOrBlank(value.study.population),
        region: stringOrBlank(value.study.region),
        weekStart: stringOrBlank(value.study.weekStart),
        priceContext:
          value.study.priceContext === 'in-store' ||
          value.study.priceContext === 'online-order'
            ? value.study.priceContext
            : '',
        maxObservationWindowHours: 24,
      },
      baseline,
      candidate,
    }
  } catch {
    return null
  }
}

export function observationLineCollectionComplete(
  line: StoreObservation['lines'][number],
) {
  const product = line.observedProduct
  if (typeof product.available !== 'boolean') return false
  if (!product.available) return true

  return (
    nonBlank(product.productName) &&
    product.packAmount !== null &&
    Number.isFinite(product.packAmount) &&
    product.packAmount > 0 &&
    product.packUnit !== null &&
    product.packUnit !== 'unknown' &&
    Number.isSafeInteger(product.packCount) &&
    product.packCount > 0 &&
    product.priceCents !== null &&
    Number.isSafeInteger(product.priceCents) &&
    product.priceCents >= 0
  )
}

export type ObservationLineTarget = {
  side: 'baseline' | 'candidate'
  ingredientId: string
}

export function nextIncompleteObservationLine(
  sheet: ObservationSheet,
): ObservationLineTarget | null {
  for (const side of ['baseline', 'candidate'] as const) {
    const line = sheet[side].lines.find(
      (candidate) => !observationLineCollectionComplete(candidate),
    )
    if (line) {
      return {
        side,
        ingredientId: line.ingredientId,
      }
    }
  }

  return null
}

export function observationSheetHasUserInput(sheet: ObservationSheet): boolean {
  const studyValues = [
    sheet.study.studyId,
    sheet.study.participantKey,
    sheet.study.population,
    sheet.study.region,
    sheet.study.weekStart,
    sheet.study.priceContext,
  ]
  if (studyValues.some(nonBlank)) return true

  return ([sheet.baseline, sheet.candidate] as StoreObservation[]).some(
    (observation) =>
      nonBlank(observation.evidenceId) ||
      nonBlank(observation.observedAt) ||
      observation.source !== 'manual-cart' ||
      nonBlank(observation.provenanceNote) ||
      nonBlank(observation.store.id) ||
      nonBlank(observation.store.name) ||
      observation.lines.some((line) => {
        const product = line.observedProduct
        return (
          product.available !== null ||
          nonBlank(product.productId) ||
          nonBlank(product.productName) ||
          product.packAmount !== null ||
          product.packUnit !== null ||
          product.packCount !== 1 ||
          product.priceCents !== null ||
          nonBlank(product.sourceUrl) ||
          nonBlank(product.note)
        )
      }),
  )
}

export function observationStoreProgress(observation: StoreObservation) {
  return {
    totalLines: observation.lines.length,
    availabilityRecorded: observation.lines.filter(
      (line) => typeof line.observedProduct.available === 'boolean',
    ).length,
    completeLines: observation.lines.filter(observationLineCollectionComplete)
      .length,
  }
}

export function observationSheetProgress(sheet: ObservationSheet) {
  const observations = [sheet.baseline, sheet.candidate]
  const totalLines = observations.reduce(
    (total, observation) => total + observation.lines.length,
    0,
  )
  const availabilityRecorded = observations.reduce(
    (total, observation) =>
      total + observationStoreProgress(observation).availabilityRecorded,
    0,
  )
  const completeLines = observations.reduce(
    (total, observation) =>
      total + observationStoreProgress(observation).completeLines,
    0,
  )

  const metadataValues = [
    sheet.study.studyId,
    sheet.study.participantKey,
    sheet.study.population,
    sheet.study.region,
    sheet.study.weekStart,
    sheet.study.priceContext,
    sheet.baseline.evidenceId,
    sheet.baseline.observedAt,
    sheet.baseline.provenanceNote,
    sheet.baseline.store.id,
    sheet.baseline.store.name,
    sheet.candidate.evidenceId,
    sheet.candidate.observedAt,
    sheet.candidate.provenanceNote,
    sheet.candidate.store.id,
    sheet.candidate.store.name,
  ]
  const metadataCompleted = metadataValues.filter(
    (value) => value.trim().length > 0,
  ).length

  return {
    totalLines,
    availabilityRecorded,
    completeLines,
    metadataCompleted,
    metadataTotal: metadataValues.length,
  }
}


export type ObservationSheetReadiness = {
  ready: boolean
  issues: string[]
}

function nonBlank(value: string) {
  return value.trim().length > 0
}

// Collector export readiness must match the canonical JSON converter and the
// final assessment. Nonblank text by itself cannot prove a valid field date,
// price context or pseudonymous path-safe identifier.
const M3_STUDY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const M3_WEEK_START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function validM3WeekStart(value: string): boolean {
  const match = M3_WEEK_START_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

// Keep the collector's export readiness and window guidance in lockstep with
// the canonical M3 JSON converter, not JavaScript Date.parse's loose fallback.
// Both require a real calendar day and an explicit, valid ISO UTC offset.
const M3_OBSERVED_AT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/

function validObservedAt(value: string) {
  const match = M3_OBSERVED_AT_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6] ?? '0') > 59
  ) {
    return null
  }
  if (
    match[7] !== 'Z' &&
    (Number(match[8]) > 14 || Number(match[9]) > 59 ||
      (Number(match[8]) === 14 && Number(match[9]) !== 0))
  ) {
    return null
  }

  const timestamp = Date.parse(value)
  // A future calendar instant cannot represent a completed collection.
  // Compare UTC instants (including parsed offsets) at the collection gate.
  return Number.isFinite(timestamp) && timestamp <= Date.now() ? timestamp : null
}

export function observationSheetReadiness(
  sheet: ObservationSheet,
): ObservationSheetReadiness {
  const issues: string[] = []

  const studyFields: Array<[string, string]> = [
    ['Study ID', sheet.study.studyId],
    ['Participant key', sheet.study.participantKey],
    ['Populatie', sheet.study.population],
    ['Regio', sheet.study.region],
    ['Week start', sheet.study.weekStart],
    ['Prijscontext', sheet.study.priceContext],
  ]

  for (const [label, value] of studyFields) {
    if (!nonBlank(value)) issues.push(`${label} ontbreekt.`)
  }
  if (nonBlank(sheet.study.studyId) && !M3_STUDY_KEY_PATTERN.test(sheet.study.studyId)) {
    issues.push('Study ID moet een veilige pseudonieme sleutel zijn.')
  }
  if (nonBlank(sheet.study.participantKey) &&
      !M3_STUDY_KEY_PATTERN.test(sheet.study.participantKey)) {
    issues.push('Participant key moet een veilige pseudonieme sleutel zijn.')
  }
  if (nonBlank(sheet.study.weekStart) && !validM3WeekStart(sheet.study.weekStart)) {
    issues.push('Week start moet een geldige datum in JJJJ-MM-DD zijn.')
  }
  if (nonBlank(sheet.study.priceContext) &&
      sheet.study.priceContext !== 'in-store' &&
      sheet.study.priceContext !== 'online-order') {
    issues.push('Prijscontext moet in-store of online-order zijn.')
  }

  const observations: Array<[string, M3ObservationSide, StoreObservation]> = [
    ['Winkel A', 'baseline', sheet.baseline],
    ['Winkel B', 'candidate', sheet.candidate],
  ]
  const observedTimes: number[] = []

  for (const [label, side, observation] of observations) {
    if (!nonBlank(observation.store.name)) {
      issues.push(`${label}: winkelnaam ontbreekt.`)
    } else if (!observationStoreMatchesExpectedRetailer(side, observation.store.name)) {
      issues.push(
        `${label}: winkelnaam moet ${M3_EXPECTED_RETAILERS[side]} identificeren.`,
      )
    }
    if (!nonBlank(observation.store.id)) {
      issues.push(`${label}: winkel-ID ontbreekt.`)
    }
    if (!nonBlank(observation.evidenceId)) {
      issues.push(`${label}: evidence ID ontbreekt.`)
    }
    if (!nonBlank(observation.provenanceNote)) {
      issues.push(`${label}: provenance-notitie ontbreekt.`)
    }

    const observedAt = validObservedAt(observation.observedAt)
    if (observedAt === null) {
      issues.push(`${label}: geldige observatietijd ontbreekt.`)
    } else {
      observedTimes.push(observedAt)
    }

    observation.lines.forEach((line) => {
      const product = line.observedProduct
      const lineLabel = `${label} · ${line.ingredientLabel}`

      if (typeof product.available !== 'boolean') {
        issues.push(`${lineLabel}: beschikbaarheid is nog niet gemeten.`)
        return
      }

      if (!product.available) return

      if (!nonBlank(product.productName)) {
        issues.push(`${lineLabel}: productnaam ontbreekt.`)
      }
      if (
        product.packAmount === null ||
        !Number.isFinite(product.packAmount) ||
        product.packAmount <= 0
      ) {
        issues.push(`${lineLabel}: verpakkingshoeveelheid moet groter dan 0 zijn.`)
      }
      if (product.packUnit === null || product.packUnit === 'unknown') {
        issues.push(`${lineLabel}: geldige verpakkingseenheid ontbreekt.`)
      }
      if (
        !Number.isSafeInteger(product.packCount) ||
        product.packCount <= 0
      ) {
        issues.push(`${lineLabel}: aantal per verpakking moet minimaal 1 zijn.`)
      }
      if (
        product.priceCents === null ||
        !Number.isSafeInteger(product.priceCents) ||
        product.priceCents < 0
      ) {
        issues.push(`${lineLabel}: prijs per verpakking ontbreekt of is ongeldig.`)
      }
    })
  }

  if (
    nonBlank(sheet.baseline.store.id) &&
    nonBlank(sheet.candidate.store.id) &&
    sheet.baseline.store.id.trim() === sheet.candidate.store.id.trim()
  ) {
    issues.push('Winkel A en Winkel B moeten verschillende winkel-ID\'s hebben.')
  }

  if (observedTimes.length === 2) {
    const deltaHours =
      Math.abs(observedTimes[0] - observedTimes[1]) / (60 * 60 * 1000)
    if (deltaHours > sheet.study.maxObservationWindowHours) {
      issues.push(
        `De twee observaties liggen ${deltaHours.toFixed(1)} uur uit elkaar; maximaal ${sheet.study.maxObservationWindowHours} uur is toegestaan.`,
      )
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  }
}

export type ObservationWindowSummary =
  | { state: 'not-started' }
  | {
      state: 'single-observation'
      firstSide: 'baseline' | 'candidate'
      firstObservedAt: string
      deadlineAt: string
    }
  | { state: 'within-window'; deltaHours: number }
  | { state: 'outside-window'; deltaHours: number }

export function observationWindowSummary(
  sheet: ObservationSheet,
): ObservationWindowSummary {
  const baselineAt = validObservedAt(sheet.baseline.observedAt)
  const candidateAt = validObservedAt(sheet.candidate.observedAt)

  if (baselineAt === null && candidateAt === null) {
    return { state: 'not-started' }
  }

  if (baselineAt === null || candidateAt === null) {
    const firstSide = baselineAt !== null ? 'baseline' : 'candidate'
    const firstObservedAt = baselineAt ?? candidateAt

    if (firstObservedAt === null) {
      return { state: 'not-started' }
    }

    return {
      state: 'single-observation',
      firstSide,
      firstObservedAt: new Date(firstObservedAt).toISOString(),
      deadlineAt: new Date(
        firstObservedAt + sheet.study.maxObservationWindowHours * 60 * 60 * 1000,
      ).toISOString(),
    }
  }

  const deltaHours =
    Math.abs(baselineAt - candidateAt) / (60 * 60 * 1000)

  return {
    state:
      deltaHours <= sheet.study.maxObservationWindowHours
        ? 'within-window'
        : 'outside-window',
    deltaHours,
  }
}

