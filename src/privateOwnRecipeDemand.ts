/** Explicit, read-only local saved-recipe -> canonical offline private demand.
 * No recipe URL fetch, no retailer lookup, no storage writes or inferred prices.
 */
import { aggregatePlanIngredients, type RecipeWithIngredients } from './domain/basket.ts'
import { readRecipeLibrary, type SavedRecipe } from './features/recipes/recipeLibrary.ts'
import { toPlannerRecipe } from './features/recipes/plannerRecipes.ts'

const loadButton = document.querySelector<HTMLButtonElement>('#load-own-recipes')!
const convertButton = document.querySelector<HTMLButtonElement>('#own-recipes-to-demand')!
const status = document.querySelector<HTMLElement>('#own-recipe-status')!
const choices = document.querySelector<HTMLElement>('#own-recipe-choices')!
const units = ['g', 'kg', 'ml', 'l', 'piece']
// Physical fractional pieces (e.g. half an egg) need explicit human review in
// the existing recipe/scaler workflow; never silently mark them basket-ready.
function reviewedForBasket(recipe: SavedRecipe): RecipeWithIngredients | null {
  const reviewed = toPlannerRecipe(recipe)
  if (!reviewed || reviewed.ingredients.some(item =>
    item.unit === 'piece' && item.amount !== null && !Number.isInteger(item.amount))) return null
  return reviewed
}
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
      recipe.warnings.length === 0 && reviewedForBasket(recipe) !== null)
    loaded = ready
    libraryRaw = snapshot.raw
    for (const recipe of ready.slice(0, 100)) {
      const card = document.createElement('label')
      card.className = 'own-recipe-pick-card'
      card.style.display = 'grid'
      card.style.gridTemplateColumns = 'auto minmax(0,1fr) auto'
      card.style.padding = '10px 0'
      card.style.borderBottom = '1px solid #d8e5d9'
      card.style.maxWidth = '100%'
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
      const portions = document.createElement('input')
      portions.type = 'number'
      portions.min = '1'
      portions.max = '100'
      portions.step = '1'
      portions.value = String(recipe.servings ?? 2)
      portions.setAttribute('aria-label', 'Porties per bereiding van ' + recipe.title)
      portions.title = 'Gewenste porties per bereiding (1–100)'
      portions.dataset.recipePortions = recipe.id
      const inputs = [repeats, portions]
      for (const field of inputs) {
        field.style.minWidth = '0'
        field.style.width = '100%'
      }
      const controls = document.createElement('span')
      controls.className = 'own-recipe-pick-controls'
      for (const [name, field] of [['Bereidingen', repeats], ['Porties', portions]] as const) {
        const wrapper = document.createElement('span')
        const title = document.createElement('span')
        title.textContent = name
        title.className = 'own-recipe-pick-caption'
        wrapper.append(title, field)
        controls.append(wrapper)
      }
      card.append(selected, caption, controls)
      choices.append(card)
    }
    convertButton.disabled = ready.length === 0
    setStatus(ready.length + ' eigen recepten met volledig beoordeelde metrische ingrediënten beschikbaar. ' +
      (snapshot.recipes.length - ready.length) + ' recepten vereisen nog metrische hoeveelheden, hele fysieke stuks, porties of menselijke review. ' +
      'Vink maximaal zeven bereidingen aan. De eerste invoer per recept is het aantal bereidingen, de tweede het gewenste aantal porties per bereiding. ' +
      'Porties worden voor de bronmatching opnieuw uit de bevestigde metrische ingrediënten berekend.',
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
      const portionsInput = card?.querySelector<HTMLInputElement>('input[data-recipe-portions]')
      const portions = Number(portionsInput?.value)
      if (!portionsInput || !/^(?:[1-9]|[1-9]\d|100)$/.test(portionsInput.value) ||
          !Number.isSafeInteger(portions)) {
        throw Error('Kies tussen 1 en 100 hele porties per bereiding.')
      }
      const reviewed = reviewedForBasket(recipe)
      if (!reviewed || !Number.isFinite(recipe.servings) || recipe.servings === null ||
          recipe.servings <= 0 || recipe.warnings.length || reviewed.ingredients.some(item =>
          item.amount === null || !units.includes(item.unit) ||
          !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000)) {
        throw Error('Een eigen recept vereist nog menselijke metrische controle in Mijn recepten.')
      }
      count += times
      if (count > 7) throw Error('Kies maximaal zeven bereidingen bij elkaar.')
      // Each selection produces one canonical recipe identity. The normal
      // Supa aggregator then combines repeated preparations and equivalent
      // store demands; never round physical pieces up or infer a package.
      const scaledIngredients = reviewed.ingredients.map(item => {
        const scaled = item.amount! * portions / recipe.servings!
        const rounded = Math.round(scaled * 1000) / 1000
        if (!Number.isFinite(scaled) || scaled <= 0 ||
            !Number.isFinite(rounded) || rounded <= 0 || rounded > 100000 ||
            (item.unit === 'piece' && !Number.isSafeInteger(scaled))) {
          throw Error('Gedeeltelijke stuks of onveilige metrische porties: corrigeer het recept eerst.')
        }
        return { ...item, amount: rounded }
      })
      recipes.push({ ...reviewed, servings: portions, ingredients: scaledIngredients })
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
    // A prior private basket may contain manually admitted physical products.
    // Never destroy those product choices merely because this picker was
    // opened or a portion count changed: ask before replacing accepted demand.
    const existingRows = document.querySelector<HTMLElement>('#lines')
    if (existingRows?.children.length && !window.confirm(
      'Vervang de huidige mandvraag door ' + ingredients.length + ' ingrediënten uit je gekozen eigen recepten? ' +
      'Bestaande PLUS/Deka-productkoppelingen en afvinkstatus voor dat mandje moeten opnieuw worden bevestigd.'
    )) {
      setStatus('Huidig mandje behouden. Je kunt de bereidingen of porties nog aanpassen.')
      return
    }
    document.dispatchEvent(new CustomEvent('supa:private-planner-demand', { detail: demand }))
    setStatus(count + ' bereidingen omgezet naar ' + ingredients.length +
      ' exacte, op jouw gekozen porties geschaalde metrische ingrediëntbehoeften. Iedere winkel-SKU en prijs blijft onbekend ' +
      'tot je de eigen bronartikelen bewust koppelt. Geen gegevens verzonden.')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Eigen recepten konden niet veilig worden omgezet.', true)
  }
})
