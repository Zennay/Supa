/** Explicit, read-only local saved-recipe -> canonical offline private demand.
 * No recipe URL fetch, no retailer lookup, no storage writes or inferred prices.
 */
import { aggregatePlanIngredients } from './domain/basket.ts'
import { readRecipeLibrary, type SavedRecipe } from './features/recipes/recipeLibrary.ts'
import { toPlannerRecipe } from './features/recipes/plannerRecipes.ts'

const loadButton = document.querySelector<HTMLButtonElement>('#load-own-recipes')!
const convertButton = document.querySelector<HTMLButtonElement>('#own-recipes-to-demand')!
const status = document.querySelector<HTMLElement>('#own-recipe-status')!
const choices = document.querySelector<HTMLElement>('#own-recipe-choices')!
const units = ['g', 'kg', 'ml', 'l', 'piece']
let loaded: SavedRecipe[] = []
let libraryRaw: string | null = null
const setStatus = (message: string, warning = false) => {
  status.textContent = message
  status.className = 'notice' + (warning ? ' warning' : '')
}

loadButton.addEventListener('click', () => {
  loaded = []
  libraryRaw = null
  choices.replaceChildren()
  convertButton.disabled = true
  try {
    // Access storage only on the user's explicit click; never save or mutate it.
    const snapshot = readRecipeLibrary(window.localStorage)
    if (snapshot.error) throw Error('Jouw receptbibliotheek kan niet veilig worden gelezen. Herstel die eerst in Mijn recepten.')
    const ready = snapshot.recipes.filter(recipe =>
      recipe.warnings.length === 0 && toPlannerRecipe(recipe) !== null)
    loaded = ready
    libraryRaw = snapshot.raw
    for (const recipe of ready.slice(0, 100)) {
      const card = document.createElement('label')
      card.style.display = 'grid'
      card.style.gridTemplateColumns = 'auto minmax(0,1fr) 80px'
      card.style.alignItems = 'center'
      card.style.gap = '10px'
      const selected = document.createElement('input')
      selected.type = 'checkbox'
      selected.style.width = '20px'
      selected.dataset.recipeSelected = recipe.id
      const caption = document.createElement('span')
      caption.textContent = recipe.title + ' · ' + recipe.servings + ' porties per bereiding · ' +
        recipe.ingredients.length + ' ingrediënten'
      const repeats = document.createElement('input')
      repeats.type = 'number'
      repeats.min = '1'
      repeats.max = '7'
      repeats.step = '1'
      repeats.value = '1'
      repeats.setAttribute('aria-label', 'Aantal bereidingen van ' + recipe.title)
      repeats.dataset.recipeRepeats = recipe.id
      card.append(selected, caption, repeats)
      choices.append(card)
    }
    convertButton.disabled = ready.length === 0
    setStatus(ready.length + ' eigen recepten met volledig beoordeelde metrische ingrediënten beschikbaar. ' +
      (snapshot.recipes.length - ready.length) + ' recepten hebben nog onopgeloste hoeveelheden, porties of reviewwaarschuwingen. ' +
      'Vink maximaal zeven bereidingen aan; herhalingen tellen mee voor het echte aantal maaltijden.',
    ready.length === 0)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Kan lokale eigen recepten niet lezen.', true)
  }
})

convertButton.addEventListener('click', () => {
  try {
    const latest = readRecipeLibrary(window.localStorage)
    if (latest.error || latest.raw !== libraryRaw || !loaded.length) {
      throw Error('De eigen recepten zijn gewijzigd. Laad ze opnieuw vóór omzetten.')
    }
    const recipes = []
    const plan: { day: string; recipeId: string }[] = []
    const activeDays: string[] = []
    let count = 0
    for (const recipe of loaded) {
      const card = Array.from(choices.children).find(item =>
        item.querySelector<HTMLInputElement>('input[type="checkbox"]')?.dataset.recipeSelected === recipe.id)
      const checked = card?.querySelector<HTMLInputElement>('input[type="checkbox"]')
      if (!checked?.checked) continue
      const repeatsInput = card?.querySelector<HTMLInputElement>('input[type="number"]')
      const times = Number(repeatsInput?.value)
      if (!repeatsInput || !/^[1-7]$/.test(repeatsInput.value) || !Number.isSafeInteger(times)) {
        throw Error('Gebruik een volledig aantal bereidingen van 1 tot 7.')
      }
      const reviewed = toPlannerRecipe(recipe)
      if (!reviewed || recipe.warnings.length || reviewed.ingredients.some(item =>
          item.amount === null || !units.includes(item.unit) ||
          !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000)) {
        throw Error('Een eigen recept vereist nog menselijke metrische controle in Mijn recepten.')
      }
      count += times
      if (count > 7) throw Error('Kies maximaal zeven bereidingen bij elkaar.')
      recipes.push(reviewed)
      for (let index = 0; index < times; index++) {
        const day = 'Eigen maaltijd ' + String(activeDays.length + 1)
        activeDays.push(day)
        plan.push({ day, recipeId: reviewed.id })
      }
    }
    if (!count) throw Error('Vink minstens één gecontroleerd eigen recept aan.')
    const ingredients = aggregatePlanIngredients(plan, recipes, activeDays)
    const safeText = (value: string, limit: number) => value.length > 0 &&
      value.length <= limit && value.trim() === value && /[\p{L}\p{N}]/u.test(value) &&
      !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/^[=+@-]/u.test(value)
    if (!ingredients.length || ingredients.length > 200 || ingredients.some(item =>
      !safeText(item.id, 100) || !safeText(item.label, 160) ||
      item.amount === null || !Number.isFinite(item.amount) ||
      item.amount <= 0 || item.amount > 100000 || !units.includes(item.unit))) {
      throw Error('De samengestelde fysieke vraag is ongeldig of groter dan 200 ingrediënten.')
    }
    const demand = {
      schema: 'supa-private-basket-demand-v1',
      selectedMealCount: count,
      ingredients: ingredients.map(item => ({
        id: item.id, label: item.label, amount: item.amount, unit: item.unit,
        productIds: { PLUS: null, DekaMarkt: null },
      })),
    }
    document.dispatchEvent(new CustomEvent('supa:private-planner-demand', { detail: demand }))
    setStatus(count + ' bereidingen omgezet naar ' + ingredients.length +
      ' exacte metrische ingrediëntbehoeften. Iedere winkel-SKU en prijs blijft onbekend ' +
      'tot je de eigen bronartikelen bewust koppelt. Geen gegevens verzonden.')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Eigen recepten konden niet veilig worden omgezet.', true)
  }
})
