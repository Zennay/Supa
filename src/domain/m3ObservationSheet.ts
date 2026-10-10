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

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/
const ALLOWED_PRICE_CONTEXTS = new Set<PriceContext>(['in-store', 'online-order'])
const ALLOWED_OBSERVATION_SOURCES = new Set<ObservationSource>([
  'manual-cart',
  'receipt',
  'consented-export',
])
const ALLOWED_OBSERVED_PACK_UNITS = new Set<MatchUnit>(['g', 'kg', 'ml', 'l', 'piece'])

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
  const words = normalizedRetailerName(storeName).split(/\s+/)
  // Brand identity must be a whole token, never embedded in another brand.
  // A contradictory two-retailer name cannot serve as either observation.
  const hasPlus = words.includes('plus')
  const hasDekaMarkt = words.includes('dekamarkt') || words.some(
    (word, index) => word === 'deka' && words[index + 1] === 'markt',
  )
  if (hasPlus && hasDekaMarkt) return false
  return side === 'baseline' ? hasPlus : hasDekaMarkt
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
        // Match the converter's exact JSON identity; extra or reordered
        // fields must not become a misleading collector export-ready result.
        JSON.stringify(item) === JSON.stringify(expected)
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
  // Never turn untrusted saved provenance into a made-up manual-cart observation.
  if (!ALLOWED_OBSERVATION_SOURCES.has(value.source as ObservationSource)) {
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
      // Do not erase forged demand metadata during draft recovery.
      JSON.stringify(line.requirement) !== JSON.stringify(expectedLine.requirement)
    ) {
      return null
    }

    const product = line.observedProduct
    const available =
      product.available === true || product.available === false
        ? product.available
        : null
    // A recorded available product must not gain a fabricated whole pack on
    // restore. Rejecting a corrupted draft is safer than counting it complete.
    if (
      available === true &&
      !(
        typeof product.packCount === 'number' &&
        Number.isSafeInteger(product.packCount) &&
        product.packCount > 0
      )
    ) {
      return null
    }
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
      value.study.maxObservationWindowHours !== 24 ||
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
  // Runtime JSON and partially restored drafts are not guaranteed to obey TS
  // types. Invalid observations must remain incomplete, not crash rendering.
  if (!isRecord(line) || !isRecord(line.observedProduct)) return false
  const product = line.observedProduct
  if (typeof product.available !== 'boolean') return false
  if (!product.available) return true

  return (
    nonBlank(product.productName) &&
    typeof product.packAmount === 'number' &&
    Number.isFinite(product.packAmount) &&
    product.packAmount > 0 &&
    ALLOWED_OBSERVED_PACK_UNITS.has(product.packUnit as MatchUnit) &&
    Number.isSafeInteger(product.packCount) &&
    (product.packCount as number) > 0 &&
    Number.isSafeInteger(product.priceCents) &&
    (product.priceCents as number) >= 0
  )
}

export type ObservationLineTarget = {
  side: 'baseline' | 'candidate'
  ingredientId: string
}

export function nextIncompleteObservationLine(
  sheet: ObservationSheet,
): ObservationLineTarget | null {
  if (!isRecord(sheet)) return null
  const expected = buildObservationSheet()
  for (const side of ['baseline', 'candidate'] as const) {
    const store = sheet[side]
    if (!isRecord(store) || !Array.isArray(store.lines) ||
        store.lines.length !== expected[side].lines.length) {
      return null
    }
    for (const line of store.lines) {
      // A broken row cannot supply a safe navigation target. The separate
      // readiness gate prevents it from being exported or marked complete.
      if (!isRecord(line) || !nonBlank(line.ingredientId)) return null
      if (!observationLineCollectionComplete(line as StoreObservation['lines'][number])) {
        return { side, ingredientId: line.ingredientId }
      }
    }
  }
  return null
}

export function observationSheetHasUserInput(sheet: ObservationSheet): boolean {
  // On malformed drafts, require a confirmation rather than silently assuming
  // there is nothing to lose. The normal empty sheet still returns false.
  if (!isRecord(sheet) || !isRecord(sheet.study)) return true
  const studyValues = [
    sheet.study.studyId,
    sheet.study.participantKey,
    sheet.study.population,
    sheet.study.region,
    sheet.study.weekStart,
    sheet.study.priceContext,
  ]
  if (studyValues.some(nonBlank)) return true

  for (const side of ['baseline', 'candidate'] as const) {
    const observation = sheet[side]
    if (!isRecord(observation) || !isRecord(observation.store) ||
        !Array.isArray(observation.lines)) return true
    if (
      nonBlank(observation.evidenceId) ||
      nonBlank(observation.observedAt) ||
      observation.source !== 'manual-cart' ||
      nonBlank(observation.provenanceNote) ||
      nonBlank(observation.store.id) ||
      nonBlank(observation.store.name)
    ) return true
    for (const line of observation.lines) {
      if (!isRecord(line) || !isRecord(line.observedProduct)) return true
      const product = line.observedProduct
      if (
        product.available !== null ||
        nonBlank(product.productId) ||
        nonBlank(product.productName) ||
        product.packAmount !== null ||
        product.packUnit !== null ||
        product.packCount !== 1 ||
        product.priceCents !== null ||
        nonBlank(product.sourceUrl) ||
        nonBlank(product.note)
      ) return true
    }
  }
  return false
}

