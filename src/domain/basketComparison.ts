import type { BasketTraceLine, OneStoreBasket } from './basket.ts'
import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'

const MAX_PHYSICAL_BASKET_LINES = 10_000

// Keep preflight financial descriptor values scoped to one comparison call.
// A caller-owned Proxy must not silently swap a row price during the snapshot.
type PinnedMonetaryFacts = WeakMap<object, {
  pricePerPackCents: unknown
  lineTotalCents: unknown
  requirement: object
  requirementAmount: unknown
  requirementUnit: unknown
  packs: unknown
  pack: object
  packAmount: unknown
  packUnit: unknown
  packCount: unknown
  id: unknown
  ingredientLabel: unknown
  productId: unknown
  productName: unknown
  matchScore: unknown
}>

type PinnedStoreIdentity = { reference: unknown; id: unknown }
type PinnedRootFacts = {
  lines: unknown
  physicalSlots: unknown[]
  selectedMealCount: unknown
  totalCents: unknown
  matchedLineCount: unknown
  unresolvedLineCount: unknown
}

type MatchedBasketLine = Extract<BasketTraceLine, { status: 'matched' }>

export type BasketComparisonOutcome =
  | 'better'
  | 'same'
  | 'worse'
  | 'unknown'

export type BasketLineDelta = {
  id: string
  ingredientLabel: string
  baselineLineTotalCents: number
  candidateLineTotalCents: number
  deltaCents: number
}

export type BasketComparison = {
  outcome: BasketComparisonOutcome
  claimable: boolean
  baselineTotalCents: number
  candidateTotalCents: number
  deltaCents: number | null
  savingsCents: number | null
  lineDeltas: BasketLineDelta[]
  reasons: string[]
}

function baseQuantity(
  amount: number,
  unit: MatchedBasketLine['requirement']['unit'],
): { amount: number; family: 'mass' | 'volume' | 'piece' } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null

  if (unit === 'kg') {
    const converted = amount * 1000
    return Number.isFinite(converted) && converted > 0
      ? { amount: converted, family: 'mass' }
      : null
  }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') {
    const converted = amount * 1000
    return Number.isFinite(converted) && converted > 0
      ? { amount: converted, family: 'volume' }
      : null
  }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return null
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && /[\p{L}\p{N}\p{S}]/u.test(value)
}

// Financial facts must belong to the observed row; prototypes are not basket evidence.
function hasOwnMatchedFacts(line: object): boolean {
  const keys = [
    'id', 'ingredientLabel', 'requirement', 'productId', 'productName',
    'packs', 'pack', 'pricePerPackCents', 'lineTotalCents', 'matchScore',
  ]
  if (keys.some((key) => !Object.hasOwn(line, key))) return false

  const matched = line as MatchedBasketLine
  const requirement = matched.requirement
  const pack = matched.pack
  return (
    requirement !== null && typeof requirement === 'object' &&
    !Array.isArray(requirement) &&
    Object.hasOwn(requirement, 'amount') &&
    Object.hasOwn(requirement, 'unit') &&
    pack !== null && typeof pack === 'object' &&
    !Array.isArray(pack) &&
    Object.hasOwn(pack, 'amount') &&
    Object.hasOwn(pack, 'unit') &&
    Object.hasOwn(pack, 'count')
  )
}

function supportedBasketLine(line: unknown): line is BasketTraceLine {
  if (
    line === null || typeof line !== 'object' ||
    Array.isArray(line) || !Object.hasOwn(line, 'status')
  ) {
    return false
  }

  const status = (line as { status?: unknown }).status
  return status === 'unresolved' || (status === 'matched' && hasOwnMatchedFacts(line))
}

function basketLines(basket: OneStoreBasket): BasketTraceLine[] {
  if (!Array.isArray(basket.lines)) return []
  return basket.lines.filter(supportedBasketLine)
}

function invalidMatchedLineIdentity(line: MatchedBasketLine): boolean {
  return (
    !validIdentity(line.id) ||
    !validIdentity(line.ingredientLabel) ||
    !validIdentity(line.productId) ||
    !validIdentity(line.productName)
  )
}

