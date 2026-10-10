import type { OneStoreBasket } from '../../domain/basket'
import type { BasketComparison } from '../../domain/basketComparison'

export type ComparisonNextStepCode =
  | 'choose-meals'
  | 'complete-products'
  | 'align-plans'
  | 'choose-different-stores'
  | 'review-data'
  | 'comparison-ready'

/**
 * Presentation guidance, not an alternative financial assessor.
 *
 * This deliberately never derives savings or promotes unknown/empty baskets to
 * claimable results. Callers must still use the canonical basket comparator.
 */
export type ComparisonNextStep = {
  code: ComparisonNextStepCode
  title: string
  explanation: string
  action: string
  canShowDifference: boolean
}

const STEPS: Record<ComparisonNextStepCode, Omit<ComparisonNextStep, 'code'>> = {
  'choose-meals': {
    title: 'Plan eerst een maaltijd',
    explanation: 'Zonder geplande boodschappen is er niets te vergelijken.',
    action: 'Kies één of meer maaltijden in je weekplanning.',
    canShowDifference: false,
  },
  'complete-products': {
    title: 'Controleer ontbrekende producten',
    explanation: 'Niet alle benodigde ingrediënten hebben een betrouwbare productkeuze in beide winkels.',
    action: 'Controleer de niet-gevonden ingrediënten voordat je de winkelmanden vergelijkt.',
    canShowDifference: false,
  },
  'align-plans': {
    title: 'Vergelijk dezelfde boodschappen',
    explanation: 'De winkelmanden zijn niet op precies dezelfde maaltijden en hoeveelheden gebaseerd.',
    action: 'Gebruik voor beide winkels dezelfde weekplanning en hoeveelheden.',
    canShowDifference: false,
  },
  'choose-different-stores': {
    title: 'Kies twee verschillende winkels',
    explanation: 'Een winkelmand kan niet zinvol met zichzelf worden vergeleken.',
    action: 'Selecteer een andere winkel voor de tweede mand.',
    canShowDifference: false,
  },
  'review-data': {
    title: 'De vergelijking is nog niet betrouwbaar',
    explanation: 'De gegevens zijn onvolledig of niet onderling te controleren. Een prijsverschil zou misleidend zijn.',
    action: 'Controleer de winkelmanden en probeer de vergelijking opnieuw.',
    canShowDifference: false,
  },
  'comparison-ready': {
    title: 'De testmanden zijn vergelijkbaar',
    explanation: 'De gecontroleerde manden hebben dezelfde vraag en een controleerbare prijsberekening. Dit zijn geen actuele winkelprijzen of bewezen besparingen.',
    action: 'Controleer de producten en prijzen voordat je hierop een aankoopbeslissing baseert.',
    canShowDifference: true,
  },
}

function step(code: ComparisonNextStepCode): ComparisonNextStep {
  return { code, ...STEPS[code] }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Fail-closed user-facing next action for a canonical two-store comparison.
 *
 * No raw comparator reasons or ingredient IDs are displayed: internal messages
 * can contain technical jargon and user-derived labels.
 */
export function comparisonNextStep(input: {
  comparison: BasketComparison
  baseline: OneStoreBasket
  candidate: OneStoreBasket
}): ComparisonNextStep {
  if (!record(input) || !record(input.baseline) || !record(input.candidate) || !record(input.comparison)) {
    return step('review-data')
  }

  const { comparison, baseline, candidate } = input

  if (
    !safeNonnegativeInteger(baseline.selectedMealCount) ||
    !safeNonnegativeInteger(candidate.selectedMealCount) ||
    !Array.isArray(baseline.lines) ||
    !Array.isArray(candidate.lines) ||
    !safeNonnegativeInteger(baseline.matchedLineCount) ||
    !safeNonnegativeInteger(candidate.matchedLineCount) ||
    !safeNonnegativeInteger(baseline.unresolvedLineCount) ||
    !safeNonnegativeInteger(candidate.unresolvedLineCount)
  ) {
    return step('review-data')
  }

  // The current comparator can say "same" on two empty baskets (#1051).
  // Never turn that into a consumer-facing financial comparison.
  if (
    baseline.selectedMealCount === 0 ||
    candidate.selectedMealCount === 0 ||
    baseline.lines.length === 0 ||
    candidate.lines.length === 0
  ) {
    return step('choose-meals')
  }

  if (baseline.unresolvedLineCount > 0 || candidate.unresolvedLineCount > 0) {
    return step('complete-products')
  }

  if (
    baseline.selectedMealCount !== candidate.selectedMealCount ||
    (Array.isArray(comparison.reasons) &&
      comparison.reasons.some(
        (reason) =>
          typeof reason === 'string' &&
          /different number of meals|ingredient demand differs|ingredient coverage differs|missing ingredient|extra ingredient|ingredient label differs/.test(reason),
      ))
  ) {
    return step('align-plans')
  }

  if (
    !record(baseline.store) ||
    !record(candidate.store) ||
    typeof baseline.store.id !== 'string' ||
    typeof candidate.store.id !== 'string' ||
    !baseline.store.id.trim() ||
    !candidate.store.id.trim()
  ) {
    return step('review-data')
  }

  if (baseline.store.id === candidate.store.id) {
    return step('choose-different-stores')
  }

  // An inconsistent comparison object must not let presentation claim money.
  if (
    comparison.claimable !== true ||
    !['better', 'same', 'worse'].includes(comparison.outcome) ||
    !Array.isArray(comparison.reasons) ||
    comparison.reasons.length !== 0 ||
    !safeNonnegativeInteger(baseline.totalCents) ||
    !safeNonnegativeInteger(candidate.totalCents) ||
    !safeNonnegativeInteger(comparison.baselineTotalCents) ||
    !safeNonnegativeInteger(comparison.candidateTotalCents) ||
    baseline.totalCents !== comparison.baselineTotalCents ||
    candidate.totalCents !== comparison.candidateTotalCents ||
    !Number.isSafeInteger(comparison.deltaCents) ||
    !Number.isSafeInteger(comparison.savingsCents) ||
    comparison.deltaCents !== candidate.totalCents - baseline.totalCents ||
    comparison.savingsCents !== -comparison.deltaCents ||
    (comparison.deltaCents < 0 ? 'better' : comparison.deltaCents > 0 ? 'worse' : 'same') !== comparison.outcome ||
    baseline.matchedLineCount === 0 ||
    candidate.matchedLineCount === 0 ||
    baseline.matchedLineCount !== baseline.lines.length ||
    candidate.matchedLineCount !== candidate.lines.length
  ) {
    return step('review-data')
  }

  return step('comparison-ready')
}
