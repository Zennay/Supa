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
  'pak',
  'fles',
  'zak',
  'doos',
])

const MATCH_UNITS: ReadonlySet<string> = new Set([
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'unknown',
])

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMatchUnit(value: unknown): value is MatchUnit {
  return typeof value === 'string' && MATCH_UNITS.has(value)
}

function hasValidRequirementShape(value: unknown): value is IngredientRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const requirement = value as Record<string, unknown>
  return (
    isNonBlankString(requirement.id) &&
    isNonBlankString(requirement.query) &&
    (requirement.amount === null || typeof requirement.amount === 'number') &&
    isMatchUnit(requirement.unit)
  )
}

function hasValidCandidateShape(value: unknown): value is ProductCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  return (
    isNonBlankString(candidate.id) &&
    isNonBlankString(candidate.name) &&
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

function textTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !STOP_TOKENS.has(token))
}

function normalizedPhrase(value: string): string {
  return textTokens(value).join(' ')
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

  const packCount = candidate.packCount ?? 1
  if (!Number.isSafeInteger(packCount) || packCount <= 0) {
    return { score: -100, reasons: ['invalid pack count'] }
  }

  const queryPhrase = normalizedPhrase(requirement.query)
  const productPhrase = normalizedPhrase(candidate.name)
  const queryTokens = new Set(textTokens(requirement.query))
  const productTokens = new Set(textTokens(candidate.name))
  const reasons: string[] = []

  let overlap = 0
  for (const token of queryTokens) {
    if (productTokens.has(token)) overlap += 1
  }

  const overlapRatio = queryTokens.size === 0 ? 0 : overlap / queryTokens.size
  let score = Math.round(overlapRatio * 55)

  if (queryPhrase && productPhrase.includes(queryPhrase)) {
    score += 35
    reasons.push('query phrase present')
  } else if (overlap > 0) {
    reasons.push(`${overlap}/${queryTokens.size} query tokens present`)
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
      const oversupplyRatio = pack.amount / Math.max(required.amount, 1)
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

  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    return abstain('matching candidate identities ambiguous')
  }

  if (hasInvalidKnownAmount(requirement.amount)) {
    return {
      type: 'abstain',
      score: null,
      runnerUpScore: null,
      reasons: ['requirement amount invalid'],
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
