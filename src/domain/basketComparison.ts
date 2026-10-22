import type { BasketTraceLine, OneStoreBasket } from './basket.ts'
import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'
import type { MatchUnit } from './matching.ts'

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
  // Do not price half an indivisible item without an explicit human review.
  if (unit === 'piece') return Number.isSafeInteger(amount)
    ? { amount, family: 'piece' } : null
  return null
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && /[\p{L}\p{N}\p{S}]/u.test(value)
}

function canonicalStoreIdentity(value: unknown): value is string {
  return validIdentity(value) && value === value.trim()
}

function isObjectContainer(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function supportedBasketLine(line: unknown): line is BasketTraceLine {
  if (!isObjectContainer(line) || !('status' in line)) return false
  if (line.status === 'unresolved') return true
  if (line.status !== 'matched') return false
  // Original physical quantity and package must exist before economics
  // accesses their fields. A malformed imported record is NOT a priced row.
  return isObjectContainer(line.requirement) && isObjectContainer(line.pack)
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
    line.pricePerPackCents <= 0 ||
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

// Native Array.filter/some skip absent physical slots. Sparse checkout evidence
// must never look complete simply because a hole disappeared in iteration.
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
    reasons.push(`${label} basket contains an unobserved physical line slot`)
  } else if (rawLines.some((line) => !supportedBasketLine(line))) {
    reasons.push(`${label} basket contains an unsupported line shape or status`)
  }

  // An empty active week or a forged no-ingredient basket has no financial
  // comparison to substantiate, even if both totals are mathematically zero.
  if (basket.selectedMealCount === 0 || lines.length === 0) {
    reasons.push(`${label} basket has no planned meals or basket ingredients`)
  }

  if (!canonicalStoreIdentity(basket.store.id)) {
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
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents <= 0,
    )
  ) {
    reasons.push(`${label} basket contains an invalid monetary value`)
  }

  if (matched.some(invalidMatchedLineEconomics)) {
    reasons.push(`${label} basket contains invalid matched-line economics`)
  }

  const calculatedTotal = matched.reduce(
    (total, line) => total + line.lineTotalCents,
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
    reasons.push(
      `${label} basket has unresolved ingredients: ${unresolved
        .map((line) => line.id)
        .sort()
        .join(', ')}`,
    )
  }

  return reasons
}

/**
 * A single locally reviewed shop is only ready for Planner, Products and List
 * when its original whole-pack ledger is coherent. A caller can otherwise
 * provide apparently complete counts with an unrelated retailer identity or
 * forged cents, even before there is a second shop to compare against.
 *
 * Reuse exactly the same financial and physical rules as the canonical
 * two-shop comparator. Do not calculate a replacement amount or imply source
 * rights. Malformed/partially restored private state fails closed.
 */
export function isCoherentPricedBasket(
  basket: unknown,
  expectedStoreId: string,
): basket is OneStoreBasket {
  if (!basket || typeof basket !== 'object' || Array.isArray(basket) ||
      !canonicalStoreIdentity(expectedStoreId)) return false
  try {
    const source = basket as OneStoreBasket
    return canonicalStoreIdentity(source.store?.id) &&
      canonicalStoreIdentity(source.store?.name) &&
      source.store.id === expectedStoreId &&
      inspectBasket('source', source).length === 0
  } catch {
    return false
  }
}

function unknownComparison(
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
  reasons: string[],
): BasketComparison {
  return {
    outcome: 'unknown',
    claimable: false,
    baselineTotalCents: baseline.totalCents,
    candidateTotalCents: candidate.totalCents,
    deltaCents: null,
    savingsCents: null,
    lineDeltas: [],
    reasons: [...new Set(reasons)],
  }
}

// Compare the exact physical quantity rather than a display-unit spelling.
// Bidirectional exact ceiling=1 refuses even the tiniest true discrepancy.
function physicalUnit(unit: string): unit is MatchUnit {
  return unit === 'g' || unit === 'kg' || unit === 'ml' ||
    unit === 'l' || unit === 'piece'
}

/** Share canonical physical demand across preview, review and export. */
export function samePhysicalDemand(
  left: { amount: number | null; unit: string },
  right: { amount: number | null; unit: string },
): boolean {
  if (left.amount === null || right.amount === null ||
      !Number.isFinite(left.amount) || left.amount <= 0 ||
      !Number.isFinite(right.amount) || right.amount <= 0 ||
      !physicalUnit(left.unit) || !physicalUnit(right.unit) ||
      (left.unit === 'piece' && !Number.isSafeInteger(left.amount)) ||
      (right.unit === 'piece' && !Number.isSafeInteger(right.amount))) return false
  if (left.amount === right.amount && left.unit === right.unit) return true
  return calculateDecimalPackCount(
    [{ amount: left.amount, unit: left.unit }],
    { amount: right.amount, unit: right.unit },
  ) === 1 && calculateDecimalPackCount(
    [{ amount: right.amount, unit: right.unit }],
    { amount: left.amount, unit: left.unit },
  ) === 1
}

/** Reuse the validated source-only container guard from #419 (#417/#420).
 * Explicit SUPA errors for invalid request containers; valid but inconsistent
 * physical/economic rows still yield the canonical unknown/no-savings result.
 */
function requiredBasket(value: unknown, label: 'baseline' | 'candidate'): OneStoreBasket {
  if (!isObjectContainer(value)) throw new Error(label + ' basket container invalid')
  if (!isObjectContainer(value.store)) throw new Error(label + ' basket store container invalid')
  // The container and store have been checked above; inspectBasket performs the full line/economic validation immediately after.
  return value as OneStoreBasket
}

export function compareFullBaskets(input: unknown): BasketComparison {
  if (!isObjectContainer(input)) throw new Error('Basket comparison input invalid')
  const baseline = requiredBasket(input.baseline, 'baseline')
  const candidate = requiredBasket(input.candidate, 'candidate')
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
      reasons.push(`candidate basket is missing ingredient ${id}`)
      continue
    }

    if (baselineLine.ingredientLabel !== candidateLine.ingredientLabel) {
      reasons.push(`ingredient label differs for ${id}`)
      continue
    }

    if (
      !samePhysicalDemand(baselineLine.requirement, candidateLine.requirement)
    ) {
      reasons.push(`ingredient demand differs for ${id}`)
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
      reasons.push(`candidate basket has extra ingredient ${id}`)
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
