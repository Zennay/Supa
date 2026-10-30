import type { Recipe } from '../../domain/types'

/** Per-person prices from the SUPA design for its example recipes (euros). */
const designPricePerPerson: Record<string, number> = {
  'supa-burrito-bowl': 5.35,
  'supa-fried-rice': 4.25,
  'supa-thai': 3.7,
  'supa-bao': 6.2,
  'supa-katsu': 4.8,
  'supa-quesadillas': 3.75,
  'supa-veg-pasta': 3.3,
}

const format = { format: (value: number) => `€${value.toFixed(2).replace('.', ',')}` }

/** "€4,25 p.p." for a recipe, or null when no price is known. */
export function pricePerPersonLabel(recipe: Pick<Recipe, 'id' | 'estimatedCost' | 'servings'>): string | null {
  const designed = designPricePerPerson[recipe.id]
  if (designed !== undefined) return `${format.format(designed)} p.p.`
  const { estimatedCost, servings } = recipe
  if (Number.isFinite(estimatedCost) && estimatedCost > 0 && Number.isFinite(servings) && servings > 0) {
    return `${format.format(estimatedCost / servings)} p.p.`
  }
  return null
}