function invalidMatchedLineEconomics(line: MatchedBasketLine): boolean {
  // Descriptor-safe snapshots may still carry caller-owned objects. Check the
  // primitive types before multiplication can invoke valueOf/toPrimitive.
  if (
    typeof line.requirement.amount !== 'number' ||
    typeof line.pack.amount !== 'number' ||
    typeof line.pack.count !== 'number' ||
    typeof line.packs !== 'number' ||
    typeof line.pricePerPackCents !== 'number' ||
    typeof line.lineTotalCents !== 'number' ||
    typeof line.matchScore !== 'number'
  ) return true

  const effectivePackAmount = line.pack.amount * line.pack.count
  const required = baseQuantity(line.requirement.amount, line.requirement.unit)
  const pack = baseQuantity(effectivePackAmount, line.pack.unit)
  const expectedPacks =
    required && pack && required.family === pack.family
      ? calculateDecimalPackCount(
          [{ amount: line.requirement.amount, unit: line.requirement.unit }],
          { amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count },
        )
      : null
  const expectedLineTotalCents = line.packs * line.pricePerPackCents

  return (
    !Number.isSafeInteger(line.pack.count) ||
    line.pack.count <= 0 ||
    !Number.isSafeInteger(line.packs) ||
    line.packs <= 0 ||
    !Number.isSafeInteger(line.pricePerPackCents) ||
    line.pricePerPackCents < 0 ||
    !Number.isFinite(effectivePackAmount) ||
    effectivePackAmount <= 0 ||
    expectedPacks === null ||
    !Number.isSafeInteger(expectedPacks) ||
    expectedPacks <= 0 ||
    expectedPacks !== line.packs ||
    !Number.isSafeInteger(expectedLineTotalCents) ||
    expectedLineTotalCents !== line.lineTotalCents ||
    !Number.isSafeInteger(line.matchScore) ||
    line.matchScore < 65 ||
    line.matchScore > 110
  )
}

// Read property descriptors before dereferencing untrusted runtime snapshots.
// An accessor can be an own property but is not observed price or demand data.
// Transparent Proxy get traps cannot be identified by reflection: the catch
// below still guarantees abstention if their reads throw.
function ownData(record: unknown, key: PropertyKey): { value: unknown } | null {
  if (record === null || typeof record !== 'object') return null
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? { value: descriptor.value }
    : null
}

