import { assessWeeklyBasketStudy } from '../../domain/observedBasketStudy.ts'
import type { OneStoreBasket, BasketTraceLine } from '../../domain/basket.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import { matchIngredient } from '../../domain/matching.ts'
import {
  M3_EXPECTED_RETAILERS,
  buildObservationSheet,
  observationSheetReadiness,
  type M3ObservationSide,
  type ObservationRequirement,
  type ObservationSheet,
  type ObservedProduct,
} from '../../domain/m3ObservationSheet.ts'

export type ObservedPriceLine = {
  status: 'priced' | 'unavailable' | 'missing' | 'untrusted'
  totalCents: number | null
  packs: number | null
  productName: string | null
}

export type ObservedComparisonRow = {
  id: string
  ingredientLabel: string
  amount: number
  unit: string
  plus: ObservedPriceLine
  dekamarkt: ObservedPriceLine
  differenceCents: number | null
}

export type ObservedStoreTotals = {
  matched: number
  total: number
  knownSubtotalCents: number | null
  complete: boolean
}

export type ObservedComparisonPreview = {
  rows: ObservedComparisonRow[]
  plus: ObservedStoreTotals
  dekamarkt: ObservedStoreTotals
  outcome: 'better' | 'same' | 'worse' | 'unknown'
  savingsCents: number | null
  reasons: string[]
  comparable: boolean
}

/**
 * The displayed comparison is derived solely from the operator's local M3
 * observations, NEVER the demo/fixture catalog or a guessed retailer price.
 * We use the same matcher, exact decimal pack arithmetic and authoritative
 * observed-week assessment as the offline M3 validation path.
 */
function observedLine(
  requirement: ObservationRequirement,
  record: ObservationSheet['baseline']['lines'][number] | undefined,
): { preview: ObservedPriceLine; basketLine: BasketTraceLine } {
  const unresolved = (status: ObservedPriceLine['status'], reason: string) => ({
    preview: {
      status,
      totalCents: null,
      packs: null,
      productName: null,
    } satisfies ObservedPriceLine,
    basketLine: {
      id: requirement.id,
      ingredientLabel: requirement.label,
      requirement: { amount: requirement.amount, unit: requirement.unit },
      status: 'unresolved' as const,
      reasons: [reason],
      matchScore: null,
    } satisfies BasketTraceLine,
  })

  if (
    !record ||
    record.ingredientId !== requirement.id ||
    record.ingredientLabel !== requirement.label ||
    record.requirement?.amount !== requirement.amount ||
    record.requirement?.unit !== requirement.unit
  ) return unresolved('untrusted', 'canonical ingredient requirement changed')

  const product: ObservedProduct = record.observedProduct
  if (product?.available === false) {
    return unresolved('unavailable', 'product observed unavailable')
  }
  if (product?.available !== true) return unresolved('missing', 'availability not observed')
  if (
    typeof product.productName !== 'string' ||
    !product.productName.trim() ||
    typeof product.packAmount !== 'number' ||
    !Number.isFinite(product.packAmount) ||
    product.packAmount <= 0 ||
    !product.packUnit ||
    product.packUnit === 'unknown' ||
    !Number.isSafeInteger(product.packCount) ||
    product.packCount <= 0 ||
    !Number.isSafeInteger(product.priceCents) ||
    product.priceCents === null ||
    product.priceCents < 0
  ) return unresolved('missing', 'observed product or price incomplete')

  const productId = typeof product.productId === 'string' && product.productId.trim()
    ? product.productId.trim()
    : `observation-${requirement.id}`

  const decision = matchIngredient(
    { id: requirement.id, query: requirement.query, amount: requirement.amount, unit: requirement.unit },
    [{
      id: productId,
      name: product.productName.trim(),
      packAmount: product.packAmount,
      packUnit: product.packUnit,
      packCount: product.packCount,
      available: true,
    }],
  )
  if (decision.type !== 'match') return unresolved('untrusted', 'product match cannot be trusted')

  const packs = calculateDecimalPackCount(
    [{ amount: requirement.amount, unit: requirement.unit }],
    { amount: product.packAmount, unit: product.packUnit, count: product.packCount },
  )
  if (packs === null) return unresolved('untrusted', 'pack quantity cannot be calculated exactly')

  const totalCents = packs * product.priceCents
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return unresolved('untrusted', 'line price exceeds safe integer limit')
  }

  return {
    preview: {
      status: 'priced',
      totalCents,
      packs,
      productName: product.productName.trim(),
    },
    basketLine: {
      id: requirement.id,
      ingredientLabel: requirement.label,
      requirement: { amount: requirement.amount, unit: requirement.unit },
      status: 'matched',
      productId,
      productName: product.productName.trim(),
      packs,
      pack: { amount: product.packAmount, unit: product.packUnit, count: product.packCount },
      pricePerPackCents: product.priceCents,
      lineTotalCents: totalCents,
      matchScore: decision.score,
      reasons: decision.reasons,
    },
  }
}