export function observationStoreProgress(observation: StoreObservation) {
  const expectedCount = buildObservationSheet().requirements.length
  const lines = isRecord(observation) && Array.isArray(observation.lines)
    ? observation.lines
    : []
  // A missing/extra array must never render as fully collected.
  const validShape = lines.length === expectedCount
  const safeLines = validShape ? lines.filter(
    (line) => isRecord(line) && isRecord(line.observedProduct),
  ) : []
  return {
    totalLines: expectedCount,
    availabilityRecorded: safeLines.filter(
      (line) => typeof line.observedProduct.available === 'boolean',
    ).length,
    completeLines: safeLines.filter(observationLineCollectionComplete).length,
  }
}

export function observationSheetProgress(sheet: ObservationSheet) {
  const baseline = isRecord(sheet) ? sheet.baseline : null
  const candidate = isRecord(sheet) ? sheet.candidate : null
  const storeA = observationStoreProgress(baseline as StoreObservation)
  const storeB = observationStoreProgress(candidate as StoreObservation)
  const study = isRecord(sheet) && isRecord(sheet.study) ? sheet.study : null
  const a = isRecord(baseline) ? baseline : null
  const b = isRecord(candidate) ? candidate : null
  const aStore = a && isRecord(a.store) ? a.store : null
  const bStore = b && isRecord(b.store) ? b.store : null
  const metadataValues = [
    study?.studyId,
    study?.participantKey,
    study?.population,
    study?.region,
    study?.weekStart,
    study?.priceContext,
    a?.evidenceId,
    a?.observedAt,
    a?.provenanceNote,
    aStore?.id,
    aStore?.name,
    b?.evidenceId,
    b?.observedAt,
    b?.provenanceNote,
    bStore?.id,
    bStore?.name,
  ]
  return {
    totalLines: storeA.totalLines + storeB.totalLines,
    availabilityRecorded: storeA.availabilityRecorded + storeB.availabilityRecorded,
    completeLines: storeA.completeLines + storeB.completeLines,
    metadataCompleted: metadataValues.filter(nonBlank).length,
    metadataTotal: metadataValues.length,
  }
}