function safeRuntimeBasket(
  basket: unknown,
  validatedLength: { value: number | null },
  pinnedMonetaryFacts: PinnedMonetaryFacts,
  pinnedStore: PinnedStoreIdentity,
  pinnedRoot: PinnedRootFacts,
): boolean {
  const keys = [
    'store', 'lines', 'selectedMealCount', 'totalCents',
    'matchedLineCount', 'unresolvedLineCount',
  ]
  const metadata = new Map<string, unknown>()
  for (const key of keys) {
    const descriptor = ownData(basket, key)
    if (!descriptor) return false
    metadata.set(key, descriptor.value)
  }

  const store = metadata.get('store')
  const storeId = ownData(store, 'id')
  if (!storeId) return false
  pinnedStore.reference = store
  pinnedStore.id = storeId.value
  pinnedRoot.lines = metadata.get('lines')
  pinnedRoot.selectedMealCount = metadata.get('selectedMealCount')
  pinnedRoot.totalCents = metadata.get('totalCents')
  pinnedRoot.matchedLineCount = metadata.get('matchedLineCount')
  pinnedRoot.unresolvedLineCount = metadata.get('unresolvedLineCount')

  const lines = ownData(basket, 'lines')?.value
  // The same caller-owned array must be inspected across both preflight reads.
  if (lines !== pinnedRoot.lines) return false
  if (!Array.isArray(lines)) return true // Existing malformed-array reason.
  // The comparator calls filter()/some() on the caller's array. Never execute
  // shadowed instance methods or inherited overrides from an altered prototype.
  if (
    Object.getPrototypeOf(lines) !== Array.prototype ||
    Object.hasOwn(lines, 'filter') || Object.hasOwn(lines, 'some')
  ) return false
  const length = ownData(lines, 'length')?.value
  // A small proxy-backed array can synthesize arbitrarily many indexed
  // descriptors. Bound both preflight and subsequent trusted snapshots before
  // consulting any physical slot (same ceiling as decimal demand arithmetic).
  if (!Number.isSafeInteger(length) || (length as number) < 0 ||
      (length as number) > MAX_PHYSICAL_BASKET_LINES) return false
  // Pin exactly the physical length that was inspected, not just its bound.
  validatedLength.value = length as number

  for (let index = 0; index < (length as number); index += 1) {
    const physical = ownData(lines, String(index))
    if (!physical) return false
    const line = physical.value
    pinnedRoot.physicalSlots.push(line)
    const statusData = ownData(line, 'status')
    // A present accessor status must not be visited by supportedBasketLine.
    if (!statusData && line !== null && typeof line === 'object' &&
        Object.hasOwn(line, 'status')) return false
    const status = statusData?.value
    if (status === 'matched') {
      const keys = [
        'id', 'ingredientLabel', 'productId', 'productName', 'requirement',
        'pack', 'packs', 'pricePerPackCents', 'lineTotalCents', 'matchScore',
      ]
      let pricePerPackCents: unknown
      let lineTotalCents: unknown
      let requirement: unknown
      let pack: unknown
      let packs: unknown
      const attribution: Record<string, unknown> = {}
      for (const key of keys) {
        const descriptor = ownData(line, key)
        if (!descriptor) return false
        if (key === 'pricePerPackCents') pricePerPackCents = descriptor.value
        if (key === 'lineTotalCents') lineTotalCents = descriptor.value
        if (key === 'requirement') requirement = descriptor.value
        if (key === 'pack') pack = descriptor.value
        if (key === 'packs') packs = descriptor.value
        if (key === 'id' || key === 'ingredientLabel' || key === 'productId' ||
            key === 'productName' || key === 'matchScore') {
          attribution[key] = descriptor.value
        }
      }
      const amountData = ownData(requirement, 'amount')
      const unitData = ownData(requirement, 'unit')
      if (!amountData || !unitData || requirement === null ||
          typeof requirement !== 'object') return false
      const packAmount = ownData(pack, 'amount')
      const packUnit = ownData(pack, 'unit')
      const packCount = ownData(pack, 'count')
      if (!packAmount || !packUnit || !packCount || pack === null ||
          typeof pack !== 'object') return false
      pinnedMonetaryFacts.set(line as object, {
        pricePerPackCents, lineTotalCents, requirement,
        requirementAmount: amountData.value, requirementUnit: unitData.value,
        packs, pack, packAmount: packAmount.value, packUnit: packUnit.value,
        packCount: packCount.value,
        id: attribution.id, ingredientLabel: attribution.ingredientLabel,
        productId: attribution.productId, productName: attribution.productName,
        matchScore: attribution.matchScore,
      })
    } else if (status === 'unresolved' && !ownData(line, 'id')) {
      return false
    }
  }
  return true
}

