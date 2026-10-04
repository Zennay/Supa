import { aggregatePlanIngredients } from './basket.ts'
import type { MatchUnit } from './matching.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../data/m2Fixture.ts'

export type ObservationSource =
  | 'manual-cart'
  | 'receipt'
  | 'consented-export'

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
      observedProduct: {
        productId: '',
        productName: '',
        packAmount: null,
        packUnit: null,
        packCount: 1,
        priceCents: null,
        available: null,
        sourceUrl: '',
        note: '',
      },
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
      maxObservationWindowHours: 24,
    },
    requirements,
    baseline: blankStoreObservation(requirements),
    candidate: blankStoreObservation(requirements),
    instructions: [
      'Observe both stores for the exact same requirement list.',
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
  if (value.lines.length !== canonical.lines.length) return null

  const lines = canonical.lines.map((expectedLine, index) => {
    const line = value.lines[index]
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
      Number.isInteger(product.packCount) &&
      product.packCount > 0
        ? product.packCount
        : 1

    return {
      ...expectedLine,
      observedProduct: {
        productId: stringOrBlank(product.productId),
        productName: stringOrBlank(product.productName),
        packAmount: optionalNonNegativeNumber(product.packAmount),
        packUnit: restoredPackUnit(product.packUnit),
        packCount,
        priceCents:
          typeof product.priceCents === 'number' &&
          Number.isInteger(product.priceCents) &&
          product.priceCents >= 0
            ? product.priceCents
            : null,
        available,
        sourceUrl: stringOrBlank(product.sourceUrl),
        note: stringOrBlank(product.note),
      },
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
        maxObservationWindowHours: 24,
      },
      baseline,
      candidate,
    }
  } catch {
    return null
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
      total +
      observation.lines.filter(
        (line) => typeof line.observedProduct.available === 'boolean',
      ).length,
    0,
  )

  const metadataValues = [
    sheet.study.studyId,
    sheet.study.participantKey,
    sheet.study.population,
    sheet.study.region,
    sheet.study.weekStart,
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
    metadataCompleted,
    metadataTotal: metadataValues.length,
  }
}
