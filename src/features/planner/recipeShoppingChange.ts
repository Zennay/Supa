import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { sumDecimalDemandUnits } from '../../domain/decimalPackArithmetic.ts'
import type { MatchUnit } from '../../domain/matching.ts'
import type { PlannedMeal } from '../../domain/types.ts'

export type ShoppingChange = Readonly<{
  id: string
  label: string
  kind: 'added' | 'removed' | 'changed'
  before: string | null
  after: string | null
}>
export type RecipeShoppingChange =
  | { status: 'unavailable'; reason: string; changes: readonly [] }
  | { status: 'ready'; changes: readonly ShoppingChange[]; previousCount: number; nextCount: number }

type PhysicalRequirement = { id: string; label: string; unit: MatchUnit; amount: number | null }

function normalized(item: PhysicalRequirement): { unit: MatchUnit; amount: number } | null {
  const unit: MatchUnit = item.unit === 'kg' ? 'g' : item.unit === 'l' ? 'ml' : item.unit
  if (!['g', 'ml', 'piece'].includes(unit) || item.amount === null ||
      !Number.isFinite(item.amount) || item.amount <= 0 ||
      (unit === 'piece' && !Number.isSafeInteger(item.amount))) return null
  const amount = sumDecimalDemandUnits([{ unit: item.unit, amount: item.amount }], unit)
  if (amount === null || !Number.isFinite(amount) || amount <= 0 ||
      (unit === 'piece' && !Number.isSafeInteger(amount))) return null
  return { unit, amount }
}

/** No prices or retailer identity enter a recipe switch. Both sides use the
 * exact same canonical aggregated physical demand as the basket engine.
 * Invalid quantities stay unavailable; never silently underbuy. */
export function recipeShoppingChange(input: {
  plan: readonly PlannedMeal[]
  recipes: readonly RecipeWithIngredients[]
  activeDays: readonly string[]
  day: string
  recipeId: string
}): RecipeShoppingChange {
  const unavailable = (reason: string): RecipeShoppingChange => ({ status: 'unavailable', reason, changes: [] })
  if (!Array.isArray(input.plan) || !Array.isArray(input.recipes) ||
      !Array.isArray(input.activeDays) || !input.activeDays.includes(input.day) ||
      new Set(input.activeDays).size !== input.activeDays.length ||
      input.plan.filter(meal => meal?.day === input.day).length !== 1 ||
      input.recipes.filter(recipe => recipe?.id === input.recipeId).length !== 1) {
    return unavailable('Kies één geldige actieve Planner-dag en een bestaand recept.')
  }
  try {
    const before = aggregatePlanIngredients(
      [...input.plan], [...input.recipes], [...input.activeDays])
    const after = aggregatePlanIngredients(
      input.plan.map(meal => meal.day === input.day
        ? { ...meal, recipeId: input.recipeId } : { ...meal }),
      [...input.recipes], [...input.activeDays])
    if (before.length > 200 || after.length > 200 ||
        new Set(before.map(line => line.id)).size !== before.length ||
        new Set(after.map(line => line.id)).size !== after.length) {
      return unavailable('De week bevat te veel of dubbele fysieke ingrediënten voor deze preview.')
    }
    const old = new Map(before.map(line => [line.id, line] as const))
    const next = new Map(after.map(line => [line.id, line] as const))
    const changes: ShoppingChange[] = []
    for (const id of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const previous = old.get(id)
      const upcoming = next.get(id)
      if (previous && upcoming && (previous.label !== upcoming.label || previous.query !== upcoming.query)) {
        return unavailable('Ingrediëntidentiteit is veranderd. Controleer de originele receptregels.')
      }
      const beforeQty = previous ? normalized(previous) : null
      const afterQty = upcoming ? normalized(upcoming) : null
      if ((previous && !beforeQty) || (upcoming && !afterQty)) {
        return unavailable('Een recept heeft een onbekende hoeveelheid of gedeeltelijke stuks. Controleer de ingrediënten.')
      }
      if (beforeQty && afterQty && beforeQty.unit !== afterQty.unit) {
        return unavailable('Een ingrediënt is tussen onverenigbare maateenheden veranderd.')
      }
      if (beforeQty && afterQty && beforeQty.amount === afterQty.amount) continue
      const quantity = (value: { amount: number; unit: MatchUnit } | null) =>
        value ? String(value.amount).replace('.', ',') + ' ' +
          (value.unit === 'piece' ? 'stuks' : value.unit) : null
      changes.push({ id, label: upcoming?.label ?? previous!.label,
        kind: beforeQty && afterQty ? 'changed' : beforeQty ? 'removed' : 'added',
        before: quantity(beforeQty), after: quantity(afterQty) })
    }
    return { status: 'ready', changes, previousCount: before.length, nextCount: after.length }
  } catch {
    return unavailable('De huidige of nieuwe Planner-vraag is niet betrouwbaar te berekenen.')
  }
}

/** Portable unpriced physical demand changes: never price or SKU evidence. */
export function recipeShoppingChangeText(preview: RecipeShoppingChange, day: string): string {
  if (preview.status !== 'ready') throw new Error('Controleer de fysieke receptwijziging eerst.')
  const safe = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const rows = [
    'Supa · concept van de boodschappenwijziging voor ' + safe(day),
    'Voorlopig receptvoorstel; dit wijzigt nog geen opgeslagen planning.',
    'Alleen fysieke hoeveelheden, geen actuele winkelprijzen of besparingsclaim.',
    '',
    ...preview.changes.map(line =>
      (line.kind === 'added' ? 'NIEUW' : line.kind === 'removed' ? 'VERVALT' : 'VERANDERT') +
      ' · ' + safe(line.label) + ' · ' + safe(line.before ?? 'niet nodig') +
      ' → ' + safe(line.after ?? 'niet nodig')),
    ...(preview.changes.length ? [] : ['Geen fysieke boodschappenwijziging.']),
    '', 'Na de receptkeuze: controleer PLUS/Deka-bronnen, SKU-keuzes,',
    'eenheidsprijzen en volledige mandjes opnieuw in Vergelijk.',
  ]
  const output = rows.join('\n') + '\n'
  if (new TextEncoder().encode(output).length > 100_000)
    throw new Error('De conceptlijst is te groot om veilig te delen.')
  return output
}
