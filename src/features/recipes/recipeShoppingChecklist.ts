import type { SavedRecipe } from './recipeLibrary.ts'

export type OwnRecipeChecklistLine = {
  key: string
  label: string
  amount: number | null
  unit: 'g' | 'ml' | 'piece' | null
  needsReview: boolean
  original: string
}

export type OwnRecipeChecklist = {
  title: string
  portions: number
  lines: OwnRecipeChecklistLine[]
  canCopy: boolean
  copyText: string
}

function compactAmount(amount: number): string {
  return Number(amount.toFixed(3)).toLocaleString('nl-NL', { maximumFractionDigits: 3 })
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
    const measured = valid ? ingredient.amount! * portions / recipe.servings : NaN
    const reasonable = Number.isFinite(measured) && measured > 0 && measured <= 1_000_000
    const rounded = reasonable ? Math.round(measured * 1000) / 1000 : NaN
    const exactPieces = ingredient.unit !== 'piece' || Number.isSafeInteger(measured)
    const verified = valid && reasonable && Number.isFinite(rounded) && rounded > 0 && exactPieces
    const label = ingredient.label || ingredient.original
    const groupKey = verified ? JSON.stringify([ingredient.query, ingredient.unit]) : ''
    const previous = groupKey ? grouped.get(groupKey) : undefined
    if (previous && previous.amount !== null) {
      const combined = Math.round((previous.amount + rounded) * 1000) / 1000
      if (Number.isFinite(combined) && combined > 0 && combined <= 1_000_000) {
        previous.amount = combined
        continue
      }
    }
    const line: OwnRecipeChecklistLine = {
      key: String(lines.length),
      label,
      amount: verified ? rounded : null,
      unit: verified ? ingredient.unit : null,
      needsReview: !verified,
      original: ingredient.original,
    }
    lines.push(line)
    if (groupKey && verified && !previous) grouped.set(groupKey, line)
  }

  const copyText = [
    `Mijn recept: ${recipe.title} — ${portions} porties`,
    'Eigen ongeprijsde boodschappenlijst · controleer hoeveelheden en verpakking zelf.',
    ...lines.map(line => line.needsReview
      ? `[?] ${line.original} — hoeveelheid handmatig controleren`
      : `[ ] ${compactAmount(line.amount!)} ${line.unit === 'piece' ? 'stuks' : line.unit} ${line.label}`),
    'Prijzen, winkelvoorraad en besparingen zijn onbekend.',
  ].join('\n')

  return { title: recipe.title, portions, lines, canCopy: lines.length > 0, copyText }
}