// Consume only indexed own-data values from a preflighted array. A Proxy can
// preserve Array.isArray/prototype/descriptors yet spoof .filter/.some/.map on
// property GET; copying through descriptors avoids invoking those methods.
// The resulting array and basket metadata are ordinary local values.
// The prior array snapshot alone retained caller-owned matched line objects.
// Copy all inspected financial and demand fields through own data descriptors:
// a transparent Proxy may spoof ordinary `get` while exposing valid descriptors.
// Unsupported/malformed lines keep the existing diagnostic, not financial facts.
function snapshotRuntimeLine(
  line: unknown,
  pinnedMonetaryFacts: PinnedMonetaryFacts,
): BasketTraceLine {
  const status = ownData(line, 'status')?.value
  if (status === 'matched') {
    // Descriptor values must be the same facts that passed preflight. Merely
    // repeating a shape check is insufficient for a changing Array/row Proxy.
    const pinned = pinnedMonetaryFacts.get(line as object)
    const pricePerPackCents = ownData(line, 'pricePerPackCents')?.value
    const lineTotalCents = ownData(line, 'lineTotalCents')?.value
    if (!pinned || !Object.is(pricePerPackCents, pinned.pricePerPackCents) ||
        !Object.is(lineTotalCents, pinned.lineTotalCents)) {
      throw new Error('basket monetary descriptors changed after preflight')
    }
    const requirement = ownData(line, 'requirement')?.value
    const requirementAmount = ownData(requirement, 'amount')?.value
    const requirementUnit = ownData(requirement, 'unit')?.value
    if (requirement !== pinned.requirement ||
        !Object.is(requirementAmount, pinned.requirementAmount) ||
        !Object.is(requirementUnit, pinned.requirementUnit)) {
      throw new Error('basket requirement descriptors changed after preflight')
    }
    const pack = ownData(line, 'pack')?.value
    const packs = ownData(line, 'packs')?.value
    const packAmount = ownData(pack, 'amount')?.value
    const packUnit = ownData(pack, 'unit')?.value
    const packCount = ownData(pack, 'count')?.value
    if (pack !== pinned.pack || !Object.is(packs, pinned.packs) ||
        !Object.is(packAmount, pinned.packAmount) ||
        !Object.is(packUnit, pinned.packUnit) ||
        !Object.is(packCount, pinned.packCount)) {
      throw new Error('basket physical pack descriptors changed after preflight')
    }
    const id = ownData(line, 'id')?.value
    const ingredientLabel = ownData(line, 'ingredientLabel')?.value
    const productId = ownData(line, 'productId')?.value
    const productName = ownData(line, 'productName')?.value
    const matchScore = ownData(line, 'matchScore')?.value
    if (!Object.is(id, pinned.id) ||
        !Object.is(ingredientLabel, pinned.ingredientLabel) ||
        !Object.is(productId, pinned.productId) ||
        !Object.is(productName, pinned.productName) ||
        !Object.is(matchScore, pinned.matchScore)) {
      throw new Error('basket matched attribution descriptors changed after preflight')
    }
    return {
      status: 'matched',
      id: id as string,
      ingredientLabel: ingredientLabel as string,
      productId: productId as string,
      productName: productName as string,
      packs: packs as number,
      pricePerPackCents: pricePerPackCents as number,
      lineTotalCents: lineTotalCents as number,
      matchScore: matchScore as number,
      reasons: ownData(line, 'reasons')?.value as string[] ?? [],
      requirement: {
        amount: requirementAmount as number,
        unit: requirementUnit as MatchedBasketLine['requirement']['unit'],
      },
      pack: {
        amount: packAmount as number,
        unit: packUnit as MatchedBasketLine['pack']['unit'],
        count: packCount as number,
      },
    }
  }
  if (status === 'unresolved') {
    return {
      status: 'unresolved',
      id: ownData(line, 'id')?.value as string,
      ingredientLabel: ownData(line, 'ingredientLabel')?.value as string,
      requirement: {
        amount: ownData(ownData(line, 'requirement')?.value, 'amount')?.value as number | null,
        unit: ownData(ownData(line, 'requirement')?.value, 'unit')?.value as MatchedBasketLine['requirement']['unit'],
      },
      matchScore: ownData(line, 'matchScore')?.value as number | null,
      reasons: ownData(line, 'reasons')?.value as string[] ?? [],
    }
  }
  return line !== null && typeof line === 'object'
    ? { status, id: ownData(line, 'id')?.value } as BasketTraceLine
    : line as BasketTraceLine
}

