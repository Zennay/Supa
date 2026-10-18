/**
 * Supa local selected-week intake to existing private basket demand.
 * Uses the same canonical Supa aggregation as offline-planner-demand-to-json.
 * No recipe fetch, retailer prices, SKU inference, network calls or storage.
 */
import { aggregatePlanIngredients } from './domain/basket.ts'

type Week = {
  schema: 'supa-private-planner-week-v1'
  plan: { day: string; recipeId: string }[]
  activeDays: string[]
  recipes: { id: string; ingredients: { id: string; label: string; query: string; amount: number | null; unit: 'g' | 'kg' | 'ml' | 'l' | 'piece' }[] }[]
}
const upload = document.querySelector<HTMLInputElement>('#week-import')!
const info = document.querySelector<HTMLElement>('#week-status')!
const maxBytes = 256000
const units = ['g', 'kg', 'ml', 'l', 'piece']
let revision = 0

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const validText = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.trim() === value && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/^[=+@-]/u.test(value)
const only = (value: Record<string, unknown>, permitted: string[]) =>
  Object.keys(value).every(key => permitted.includes(key))
const quantity = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) &&
    value > 0 && value <= 100000)

function readWeek(value: unknown): Week {
  if (!record(value) || value.schema !== 'supa-private-planner-week-v1' ||
      !only(value, ['schema', 'plan', 'activeDays', 'recipes']) ||
      !Array.isArray(value.plan) || value.plan.length < 1 || value.plan.length > 14 ||
      !Array.isArray(value.activeDays) || value.activeDays.length < 1 || value.activeDays.length > 14 ||
      !Array.isArray(value.recipes) || value.recipes.length < 1 || value.recipes.length > 150) {
    throw Error('Geen geldig lokaal geselecteerd weekmenu.')
  }
  if (new Set(value.activeDays).size !== value.activeDays.length ||
      !value.activeDays.every(day => validText(day, 40))) throw Error('Weekdagen ontbreken of zijn dubbel.')
  if (!value.plan.every(meal => record(meal) &&
      only(meal, ['day', 'recipeId']) && validText(meal.day, 40) &&
      validText(meal.recipeId, 100))) throw Error('Onvolledige geplande maaltijd.')
  if (!value.recipes.every(recipe => record(recipe) &&
      only(recipe, ['id', 'ingredients']) && validText(recipe.id, 100) &&
      Array.isArray(recipe.ingredients) && recipe.ingredients.length <= 1000 &&
      recipe.ingredients.every(item => record(item) &&
        only(item, ['id', 'label', 'query', 'amount', 'unit']) &&
        validText(item.id, 100) && validText(item.label) && validText(item.query) &&
        units.includes(item.unit as string) && quantity(item.amount)))) {
    throw Error('Onjuiste recepten of niet-metrische ingrediënten.')
  }
  if (new Set(value.recipes.map(recipe => recipe.id)).size !== value.recipes.length) {
    throw Error('Meerdere recepten delen hetzelfde ID.')
  }
  return value as unknown as Week
}

function demandFromWeek(week: Week) {
  const ingredients = aggregatePlanIngredients(
    week.plan,
    week.recipes as Parameters<typeof aggregatePlanIngredients>[1],
    week.activeDays,
  )
  if (!ingredients.length || ingredients.length > 200 ||
      ingredients.some(item => !validText(item.id, 100) || !validText(item.label) ||
        !units.includes(item.unit) || !quantity(item.amount))) {
    throw Error('Weekmenu bevat geen ondersteunde volledige fysieke vraag; maximaal 200 ingrediënten.')
  }
  return {
    schema: 'supa-private-basket-demand-v1',
    selectedMealCount: week.activeDays.length,
    ingredients: ingredients.map(item => ({
      id: item.id, label: item.label, amount: item.amount, unit: item.unit,
      productIds: { PLUS: null, DekaMarkt: null },
    })),
  }
}

upload.addEventListener('change', async () => {
  const current = ++revision
  const file = upload.files?.[0]
  if (!file) return
  try {
    if (!file.size || file.size > maxBytes) throw Error('Het lokale weekmenu is leeg of groter dan 256 kB.')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    const demand = demandFromWeek(readWeek(JSON.parse(content)))
    if (revision !== current) return
    document.dispatchEvent(new CustomEvent('supa:private-planner-demand', { detail: demand }))
    info.textContent = String(demand.ingredients.length) +
      ' fysieke ingrediëntbehoeften uit ' + demand.selectedMealCount +
      ' geselecteerde maaltijden geïmporteerd. Winkelproducten blijven onbekend tot je de echte bron-SKU per winkel kiest.'
    info.className = 'notice'
  } catch (error) {
    if (revision !== current) return
    info.textContent = error instanceof Error ? error.message :
      'Weekmenu kan niet veilig worden samengevoegd.'
    info.className = 'notice error'
  }
})
