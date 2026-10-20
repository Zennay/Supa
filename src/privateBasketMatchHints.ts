/** Reuse Supa's canonical deterministic, abstaining product matcher.
 * Read-only suggestion in the private own-data browser. Never commits a SKU.
 */
import { matchIngredient } from './domain/matching.ts'
import { calculateDecimalPackCount } from './domain/decimalPackArithmetic.ts'
import type { MatchUnit } from './domain/matching.ts'
import type { IngredientRequirement, ProductCandidate, MatchDecision } from './domain/matching.ts'

type PrivateHint = {
  requirement: IngredientRequirement
  candidates: ProductCandidate[]
  decision: MatchDecision | null
}

document.addEventListener('supa:private-match-hint', (event: Event) => {
  const request = (event as CustomEvent<PrivateHint>).detail
  if (!request) return
  request.decision = matchIngredient(request.requirement, request.candidates)
})


/** Advisory whole-package cost for ONE user-picked store product.
 * Reuses the canonical decimal pack counter. This is never a confirmed
 * SKU match, never a full-basket quote, and cannot use an unknown price.
 */
type PrivatePackPreview = {
  amount: number | null
  unit: MatchUnit
  product: {
    available: boolean
    packAmount: number | null
    packUnit: MatchUnit
    packCount?: number
    priceCents: number | null
  }
  outcome: { packs: number; cents: number } | null
}
document.addEventListener('supa:private-pack-preview', (event: Event) => {
  const data = (event as CustomEvent<PrivatePackPreview>).detail
  if (!data) return
  data.outcome = null
  const { product, amount, unit } = data
  if (!product || product.available !== true ||
      typeof amount !== 'number' || !Number.isFinite(amount) ||
      amount <= 0 || amount > 100000 ||
      (unit === 'piece' && !Number.isSafeInteger(amount)) ||
      !Number.isSafeInteger(product.priceCents) ||
      product.priceCents! < 0 || product.priceCents! > 1000000 ||
      typeof product.packAmount !== 'number' ||
      !Number.isFinite(product.packAmount) ||
      product.packAmount <= 0 || product.packAmount > 100000 ||
      !Number.isSafeInteger(product.packCount) ||
      product.packCount! < 1 || product.packCount! > 1000) return
  const packs = calculateDecimalPackCount(
    [{ amount, unit }],
    { amount: product.packAmount, unit: product.packUnit, count: product.packCount },
  )
  const cents = packs === null ? NaN : packs * product.priceCents!
  if (packs !== null && Number.isSafeInteger(packs) && packs > 0 &&
      Number.isSafeInteger(cents) && cents >= 0) data.outcome = { packs, cents }
})