function snapshotRuntimeBasket(
  basket: unknown,
  validatedLength: number | null,
  pinnedMonetaryFacts: PinnedMonetaryFacts,
  pinnedStore: PinnedStoreIdentity,
  pinnedRoot: PinnedRootFacts,
): OneStoreBasket {
  const originalLines = ownData(basket, 'lines')?.value
  // Row pins alone are insufficient: a replacement array can reuse the same
  // validated row objects while bypassing the original array's method checks.
  if (originalLines !== pinnedRoot.lines) {
    throw new Error('basket physical lines array reference changed after preflight')
  }
  const lines: BasketTraceLine[] = []
  if (Array.isArray(originalLines)) {
    // A caller-owned Array Proxy can change its actual length between
    // preflight and this second own-descriptor read. Recheck the same cap
    // before *any* snapshot index; never trust a previous length check.
    const length = ownData(originalLines, 'length')?.value
    if (typeof length !== 'number' || !Number.isSafeInteger(length) ||
        length < 0 || length > MAX_PHYSICAL_BASKET_LINES ||
        length !== validatedLength) {
      throw new Error('basket length changed outside the snapshot safety bound')
    }
    // Capture the bounded physical index descriptor vector exactly once before
    // materializing any row, so later checks use one consistent snapshot.
    const physicalRows: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const physical = ownData(originalLines, String(index))
      if (!physical) {
        throw new Error('basket physical row slot disappeared after preflight')
      }
      physicalRows.push(physical.value)
    }
    if (physicalRows.some((row, index) => row !== pinnedRoot.physicalSlots[index])) {
      throw new Error('basket physical row slot changed after preflight')
    }
    for (const row of physicalRows) {
      lines.push(snapshotRuntimeLine(row, pinnedMonetaryFacts))
    }
  }
  const originalStore = ownData(basket, 'store')?.value
  const storeId = ownData(originalStore, 'id')?.value
  if (originalStore !== pinnedStore.reference || !Object.is(storeId, pinnedStore.id)) {
    throw new Error('basket store identity changed after preflight')
  }
  const selectedMealCount = ownData(basket, 'selectedMealCount')?.value
  const totalCents = ownData(basket, 'totalCents')?.value
  const matchedLineCount = ownData(basket, 'matchedLineCount')?.value
  const unresolvedLineCount = ownData(basket, 'unresolvedLineCount')?.value
  if (!Object.is(selectedMealCount, pinnedRoot.selectedMealCount) ||
      !Object.is(totalCents, pinnedRoot.totalCents) ||
      !Object.is(matchedLineCount, pinnedRoot.matchedLineCount) ||
      !Object.is(unresolvedLineCount, pinnedRoot.unresolvedLineCount)) {
    throw new Error('basket root financial descriptors changed after preflight')
  }
  return {
    store: {
      id: storeId as string,
      name: (ownData(originalStore, 'name')?.value ?? '') as string,
    },
    lines: Array.isArray(originalLines)
      ? lines
      : originalLines as BasketTraceLine[],
    selectedMealCount: selectedMealCount as number,
    totalCents: totalCents as number,
    matchedLineCount: matchedLineCount as number,
    unresolvedLineCount: unresolvedLineCount as number,
  }
}

function runtimeUnknownComparison(): BasketComparison {
  return {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: 0,
    candidateTotalCents: 0,
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    reasons: ['basket runtime snapshot cannot be safely inspected'],
  }
}

// Array.some()/filter() skip holes: a missing physical line must never vanish.
function hasMissingOwnLine(lines: unknown[]): boolean {
  for (let index = 0; index < lines.length; index += 1) {
    if (!Object.hasOwn(lines, index)) return true
  }
  return false
}