function storeBasket(
  sheet: ObservationSheet,
  side: M3ObservationSide,
): { basket: OneStoreBasket; lines: ObservedPriceLine[]; totals: ObservedStoreTotals } {
  const observation = sheet[side]
  const converted = sheet.requirements.map((req, index) =>
    observedLine(req, observation.lines[index]),
  )
  const matchedLines = converted.filter((entry) => entry.preview.status === 'priced')
  const sum = matchedLines.reduce(
    (total, entry) => total + (entry.preview.totalCents ?? 0),
    0,
  )
  const safeSum = Number.isSafeInteger(sum) && sum >= 0
  const basket: OneStoreBasket = {
    store: {
      // Empty store IDs remain invalid in the canonical comparator; their
      // display label is NOT a substitute for observed provenance.
      id: observation.store.id.trim(),
      name: observation.store.name.trim() || M3_EXPECTED_RETAILERS[side],
    },
    selectedMealCount: sheet.selectedMealCount,
    lines: converted.map((entry) => entry.basketLine),
    totalCents: safeSum ? sum : Number.NaN,
    matchedLineCount: matchedLines.length,
    unresolvedLineCount: converted.length - matchedLines.length,
  }
  return {
    basket,
    lines: converted.map((entry) => entry.preview),
    totals: {
      matched: matchedLines.length,
      total: sheet.requirements.length,
      knownSubtotalCents: matchedLines.length > 0 && safeSum ? sum : null,
      complete: matchedLines.length === sheet.requirements.length && safeSum,
    },
  }
}

/**
 * Reject any direct or tampered field draft that the canonical M3 converter
 * would refuse. Checking every raw slot (not Array.every alone) also rejects
 * sparse arrays, trailing duplicates, and forged planner requirements.
 *
 * Local draft restoration already enforces this contract, but callers can
 * invoke this pure comparison function without going through restoration.
 */
function hasCanonicalComparisonShape(
  sheet: ObservationSheet,
  canonical: ObservationSheet,
): boolean {
  if (!sheet || sheet.schemaVersion !== canonical.schemaVersion ||
      sheet.sheetType !== canonical.sheetType ||
      sheet.evidenceStatus !== canonical.evidenceStatus ||
      sheet.plannerFixture !== canonical.plannerFixture ||
      sheet.selectedMealCount !== canonical.selectedMealCount ||
      sheet.study?.maxObservationWindowHours !== 24 ||
      !Array.isArray(sheet.requirements) ||
      sheet.requirements.length !== canonical.requirements.length) {
    return false
  }

  for (let index = 0; index < canonical.requirements.length; index += 1) {
    const expected = canonical.requirements[index]
    const actual = sheet.requirements[index]
    if (!actual || actual.id !== expected.id ||
        actual.label !== expected.label ||
        actual.query !== expected.query ||
        actual.amount !== expected.amount ||
        actual.unit !== expected.unit) return false
  }

  for (const side of ['baseline', 'candidate'] as const) {
    const lines = sheet[side]?.lines
    if (!Array.isArray(lines) || lines.length !== canonical.requirements.length) return false
    for (let index = 0; index < canonical.requirements.length; index += 1) {
      const expected = canonical.requirements[index]
      const line = lines[index]
      if (!line || line.ingredientId !== expected.id ||
          line.ingredientLabel !== expected.label ||
          line.requirement?.amount !== expected.amount ||
          line.requirement?.unit !== expected.unit) return false
    }
  }
  return true
}

