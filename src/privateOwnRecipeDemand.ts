/** Explicit, read-only local saved-recipe -> canonical offline private demand.
 * No recipe URL fetch, no retailer lookup, no storage writes or inferred prices.
 */
import { aggregatePlanIngredients, type RecipeWithIngredients } from './domain/basket.ts'
import { readRecipeLibrary, type SavedRecipe } from './features/recipes/recipeLibrary.ts'
import { prepareRecipeBackupImport, RECIPE_BACKUP_MAX_BYTES } from './features/recipes/recipeBackup.ts'
import { toPlannerRecipe } from './features/recipes/plannerRecipes.ts'
import { scaledMetricPortionAmount } from './domain/metricPortionScale.ts'
import type { MetricUnit } from './domain/userRecipeImport.ts'

const loadButton = document.querySelector<HTMLButtonElement>('#load-own-recipes')!
const backupFileInput = document.querySelector<HTMLInputElement>('#own-recipe-backup-file')!
const backupLoadButton = document.querySelector<HTMLButtonElement>('#load-own-recipe-backup')!
const convertButton = document.querySelector<HTMLButtonElement>('#own-recipes-to-demand')!
const status = document.querySelector<HTMLElement>('#own-recipe-status')!
const choices = document.querySelector<HTMLElement>('#own-recipe-choices')!
const reviewNeeded = document.querySelector<HTMLElement>('#own-recipe-review-needed')!
const units = ['g', 'kg', 'ml', 'l', 'piece']
const missingMinutesWarning = 'Bereidingstijd ontbreekt of is onduidelijk'
// Physical fractional pieces (e.g. half an egg) need explicit human review in
// the existing recipe/scaler workflow; never silently mark them basket-ready.
function reviewedForBasket(recipe: SavedRecipe): RecipeWithIngredients | null {
  // Shopping demand needs verified portions and bounded physical quantities,
  // not a prep-time estimate. Keep this eligibility check aligned with the
  // final admission guard so a card cannot look ready and fail only on selection.
  // Unknown duration remains unknown in the dedicated unpriced-demand mode.
  const reviewed = toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
  if (!reviewed || reviewed.ingredients.some(item =>
    item.amount === null || !Number.isFinite(item.amount) || item.amount <= 0 ||
    item.amount > 100000 || !units.includes(item.unit) ||
    (item.unit === 'piece' && !Number.isSafeInteger(item.amount)))) return null
  return reviewed
}
function reviewReasons(recipe: SavedRecipe): string[] {
  const reasons = new Set<string>()
  for (const warning of recipe.warnings) {
    if (warning !== missingMinutesWarning) reasons.add(warning)
  }
  if (!Number.isFinite(recipe.servings) || recipe.servings === null ||
      recipe.servings <= 0 || recipe.servings > 1000) {
    reasons.add('Voer een geldig positief aantal porties in.')
  }
  for (const ingredient of recipe.ingredients) {
    const name = (ingredient.label || ingredient.original || 'Ingrediënt').slice(0, 160)
    const original = typeof ingredient.original === 'string'
      ? ingredient.original.replace(/[\r\n\t\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 180)
      : ''
    const sourceNote = original && original !== name ? ' · originele regel: ' + original : ''
    if (ingredient.reviewReason) {
      reasons.add(name + ': ' + ingredient.reviewReason + sourceNote)
    } else if (ingredient.amount === null || !Number.isFinite(ingredient.amount) ||
        ingredient.amount <= 0 || !units.includes(ingredient.unit ?? '')) {
      reasons.add(name + ': voer een geldige metrische hoeveelheid in.' + sourceNote)
    } else if (ingredient.amount > 100000) {
      reasons.add(name + ': de hoeveelheid is groter dan 100.000; controleer de oorspronkelijke receptregel.' + sourceNote)
    } else if (ingredient.unit === 'piece' && !Number.isSafeInteger(ingredient.amount)) {
      reasons.add(name + ': ' + ingredient.amount + ' stuks is geen veilig heel aantal; corrigeer dit in Mijn recepten.' + sourceNote)
    }
  }
  if (toPlannerRecipe(recipe, { usage: 'unpriced-demand' }) === null && reasons.size === 0) {
    reasons.add('Controleer de receptgegevens en eventuele openstaande bronwaarschuwingen in Mijn recepten.')
  }
  return Array.from(reasons).slice(0, 8)
}

function renderReviewNeeded(recipes: SavedRecipe[]) {
  reviewNeeded.replaceChildren()
  reviewNeeded.hidden = recipes.length === 0
  if (!recipes.length) return
  const heading = document.createElement('h4')
  heading.textContent = 'Recepten die nog controle nodig hebben (' + recipes.length + ')'
  const intro = document.createElement('p')
  intro.textContent = 'Deze recepten worden niet naar een boodschappenmand omgezet totdat de aangegeven hoeveelheden, porties of reviewpunten zijn opgelost. Open Supa → Recepten, corrigeer het recept en laad deze lijst opnieuw.'
  const listContainer = document.createElement('div')
  listContainer.style.display = 'grid'
  listContainer.style.gap = '8px'
  for (const recipe of recipes.slice(0, 100)) {
    const details = document.createElement('details')
    details.style.border = '1px solid #e2d1b2'
    details.style.borderRadius = '9px'
    details.style.padding = '9px 12px'
    const summary = document.createElement('summary')
    summary.style.cursor = 'pointer'
    summary.style.fontWeight = '650'
    const reasons = reviewReasons(recipe)
    summary.textContent = recipe.title + ' · ' + reasons.length + ' controlepunt(en)'
    const reasonsList = document.createElement('ul')
    reasonsList.style.paddingLeft = '22px'
    for (const reason of reasons) {
      const item = document.createElement('li')
      item.textContent = reason
      reasonsList.append(item)
    }
    details.append(summary, reasonsList)
    listContainer.append(details)
  }
  reviewNeeded.append(heading, intro, listContainer)
}

let loaded: SavedRecipe[] = []
let libraryRaw: string | null = null
let selectedSource: 'device' | 'backup' | null = null
let selectedBackupFile: File | null = null
// Ignore obsolete asynchronous file reads when the input, selected source or
// inspected file changes. File contents remain private and are never persisted.
let sourceRevision = 0
const setStatus = (message: string, warning = false) => {
  status.textContent = message
  status.className = 'notice' + (warning ? ' warning' : '')
}

function clearRecipeSelection() {
  loaded = []
  libraryRaw = null
  selectedSource = null
  selectedBackupFile = null
  choices.replaceChildren()
  reviewNeeded.replaceChildren()
  reviewNeeded.hidden = true
  convertButton.disabled = true
}

/** Same picker and physical eligibility regardless of a device or file source. */
function presentRecipes(recipes: SavedRecipe[], sourceLabel: string) {
  if (new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw Error('Deze receptenbron bevat dubbele recept-ID’s; er is geen mandvraag gemaakt.')
  }
  const ready = recipes.filter(recipe =>
    recipe.warnings.every(warning => warning === missingMinutesWarning) &&
    reviewedForBasket(recipe) !== null)
  const held = recipes.filter(recipe => !ready.includes(recipe))
  renderReviewNeeded(held)
  loaded = ready
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
  const missingMinutes = ready.filter(recipe => recipe.warnings.includes(missingMinutesWarning)).length
  setStatus(sourceLabel + ': ' + ready.length + ' gecontroleerde eigen recepten geschikt voor de ongeprijsde boodschappenmand. ' +
    held.length + ' recept(en) wachten op controle; details hieronder. ' +
    (missingMinutes ? missingMinutes + ' recept(en) zonder betrouwbare bereidingstijd kunnen wel naar de boodschappenmand; de tijd blijft onbekend. ' : '') +
    'Vink maximaal zeven bereidingen aan. Per recept kies je het aantal bereidingen en de porties. ' +
    'Alle originele SKU’s en winkelprijzen blijven onbekend totdat jij toegestane bronproducten bewust koppelt.',
  ready.length === 0)
}

backupFileInput.addEventListener('change', () => {
  ++sourceRevision
  // A changed file invalidates an earlier preview immediately; never convert
  // the previous file after the user selects a different private backup.
  if (selectedSource === 'backup') {
    clearRecipeSelection()
    setStatus('Ander back-upbestand gekozen. Controleer het bestand opnieuw vóór omzetting.')
  }
})

loadButton.addEventListener('click', () => {
  ++sourceRevision
  clearRecipeSelection()
  try {
    // Device storage is only accessed on this explicit click. Its raw snapshot
    // is checked again just before emitting the physical shopping demand.
    const snapshot = readRecipeLibrary(window.localStorage)
    if (snapshot.error) throw Error('Jouw receptbibliotheek kan niet veilig worden gelezen. Herstel die eerst in Mijn recepten.')
    presentRecipes(snapshot.recipes, 'Op dit apparaat')
    selectedSource = 'device'
    libraryRaw = snapshot.raw
  } catch (error) {
    clearRecipeSelection()
    setStatus(error instanceof Error ? error.message : 'Kan lokale eigen recepten niet lezen.', true)
  }
})

backupLoadButton.addEventListener('click', async () => {
  const ticket = ++sourceRevision
  clearRecipeSelection()
  const file = backupFileInput.files?.[0]
  if (!file) {
    setStatus('Kies eerst je eigen JSON-receptenback-up.', true)
    return
  }
  if (file.size === 0 || file.size > RECIPE_BACKUP_MAX_BYTES) {
    setStatus('Kies een gevuld eigen receptenbestand van maximaal 2 MB.', true)
    return
  }
  backupLoadButton.disabled = true
  setStatus('Je privé-receptenback-up wordt uitsluitend op dit apparaat gelezen en gecontroleerd.')
  try {
    const raw = await file.text()
    if (ticket !== sourceRevision || backupFileInput.files?.[0] !== file) return
    // Existing strict Supa backup admission: no localStorage write, no remote
    // fetch, no fabricated price; even one malformed record rejects the file.
    const preview = prepareRecipeBackupImport(raw, [])
    if (ticket !== sourceRevision || backupFileInput.files?.[0] !== file) return
    presentRecipes(preview.additions, 'Je gecontroleerde JSON-back-up')
    selectedSource = 'backup'
    selectedBackupFile = file
  } catch (error) {
    if (ticket !== sourceRevision) return
    clearRecipeSelection()
    setStatus(error instanceof Error ? error.message : 'Kan je eigen JSON-back-up niet veilig lezen.', true)
  } finally {
    // Changing the file during an async read cancels the old inspection,
    // but must never leave the explicit import button permanently disabled.
    backupLoadButton.disabled = false
  }
})

convertButton.addEventListener('click', () => {
  try {
    if (!selectedSource || !loaded.length) {
      throw Error('Laad eerst gecontroleerde eigen recepten vanaf je apparaat of back-up.')
    }
    if (selectedSource === 'device') {
      const latest = readRecipeLibrary(window.localStorage)
      if (latest.error || latest.raw !== libraryRaw) {
        throw Error('De eigen recepten zijn in een ander tabblad gewijzigd. Laad ze opnieuw vóór omzetten.')
      }
    } else if (!selectedBackupFile || backupFileInput.files?.[0] !== selectedBackupFile) {
      throw Error('Je back-upselectie is gewijzigd. Controleer opnieuw vóór omzetten.')
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
          recipe.servings <= 0 || recipe.warnings.some(warning => warning !== missingMinutesWarning) || reviewed.ingredients.some(item =>
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
        // Keep the standalone recipe basket identical to Planner and
        // Mijn recepten: exact decimal portions, UP to 0.001 g/ml,
        // never a rounded or fractional physical piece.
        const unit = item.unit
        const scaled = ['g', 'ml', 'piece'].includes(unit)
          ? scaledMetricPortionAmount(
            item.amount!, recipe.servings!, portions, unit as MetricUnit,
          ) : null
        if (scaled === null || scaled > 100000) {
          throw Error('Gedeeltelijke stuks of onveilige metrische porties: corrigeer het recept eerst.')
        }
        return { ...item, amount: scaled }
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