function inspectBasket(label: string, basket: OneStoreBasket): string[] {
  const reasons: string[] = []
  const rawLines: unknown[] = Array.isArray(basket.lines) ? basket.lines : []
  const lines = rawLines.filter(supportedBasketLine)
  const ids = lines.map((line) => line.id)
  const matched = lines.filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const unresolved = lines.filter((line) => line.status === 'unresolved')

  if (!Array.isArray(basket.lines)) {
    reasons.push(`${label} basket lines are not an array`)
  } else if (hasMissingOwnLine(rawLines)) {
    reasons.push(`${label} basket has an unobserved physical line slot`)
  } else if (rawLines.some((line) => !supportedBasketLine(line))) {
    reasons.push(`${label} basket contains an unsupported line shape or status`)
  }

  if (!validIdentity(basket.store.id)) {
    reasons.push(`${label} basket has an invalid store identity`)
  }

  if (new Set(ids).size !== ids.length) {
    reasons.push(`${label} basket contains duplicate ingredient ids`)
  }

  if (matched.some(invalidMatchedLineIdentity)) {
    reasons.push(`${label} basket contains invalid matched-line identity`)
  }

  if (
    !Number.isSafeInteger(basket.selectedMealCount) ||
    basket.selectedMealCount < 0
  ) {
    reasons.push(`${label} basket has an invalid selected meal count`)
  }

  if (
    !Number.isSafeInteger(basket.totalCents) ||
    basket.totalCents < 0 ||
    matched.some(
      (line) =>
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0,
    )
  ) {
    reasons.push(`${label} basket contains an invalid monetary value`)
  }

  if (matched.some(invalidMatchedLineEconomics)) {
    reasons.push(`${label} basket contains invalid matched-line economics`)
  }

  // A malformed financial snapshot must not trigger numeric coercion even
  // after invalidMatchedLineEconomics has rejected it.
  const calculatedTotal = matched.reduce(
    (total, line) => typeof line.lineTotalCents === 'number'
      ? total + line.lineTotalCents
      : Number.NaN,
    0,
  )
  if (!Number.isSafeInteger(calculatedTotal)) {
    reasons.push(`${label} basket monetary total exceeds safe integer range`)
  }
  if (calculatedTotal !== basket.totalCents) {
    reasons.push(`${label} basket total does not match its line totals`)
  }

  if (
    basket.matchedLineCount !== matched.length ||
    basket.unresolvedLineCount !== unresolved.length
  ) {
    reasons.push(`${label} basket line counters are inconsistent`)
  }

  if (unresolved.length > 0) {
    // A malformed runtime ID can be an object with toString/toPrimitive hooks.
    // Never let diagnostic formatting execute those hooks after preflight.
    const unresolvedIds: unknown[] = unresolved.map((line) => line.id)
    if (unresolvedIds.every(validIdentity)) {
      reasons.push(`${label} basket has unresolved ingredients: ${(unresolvedIds as string[])
        .sort()
        .join(', ')}`)
    } else {
      reasons.push(`${label} basket has unresolved ingredients with invalid identifiers`)
    }
  }

  return reasons
}

// Unknown results are public DTOs: an own-data value from a rejected runtime
// basket must never escape as an object with toJSON/valueOf/get traps, nor as
// noncanonical cents. Keep trusted nonnegative integer totals for diagnostics.
function trustedUnknownTotalCents(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

function unknownComparison(
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
  reasons: string[],
): BasketComparison {
  return {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: trustedUnknownTotalCents(baseline.totalCents),
    candidateTotalCents: trustedUnknownTotalCents(candidate.totalCents),
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    reasons: [...new Set(reasons)],
  }
}

// Reject user-owned runtime objects before interpolating identifier diagnostics.
// A malformed matched line is already unclaimable; its label must not run
// Symbol.toPrimitive/toString or hide a more specific validation reason.
function diagnosticIngredientId(id: unknown): string {
  return validIdentity(id) ? id : '[invalid ingredient id]'
}

// Each exact decimal pack ceiling equals one in both directions only when
// the two positive demands describe the *same* physical amount. Reuse the
// basket's rational decimal/unit conversion instead of epsilon arithmetic.
function sameDemand(
  baseline: MatchedBasketLine['requirement'],
  candidate: MatchedBasketLine['requirement'],
): boolean {
  if (baseline.amount === candidate.amount && baseline.unit === candidate.unit) {
    return true
  }
  return (
    calculateDecimalPackCount([baseline], {
      amount: candidate.amount, unit: candidate.unit,
    }) === 1 &&
    calculateDecimalPackCount([candidate], {
      amount: baseline.amount, unit: baseline.unit,
    }) === 1
  )
}

function compareInspectedBaskets({
  baseline,
  candidate,
}: {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
}): BasketComparison {
  const reasons = [
    ...inspectBasket('baseline', baseline),
    ...inspectBasket('candidate', candidate),
  ]

  if (baseline.store.id === candidate.store.id) {
    reasons.push('baseline and candidate stores must differ')
  }

  if (baseline.selectedMealCount !== candidate.selectedMealCount) {
    reasons.push('basket plans select a different number of meals')
  }

  const baselineMatched = basketLines(baseline).filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )
  const candidateMatched = basketLines(candidate).filter(
    (line): line is MatchedBasketLine => line.status === 'matched',
  )

  const baselineById = new Map(
    baselineMatched.map((line) => [line.id, line] as const),
  )
  const candidateById = new Map(
    candidateMatched.map((line) => [line.id, line] as const),
  )

  if (baselineById.size !== candidateById.size) {
    reasons.push('basket ingredient coverage differs')
  }

  const lineDeltas: BasketLineDelta[] = []
  for (const [id, baselineLine] of baselineById) {
    const candidateLine = candidateById.get(id)
    if (!candidateLine) {
      reasons.push(`candidate basket is missing ingredient ${diagnosticIngredientId(id)}`)
      continue
    }

    if (baselineLine.ingredientLabel !== candidateLine.ingredientLabel) {
      reasons.push(`ingredient label differs for ${diagnosticIngredientId(id)}`)
      continue
    }

    if (
      !sameDemand(baselineLine.requirement, candidateLine.requirement)
    ) {
      reasons.push(`ingredient demand differs for ${diagnosticIngredientId(id)}`)
      continue
    }

    // Other invalid rows may have already added inspection reasons. Never
    // subtract caller-controlled non-numeric data before abstaining.
    if (
      typeof baselineLine.lineTotalCents !== 'number' ||
      typeof candidateLine.lineTotalCents !== 'number'
    ) {
      reasons.push(`ingredient line total is not numeric for ${diagnosticIngredientId(id)}`)
      continue
    }

    lineDeltas.push({
      id,
      ingredientLabel: baselineLine.ingredientLabel,
      baselineLineTotalCents: baselineLine.lineTotalCents,
      candidateLineTotalCents: candidateLine.lineTotalCents,
      deltaCents:
        candidateLine.lineTotalCents - baselineLine.lineTotalCents,
    })
  }

  for (const id of candidateById.keys()) {
    if (!baselineById.has(id)) {
      reasons.push(`candidate basket has extra ingredient ${diagnosticIngredientId(id)}`)
    }
  }

  if (reasons.length > 0) {
    return unknownComparison(baseline, candidate, reasons)
  }

  const deltaCents = candidate.totalCents - baseline.totalCents
  const outcome: BasketComparisonOutcome =
    deltaCents < 0 ? 'better' : deltaCents > 0 ? 'worse' : 'same'

  return {
    outcome,
    claimable: true,
    baselineTotalCents: baseline.totalCents,
    candidateTotalCents: candidate.totalCents,
    deltaCents,
    savingsCents: deltaCents === 0 ? 0 : -deltaCents,
    lineDeltas,
    reasons: [],
  }
}

