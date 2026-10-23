export type MatchUnit = 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'unknown'

export type IngredientRequirement = {
  id: string
  query: string
  amount: number | null
  unit: MatchUnit
}

export type ProductCandidate = {
  id: string
  name: string
  packAmount: number | null
  packUnit: MatchUnit
  packCount?: number | null
  available: boolean
}

export type MatchDecision =
  | {
      type: 'match'
      productId: string
      score: number
      runnerUpScore: number | null
      reasons: string[]
    }
  | {
      type: 'abstain'
      score: number | null
      runnerUpScore: number | null
      reasons: string[]
    }

const STOP_TOKENS = new Set([
  'ah',
  'plus',
  'de',
  'het',
  'een',
  'in',
  'met',
  'van',
  'voor',
  'zonder',
  'en',
  'per',
  'uit',
  'op',
  'aan',
  'bij',
  'tot',
  'of',
  'pak',
  'pakken',
  'fles',
  'flessen',
  'zak',
  'zakje',
  'doos',
  'doosje',
])

const MATCH_UNITS: ReadonlySet<string> = new Set([
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'unknown',
])

function isMatchUnit(value: unknown): value is MatchUnit {
  return typeof value === 'string' && MATCH_UNITS.has(value)
}

function hasValidRequirementShape(value: unknown): value is IngredientRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const requirement = value as Record<string, unknown>
  return (
    typeof requirement.id === 'string' &&
    requirement.id.length > 0 &&
    requirement.id === requirement.id.trim() &&
    typeof requirement.query === 'string' &&
    requirement.query.trim().length > 0 &&
    (requirement.amount === null || typeof requirement.amount === 'number') &&
    isMatchUnit(requirement.unit)
  )
}

function hasValidCandidateShape(value: unknown): value is ProductCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    candidate.id === candidate.id.trim() &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    (candidate.packAmount === null || typeof candidate.packAmount === 'number') &&
    isMatchUnit(candidate.packUnit) &&
    (candidate.packCount === undefined ||
      candidate.packCount === null ||
      typeof candidate.packCount === 'number') &&
    typeof candidate.available === 'boolean'
  )
}

function abstain(reason: string): MatchDecision {
  return {
    type: 'abstain',
    score: null,
    runnerUpScore: null,
    reasons: [reason],
  }
}

// Strip only explicit physical pack notation before comparing names. A pack
// size is handled by the physical-quantity score below, not as a product-name
// token that can distort confidence.
const PACK_NOTATION = /\b(?:\d{1,4}\s*[x×]\s*)?\d{1,7}(?:[.,]\d+)?\s*(?:kilogram(?:men)?|kg|gram(?:men)?|gr|g|milliliter|millilitre|ml|cl|liter|litre|l|stuks?|stuk|pcs?|pieces?)\b/giu

function textTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && /[\p{L}\p{N}]/u.test(token) && !STOP_TOKENS.has(token))
}

function identityTokens(value: string): string[] {
  return [...new Set(textTokens(value.replace(PACK_NOTATION, ' ')))]
}

function baseUnitAmount(
  amount: number | null,
  unit: MatchUnit,
): { amount: number | null; family: 'mass' | 'volume' | 'piece' | 'unknown' } {
  if (unit === 'kg') {
    return { amount: amount === null ? null : amount * 1000, family: 'mass' }
  }
  if (unit === 'g') return { amount, family: 'mass' }
  if (unit === 'l') {
    return { amount: amount === null ? null : amount * 1000, family: 'volume' }
  }
  if (unit === 'ml') return { amount, family: 'volume' }
  if (unit === 'piece') return { amount, family: 'piece' }
  return { amount, family: 'unknown' }
}

function hasInvalidKnownAmount(amount: number | null): boolean {
  return amount !== null && (!Number.isFinite(amount) || amount <= 0)
}

function hasInvalidBaseUnitAmount(
  amount: number | null,
  unit: MatchUnit,
): boolean {
  if (amount === null) return false
  const normalized = baseUnitAmount(amount, unit).amount
  return normalized !== null && (!Number.isFinite(normalized) || normalized <= 0)
}

