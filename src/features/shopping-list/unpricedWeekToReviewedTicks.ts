import { aggregatePlanIngredients, type RecipeWithIngredients, type OneStoreBasket } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { importUnpricedProgress, unpricedProgressStorageKey } from '../comparison/unpricedPlannerProgress.ts'

type Input = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  basket: OneStoreBasket
  read: (key: string) => string | null
}

type Pending = { checkedIds: string[]; total: number }

/**
 * Transfer only physical completion, explicitly initiated by the owner.
 * Uses the existing Planner's exact tab-storage identity, not a new source.
 * Refuses drift in ingredient definitions, week or physical basket amounts.
 * Never imports review approvals, product prices, availability or source rights.
 */
export function unpricedWeekToReviewedTicks({
  plan, recipes, activeDays, basket, read,
}: Input): Pending {
  const rows = aggregatePlanIngredients(plan, recipes, activeDays)
  if (!activeDays.length || rows.length === 0 ||
      rows.length !== basket.lines.length ||
      basket.selectedMealCount !== activeDays.length ||
      basket.matchedLineCount !== rows.length || basket.unresolvedLineCount !== 0) {
    throw Error('Dit eigen winkelmandje komt niet volledig overeen met je Planner-week.')
  }
  const demandKeys = rows.map(row => JSON.stringify([row.id, row.label, row.amount, row.unit]))
  const demandIdentity = JSON.stringify([activeDays, demandKeys])
  const sourceLines = new Map(basket.lines.map(line => [line.id, line]))
  if (sourceLines.size !== rows.length) throw Error('Dubbele ingrediënten in het winkelmandje.')
  for (const row of rows) {
    const line = sourceLines.get(row.id)
    if (!line || line.status !== 'matched' || line.ingredientLabel !== row.label ||
        line.requirement.amount !== row.amount || line.requirement.unit !== row.unit ||
        row.amount === null) {
      throw Error('Dit winkelmandje bevat een andere hoeveelheid, productvraag of ingrediënt.')
    }
  }
  const raw = read(unpricedProgressStorageKey(demandIdentity))
  if (raw === null) return { checkedIds: [], total: rows.length }
  const checked = importUnpricedProgress(raw, demandIdentity, demandKeys)
  return {
    checkedIds: rows.filter((row, index) => checked[demandKeys[index]])
      .map(row => row.id),
    total: rows.length,
  }
}