export function compareFullBaskets(input: {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
}): BasketComparison {
  try {
    // No unsafe getter is visited during this validation.
    const baseline = ownData(input, 'baseline')?.value
    const candidate = ownData(input, 'candidate')?.value
    const baselineLength = { value: null as number | null }
    const candidateLength = { value: null as number | null }
    const baselinePinnedFacts: PinnedMonetaryFacts = new WeakMap()
    const candidatePinnedFacts: PinnedMonetaryFacts = new WeakMap()
    const baselineStore: PinnedStoreIdentity = { reference: null, id: null }
    const candidateStore: PinnedStoreIdentity = { reference: null, id: null }
    const baselineRoot: PinnedRootFacts = {
      lines: null, physicalSlots: [], selectedMealCount: null, totalCents: null, matchedLineCount: null,
      unresolvedLineCount: null,
    }
    const candidateRoot: PinnedRootFacts = {
      lines: null, physicalSlots: [], selectedMealCount: null, totalCents: null, matchedLineCount: null,
      unresolvedLineCount: null,
    }
    if (!safeRuntimeBasket(baseline, baselineLength, baselinePinnedFacts, baselineStore, baselineRoot) ||
        !safeRuntimeBasket(candidate, candidateLength, candidatePinnedFacts, candidateStore, candidateRoot)) {
      return runtimeUnknownComparison()
    }
    return compareInspectedBaskets({
      baseline: snapshotRuntimeBasket(baseline, baselineLength.value, baselinePinnedFacts, baselineStore, baselineRoot),
      candidate: snapshotRuntimeBasket(candidate, candidateLength.value, candidatePinnedFacts, candidateStore, candidateRoot),
    })
  } catch {
    // Invalid proxies, descriptor traps or a changed runtime snapshot cannot
    // become trusted financial claims, and no partial line deltas escape.
    return runtimeUnknownComparison()
  }
}