function scoreCandidate(
  requirement: IngredientRequirement,
  candidate: ProductCandidate,
): { score: number; reasons: string[] } {
  if (!candidate.available) {
    return { score: -100, reasons: ['candidate unavailable'] }
  }

  if (hasInvalidKnownAmount(candidate.packAmount)) {
    return { score: -100, reasons: ['candidate pack amount invalid'] }
  }
  if (candidate.packUnit === 'piece' && candidate.packAmount !== null &&
      !Number.isSafeInteger(candidate.packAmount)) {
    return { score: -100, reasons: ['candidate piece pack amount must be a whole number'] }
  }

  // An omitted count retains the legacy single-pack default; an explicit
  // null means the source says the count is unknown and must not be treated as 1.
  if (candidate.packCount === null) {
    return { score: -100, reasons: ['pack count unknown'] }
  }
  const packCount = candidate.packCount ?? 1
  if (!Number.isSafeInteger(packCount) || packCount <= 0) {
    return { score: -100, reasons: ['invalid pack count'] }
  }

  const queryWords = identityTokens(requirement.query)
  const productWords = identityTokens(candidate.name)
  const queryTokens = new Set(queryWords)
  const productTokens = new Set(productWords)
  const reasons: string[] = []

  let overlap = 0
  for (const token of queryTokens) {
    if (productTokens.has(token)) overlap += 1
  }

  const overlapRatio = queryTokens.size === 0 ? 0 : overlap / queryTokens.size
  let score = Math.round(overlapRatio * 55)

  // A substring inside a token is not product identity: "ham" must not
  // receive the exact-phrase bonus from "champignonham". Extra meaningful
  // descriptors such as "geraspte", "bio" or "basilicum" require review
  // instead of turning a partial name overlap into an automatic match.
  const exactTokenIdentity = queryWords.length > 0 &&
    queryWords.length === productWords.length &&
    queryWords.every((token) => productTokens.has(token))
  if (exactTokenIdentity) {
    score += 35
    reasons.push('exact normalized product identity')
  } else if (overlap > 0) {
    reasons.push(`${overlap}/${queryTokens.size} query tokens present`)
    const additionalDescriptors = [...productTokens].filter((token) => !queryTokens.has(token)).length
    if (additionalDescriptors > 0) {
      score -= Math.min(45, additionalDescriptors * 15)
      reasons.push(`${additionalDescriptors} additional product descriptor(s) require review`)
    }
  }

  const required = baseUnitAmount(requirement.amount, requirement.unit)
  const effectivePackAmount =
    candidate.packAmount === null ? null : candidate.packAmount * packCount

  if (
    effectivePackAmount !== null &&
    (!Number.isFinite(effectivePackAmount) || effectivePackAmount <= 0)
  ) {
    return { score: -100, reasons: ['candidate effective pack amount invalid'] }
  }

  const pack = baseUnitAmount(effectivePackAmount, candidate.packUnit)
  if (
    pack.amount !== null &&
    (!Number.isFinite(pack.amount) || pack.amount <= 0)
  ) {
    return { score: -100, reasons: ['candidate normalized pack amount invalid'] }
  }

  if (packCount > 1 && candidate.packAmount !== null) {
    reasons.push(`multipack count ${packCount} applied`)
  }

  if (
    required.family !== 'unknown' &&
    pack.family !== 'unknown' &&
    required.family !== pack.family
  ) {
    score -= 35
    reasons.push('unit family mismatch')
  } else if (
    required.amount !== null &&
    pack.amount !== null &&
    required.family === pack.family
  ) {
    if (pack.amount >= required.amount) {
      const oversupplyRatio = pack.amount / required.amount
      if (oversupplyRatio <= 1.5) {
        score += 20
        reasons.push('pack closely covers requirement')
      } else if (oversupplyRatio <= 4) {
        score += 5
        reasons.push('pack covers requirement')
      } else {
        score += 2
        reasons.push('pack covers requirement with high oversupply')
      }
    } else {
      score -= 10
      reasons.push('single pack underfills requirement')
    }
  }

  return { score, reasons }
}

