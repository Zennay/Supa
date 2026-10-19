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
const quantity = (value: unknown, unit: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) &&
    value > 0 && value <= 100000 &&
    (unit !== 'piece' || Number.isSafeInteger(value)))

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
  if (value.plan.length !== value.activeDays.length ||
      !value.plan.every(meal => record(meal) &&
      only(meal, ['day', 'recipeId']) && validText(meal.day, 40) &&
      validText(meal.recipeId, 100) && (value.activeDays as string[]).includes(meal.day)) ||
      new Set(value.plan.map(meal => (meal as { day: string }).day)).size !== value.plan.length) {
    throw Error('Het weekmenu bevat ontbrekende, dubbele of niet-geselecteerde maaltijden.')
  }
  if (!value.recipes.every(recipe => record(recipe) &&
      only(recipe, ['id', 'ingredients']) && validText(recipe.id, 100) &&
      Array.isArray(recipe.ingredients) && recipe.ingredients.length <= 1000 &&
      recipe.ingredients.every(item => record(item) &&
        only(item, ['id', 'label', 'query', 'amount', 'unit']) &&
        validText(item.id, 100) && validText(item.label) && validText(item.query) &&
        units.includes(item.unit as string) && quantity(item.amount, item.unit)))) {
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
        !units.includes(item.unit) || !quantity(item.amount, item.unit))) {
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


type PrivateDemand = ReturnType<typeof demandFromWeek>
const handoffKey = 'supa:private-planner-week-handoff:v1'
const acceptHandoff = document.querySelector<HTMLButtonElement>('#week-handoff-accept')!
const cancelHandoff = document.querySelector<HTMLButtonElement>('#week-handoff-cancel')!
const currentLines = document.querySelector<HTMLElement>('#lines')!
const preview = document.querySelector<HTMLElement>('#week-import-preview')!
const previewItems = document.querySelector<HTMLOListElement>('#week-import-preview-items')!
let stagedHandoff: PrivateDemand | null = null
function presentStagedWeek(demand: PrivateDemand, source: string) {
  stagedHandoff = demand
  acceptHandoff.hidden = false
  acceptHandoff.disabled = false
  cancelHandoff.hidden = false
  cancelHandoff.disabled = false
  // Use textContent only: recipe labels came from a private JSON file or
  // another browser UI and must never become executable markup.
  const list = demand.ingredients.slice(0, 30).map(row => {
    const li = document.createElement('li')
    li.textContent = row.label + ' · ' +
      (row.amount === null ? 'hoeveelheid onbekend' : String(row.amount)) +
      ' ' + row.unit
    return li
  })
  previewItems.replaceChildren(...list)
  if (demand.ingredients.length > list.length) {
    const remaining = document.createElement('li')
    remaining.textContent = 'En nog ' + (demand.ingredients.length - list.length) +
      ' overige fysieke ingrediënten.'
    previewItems.append(remaining)
  }
  preview.hidden = false
  info.textContent = source + ' staat klaar: ' +
    demand.selectedMealCount + ' geselecteerde maaltijden en ' +
    demand.ingredients.length + ' originele fysieke ingrediënten. ' +
    'Controleer de eerste regels, daarna kun je de invoer expliciet accepteren; er zijn geen winkelprijzen of SKU’s overgenomen.'
  info.className = 'notice'
}
function discardStage() {
  stagedHandoff = null
  acceptHandoff.hidden = true
  acceptHandoff.disabled = true
  cancelHandoff.hidden = true
  cancelHandoff.disabled = true
  preview.hidden = true
  previewItems.replaceChildren()
}
try {
  // Do not leave a sensitive week/menu payload in tab storage after display.
  const saved = window.sessionStorage.getItem(handoffKey)
  if (saved !== null) {
    window.sessionStorage.removeItem(handoffKey)
    if (!saved.length || new TextEncoder().encode(saved).length > maxBytes)
      throw Error('Het doorgestuurde weekmenu is leeg of te groot.')
    presentStagedWeek(demandFromWeek(readWeek(JSON.parse(saved))), 'Jouw doorgestuurde Planner-week')
  }
} catch {
  discardStage()
  info.textContent = 'De directe Planner-overdracht was niet bruikbaar. Je kunt dezelfde week zelf als JSON openen; het eerdere mandje blijft ongewijzigd.'
  info.className = 'notice error'
}

cancelHandoff.addEventListener('click', () => {
  ++revision
  discardStage()
  upload.value = ''
  info.textContent = 'Planner-importconcept bewust gewist. Je huidige mand en werkelijk ingevoerde winkelbronnen blijven onveranderd.'
  info.className = 'notice'
})

acceptHandoff.addEventListener('click', () => {
  const demand = stagedHandoff
  if (!demand) return
  if (currentLines.children.length && !window.confirm(
    'Vervang de huidige fysieke mandvraag door ' + demand.ingredients.length +
    ' originele ingrediënten uit je Planner-week? Eerder gekozen SKU’s en vinkjes moeten opnieuw worden beoordeeld. ' +
    'Bestaande bronprijzen worden niet aangevuld of gefingeerd.')) return
  // The only state-changing operation is this explicit button press. The
  // existing wizard alone decides which manual source choices remain valid.
  document.dispatchEvent(new CustomEvent('supa:private-planner-demand', { detail: demand }))
  discardStage()
  info.textContent = 'Originele Planner-vraag overgenomen: ' + demand.selectedMealCount +
    ' maaltijden en ' + demand.ingredients.length + ' fysieke ingrediënten. ' +
    'Kies nu jouw werkelijk geobserveerde producten per winkel; onbekende prijzen blijven onbekend.'
  info.className = 'notice'
})

upload.addEventListener('change', async () => {
  const current = ++revision
  const file = upload.files?.[0]
  if (!file) return
  discardStage()
  try {
    if (!file.size || file.size > maxBytes) throw Error('Het lokale weekmenu is leeg of groter dan 256 kB.')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    if (revision !== current) return
    const demand = demandFromWeek(readWeek(JSON.parse(content)))
    presentStagedWeek(demand, 'Jouw lokale Planner-JSON')
  } catch (error) {
    if (revision !== current) return
    discardStage()
    info.textContent = error instanceof Error ? error.message :
      'Weekmenu kan niet veilig worden ingelezen; bestaande mand ongewijzigd.'
    info.className = 'notice error'
  } finally {
    if (revision === current) upload.value = ''
  }
})
