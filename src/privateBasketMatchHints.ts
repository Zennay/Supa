/** Reuse Supa's canonical deterministic, abstaining product matcher.
 * Read-only suggestion in the private own-data browser. Never commits a SKU.
 */
import { matchIngredient } from './domain/matching.ts'
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