export function matchIngredient(
  requirement: IngredientRequirement,
  candidates: ProductCandidate[],
  options: { minimumScore?: number; minimumMargin?: number } = {},
): MatchDecision {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return abstain('matching trust thresholds invalid')
  }

  const minimumScore = options.minimumScore ?? 65
  const minimumMargin = options.minimumMargin ?? 12

  if (
    !Number.isFinite(minimumScore) ||
    minimumScore <= 0 ||
    !Number.isFinite(minimumMargin) ||
    minimumMargin <= 0
  ) {
    return abstain('matching trust thresholds invalid')
  }

  if (!hasValidRequirementShape(requirement)) {
    return abstain('matching requirement invalid')
  }

  if (!Array.isArray(candidates)) {
    return abstain('matching candidates invalid')
  }

  if (!candidates.every(hasValidCandidateShape)) {
    return abstain('matching candidate data invalid')
  }

  if (hasInvalidKnownAmount(requirement.amount)) {
    return {
      type: 'abstain',
      score: null,
      runnerUpScore: null,
      reasons: ['requirement amount invalid'],
    }
  }

  // A fractional physical item (for example 1.5 eggs) cannot be priced as
  // whole retail packs. Refuse it here even if a caller bypasses recipe review.
  if (requirement.unit === 'piece' && requirement.amount !== null &&
      !Number.isSafeInteger(requirement.amount)) {
    return {
      type: 'abstain',
      score: null,
      runnerUpScore: null,
      reasons: ['fractional piece requirement requires human review'],
    }
  }

  if (hasInvalidBaseUnitAmount(requirement.amount, requirement.unit)) {
    return {
      type: 'abstain',
      score: null,
      runnerUpScore: null,
      reasons: ['requirement amount invalid after unit conversion'],
    }
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidate(requirement, candidate),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))

  const best = scored[0]
  const runnerUp = scored[1]

  if (!best) {
    return {
      type: 'abstain',
      score: null,
      runnerUpScore: null,
      reasons: ['no candidates'],
    }
  }

  const margin = runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY

  if (best.score < minimumScore) {
    return {
      type: 'abstain',
      score: best.score,
      runnerUpScore: runnerUp?.score ?? null,
      reasons: [...best.reasons, 'score below trust threshold'],
    }
  }

  if (margin < minimumMargin) {
    return {
      type: 'abstain',
      score: best.score,
      runnerUpScore: runnerUp?.score ?? null,
      reasons: [...best.reasons, 'top candidates too close'],
    }
  }

  return {
    type: 'match',
    productId: best.candidate.id,
    score: best.score,
    runnerUpScore: runnerUp?.score ?? null,
    reasons: best.reasons,
  }
}

export type BenchmarkCase = {
  id: string
  requirement: IngredientRequirement
  candidates: ProductCandidate[]
  expected:
    | { type: 'match'; acceptedProductIds: string[] }
    | { type: 'abstain' }
}

export type BenchmarkMetrics = {
  total: number
  correct: number
  accuracy: number
  expectedMatches: number
  acceptedMatches: number
  matchAccuracy: number
  expectedAbstentions: number
  correctAbstentions: number
  abstentionAccuracy: number
  falsePositiveMatches: number
}

export function evaluateMatchingBenchmark(
  cases: BenchmarkCase[],
): { metrics: BenchmarkMetrics; decisions: Array<{ id: string; decision: MatchDecision; correct: boolean }> } {
  let correct = 0
  let expectedMatches = 0
  let acceptedMatches = 0
  let expectedAbstentions = 0
  let correctAbstentions = 0
  let falsePositiveMatches = 0

  const decisions = cases.map((benchmarkCase) => {
    const decision = matchIngredient(
      benchmarkCase.requirement,
      benchmarkCase.candidates,
    )

    let isCorrect = false
    if (benchmarkCase.expected.type === 'match') {
      expectedMatches += 1
      if (
        decision.type === 'match' &&
        benchmarkCase.expected.acceptedProductIds.includes(decision.productId)
      ) {
        acceptedMatches += 1
        isCorrect = true
      }
    } else {
      expectedAbstentions += 1
      if (decision.type === 'abstain') {
        correctAbstentions += 1
        isCorrect = true
      } else {
        falsePositiveMatches += 1
      }
    }

    if (isCorrect) correct += 1
    return { id: benchmarkCase.id, decision, correct: isCorrect }
  })

  const total = cases.length
  return {
    metrics: {
      total,
      correct,
      accuracy: total === 0 ? 0 : correct / total,
      expectedMatches,
      acceptedMatches,
      matchAccuracy: expectedMatches === 0 ? 0 : acceptedMatches / expectedMatches,
      expectedAbstentions,
      correctAbstentions,
      abstentionAccuracy:
        expectedAbstentions === 0 ? 0 : correctAbstentions / expectedAbstentions,
      falsePositiveMatches,
    },
    decisions,
  }
}
