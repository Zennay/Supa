import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { readRecipeLibrary, type SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { scaleOwnRecipe } from './scaleOwnRecipe.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { m2InitialPlan } from '../../data/m2Fixture.ts'
import { combinedImportedRecipeGroceries } from './combinedImportedRecipeGroceries.ts'
import type { CaptureRecipeOrigin } from './combinedRecipesCaptureKit.ts'
import { formatOwnRecipeChecklist, personalRecipeShoppingNoteLabels } from './recipeShoppingChecklist.ts'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv.ts'
import { exportCombinedRecipesPrivateWeek } from './exportCombinedRecipesPrivateWeek.ts'
import { readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'
import { exportUnpricedProgress, importUnpricedProgress, unpricedProgressMaxBytes, unpricedProgressStorageKey } from '../comparison/unpricedPlannerProgress.ts'
import { exportRecipeBundleSelection, importRecipeBundleSelection, recipeBundleMaxBytes } from './recipeBundleSelection.ts'

const RecipeWeekCookingMode = lazy(async () => {
  const module = await import('./RecipeWeekCookingMode.tsx')
  return { default: module.RecipeWeekCookingMode }
})

// UI-only discovery, never a synonym mapping or verified retailer-product match.
function searchableIngredient(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl')
}

function savePrivateFile(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  try {
    const link = document.createElement('a')
    link.href = url; link.download = filename
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Session-only combined groceries for the recipes explicitly added by the
 * user. Physical quantities are reviewed independently from shop prices.
 * No automatic store matching, no phantom unit rates, no financial claim.
 */
export function ImportedRecipeGroceriesPanel({
  recipes, recentIds, onEdit, onSavePortionVariants, onAddToOwnList,
}: {
  recipes: readonly SavedRecipe[]
  recentIds: readonly string[]
  onEdit: (recipe: SavedRecipe) => void
  onAddToOwnList?: (labels: readonly string[]) => string | null
  onSavePortionVariants: (changes: readonly {
    recipeId: string; sourceSnapshot: string; portions: number; draftSnapshot: string
  }[]) => SavedRecipe[]
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    [...new Set(recentIds.length
      ? recentIds : recipes.slice(0, 3).map(recipe => recipe.id))]
      .filter(id => recipes.some(recipe => recipe.id === id)).slice(0, 15))
  const [query, setQuery] = useState('')
  const [reuseFirst, setReuseFirst] = useState(false)
  const [startDay, setStartDay] = useState(m2InitialPlan[0].day)
  const [captureTarget, setCaptureTarget] = useState<'both' | 'PLUS' | 'DekaMarkt'>('both')
  const [captureDelimiter, setCaptureDelimiter] = useState<',' | ';' | '\t'>(';')
  const [showCookingMode, setShowCookingMode] = useState(false)
  const [cookingModeOpened, setCookingModeOpened] = useState(false)
  const [copyableCaptureGuide, setCopyableCaptureGuide] = useState<{ identity: string; target: string; text: string } | null>(null)
  const [copyableCaptureSheet, setCopyableCaptureSheet] = useState<{ key: string; text: string } | null>(null)
  const [copyableDayGuide, setCopyableDayGuide] = useState<{ key: string; text: string } | null>(null)
  const [capturePreview, setCapturePreview] = useState<{
    key: string; rows: { csvRow: number; store: string; id: string;
      label: string; amount: number; unit: string; sources: CaptureRecipeOrigin[] }[]
  } | null>(null)
  const [dayOverrides, setDayOverrides] = useState<Record<string, string>>({})
  const [portionsById, setPortionsById] = useState<Record<string, number>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [pendingOnly, setPendingOnly] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [manualCopy, setManualCopy] = useState<{ key: string; text: string } | null>(null)
  const [variantPreview, setVariantPreview] = useState<null | {
    inputKey: string
    changes: { recipeId: string; sourceSnapshot: string; portions: number;
      draftSnapshot: string; draft: UserRecipeDraft }[]
  }>(null)
  // Preserve the actual user's selection order rather than imposing the
  // library's saved-at order on the day plan and combined recipe exports.
  const selected = selectedIds.flatMap(id => {
    const recipe = recipes.find(item => item.id === id)
    return recipe ? [recipe] : []
  })
  function requireLatestOwnedRecipes() {
    // Another tab may have edited or deleted an ingredient after this UI
    // rendered. Never download a field sheet or hand off a priced-demand
    // candidate from a stale recipe snapshot. No saving or extra network work.
    const library = readRecipeLibrary(window.localStorage)
    if (library.error) throw new Error(library.error)
    const current = new Map(library.recipes.map(recipe => [recipe.id, recipe]))
    if (selected.length !== selectedIds.length || selected.some(recipe =>
      !current.has(recipe.id) || JSON.stringify(current.get(recipe.id)) !== JSON.stringify(recipe))) {
      throw new Error('Eén of meer gekozen recepten zijn in een ander tabblad gewijzigd of verwijderd. ' +
        'Heropen de actuele recepten voordat je winkelproducten koppelt of prijzen opneemt.')
    }
  }
  const incomingBatch = recentIds.join('\u001f')
  const lastImportedBatch = useRef(incomingBatch)
  useEffect(() => {
    if (lastImportedBatch.current === incomingBatch) return
    lastImportedBatch.current = incomingBatch
    const available = [...new Set(recentIds)].filter(id =>
      recipes.some(recipe => recipe.id === id)).slice(0, 15)
    if (available.length) {
      // A just-confirmed multi-recipe import should immediately display
      // THOSE new recipes, not an unrelated previously-selected basket.
      setSelectedIds(available)
      setPortionsById({})
      setChecked({})
      setFeedback('Nieuwe recepten geselecteerd voor één ongeprijsde lijst.')
    }
  }, [incomingBatch, recentIds, recipes])
  const allPlannerReady = selected.length > 0 && selected.every(recipe =>
    !!toPlannerRecipe(recipe) && (Object.hasOwn(portionsById, recipe.id)
      ? portionsById[recipe.id] === recipe.servings : true))
  const plannerDays = m2InitialPlan.map(meal => meal.day)
  const startDayIndex = plannerDays.indexOf(startDay)
  const plannerAssignments = selected.length <= plannerDays.length && startDayIndex >= 0
    ? selected.map((recipe, index) => ({
        day: dayOverrides[recipe.id] ?? plannerDays[(startDayIndex + index) % plannerDays.length],
        recipeId: recipe.id, title: recipe.title, servings: recipe.servings,
        recipeSnapshot: JSON.stringify(recipe),
      })) : []
  const plannerDaysDistinct = plannerAssignments.length > 0 &&
    new Set(plannerAssignments.map(assignment => assignment.day)).size === plannerAssignments.length
  // Preserve the user's real cooking-day choices when transferring up to
  // seven recipes to the existing private price mapper. Larger bundles keep
  // its neutral 14-slot labels rather than inventing actual Planner days.
  const privateCookingDays = plannerDaysDistinct
    ? plannerAssignments.map(assignment => assignment.day) : undefined
  const variantInputKey = JSON.stringify(selected.map(recipe =>
    [recipe, Object.hasOwn(portionsById, recipe.id) ? portionsById[recipe.id] : recipe.servings]))
  // A delayed download must also bind the *day assignments*, not just the
  // original recipe bytes and portions: changing Monday to Thursday while a
  // lazy module loads must never silently download the old plan.
  const plannerExportKey = JSON.stringify([variantInputKey, startDay,
    plannerAssignments.map(({ day, recipeId, recipeSnapshot }) =>
      [day, recipeId, recipeSnapshot])])
  const latestPlannerExportKey = useRef(plannerExportKey)
  latestPlannerExportKey.current = plannerExportKey
  useEffect(() => setVariantPreview(null), [variantInputKey])
  const signature = JSON.stringify(selected.map(recipe => [
    recipe.id, portionsById[recipe.id] ?? recipe.servings, recipe.servings,
    recipe.minutes, recipe.warnings,
    recipe.ingredients.map(item => [
      item.original, item.label, item.query, item.amount, item.unit, item.reviewReason,
    ]),
  ]))
  useEffect(() => { setChecked({}); setFeedback('') }, [signature])
  // A checklist tick, a search keystroke, or opening a field-guide preview
  // must not recompute all 15 recipes' metric scaling and canonical groups.
  // The full selection snapshots + explicit portions remain the cache key.
  const result = useMemo(() => selected.length
    ? combinedImportedRecipeGroceries(selected, portionsById) : null,
  // variantInputKey serializes every selected source record and target portion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [variantInputKey])
  const list = result?.checklist ?? null
  // A fully checked *display list* is not necessarily a valid portable basket:
  // the canonical private-week exporter enforces combined whole-piece, source
  // identity and maximum physical-demand limits too. Admit the exact same
  // demand here BEFORE enabling any source handoff or field CSV actions.
  const privateTransfer = useMemo(() => {
    if (!result?.complete || selected.length > 14) return { ready: false, reason: '' }
    try {
      exportCombinedRecipesPrivateWeek(selected, portionsById)
      return { ready: true, reason: '' }
    } catch (cause) {
      return { ready: false, reason: cause instanceof Error ? cause.message :
        'De volledige fysieke weekvraag kan nog niet veilig worden overgedragen.' }
    }
  // Same source-identity + complete flag as the authoritative offline engine.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantInputKey, result?.complete])
  // A valid individual recipe is not sufficient for a combined shopping
  // week: identical physical identities can overflow after aggregation.
  // The ordinary Planner must not accept a bundle that the canonical
  // private basket engine already rejects as unsafe or incomplete.
  const plannerReadyForSelection = allPlannerReady && !!result?.complete &&
    privateTransfer.ready
  // Persist ONLY explicit downloaded checkmarks. Bind them to selected recipe
  // identities, exact current physical amounts and original review warnings.
  // Positional numeric line keys alone are never enough to restore ticks.
  const progressIdentity = JSON.stringify({
    kind: 'supa-owned-recipes-combined-checklist-v1', signature, selectedIds,
    lines: list?.lines.map(line => [line.key, line.original, line.label,
      line.query ?? null, line.amount, line.unit, line.needsReview]) ?? [],
  })
  const latestProgressIdentity = useRef(progressIdentity)
  latestProgressIdentity.current = progressIdentity
  const captureKey = JSON.stringify([progressIdentity, captureTarget, captureDelimiter, privateCookingDays ?? null])
  const latestCaptureKey = useRef(captureKey)
  latestCaptureKey.current = captureKey
  const outstanding = list?.lines.filter(line => line.needsReview).length ?? 0
  const checkedCount = list?.lines.filter(line => !line.needsReview && checked[line.key]).length ?? 0
  const visible = list?.lines.filter(line => !pendingOnly || line.needsReview || !checked[line.key]) ?? []
  const changeSelection = (id: string, include: boolean) => {
    // Deleted recipes from another tab must not occupy invisible selection
    // slots. A restored/imported batch can also contain duplicate IDs.
    if (include && selected.length >= 15 && !selectedIds.includes(id)) {
      setFeedback('Kies maximaal vijftien recepten voor één fysieke boodschappenlijst.')
      return
    }
    setSelectedIds(current => {
      const available = [...new Set(current)].filter(value =>
        recipes.some(recipe => recipe.id === value))
      return include
        ? [...new Set([...available, id])]
        : available.filter(value => value !== id)
    })
    setChecked({}); setFeedback('')
  }
  const moveRecipe = (id: string, direction: -1 | 1) => {
    setSelectedIds(current => {
      const index = current.indexOf(id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
      return reordered
    })
    setChecked({}); setFeedback('')
  }
  // Suggest reuse only for the same canonical physical identity AND label.
  // A matching query+unit with different source labels is a source conflict,
  // not an approved substitution or already available inventory.
  const selectedPhysicalKeys = new Set(selected.flatMap(recipe =>
    (toPlannerRecipe(recipe, { usage: 'unpriced-demand' })?.ingredients ?? [])
      .map(item => JSON.stringify([item.query, item.unit, item.label]))))
  const sharedPhysicalIngredients = (recipe: SavedRecipe): string[] => {
    if (selectedIds.includes(recipe.id) || !selectedPhysicalKeys.size) return []
    const shared = new Map<string, string>()
    for (const ingredient of toPlannerRecipe(recipe, { usage: 'unpriced-demand' })?.ingredients ?? []) {
      const key = JSON.stringify([ingredient.query, ingredient.unit, ingredient.label])
      if (selectedPhysicalKeys.has(key) && !shared.has(key))
        shared.set(key, ingredient.label + ' (' + ingredient.unit + ')')
    }
    return [...shared.values()]
  }
  const reuseCount = (recipe: SavedRecipe) => sharedPhysicalIngredients(recipe).length
  const search = searchableIngredient(query.trim())
  const visibleRecipes = recipes.filter(recipe => !search ||
    [recipe.title, ...recipe.ingredients.flatMap(ingredient =>
      [ingredient.label, ingredient.original, ingredient.query])]
      .some(value => typeof value === 'string' && searchableIngredient(value).includes(search)))
    .sort((a, b) => reuseFirst ? reuseCount(b) - reuseCount(a) : 0)
  const planSelected = (destination: 'planner' | 'list' | 'basket') => {
    setFeedback('')
    if (!plannerAssignments.length || !plannerReadyForSelection || !plannerDaysDistinct) {
      setFeedback('Kies maximaal zeven recepten met gecontroleerde ingrediënten, originele porties en ieder een andere weekdag. ' +
        'De gezamenlijke fysieke weekvraag moet ook volledig geldig zijn. ' +
        (privateTransfer.reason || 'Bewaar afwijkende porties eerst als eigen receptvariant.'))
      return
    }
    const summary = plannerAssignments.map(row =>
      row.day + ': ' + row.title + ' (' + row.servings + ' porties)').join('\n')
    if (!window.confirm('Plan deze recepten voor de gekozen dagen?\n\n' +
      summary + '\n\nBestaande dagkeuzes worden voor deze dagen vervangen. ' +
      'Je huidige winkelbronprijzen zijn geen bewijs voor het nieuwe mandje.')) return
    const accepted = window.dispatchEvent(new CustomEvent('supa-plan-own-recipes', {
      cancelable: true,
      detail: { assignments: plannerAssignments.map(({ day, recipeId, recipeSnapshot }) => ({ day, recipeId, recipeSnapshot })), destination },
    }))
    if (!accepted) setFeedback('Het recept of de beveiligde Planner-opslag is veranderd of niet beschikbaar. De hele batch is geweigerd en het bestaande weekmenu is behouden.')
  }
  function downloadPlanWithGroceries() {
    setFeedback('')
    try {
      if (!plannerReadyForSelection || !plannerDaysDistinct ||
        plannerAssignments.length === 0 || !list?.canCopy)
        throw new Error('Controleer alle ingrediënten, porties en unieke dagen voordat je het weekmenu exporteert.')
      requireLatestOwnedRecipes()
      const byDay = new Map(plannerAssignments.map(row => [row.day, row]))
      const lines = plannerDays.map(day => {
        const assigned = byDay.get(day)
        return day + ': ' + (assigned
          ? assigned.title + ' (' + assigned.servings + ' porties)'
          : 'geen recept gekozen')
      })
      const groceryText = formatOwnRecipeChecklist(list, {}, false)
      const text = ['SUPA · CONCEPTWEEKMENU (NIET OPGESLAGEN)',
        'Gebaseerd op eigen gecontroleerde recepten en gekozen dagen.',
        ...lines, '', 'VOLLEDIGE ONGEPRIJSDE BOODSCHAPPEN',
        groceryText, '',
        'Dit is een concept, geen opgeslagen Planner en geen winkelprijsvergelijking.',
        'Alle SKU’s, winkelprijzen, beschikbaarheid en besparing zijn onbekend.',
      ].join('\n')
      if (new TextEncoder().encode(text).length > 256_000)
        throw new Error('Het complete weekmenu is te groot om als één bestand te downloaden.')
      savePrivateFile('supa-conceptweekmenu-met-boodschappen.txt', text,
        'text/plain;charset=utf-8')
      setFeedback('Het volledige conceptweekmenu en de ongeprijsde boodschappen zijn als één privé-TXT gedownload. ' +
        'Plan de recepten apart met de knop hierboven om je Planner echt te bewaren.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Het complete weekmenu kon niet veilig worden geëxporteerd.')
    }
  }
  async function downloadPrintableRecipeWeek() {
    setFeedback('')
    const expected = plannerExportKey
    try {
      if (!plannerReadyForSelection || !plannerDaysDistinct ||
        plannerAssignments.length === 0 || !list?.canCopy)
        throw new Error('Controleer eerst alle recepten en unieke weekdagen.')
      requireLatestOwnedRecipes()
      const { exportRecipeWeekPrint } = await import('./exportRecipeWeekPrint.ts')
      if (expected !== latestPlannerExportKey.current)
        throw new Error('Recepten of porties zijn intussen veranderd. Maak het plan opnieuw.')
      requireLatestOwnedRecipes()
      const html = exportRecipeWeekPrint(plannerAssignments, selected, plannerDays, list)
      savePrivateFile('supa-conceptweekmenu-met-recepten.html', html,
        'text/html;charset=utf-8')
      setFeedback('Het printbare conceptweekmenu met bereidingen en volledige ongeprijsde lijst is lokaal gedownload. ' +
        'Open de HTML op je apparaat om te printen. De gewone Planner is niet gewijzigd.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Het printbare weekmenu kon niet veilig worden gemaakt.')
    }
  }
  async function downloadDayGroceryOrigin() {
    setFeedback('')
    const expected = plannerExportKey
    try {
      if (!plannerReadyForSelection || !plannerDaysDistinct ||
        plannerAssignments.length === 0 || !result?.complete)
        throw new Error('Controleer eerst alle ingrediënten en kies voor elk recept een eigen dag.')
      requireLatestOwnedRecipes()
      const { formatRecipeWeekShoppingByDay } = await import('./formatRecipeWeekShoppingByDay.ts')
      if (expected !== latestPlannerExportKey.current)
        throw new Error('De recepten of porties zijn intussen veranderd. Probeer opnieuw.')
      requireLatestOwnedRecipes()
      const text = formatRecipeWeekShoppingByDay(result, plannerAssignments)
      savePrivateFile('supa-weekboodschappen-per-kookdag.txt',
        text, 'text/plain;charset=utf-8')
      setFeedback('De complete ongeprijsde weeklijst met oorspronkelijke receptbijdragen per kookdag is opgeslagen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'De boodschappen per kookdag konden niet veilig worden gemaakt.')
    }
  }
  async function copyDayGroceryGuide() {
    setFeedback('')
    setCopyableDayGuide(null)
    const expected = plannerExportKey
    try {
      if (!plannerReadyForSelection || !plannerDaysDistinct ||
          plannerAssignments.length === 0 || !result?.complete)
        throw new Error('Controleer eerst de oorspronkelijke receptporties en kookdagen.')
      requireLatestOwnedRecipes()
      const { formatRecipeWeekShoppingByDay } = await import('./formatRecipeWeekShoppingByDay.ts')
      if (expected !== latestPlannerExportKey.current)
        throw new Error('De recepten of weekdagen zijn gewijzigd. Maak de tekst opnieuw.')
      requireLatestOwnedRecipes()
      const guide = formatRecipeWeekShoppingByDay(result, plannerAssignments)
      if (expected !== latestPlannerExportKey.current)
        throw new Error('De receptenbundel is gewijzigd. Open de nieuwe gids.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(guide)
          if (expected !== latestPlannerExportKey.current)
            throw new Error('De recepten veranderden tijdens kopiëren. Kopieer het actuele weekmenu opnieuw.')
          requireLatestOwnedRecipes()
          setFeedback('De volledige ongeprijsde kookdag-boodschappengids is gekopieerd. Receptbijdragen zijn geen extra aankopen.')
          return
        } catch { /* Fall back to manually selectable, local-only text. */ }
      }
      if (expected !== latestPlannerExportKey.current)
        throw new Error('Je kookdagen zijn gewijzigd. Maak de actuele gids opnieuw.')
      requireLatestOwnedRecipes()
      setCopyableDayGuide({ key: expected, text: guide })
      setFeedback('Klembord niet beschikbaar. Selecteer hieronder je volledige ongeprijsde kookdag-gids.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De kookdag-gids is niet beschikbaar.')
    }
  }
  async function downloadDayGroceryCsv() {
    setFeedback('')
    const expected = plannerExportKey
    try {
      if (!plannerReadyForSelection || !plannerDaysDistinct ||
          plannerAssignments.length === 0 || !result?.complete)
        throw new Error('Kies geldige porties en unieke weekdagen voordat je de kookdag-CSV maakt.')
      requireLatestOwnedRecipes()
      const { exportRecipeWeekShoppingByDayCsv } = await import('./formatRecipeWeekShoppingByDay.ts')
      if (expected !== latestPlannerExportKey.current)
        throw new Error('De recepten, porties of dagen zijn veranderd. Maak de CSV opnieuw.')
      requireLatestOwnedRecipes()
      const csv = exportRecipeWeekShoppingByDayCsv(result, plannerAssignments)
      if (expected !== latestPlannerExportKey.current)
        throw new Error('De weekindeling is veranderd. Download de actuele CSV.')
      savePrivateFile('supa-weekboodschappen-met-receptbijdragen.csv',
        '\uFEFF' + csv, 'text/csv;charset=utf-8')
      setFeedback('De ongeprijsde kookdag-CSV is lokaal opgeslagen. Alleen Totaal-regels zijn boodschappen; bijdragen zijn geen extra aankopen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'De kookdag-CSV kon niet veilig worden gemaakt.')
    }
  }
  const changedPortions = selected.filter(recipe =>
    Object.hasOwn(portionsById, recipe.id) &&
    portionsById[recipe.id] !== recipe.servings)
  const previewVariants = () => {
    setFeedback('')
    setVariantPreview(null)
    try {
      if (!changedPortions.length) throw new Error('Kies eerst bij minimaal één recept een ander heel aantal porties.')
      const changes = changedPortions.map(recipe => {
        const portions = portionsById[recipe.id]
        const draft = scaleOwnRecipe(recipe, portions)
        return {
          recipeId: recipe.id, sourceSnapshot: JSON.stringify(recipe), portions,
          draftSnapshot: JSON.stringify(draft), draft,
        }
      })
      setVariantPreview({ inputKey: variantInputKey, changes })
      setFeedback('Bekijk alle omgerekende hoeveelheden. Er zijn nog geen varianten bewaard.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De gekozen porties kunnen niet veilig worden omgerekend.')
    }
  }
  const saveVariants = () => {
    setFeedback('')
    try {
      if (!variantPreview || variantPreview.inputKey !== variantInputKey)
        throw new Error('De recepten of porties zijn gewijzigd. Controleer het voorbeeld opnieuw.')
      const created = onSavePortionVariants(variantPreview.changes.map(({
        recipeId, sourceSnapshot, portions, draftSnapshot,
      }) => ({ recipeId, sourceSnapshot, portions, draftSnapshot })))
      const variantsByOriginal = new Map(
        variantPreview.changes.map((change, index) => [change.recipeId, created[index].id]))
      setSelectedIds(ids => ids.map(id => variantsByOriginal.get(id) ?? id))
      // Preserve the explicitly chosen weekday when the source recipe is
      // replaced by its new saved portion variant.
      setDayOverrides(previous => Object.fromEntries(
        Object.entries(previous).map(([id, day]) =>
          [variantsByOriginal.get(id) ?? id, day])))
      setPortionsById({})
      setChecked({})
      setVariantPreview(null)
      setFeedback(created.length + ' nieuwe metrische receptvarianten samen opgeslagen. ' +
        'De varianten zijn geselecteerd; controleer de weekdagen en plan ze hieronder. ' +
        'Bestaande originele recepten en winkelprijzen zijn niet gewijzigd.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Varianten zijn niet opgeslagen. De originele recepten blijven behouden.')
    }
  }
  const currentCopyKey = JSON.stringify([progressIdentity, checked, pendingOnly])
  const latestCopyKey = useRef(currentCopyKey)
  latestCopyKey.current = currentCopyKey
  const readyLineKeys = list?.lines.filter(line => !line.needsReview)
    .map(line => line.key) ?? []
  function downloadRecipeBundle() {
    setFeedback('')
    try {
      requireLatestOwnedRecipes()
      const json = exportRecipeBundleSelection(selected, portionsById,
        dayOverrides, startDay, plannerDays)
      savePrivateFile('supa-prive-receptenselectie.json', json,
        'application/json;charset=utf-8')
      setFeedback('Je gekozen recepten, porties en weekdagen zijn als privébestand opgeslagen. ' +
        'Winkelproducten, vinkjes en prijzen zijn niet meegenomen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Je receptenkeuze kon niet veilig worden opgeslagen.')
    }
  }

  async function restoreRecipeBundle(file: File | null) {
    if (!file) return
    setFeedback('')
    const before = JSON.stringify(recipes)
    try {
      if (file.size < 1 || file.size > recipeBundleMaxBytes)
        throw new Error('Kies een privé-receptenselectie van maximaal 256 kB.')
      const json = await file.text()
      if (JSON.stringify(recipes) !== before)
        throw new Error('Je receptenbibliotheek is intussen veranderd. Open het bestand opnieuw.')
      const library = readRecipeLibrary(window.localStorage)
      if (library.error) throw new Error(library.error)
      const bundle = importRecipeBundleSelection(json, library.recipes, plannerDays)
      if (bundle.selectedIds.some(id => {
        const current = library.recipes.find(recipe => recipe.id === id)
        const visible = recipes.find(recipe => recipe.id === id)
        return !current || !visible || JSON.stringify(current) !== JSON.stringify(visible)
      })) throw new Error('De recepten op dit scherm zijn verouderd. Heropen eerst de bibliotheek.')
      if (!window.confirm('Vervang je huidige receptselectie, gewenste porties en weekdagen ' +
        'door de gecontroleerde selectie uit dit privébestand? Je recepten, ' +
        'winkelbronnen en reeds opgeslagen Planner blijven ongewijzigd.')) return
      const latest = readRecipeLibrary(window.localStorage)
      if (latest.error || bundle.selectedIds.some(id => {
        const original = library.recipes.find(recipe => recipe.id === id)
        const current = latest.recipes.find(recipe => recipe.id === id)
        return !original || !current || JSON.stringify(original) !== JSON.stringify(current)
      }) || JSON.stringify(recipes) !== before)
        throw new Error('Een recept is ondertussen gewijzigd; de huidige selectie blijft behouden.')
      setSelectedIds(bundle.selectedIds)
      setPortionsById(bundle.portionsById)
      setDayOverrides(bundle.dayOverrides)
      setStartDay(bundle.startDay)
      setChecked({})
      setVariantPreview(null)
      setFeedback('Privé-receptenselectie hersteld: ' + bundle.selectedIds.length +
        ' recepten, gekozen porties en weekdagen. Controleer het plan opnieuw. ' +
        'Geen winkelprijzen, matches of Planner-dagen zijn overgenomen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Het privébestand is geweigerd. De huidige selectie is behouden.')
    }
  }

  async function restoreChecks(file: File | null) {
    if (!file || !list?.canCopy) return
    setFeedback('')
    const expected = progressIdentity
    try {
      if (file.size < 1 || file.size > unpricedProgressMaxBytes)
        throw new Error('Kies een privé-Supa-afvinkingenbestand van maximaal 128 kB.')
      const text = await file.text()
      if (latestProgressIdentity.current !== expected)
        throw new Error('De geselecteerde recepten of hoeveelheden zijn veranderd. Kies de back-up opnieuw.')
      // Reuse the strict own-demand restore contract. Reviewed/unknown rows
      // cannot become checked through a crafted, user-imported JSON record.
      const recovered = importUnpricedProgress(text, expected, readyLineKeys)
      const count = Object.keys(recovered).length
      if (!window.confirm(`Herstel ${count} afgevinkte boodschappen voor exact deze recepten en porties? ` +
        'Je huidige vinkjes worden vervangen; recepten en prijzen blijven onaangeroerd.')) return
      if (latestProgressIdentity.current !== expected)
        throw new Error('De actuele fysieke boodschappen zijn tussentijds gewijzigd; niets hersteld.')
      setChecked(recovered)
      setFeedback(`${count} afgevinkte boodschappen veilig hersteld voor deze exacte receptenbundel.`)
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Back-up niet herkend; je bestaande vinkjes blijven behouden.')
    }
  }
  const downloadChecks = () => {
    if (!list?.canCopy) return
    try {
      const record = exportUnpricedProgress(progressIdentity,
        readyLineKeys, checked)
      savePrivateFile('supa-receptenbundel-boodschappen-vinkjes.json',
        record, 'application/json;charset=utf-8')
      setFeedback('Je afvinkingen zijn lokaal als privé-JSON opgeslagen, zonder prijzen of winkelgegevens.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Vinkjes opslaan is niet gelukt.')
    }
  }
  function addRemainingToOwnList() {
    if (!onAddToOwnList || !list?.canCopy) return
    try {
      // Confirm that none of the selected originals were replaced in another tab.
      // No new shopping item may inherit the previous recipe's stale quantity.
      requireLatestOwnedRecipes()
      const pending = list.lines.filter(line => line.needsReview || checked[line.key] !== true)
      const labels = personalRecipeShoppingNoteLabels(pending)
      if (!window.confirm('Voeg ' + labels.length +
        ' nog openstaande receptboodschappen toe aan je gewone ongeprijsde Lijst? ' +
        'Bestaande lijstregels en vinkjes blijven bewaard. Controlepunten krijgen geen verzonnen hoeveelheid ' +
        'en er worden geen winkelprijzen of artikelcodes gekoppeld.')) return
      requireLatestOwnedRecipes()
      const error = onAddToOwnList(labels)
      if (error) setFeedback(error)
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'De ongeprijsde receptenboodschappen konden niet worden overgenomen.')
    }
  }

  async function copyGroceries() {
    setFeedback('')
    setManualCopy(null)
    if (!list?.canCopy) return
    const key = currentCopyKey
    try {
      const text = formatOwnRecipeChecklist(list, checked, pendingOnly)
      if (new TextEncoder().encode(text).length > 256_000)
        throw new Error('De gecombineerde lijst is te groot om veilig mobiel te kopiëren.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          if (latestCopyKey.current !== key) {
            setFeedback('De recepten of afvinkingen veranderden tijdens het kopiëren. Kopieer opnieuw voor de actuele lijst.')
          } else {
            setFeedback(pendingOnly
              ? 'Alleen je nog openstaande ongeprijsde boodschappen zijn gekopieerd; dit is geen volledig mandje.'
              : 'De complete ongeprijsde receptenboodschappenlijst is gekopieerd.')
          }
          return
        } catch { /* The same private text can be selected manually below. */ }
      }
      if (latestCopyKey.current !== key)
        throw new Error('De recepten of afvinkingen zijn veranderd. Probeer de actuele lijst opnieuw.')
      setManualCopy({ key, text })
      setFeedback('Klembord niet beschikbaar: selecteer de volledige ongeprijsde lijst hieronder.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De lijst kon niet worden gekopieerd.')
    }
  }
  const exportText = () => {
    if (!list?.canCopy) return
    try {
      savePrivateFile('supa-gecombineerde-boodschappen-ongeprijsd.txt',
        formatOwnRecipeChecklist(list, checked), 'text/plain;charset=utf-8')
      setFeedback('Je ongeprijsde lijst is lokaal opgeslagen. Geen winkels of prijzen toegevoegd.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De tekstlijst kon niet worden opgeslagen.')
    }
  }
  const exportCsv = () => {
    if (!list?.canCopy) return
    try {
      const csv = exportOwnRecipeChecklistCsv(list, checked)
      savePrivateFile('supa-gecombineerde-boodschappen-ongeprijsd.csv',
        '\uFEFF' + csv, 'text/csv;charset=utf-8')
      setFeedback('CSV met fysieke hoeveelheden, controlepunten en onbekende prijzen lokaal opgeslagen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De CSV kon niet worden opgeslagen.')
    }
  }
  async function showCapturePreview() {
    if (!privateTransfer.ready) return
    setFeedback('')
    const key = captureKey
    const target = captureTarget
    try {
      requireLatestOwnedRecipes()
      const { combinedRecipesCaptureKit } = await import('./combinedRecipesCaptureKit.ts')
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De receptenbundel of winkelkeuze veranderde. Bekijk de nieuwe rijen.')
      const stores = target === 'both' ? ['PLUS', 'DekaMarkt'] as const
        : [target as 'PLUS' | 'DekaMarkt']
      const kit = combinedRecipesCaptureKit(selected, portionsById, stores, privateCookingDays, captureDelimiter)
      if (latestCaptureKey.current !== key)
        throw new Error('De fysieke boodschappen veranderden. Bekijk het actuele winkelblad opnieuw.')
      setCapturePreview({ key, rows: kit.rows })
      setFeedback(kit.rows.length + ' lege opname-rijen voorbereid. ' +
        'Alle productcodes, werkelijk waargenomen verpakkingen en winkelprijzen ontbreken bewust.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'De actuele originele bronopname kan niet worden getoond.')
    }
  }
  async function copyCaptureGuide() {
    if (!privateTransfer.ready) return
    setFeedback('')
    setCopyableCaptureGuide(null)
    const identity = captureKey
    const key = captureKey
    const target = captureTarget
    try {
      requireLatestOwnedRecipes()
      const { combinedRecipesCaptureKit } = await import('./combinedRecipesCaptureKit.ts')
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De fysieke receptenbundel veranderde tijdens voorbereiden. Probeer opnieuw.')
      const shops = target === 'both' ? ['PLUS', 'DekaMarkt'] as const
        : [target as 'PLUS' | 'DekaMarkt']
      const content = combinedRecipesCaptureKit(selected, portionsById, shops, privateCookingDays, captureDelimiter).guide
      if (latestCaptureKey.current !== key)
        throw new Error('De fysieke ingrediënten veranderden; kopieer de nieuwe gids.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content)
          if (latestCaptureKey.current === key) {
            requireLatestOwnedRecipes()
            setFeedback('De actuele ongeprijsde opnamegids voor jouw winkelkeuze is gekopieerd.')
          }
          else setFeedback('De recepten veranderden tijdens kopiëren. Maak de nieuwe gids opnieuw.')
          return
        } catch { /* Browser denied clipboard access. Display only own source hints. */ }
      }
      if (latestCaptureKey.current !== key)
        throw new Error('De recepten zijn veranderd. Maak de gids opnieuw.')
      requireLatestOwnedRecipes()
      setCopyableCaptureGuide({ identity, target, text: content })
      setFeedback('Klembordtoegang ontbreekt. Selecteer en kopieer je ongeprijsde rijgids hieronder.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'De opnamegids kon niet worden gekopieerd.')
    }
  }
  async function copyCaptureSheet() {
    if (!privateTransfer.ready) return
    setFeedback('')
    setCopyableCaptureSheet(null)
    const key = captureKey
    const stores = captureTarget === 'both' ? ['PLUS', 'DekaMarkt'] as const : [captureTarget]
    try {
      requireLatestOwnedRecipes()
      const { combinedRecipesCaptureKit } = await import('./combinedRecipesCaptureKit.ts')
      if (latestCaptureKey.current !== key)
        throw new Error('Je winkelkeuze of receptenbundel is gewijzigd. Open het actuele blad opnieuw.')
      requireLatestOwnedRecipes()
      const csv = combinedRecipesCaptureKit(selected, portionsById, stores,
        privateCookingDays, captureDelimiter).csv
      if (new TextEncoder().encode(csv).length > 256_000)
        throw new Error('Dit privé-opnameblad is te groot voor het mobiele klembord.')
      if (latestCaptureKey.current !== key)
        throw new Error('Het opnameblad is gewijzigd. Kopieer de actuele rijen opnieuw.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(csv)
          requireLatestOwnedRecipes()
          if (latestCaptureKey.current !== key)
            throw new Error('Het receptenmandje veranderde tijdens het kopiëren. Kopieer opnieuw.')
          setFeedback('Leeg ' + (captureDelimiter === '\t' ? 'TSV' : 'CSV') +
            '-winkelopnameblad gekopieerd. Vul uitsluitend eigen geobserveerde brongegevens in.')
          return
        } catch {
          // Permission denied or changed content: offer visible manual copy,
          // never upload or silently persist the user's physical basket.
        }
      }
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('Het opnameblad veranderde tijdens het kopiëren. Probeer opnieuw.')
      setCopyableCaptureSheet({ key, text: csv })
      setFeedback('Klembord niet beschikbaar: selecteer hieronder de originele lege CSV/TSV-rijen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Kopiëren van het bronblad is niet gelukt.')
    }
  }
  async function downloadCaptureKit(kind: 'csv' | 'guide') {
    if (!privateTransfer.ready) return
    setFeedback('')
    const key = captureKey
    try {
      requireLatestOwnedRecipes()
      const { combinedRecipesCaptureKit } = await import('./combinedRecipesCaptureKit.ts')
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De receptenbundel is gewijzigd. Maak de winkelopname opnieuw.')
      const stores = captureTarget === 'both' ? ['PLUS', 'DekaMarkt'] as const : [captureTarget]
      const kit = combinedRecipesCaptureKit(selected, portionsById, stores, privateCookingDays, captureDelimiter)
      if (latestCaptureKey.current !== key)
        throw new Error('De fysieke ingrediënten zijn veranderd. Maak het opnameblad opnieuw.')
      // One stable filename stem pairs the blank CSV with its exact row guide.
      // This is only a local document identifier, not source-evidence metadata.
      const fingerprint = unpricedProgressStorageKey(captureKey).split(':').pop()!
      const stem = 'supa-recepten-' + fingerprint + '-' + kit.storeLabel
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De winkelkeuze is gewijzigd. Maak het actuele bronblad opnieuw.')
      const isTsv = captureDelimiter === '\t'
      savePrivateFile(stem + (kind === 'csv' ? '-lege-winkelopname.' + (isTsv ? 'tsv' : 'csv') : '-opnamegids.txt'),
        kind === 'csv' ? kit.csv : kit.guide,
        kind === 'csv' ? (isTsv ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8') : 'text/plain;charset=utf-8')
      setFeedback(kind === 'csv'
        ? 'Leeg importeerbaar CSV/TSV-winkelblad opgeslagen, zonder bronartikelen, tijd of prijzen. Download de bijbehorende rijgids.'
        : 'De bijbehorende rijgids is opgeslagen. Vul alleen werkelijk toegestane en gecontroleerde bronproducten in.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Het lege winkelopnameblad is niet beschikbaar.')
    }
  }
  async function downloadPrintableCaptureKit() {
    if (!privateTransfer.ready) return
    setFeedback('')
    const key = captureKey
    try {
      requireLatestOwnedRecipes()
      const [{ combinedRecipesCaptureKit }, { makePrintablePlannerCaptureHtml }] =
        await Promise.all([
          import('./combinedRecipesCaptureKit.ts'),
          import('../comparison/plannerPriceCapturePrint.ts'),
        ])
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De gekozen recepten of winkels zijn veranderd. Maak het formulier opnieuw.')
      const stores = captureTarget === 'both' ? ['PLUS', 'DekaMarkt'] as const : [captureTarget]
      const kit = combinedRecipesCaptureKit(selected, portionsById, stores, privateCookingDays, captureDelimiter)
      // This canonical capture kit already fixes source demand, CSV row order,
      // store grouping and the physical limits. Use its first store's rows as
      // needs: the existing print engine reproduces those exact row numbers.
      const needs = kit.rows.filter(row => row.store === stores[0]).map(row => ({
        id: row.id, label: row.label, amount: row.amount, unit: row.unit,
      }))
      // The printable capture form and the CSV use the same row IDs, physical
      // amounts and recipe provenance. Only the first store is needed for the
      // per-ingredient legend; the printer repeats it for the second store.
      const recipeLines = kit.rows.filter(row => row.store === stores[0]).map(row =>
        row.sources.map(source => source.recipeTitle +
          (source.cookingDay ? ' [' + source.cookingDay + ']' : '') +
          ' · ' + source.ingredientLabel +
          ' · ' + readablePlannerDemandAmount(source.amount) + ' ' +
          (source.unit === 'piece' ? 'stuks' : source.unit ?? 'eenheid controleren')))
      const html = makePrintablePlannerCaptureHtml(needs, stores, recipeLines)
      requireLatestOwnedRecipes()
      if (latestCaptureKey.current !== key)
        throw new Error('De fysieke weekvraag of winkelkeuze is veranderd.')
      const fingerprint = unpricedProgressStorageKey(captureKey).split(':').pop()!
      savePrivateFile('supa-recepten-' + fingerprint + '-' + kit.storeLabel +
        '-printbare-lege-winkelopname.html', html, 'text/html;charset=utf-8')
      setFeedback('Printbaar offline-formulier voor precies dezelfde CSV-rijen opgeslagen. ' +
        'Open de HTML lokaal en print deze. De originele broncode, prijs, verpakking en echte tijd ' +
        'moet je zelf rechtmatig vastleggen; kopieer ze daarna in het bijbehorende lege CSV.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message :
        'Het printbare formulier is niet beschikbaar. De winkelprijzen blijven onbekend.')
    }
  }
  const exportForStores = () => {
    if (!list?.canCopy) return
    try {
      requireLatestOwnedRecipes()
      const json = exportCombinedRecipesPrivateWeek(selected, portionsById, privateCookingDays)
      savePrivateFile('supa-meerdere-recepten-privewinkelmandje.json',
        json, 'application/json;charset=utf-8')
      setFeedback('Je fysieke receptenmandje is veilig geëxporteerd, zonder prijzen. Open de privévergelijker en koppel daar je eigen actuele winkelproducten en waarnemingen.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Het fysieke mandje kon niet veilig worden overgedragen.')
    }
  }
  const openInPrivateMatcher = () => {
    if (!list?.canCopy) return
    try {
      requireLatestOwnedRecipes()
      const json = exportCombinedRecipesPrivateWeek(selected, portionsById, privateCookingDays)
      if (!window.confirm('Open dit ongeprijsde mandje in de privéwinkelvergelijker? ' +
        'Je controleert daar eerst alle fysieke ingrediënten en bevestigt daarna zelf de bronproducten. ' +
        'Oude winkelprijzen en artikelkeuzes worden niet automatisch meegenomen.')) return
      const handoffKey = 'supa:private-planner-week-handoff:v1'
      const previous = window.sessionStorage.getItem(handoffKey)
      if (previous !== null && previous !== json) {
        if (!window.confirm('Er staat al een ander privéweekmenu klaar voor de winkelvergelijker. ' +
          'Wil je deze nog niet gebruikte overdracht bewust vervangen door je nieuwe receptenbundel? ' +
          'Je oorspronkelijke receptenbibliotheek en eventuele ingevoerde winkelprijzen veranderen niet.')) {
          setFeedback('De eerdere privéweekmenu-overdracht is bewaard. Download desgewenst de nieuwe JSON apart.')
          return
        }
        if (window.sessionStorage.getItem(handoffKey) !== previous)
          throw new Error('De vorige weekmenu-overdracht is gewijzigd. Controleer opnieuw voordat je overschrijft.')
      }
      requireLatestOwnedRecipes()
      window.sessionStorage.setItem(handoffKey, json)
      window.location.assign(import.meta.env.BASE_URL + 'private-basket-mapping.html')
    } catch (cause) {
      setFeedback((cause instanceof Error ? cause.message : 'Directe overdracht niet beschikbaar.') +
        ' Download het JSON-bestand en importeer dit handmatig als weekmenu in de privévergelijker.')
    }
  }
  return <section className="recipe-collection-groceries" aria-label="Gecombineerde ongeprijsde boodschappenlijst">
    <h3>Één boodschappenlijst voor je nieuwe recepten</h3>
    <p>Kies welke recepten je samen wilt koken. Dezelfde duidelijke ingrediënten en
      metrische eenheden worden samengevoegd. Alle hoeveelheden zijn voor de
      gewenste porties per recept. Gedeeltelijke fysieke stuks blijven handmatig
      te beoordelen. Producten, verpakkingsprijzen en besparingen blijven
      onbekend tot je eigen winkelbronnen controleert.</p>
    <label className="recipe-collection-label">Zoek recepten op naam of ingrediënt
      <input type="search" maxLength={120} value={query}
        placeholder="Bijvoorbeeld rijst, paprika of pastasaus"
        onChange={event => setQuery(event.currentTarget.value)} />
    </label>
    <label className="recipe-collection-groceries__reuse-filter">
      <input type="checkbox" checked={reuseFirst}
        onChange={event => setReuseFirst(event.currentTarget.checked)} />
      Toon recepten met gedeelde gecontroleerde ingrediënten eerst
    </label>
    <small>{selected.length} van {recipes.length} recepten gekozen (maximaal 15).
      {search ? ' ' + visibleRecipes.length + ' recepten gevonden.' : ''}
      {' '}Zoeken en sorteren wijzigen je gekozen recepten of hoeveelheden niet.
      Overeenkomende ingrediënten zijn alleen een hergebruikhint, geen voorraad- of prijsbewijs.</small>
    {selected.length > 1 && <div className="recipe-collection-groceries__order"
      role="group" aria-label="Volgorde van gekozen recepten">
      <strong>Volgorde voor het weekmenu en de gecombineerde lijst</strong>
      <ol>{selected.map((recipe, index) => <li key={recipe.id}>
        <span>{recipe.title}</span>
        <div>
          <button type="button" disabled={index === 0}
            aria-label={'Verplaats ' + recipe.title + ' omhoog'}
            onClick={() => moveRecipe(recipe.id, -1)}>↑</button>
          <button type="button" disabled={index === selected.length - 1}
            aria-label={'Verplaats ' + recipe.title + ' omlaag'}
            onClick={() => moveRecipe(recipe.id, 1)}>↓</button>
        </div>
      </li>)}</ol>
    </div>}
    <div className="recipe-collection-groceries__recipes" role="group" aria-label="Recepten combineren">
      {visibleRecipes.map(recipe => <div key={recipe.id}
        className="recipe-collection-groceries__recipe">
        <label>
          <input type="checkbox" checked={selectedIds.includes(recipe.id)}
            onChange={event => changeSelection(recipe.id, event.currentTarget.checked)} />
          {recipe.title}
        </label>
        {reuseCount(recipe) > 0 &&
          <small className="recipe-collection-groceries__shared">Deelt {reuseCount(recipe)}
            {' '}gecontroleerde fysieke ingrediënt{reuseCount(recipe) === 1 ? '' : 'en'}
            {' '}met je gekozen recepten: {sharedPhysicalIngredients(recipe).slice(0, 3).join(', ')}
            {reuseCount(recipe) > 3 ? ` en ${reuseCount(recipe) - 3} meer` : ''}.
            {' '}Dit zegt niets over resterende voorraad of voldoende hoeveelheden.</small>}
        {selectedIds.includes(recipe.id) && <label>Gewenste porties
          <input type="number" min="1" max="100" step="1"
            aria-label={'Gewenste porties voor ' + recipe.title}
            value={Object.hasOwn(portionsById, recipe.id)
              ? portionsById[recipe.id] : recipe.servings ?? ''}
            onChange={event => {
              const count = Number(event.currentTarget.value)
              setPortionsById(previous => ({ ...previous, [recipe.id]: count }))
              setChecked({}); setFeedback('')
            }} />
        </label>}
      </div>)}
    </div>
    {!list ? <p role="status">Kies minstens één recept om een gezamenlijke lijst te maken.</p> : <>
      <p role="status"><strong>{result!.recipes} recepten · {list.lines.length} boodschappenregels</strong>.
        {' '}{checkedCount} afgevinkt. {outstanding > 0
          ? outstanding + ' regels vereisen handmatige controle; ze krijgen geen verzonnen hoeveelheid.'
          : 'Alle fysieke hoeveelheden zijn klaar voor een ongeprijsde lijst.'}</p>
      {result!.identityConflicts.length > 0 && <section
        className="recipe-collection-groceries__hold" role="alert"
        aria-label="Dezelfde ingrediëntmatch heeft verschillende originele namen">
        <strong>Herstel eerst deze tegenstrijdige ingrediëntnamen voordat je winkels vergelijkt:</strong>
        <p>Twee recepten gebruiken precies dezelfde fysieke zoekidentiteit en eenheid,
          maar geven het product verschillende namen. De gewone Planner-/prijsengine
          weigert terecht deze onduidelijke samenvoeging. De ongeprijsde lijst
          toont de originele regels ter controle; er wordt niets samengevoegd,
          gekocht of ingeprijsd.</p>
        {result!.identityConflicts.map(conflict => <div key={JSON.stringify([conflict.query, conflict.unit])}>
          <strong>{conflict.query} ({conflict.unit})</strong>
          {conflict.entries.map(entry => <div key={JSON.stringify([entry.recipeId, entry.label])}>
            <span>{entry.recipeTitle}: {entry.label}</span>
            <button type="button" onClick={() => {
              const source = recipes.find(recipe => recipe.id === entry.recipeId)
              if (source) onEdit(source)
            }}>Bewerk dit recept</button>
          </div>)}
        </div>)}
      </section>}
      {result!.heldRecipes.length > 0 && <section className="recipe-collection-groceries__hold">
        <strong>Corrigeer eerst deze recepten voor betrouwbare fysieke hoeveelheden:</strong>
        {selected.filter(recipe => result!.heldRecipeIds.includes(recipe.id)).map(recipe =>
          <div key={recipe.id}>
            <span>{recipe.title}</span>
            <button type="button" onClick={() => onEdit(recipe)}>Controleer recept</button>
          </div>)}
      </section>}
      <div className="recipe-collection-groceries__controls">
        <label><input type="checkbox" checked={pendingOnly}
          onChange={event => setPendingOnly(event.currentTarget.checked)} /> Alleen nog te kopen of controleren</label>
        <button type="button" onClick={() => { setChecked({}); setFeedback('') }}>Wis vinkjes</button>
      </div>
      <ul className="recipe-collection-groceries__lines">{visible.map(line => <li key={line.key}>
        <label>
          <input type="checkbox" checked={!!checked[line.key]} disabled={line.needsReview}
            onChange={event => {
              const value = event.currentTarget.checked
              setChecked(current => ({ ...current, [line.key]: value }))
            }} />
          <span>{line.needsReview
            ? line.original + ' — hoeveelheid controleren'
            : line.amount + ' ' + (line.unit === 'piece' ? 'stuks' : line.unit) + ' ' + line.label}
            {!line.needsReview && line.query && line.query !== line.label.toLocaleLowerCase('nl') &&
              <small className="recipe-collection-groceries__query">
                {' '}Zoekterm voor winkelmatching: {line.query}
              </small>}
          </span>
        </label>
        {(result!.contributorsByLine[line.key]?.length ?? 0) > 1 && <details className="recipe-collection-groceries__sources">
          <summary>Bekijk de oorspronkelijke ingrediëntbijdragen ({result!.contributorsByLine[line.key].length})</summary>
          <ul>{result!.contributorsByLine[line.key].map((source, index) =>
            <li key={index}>
              <strong>{source.recipeTitle}</strong>
              {plannerDaysDistinct && plannerAssignments.some(row => row.recipeId === source.recipeId) &&
                <small>{plannerAssignments.find(row => row.recipeId === source.recipeId)?.day}</small>}
              {' — '}
              {source.amount === null || source.unit === null
                ? 'Hoeveelheid nog controleren'
                : source.amount + ' ' + (source.unit === 'piece' ? 'stuks' : source.unit)}
              <small> · Ingrediënt: {source.ingredientLabel}
                {' '}· Origineel: {source.original}</small>
              <button type="button" onClick={() => {
                const sourceRecipe = recipes.find(recipe => recipe.id === source.recipeId)
                if (sourceRecipe) onEdit(sourceRecipe)
              }} aria-label={'Bewerk ' + source.recipeTitle + ' voor ' + line.label}>
                Bewerk dit recept
              </button>
            </li>)}</ul>
        </details>}
      </li>)}</ul>
      {!visible.length && <p role="status">Alle controleerbare boodschappen zijn afgevinkt.</p>}
      {changedPortions.length > 0 && <section
        className="recipe-collection-groceries__variants"
        aria-label="Afwijkende porties als eigen recepten voor Planner bewaren">
        <h4>Maak eigen Planner-recepten voor je gekozen porties</h4>
        <p>{changedPortions.length} recept(en) hebben hier andere porties dan in je bibliotheek.
          De gezamenlijke boodschappenlijst mag die porties alvast gebruiken, maar Planner
          gebruikt alleen opgeslagen en volledig gecontroleerde fysieke hoeveelheden.
          Bekijk daarom eerst de omgerekende gram/ml en hele stuks.</p>
        <button type="button" onClick={previewVariants}>
          Bekijk {changedPortions.length} nieuwe portievariant(en)
        </button>
        {variantPreview && variantPreview.inputKey === variantInputKey && <>
          <div>{variantPreview.changes.map(change => <details key={change.recipeId}
            className="recipe-collection-groceries__variant">
            <summary>{change.draft.title} · {change.portions} porties ·
              {' '}{change.draft.ingredients.length} ingrediënten</summary>
            <ul>{change.draft.ingredients.map((ingredient, index) =>
              <li key={index}>{ingredient.original}
                {ingredient.reviewReason &&
                  <strong> — Controle nodig: {ingredient.reviewReason}</strong>}</li>)}</ul>
            <small>De originele bron blijft intact; dit is nog geen winkelprijs of match.</small>
          </details>)}</div>
          <div className="recipe-backup-panel__actions">
            <button type="button" onClick={saveVariants}>
              Bevestig en bewaar alle {variantPreview.changes.length} varianten
            </button>
            <button type="button" className="ghost-button"
              onClick={() => setVariantPreview(null)}>Annuleer zonder opslaan</button>
          </div>
        </>}
      </section>}
      <section className="recipe-collection-groceries__week" aria-label="Meerdere eigen recepten samen in mijn Planner zetten">
        <h4>Plan deze recepten als weekmenu</h4>
        <p>Alleen de gekozen dagen worden bijgewerkt. Voor Planner heb je gecontroleerde
          ingrediënten, een bereidingstijd en de opgeslagen originele porties nodig.
          De ongeprijsde lijst hierboven mag wel andere gewenste porties gebruiken.</p>
        <label>Begin op
          <select value={startDay} onChange={event => setStartDay(event.currentTarget.value)}>
            {plannerDays.map(day => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
        {selected.some(recipe => Object.hasOwn(dayOverrides, recipe.id)) &&
          <button type="button" className="ghost-button"
            onClick={() => { setDayOverrides({}); setFeedback('') }}>
            Herstel opeenvolgende dagen vanaf {startDay}
          </button>}
        {!!plannerAssignments.length && <ol>{plannerAssignments.map(row =>
          <li key={row.recipeId}>
            <label className="recipe-collection-groceries__day">
              <span>{row.title} ({row.servings} porties)</span>
              <select aria-label={'Weekdag voor ' + row.title} value={row.day}
                onChange={event => {
                  setDayOverrides(previous => ({ ...previous, [row.recipeId]: event.currentTarget.value }))
                  setFeedback('')
                }}>
                {plannerDays.map(day => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
          </li>)}</ol>}
        {!plannerDaysDistinct && !!plannerAssignments.length &&
          <p role="alert">Twee recepten staan op dezelfde dag. Kies voor elk recept
            een andere dag voordat je het weekmenu vastlegt.</p>}
        {selected.length > plannerDays.length &&
          <p role="status">Je kunt maximaal {plannerDays.length} recepten tegelijk
            over verschillende dagen in de gewone Planner zetten. De privévergelijker
            kan apart maximaal 14 recepten in één fysiek mandje verwerken.</p>}
        {!plannerReadyForSelection && !!selected.length &&
          <p role="status">Eén of meer recepten zijn nog niet klaar voor Planner,
            hebben hier aangepaste porties of vormen samen een onvolledige fysieke weekvraag.
            Controleer het recept en bewaar gewenste andere porties eerst als eigen variant.
            {privateTransfer.reason && <> Reden: {privateTransfer.reason}</>}
            De ongeprijsde boodschappenlijst blijft bruikbaar.</p>}
        <div className="recipe-backup-panel__actions">
          <button type="button" disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('planner')}>Plan alle gekozen recepten</button>
          <button type="button" disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('list')}>Plan en open de boodschappenlijst</button>
          <button type="button" disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('basket')}>Plan en vergelijk mijn winkelbronnen</button>
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={downloadPlanWithGroceries}>
            Download conceptweekmenu + volledige boodschappen (TXT)
          </button>
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => void downloadPrintableRecipeWeek()}>
            Download printbaar weekmenu + bereidingsstappen (HTML)
          </button>
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => void downloadDayGroceryOrigin()}>
            Download weekboodschappen met receptbijdragen per dag (TXT)
          </button>
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => void downloadDayGroceryCsv()}>
            Download weekboodschappen met receptbijdragen (CSV)
          </button>
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => void copyDayGroceryGuide()}>
            Kopieer mijn weekboodschappen per kookdag (mobiel)
          </button>
        </div>
        {copyableDayGuide?.key === plannerExportKey && <label
          className="recipe-collection-groceries__mobile-copy">
          Selecteer en kopieer je volledige ongeprijsde kookdag-boodschappen
          <textarea readOnly rows={12} value={copyableDayGuide.text}
            onFocus={event => {
              if (copyableDayGuide.key === latestPlannerExportKey.current)
                event.currentTarget.select()
            }} />
        </label>}
        <div className="recipe-backup-panel__actions">
          <button type="button" className="ghost-button"
            disabled={!plannerReadyForSelection || !plannerAssignments.length || !plannerDaysDistinct}
            aria-expanded={showCookingMode}
            onClick={() => {
              setCookingModeOpened(true)
              setShowCookingMode(current => !current)
            }}>
            {showCookingMode ? 'Sluit kookmodus' : 'Start kookmodus voor deze week'}
          </button>
        </div>
        {cookingModeOpened && plannerReadyForSelection && plannerDaysDistinct && (
          // Keep this exact week component mounted when temporarily collapsed.
          // Its ticks remain volatile and are intentionally discarded on a
          // genuinely different week, page unload or unmount. No persistence.
          <div hidden={!showCookingMode} aria-hidden={!showCookingMode}>
            <Suspense fallback={<p role="status">Kookmodus openen…</p>}>
              <RecipeWeekCookingMode key={plannerExportKey} assignments={plannerAssignments}
                recipes={selected} days={plannerDays} />
            </Suspense>
          </div>
        )}
      </section>
      <section className="recipe-collection-groceries__week"
        aria-label="Mijn receptenkeuze privé bewaren of herstellen">
        <h4>Bewaar deze receptenkeuze voor later</h4>
        <p>Neem je gekozen recepten, volgorde, porties en weekdagen mee als een lokaal privébestand.
          Herstellen werkt alleen wanneer precies dezelfde originele recepten nog in je eigen
          bibliotheek staan. Je winkelprijzen, vinkjes en bestaande Planner worden niet gewijzigd.</p>
        <div className="recipe-backup-panel__actions">
          <button type="button" onClick={downloadRecipeBundle}>
            Download receptenkeuze (JSON)
          </button>
          <label className="recipe-collection-groceries__restore">Herstel receptenkeuze (JSON)
            <input type="file" accept="application/json,.json" onChange={event => {
              const file = event.currentTarget.files?.[0] ?? null
              event.currentTarget.value = ''
              void restoreRecipeBundle(file)
            }} />
          </label>
        </div>
      </section>
      <section className="recipe-collection-groceries__capture" aria-label="Eigen fysieke receptenboodschappen in PLUS en DekaMarkt opnemen">
        <h4>Zelf echte winkelprijzen opnemen voor dit receptenmandje</h4>
        <p>Gebruik exact dezelfde gecontroleerde ingrediënten als in je privéwinkelmandje.
          Open je mandje rechtstreeks in de bestaande privévergelijker, bevestig daar eerst
          je oorspronkelijke fysieke behoefte en vul daarna zelf je echt waargenomen winkelproducten
          in. Je kunt er de oorspronkelijke ingrediënten en hoeveelheden naast de handmatige
          prijsinvoer blijven doorzoeken. Een tweede route is het lege negenkoloms CSV-blad met
          bijbehorende opnamegids downloaden, zelf invullen en in de privévergelijker importeren.
          Koppel vervolgens uitsluitend de werkelijk en rechtmatig gecontroleerde
          PLUS/DekaMarkt-SKU’s, verpakkingen, opnametijden en pakprijzen. De lege CSV staat
          standaard op beschikbaar=false; bevestig true alleen bij een echt beschikbaar artikel.
          Zonder twee volledig vergelijkbare actuele winkelmandjes blijft een prijsverschil onbekend.</p>
        <label>Winkel(s) voor de lege opname
          <select value={captureTarget}
            onChange={event => setCaptureTarget(event.currentTarget.value as typeof captureTarget)}>
            <option value="both">PLUS en DekaMarkt</option>
            <option value="PLUS">Alleen PLUS</option>
            <option value="DekaMarkt">Alleen DekaMarkt</option>
          </select>
        </label>
        <label>Spreadsheetformaat voor jouw eigen bronopname
          <select value={captureDelimiter}
            onChange={event => setCaptureDelimiter(event.currentTarget.value as typeof captureDelimiter)}>
            <option value=";">Nederlandse Excel CSV (puntkomma)</option>
            <option value=",">CSV (komma)</option>
            <option value={'\t'}>TSV (tab)</option>
          </select>
        </label>
        <div className="recipe-backup-panel__actions">
          <button type="button" disabled={!privateTransfer.ready}
            onClick={openInPrivateMatcher}>
            Open mijn mandje en voer echte winkelprijzen in
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void showCapturePreview()}>
            Bekijk exacte winkelopnameregels
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void downloadCaptureKit('csv')}>
            Download leeg winkelinvulblad (CSV/TSV)
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void copyCaptureSheet()}>
            Kopieer leeg winkelinvulblad (mobiel)
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void downloadPrintableCaptureKit()}>
            Download printbaar opnameformulier (HTML)
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void downloadCaptureKit('guide')}>
            Download bijbehorende opnamegids (TXT)
          </button>
          <button type="button" disabled={!privateTransfer.ready}
            onClick={() => void copyCaptureGuide()}>
            Kopieer opnamegids (mobiel)
          </button>
        </div>
        {capturePreview?.key === captureKey && <details open
          className="recipe-collection-groceries__capture-preview">
          <summary>Dezelfde {capturePreview.rows.length} fysieke rijen als in het lege CSV/TSV-bronblad</summary>
          <p>Alleen jouw exacte gekozen ingrediënten en hoeveelheden worden weergegeven.
            Een benodigde hoeveelheid is <strong>geen</strong> gemeten winkelverpakking.
            De originele SKU, bronmomenten, echte pakprijzen en productmatches
            blijven onbekend tot je die zelf in de bestaande import controleert.</p>
          <div className="recipe-collection-groceries__capture-scroll">
            <table>
              <thead><tr><th scope="col">CSV-rij</th><th scope="col">Winkel</th>
                <th scope="col">Originele fysieke vraag</th><th scope="col">Herkomst receptregels</th>
                <th scope="col">Bronproduct en prijs</th></tr></thead>
              <tbody>{capturePreview.rows.map(row => <tr key={JSON.stringify([row.csvRow, row.id])}>
                <td>{row.csvRow}</td><td>{row.store}</td>
                <td>{readablePlannerDemandAmount(row.amount)} {row.unit === 'piece' ? 'stuks' : row.unit} {row.label}</td>
                <td>{row.sources.length > 0
                  ? <details>
                      <summary>{row.sources.length} oorspronkelijke ingrediëntregel(len)</summary>
                      <ul>{row.sources.map((source, index) => <li key={source.recipeId + ':' + index}>
                        <strong>{source.recipeTitle}</strong>
                        {source.cookingDay && <> · {source.cookingDay}</>}: {source.amount === null
                          ? 'hoeveelheid controleren'
                          : readablePlannerDemandAmount(source.amount) + ' ' + (source.unit === 'piece' ? 'stuks' : source.unit)}
                        {' · '}{source.original}
                      </li>)}</ul>
                    </details>
                  : 'Geen herkomst gekoppeld; controleer het recept'}</td>
                <td>Niet opgenomen</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>}
        {copyableCaptureSheet?.key === captureKey &&
          <label className="recipe-collection-groceries__mobile-copy">
            Selecteer en kopieer het lege {captureDelimiter === '\t' ? 'TSV' : 'CSV'}-winkelinvulblad
            <textarea rows={12} readOnly value={copyableCaptureSheet.text}
              onFocus={event => {
                if (latestCaptureKey.current === captureKey) event.currentTarget.select()
              }} />
          </label>}
        {copyableCaptureGuide?.identity === captureKey &&
          copyableCaptureGuide.target === captureTarget &&
          <label className="recipe-collection-groceries__mobile-copy">
            Selecteer en kopieer de volledige ongeprijsde winkelopnamegids
            <textarea rows={12} readOnly value={copyableCaptureGuide.text}
              onFocus={event => {
                if (latestCaptureKey.current === captureKey) event.currentTarget.select()
              }} />
          </label>}
        {privateTransfer.reason && <small role="alert">Het bronopnameblad wacht op een geldig
          volledig fysiek mandje: {privateTransfer.reason}</small>}
        {!result!.complete && <small>Controleer de ontbrekende hoeveelheden en recipe-bronnen
          voordat je een fysiek opnamemandje aanmaakt.</small>}
        <small>De twee bestandsnamen dragen dezelfde lokale bundelcode als je selectie gelijk is.
          Deze code is geen retailerrecht, prijswaarneming of onderzoeksbewijs.</small>
      </section>
      <div className="recipe-backup-panel__actions">
        {onAddToOwnList && <button type="button" disabled={!list.canCopy}
          onClick={addRemainingToOwnList}>
          Zet mijn openstaande receptboodschappen rechtstreeks op Lijst
        </button>}
        <button type="button" onClick={() => void copyGroceries()}>
          {pendingOnly ? 'Kopieer alleen openstaande boodschappen (mobiel)' : 'Kopieer volledige lijst (mobiel)'}
        </button>
        <button type="button" onClick={exportText}>Download gezamenlijke lijst (TXT)</button>
        <button type="button" onClick={downloadChecks}>
          Bewaar mijn afvinkingen (JSON)
        </button>
        <label className="recipe-collection-groceries__restore">Herstel mijn afvinkingen (JSON)
          <input type="file" accept="application/json,.json" onChange={event => {
            const file = event.currentTarget.files?.[0] ?? null
            event.currentTarget.value = ''
            void restoreChecks(file)
          }} />
        </label>
        <button type="button" onClick={exportCsv}
          disabled={list.lines.length > 80}>Download gezamenlijke lijst (CSV)</button>

        <button type="button" onClick={exportForStores}
          disabled={!privateTransfer.ready}>
          Gebruik deze recepten in de privéwinkelvergelijker (JSON)
        </button>
      </div>
      {privateTransfer.reason && <p role="alert" className="recipe-collection-groceries__transfer-error">
        Deze receptenlijst blijft ongeprijsd bruikbaar, maar de officiële fysieke mand-overdracht
        is nog niet mogelijk: {privateTransfer.reason} Controleer de ingrediënten en gekozen porties.
      </p>}
      {selected.length > 14 && <small>De bestaande privévergelijker accepteert maximaal
        14 recepten per mandje. Deselecteer één recept voor de overdracht.</small>}
      {!result!.complete && <small>Corrigeer alle onzekere ingrediënten vóór je dit
        mandje in de prijsvergelijker gebruikt. De ongeprijsde tekstlijst blijft beschikbaar.</small>}
      {privateTransfer.ready && <a
        href={import.meta.env.BASE_URL + 'private-basket-mapping.html#own-recipe-import'}
        target="_blank" rel="noopener noreferrer">
        Of open de bestaande privévergelijker voor handmatige JSON-import
      </a>}
      {list.lines.length > 80 && <small>De veilige CSV-export ondersteunt maximaal
        80 regels. Gebruik de complete TXT-lijst, of selecteer minder recepten.</small>}
      {manualCopy?.key === currentCopyKey && <label
        className="recipe-collection-groceries__mobile-copy">
        {pendingOnly ? 'Selecteer alleen mijn nog openstaande boodschappen — geen volledig mandje'
          : 'Selecteer en kopieer mijn volledige, ongeprijsde boodschappenlijst'}
        <textarea rows={12} readOnly value={manualCopy.text}
          onFocus={event => {
            if (latestCopyKey.current === manualCopy.key) event.currentTarget.select()
          }} />
      </label>}
      {feedback && <p role="status">{feedback}</p>}
      <small>Dit is uitsluitend een persoonlijke, ongeprijsde lijst. Vinkjes blijven
        op dit scherm totdat je zelf een back-up downloadt en later herstelt.
        Terugzetten kan alleen voor exact dezelfde recepten, porties, fysieke ingrediënten
        en controlepunten. Een vinkje bevestigt geen aankoop, prijs of productmatch.</small>
    </>}
  </section>
}
