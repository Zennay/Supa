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
