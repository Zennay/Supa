import type { SavedRecipe } from './recipeLibrary.ts'
import { scaledMetricPortionAmount } from '../../domain/metricPortionScale.ts'
import { sumDecimalAmounts } from '../../domain/decimalPackArithmetic.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'

export type OwnRecipeChecklistLine = {
  key: string
  label: string
  /** Exact canonical matching identity; never merge groceries by display label. */
  query?: string
  amount: number | null
  unit: 'g' | 'ml' | 'piece' | null
  needsReview: boolean
  original: string
}

export type OwnRecipeChecklist = {
  title: string
  portions: number
  /** Set only for an explicitly combined user-owned recipe collection. */
  recipeCount?: number
  lines: OwnRecipeChecklistLine[]
  canCopy: boolean
  copyText: string
}

/** Human-readable private grocery checklist; checked state exists only in the
 * user's current detail view. Never infer a retailer price or a purchased pack.
 */
export function formatOwnRecipeChecklist(
  checklist: OwnRecipeChecklist,
  checked: Readonly<Record<string, boolean>>,
  onlyOutstanding = false,
): string {
  const remaining = onlyOutstanding
    ? checklist.lines.filter(line => line.needsReview || checked[line.key] !== true)
    : checklist.lines
  return [
    checklist.recipeCount
      ? `Mijn receptenbundel: ${checklist.recipeCount} eigen recepten`
      : `Mijn recept: ${checklist.title} — ${checklist.portions} porties`,
    onlyOutstanding
      ? 'Alleen nog te kopen of controleren · DIT IS NIET het volledige fysieke mandje.'
      : 'Eigen ongeprijsde boodschappenlijst · controleer hoeveelheden en verpakking zelf.',
    ...(remaining.length ? remaining.map(line => line.needsReview
      ? `[?] ${line.original} — hoeveelheid handmatig controleren`
      : `${checked[line.key] ? '[x]' : '[ ]'} ${readableRecipeShoppingAmount(line.amount!)} ${line.unit === 'piece' ? 'stuks' : line.unit} ${line.label}`)
      : ['Alle controleerbare boodschappen zijn afgevinkt.']),
    'Prijzen, winkelvoorraad en besparingen zijn onbekend.',
  ].join('\n')
}

export function readableRecipeShoppingAmount(amount: number): string {
  // Source amounts are canonical physical demand, not a price or display
  // estimate. Reuse the exact decimal formatter of the capture worksheet:
  // toFixed(3) could otherwise round a positive quantity to zero or alter a
  // valid fractional need during copy/paste into the user's own shopping List.
  const exact = readablePlannerDemandAmount(amount)
  if (exact === 'hoeveelheid nog controleren')
    throw new Error('Controleer eerst de oorspronkelijke fysieke hoeveelheid.')
  // The existing NL private paste path accepts decimal commas. Never add
  // grouping separators (e.g. 1.250 g could mean a different amount).
  return exact.replace('.', ',')
}

/**
 * Private, unpriced physical demand from a user-owned recipe.
 * No price, retailer, product identity or permission is inferred.
 * Ambiguous pieces/quantities must be reviewed instead of rounding silently.
 */
export function ownRecipeShoppingChecklist(recipe: SavedRecipe, portions: number): OwnRecipeChecklist {
  if (!Number.isSafeInteger(portions) || portions < 1 || portions > 100 ||
      typeof recipe.servings !== 'number' || !Number.isFinite(recipe.servings) ||
      recipe.servings <= 0 || recipe.servings > 1000) {
    return { title: recipe.title, portions, lines: [], canCopy: false, copyText: '' }
  }

  const lines: OwnRecipeChecklistLine[] = []
  const grouped = new Map<string, OwnRecipeChecklistLine>()
  for (const ingredient of recipe.ingredients) {
    const valid = ingredient.reviewReason === null &&
      typeof ingredient.amount === 'number' && Number.isFinite(ingredient.amount) &&
      ingredient.amount > 0 && ingredient.amount <= 1_000_000 &&
      (ingredient.unit === 'g' || ingredient.unit === 'ml' || ingredient.unit === 'piece')
    // Identical exact-decimal rounding to the Planner variant: no hidden
    // underbuy from Math.round(0.333333 g * 1000) and no fractional eggs.
    const scaled = valid && ingredient.unit
      ? scaledMetricPortionAmount(
        ingredient.amount!, recipe.servings, portions, ingredient.unit,
      )
      : null
    const verified = valid && scaled !== null
    const label = ingredient.label || ingredient.original
    const groupKey = verified ? JSON.stringify([ingredient.query, ingredient.unit]) : ''
    const previous = groupKey ? grouped.get(groupKey) : undefined
    if (previous && previous.amount !== null) {
      const combined = sumDecimalAmounts([previous.amount, scaled!])
      if (combined !== null && combined <= 1_000_000) {
        previous.amount = combined
        continue
      }
    }
    const line: OwnRecipeChecklistLine = {
      key: String(lines.length),
      label,
      query: verified ? ingredient.query : undefined,
      amount: verified ? scaled : null,
      unit: verified ? ingredient.unit : null,
      needsReview: !verified,
      original: ingredient.original,
    }
    lines.push(line)
    if (groupKey && verified && !previous) grouped.set(groupKey, line)
  }

  const partial: OwnRecipeChecklist = { title: recipe.title, portions, lines, canCopy: lines.length > 0, copyText: '' }
  return { ...partial, copyText: formatOwnRecipeChecklist(partial, {}) }
}


/** Transfer already-combined personal demand into the existing unpriced List.
 * Unreviewed source quantities remain explicit questions, never guessed grams,
 * article codes, stock or a price. This is NOT a retailer import format. */
export function personalRecipeShoppingNoteLabels(
  lines: readonly OwnRecipeChecklistLine[],
): string[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100)
    throw new Error('Kies 1–100 nog openstaande eigen boodschappen.')
  const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  return lines.map(line => {
    if (typeof line.original !== 'string' || typeof line.label !== 'string')
      throw new Error('Een oorspronkelijk receptingrediënt ontbreekt.')
    const raw = line.needsReview
      ? 'Controleer hoeveelheid: ' + clean(line.original)
      : (() => {
          if (typeof line.amount !== 'number' || !Number.isFinite(line.amount) ||
              line.amount <= 0 || line.amount > 1_000_000 ||
              !['g', 'ml', 'piece'].includes(line.unit ?? '') ||
              (line.unit === 'piece' && !Number.isSafeInteger(line.amount)))
            throw new Error('De fysieke hoeveelheid is veranderd; controleer het recept opnieuw.')
          return readableRecipeShoppingAmount(line.amount) +
            (line.unit === 'piece' ? ' stuks ' : ' ' + line.unit + ' ') + clean(line.label)
        })()
    const label = clean(raw)
    if (!label || label.length > 140 || !/[\p{L}\p{N}]/u.test(label))
      throw new Error('Een receptomschrijving is te lang of ongeldig voor je eigen Lijst (maximaal 140 tekens).')
    return label
  })
}
