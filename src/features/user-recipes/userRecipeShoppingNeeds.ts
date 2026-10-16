/**
 * Offline shopping-needs PREVIEW for a reviewed user recipe, with no pricing,
 * product matching or claims of availability. The real M3 retailer basket
 * and Planner remain separately owned and unchanged.
 */
import { sumDecimalAmounts } from '../../domain/decimalPackArithmetic.ts'
import { scaleMetricRecipeDraft, type PortionWarning } from '../../domain/userRecipePortions.ts'
import type { EditorRecipeDraft, EditorUnit } from './userRecipeDraftEditor.ts'

export type UserRecipeShoppingNeed =
  | {
      status: 'known_unpriced'
      label: string
      query: string
      amount: number
      unit: EditorUnit
      priceCents: null
    }
  | {
      status: 'review_required'
      label: string
      query: string
      amount: number | null
      unit: EditorUnit | null
      reasons: string[]
      priceCents: null
    }

export type UserRecipeShoppingPreview = {
  status: 'complete_unpriced' | 'needs_review'
  sourceServings: number | null
  desiredServings: number
  lines: UserRecipeShoppingNeed[]
  warnings: PortionWarning[]
  priced: false
  retailerComparisonAvailable: false
}

const MAX_NEED_AMOUNT = 1_000_000_000

export function previewPrivateRecipeShoppingNeeds(
  source: EditorRecipeDraft,
  requestedServings: number,
): UserRecipeShoppingPreview {
  const scaled = scaleMetricRecipeDraft(source, requestedServings)
  const unknownBase = scaled.warnings.some((warning) => warning.code === 'unknown_base_servings')
  const byIngredient = new Map<number, PortionWarning[]>()
  for (const warning of scaled.warnings) {
    if (warning.ingredientIndex !== null) {
      const earlier = byIngredient.get(warning.ingredientIndex) ?? []
      earlier.push(warning)
      byIngredient.set(warning.ingredientIndex, earlier)
    }
  }

  type KnownGroup = {
    label: string
    query: string
    unit: EditorUnit
    amounts: number[]
  }
  const groups = new Map<string, KnownGroup>()
  const order: Array<{ groupKey: string } | { review: UserRecipeShoppingNeed }> = []

  scaled.draft.ingredients.forEach((ingredient, index) => {
    const label = ingredient.label.trim()
    const query = ingredient.query.trim()
    const reasons: string[] = []
    if (!label || !query) reasons.push('Naam of ingrediëntzoekterm ontbreekt.')
    if (unknownBase) reasons.push('Oorspronkelijk aantal porties ontbreekt.')
    if (ingredient.reviewReason) reasons.push(ingredient.reviewReason)
    const lineWarnings = byIngredient.get(index) ?? []
    for (const warning of lineWarnings) {
      if (warning.code === 'fractional_piece') reasons.push('Controleer de hoeveelheid stuks.')
      else if (warning.code === 'rounded_quantity') reasons.push('Controleer de afgeronde hoeveelheid.')
      else if (!ingredient.reviewReason) reasons.push('Controleer onzekere ingrediënthoeveelheid.')
    }
    if (ingredient.amount === null || !Number.isFinite(ingredient.amount) ||
        ingredient.amount <= 0 || ingredient.amount > MAX_NEED_AMOUNT ||
        !ingredient.unit || !['g', 'ml', 'piece'].includes(ingredient.unit)) {
      reasons.push('Geen betrouwbare metrische hoeveelheid.')
    }

    if (reasons.length) {
      order.push({
        review: {
          status: 'review_required', label, query, amount: ingredient.amount,
          unit: ingredient.unit, reasons: [...new Set(reasons)], priceCents: null,
        },
      })
      return
    }
    // Only EXACT same normalized label/query/unit is safe to combine.
    // Never infer synonym equivalence or a supermarket product match.
    const key = JSON.stringify([label.toLocaleLowerCase('nl-NL'), query.toLocaleLowerCase('nl-NL'), ingredient.unit])
    const group = groups.get(key)
    if (group) {
      group.amounts.push(ingredient.amount as number)
    } else {
      groups.set(key, {
        label, query, unit: ingredient.unit as EditorUnit,
        amounts: [ingredient.amount as number],
      })
      order.push({ groupKey: key })
    }
  })

  const lines: UserRecipeShoppingNeed[] = order.map((entry): UserRecipeShoppingNeed => {
    if ('review' in entry) return entry.review
    const group = groups.get(entry.groupKey)!
    const exact = sumDecimalAmounts(group.amounts)
    if (exact === null || exact > MAX_NEED_AMOUNT) {
      return {
        status: 'review_required', label: group.label, query: group.query,
        amount: null, unit: group.unit, priceCents: null,
        reasons: ['Optellen van hoeveelheden is niet betrouwbaar. Controleer dit ingrediënt.'],
      }
    }
    return {
      status: 'known_unpriced', label: group.label, query: group.query,
      amount: exact, unit: group.unit, priceCents: null,
    }
  })
  const hasReview = lines.length === 0 || lines.some((line) => line.status === 'review_required') ||
    scaled.warnings.length > 0 || source.warnings.length > 0

  return {
    status: hasReview ? 'needs_review' : 'complete_unpriced',
    sourceServings: source.servings,
    desiredServings: requestedServings,
    lines, warnings: scaled.warnings,
    priced: false, retailerComparisonAvailable: false,
  }
}