export type ObservationSheetReadiness = {
  ready: boolean
  issues: string[]
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validCalendarDate(value: string) {
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

function validObservedAt(value: string) {
  if (!nonBlank(value)) return null

  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !validCalendarDate(match[1])) return null

  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return null

  if (match[5] !== 'Z') {
    const [offsetHour, offsetMinute] = match[5]
      .slice(1)
      .split(':')
      .map(Number)
    if (offsetHour > 23 || offsetMinute > 59) return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function observationSheetReadiness(
  sheet: ObservationSheet,
): ObservationSheetReadiness {
  const issues: string[] = []
  if (
    !isRecord(sheet) ||
    !isRecord(sheet.study) ||
    !isRecord(sheet.baseline) ||
    !isRecord(sheet.candidate)
  ) {
    return { ready: false, issues: ['Meetblad: basis- of winkelgegevens zijn ongeldig.'] }
  }

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

  // Readiness must enforce the exact same fixed planner/demand contract that
  // m3-build-observed-study checks, not just a complete-looking editable form.
  const canonical = buildObservationSheet()
  if (
    sheet.schemaVersion !== canonical.schemaVersion ||
    sheet.sheetType !== canonical.sheetType ||
    sheet.evidenceStatus !== canonical.evidenceStatus ||
    sheet.plannerFixture !== canonical.plannerFixture ||
    sheet.selectedMealCount !== canonical.selectedMealCount ||
    !hasCanonicalRequirements(sheet.requirements, canonical.requirements)
  ) {
    issues.push('Meetblad of ingrediëntenbehoefte wijkt af van de vaste weekplanning.')
  }
  if (sheet.study.maxObservationWindowHours !== 24) {
    issues.push('Meetvenster moet precies 24 uur zijn; de limiet kan niet worden aangepast.')
  }
  for (const side of ['baseline', 'candidate'] as const) {
    const lines = sheet[side].lines
    const expected = canonical[side].lines
    if (
      !Array.isArray(lines) ||
      lines.length !== expected.length ||
      lines.some((line, index) =>
        !line ||
        line.ingredientId !== expected[index].ingredientId ||
        line.ingredientLabel !== expected[index].ingredientLabel ||
        !line.requirement ||
        JSON.stringify(line.requirement) !==
          JSON.stringify(expected[index].requirement),
      )
    ) {
      issues.push(`${side === 'baseline' ? 'Winkel A' : 'Winkel B'}: ingrediëntenlijst wijkt af van de vaste weekplanning.`)
    }
  }

  if (nonBlank(sheet.study.studyId) && !KEY_PATTERN.test(sheet.study.studyId)) {
    issues.push('Study ID moet een padveilige sleutel zijn.')
  }
  if (
    nonBlank(sheet.study.participantKey) &&
    !KEY_PATTERN.test(sheet.study.participantKey)
  ) {
    issues.push('Participant key moet een pseudonieme padveilige sleutel zijn.')
  }
  if (nonBlank(sheet.study.weekStart) && !validCalendarDate(sheet.study.weekStart)) {
    issues.push('Week start moet een geldige datum in YYYY-MM-DD-formaat zijn.')
  }
  if (
    nonBlank(sheet.study.priceContext) &&
    !ALLOWED_PRICE_CONTEXTS.has(sheet.study.priceContext as PriceContext)
  ) {
    issues.push('Prijscontext moet in-store of online-order zijn.')
  }

  const observations: Array<[string, M3ObservationSide, StoreObservation]> = [
    ['Winkel A', 'baseline', sheet.baseline],
    ['Winkel B', 'candidate', sheet.candidate],
  ]
  const observedTimes: number[] = []

  for (const [label, side, observation] of observations) {
    if (!isRecord(observation.store) || !Array.isArray(observation.lines)) {
      issues.push(`${label}: winkel- of ingrediëntenstructuur is ongeldig.`)
      continue
    }
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
    } else if (!KEY_PATTERN.test(observation.evidenceId)) {
      issues.push(`${label}: evidence ID moet een padveilige sleutel zijn.`)
    }
    if (!ALLOWED_OBSERVATION_SOURCES.has(observation.source)) {
      issues.push(`${label}: bron/herkomst moet manual-cart, receipt of consented-export zijn.`)
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

    observation.lines.forEach((line, index) => {
      if (!isRecord(line) || !isRecord(line.observedProduct)) {
        issues.push(`${label}: ingrediëntregel ${index + 1} is ongeldig.`)
        return
      }
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
      if (!ALLOWED_OBSERVED_PACK_UNITS.has(product.packUnit as MatchUnit)) {
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
    isRecord(sheet.baseline.store) &&
    isRecord(sheet.candidate.store) &&
    nonBlank(sheet.baseline.store.id) &&
    nonBlank(sheet.candidate.store.id) &&
    sheet.baseline.store.id.trim() === sheet.candidate.store.id.trim()
  ) {
    issues.push('Winkel A en Winkel B moeten verschillende winkel-ID\'s hebben.')
  }

  if (
    nonBlank(sheet.baseline.evidenceId) &&
    nonBlank(sheet.candidate.evidenceId) &&
    sheet.baseline.evidenceId === sheet.candidate.evidenceId
  ) {
    issues.push('Winkel A en Winkel B moeten verschillende evidence ID\'s hebben.')
  }

  if (observedTimes.length === 2) {
    const deltaHours =
      Math.abs(observedTimes[0] - observedTimes[1]) / (60 * 60 * 1000)
    if (deltaHours > 24) {
      issues.push(
        `De twee observaties liggen ${deltaHours.toFixed(1)} uur uit elkaar; maximaal 24 uur is toegestaan.`,
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
  if (!isRecord(sheet) || !isRecord(sheet.baseline) ||
      !isRecord(sheet.candidate)) return { state: 'not-started' }

  const baselineAt = validObservedAt(sheet.baseline.observedAt)
  const candidateAt = validObservedAt(sheet.candidate.observedAt)

  if (baselineAt === null && candidateAt === null) {
    return { state: 'not-started' }
  }

  if (baselineAt === null || candidateAt === null) {
    const firstSide = baselineAt !== null ? 'baseline' : 'candidate'
    const firstObservedAt = baselineAt ?? candidateAt
    if (firstObservedAt === null) return { state: 'not-started' }

    return {
      state: 'single-observation',
      firstSide,
      firstObservedAt: new Date(firstObservedAt).toISOString(),
      deadlineAt: new Date(firstObservedAt + 24 * 60 * 60 * 1000).toISOString(),
    }
  }

  const deltaHours = Math.abs(baselineAt - candidateAt) / (60 * 60 * 1000)
  return {
    state: deltaHours <= 24 ? 'within-window' : 'outside-window',
    deltaHours,
  }
}