export function buildObservedComparisonPreview(
  sheet: ObservationSheet,
  referenceNowMs: number,
): ObservedComparisonPreview {
  const canonical = buildObservationSheet()
  const canonicalShape = hasCanonicalComparisonShape(sheet, canonical)
  // Never publish money or attacker-supplied extra demand for a rejected
  // shape. The blank canonical fallback is read-only and yields 11 unresolved
  // rows; the operator's original sheet remains unmodified for correction.
  const safeSheet = canonicalShape ? sheet : canonical
  const plus = storeBasket(safeSheet, 'baseline')
  const deka = storeBasket(safeSheet, 'candidate')
  const readiness = observationSheetReadiness(safeSheet, referenceNowMs)
  const reasons = [...readiness.issues]
  if (!canonicalShape) reasons.unshift('Boodschappenlijst wijkt af van de 11 vaste M3-productregels.')
  let outcome: ObservedComparisonPreview['outcome'] = 'unknown'
  let savingsCents: number | null = null

  // An observation sheet can be fully entered while its time, retailer,
  // product, source or demand provenance still makes the result untrustworthy.
  if (canonicalShape && readiness.ready) {
    const assessment = assessWeeklyBasketStudy({
      schemaVersion: 1,
      studyId: sheet.study.studyId,
      participantKey: sheet.study.participantKey,
      population: sheet.study.population,
      region: sheet.study.region,
      weekStart: sheet.study.weekStart,
      priceContext: sheet.study.priceContext === 'in-store' ? 'in-store' : 'online-order',
      baseline: {
        evidenceId: sheet.baseline.evidenceId,
        observedAt: sheet.baseline.observedAt,
        provenanceNote: sheet.baseline.provenanceNote,
        source: sheet.baseline.source,
        basket: plus.basket,
      },
      candidate: {
        evidenceId: sheet.candidate.evidenceId,
        observedAt: sheet.candidate.observedAt,
        provenanceNote: sheet.candidate.provenanceNote,
        source: sheet.candidate.source,
        basket: deka.basket,
      },
    }, { referenceNowMs })
    if (assessment.claimable && assessment.comparison.claimable) {
      outcome = assessment.comparison.outcome
      savingsCents = assessment.comparison.savingsCents
    } else {
      reasons.push(...assessment.reasons)
    }
  }

  return {
    rows: safeSheet.requirements.map((requirement, index) => {
      const plusLine = plus.lines[index]
      const dekaLine = deka.lines[index]
      const difference = plusLine.totalCents !== null && dekaLine.totalCents !== null
        ? plusLine.totalCents - dekaLine.totalCents
        : null
      return {
        id: requirement.id,
        ingredientLabel: requirement.label,
        amount: requirement.amount,
        unit: requirement.unit,
        plus: plusLine,
        dekamarkt: dekaLine,
        // A row-by-row difference is useful during collection, but never
        // authorizes a whole-basket winner while any evidence is incomplete.
        differenceCents: difference !== null && Number.isSafeInteger(difference)
          ? difference
          : null,
      }
    }),
    plus: plus.totals,
    dekamarkt: deka.totals,
    outcome,
    savingsCents,
    reasons,
    comparable: outcome !== 'unknown',
  }
}
