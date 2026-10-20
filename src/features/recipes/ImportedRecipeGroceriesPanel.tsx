import { useEffect, useRef, useState } from 'react'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { scaleOwnRecipe } from './scaleOwnRecipe.ts'
import type { UserRecipeDraft } from '../../domain/userRecipeImport.ts'
import { m2InitialPlan } from '../../data/m2Fixture.ts'
import { combinedImportedRecipeGroceries } from './combinedImportedRecipeGroceries.ts'
import { formatOwnRecipeChecklist } from './recipeShoppingChecklist.ts'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv.ts'
import { exportCombinedRecipesPrivateWeek } from './exportCombinedRecipesPrivateWeek.ts'
import { exportUnpricedProgress, importUnpricedProgress, unpricedProgressMaxBytes } from '../comparison/unpricedPlannerProgress.ts'

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
  recipes, recentIds, onEdit, onSavePortionVariants,
}: {
  recipes: readonly SavedRecipe[]
  recentIds: readonly string[]
  onEdit: (recipe: SavedRecipe) => void
  onSavePortionVariants: (changes: readonly {
    recipeId: string; sourceSnapshot: string; portions: number; draftSnapshot: string
  }[]) => SavedRecipe[]
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    (recentIds.length ? recentIds : recipes.slice(0, 3).map(recipe => recipe.id)).slice(0, 15))
  const [query, setQuery] = useState('')
  const [startDay, setStartDay] = useState(m2InitialPlan[0].day)
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
  const variantInputKey = JSON.stringify(selected.map(recipe =>
    [recipe, Object.hasOwn(portionsById, recipe.id) ? portionsById[recipe.id] : recipe.servings]))
  useEffect(() => setVariantPreview(null), [variantInputKey])
  const signature = JSON.stringify(selected.map(recipe => [
    recipe.id, portionsById[recipe.id] ?? recipe.servings, recipe.servings,
    recipe.minutes, recipe.warnings,
    recipe.ingredients.map(item => [
      item.original, item.label, item.query, item.amount, item.unit, item.reviewReason,
    ]),
  ]))
  useEffect(() => { setChecked({}); setFeedback('') }, [signature])
  const result = selected.length
    ? combinedImportedRecipeGroceries(selected, portionsById) : null
  const list = result?.checklist ?? null
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
  const outstanding = list?.lines.filter(line => line.needsReview).length ?? 0
  const checkedCount = list?.lines.filter(line => !line.needsReview && checked[line.key]).length ?? 0
  const visible = list?.lines.filter(line => !pendingOnly || line.needsReview || !checked[line.key]) ?? []
  const changeSelection = (id: string, include: boolean) => {
    if (include && selectedIds.length >= 15 && !selectedIds.includes(id)) {
      setFeedback('Kies maximaal vijftien recepten voor één fysieke boodschappenlijst.')
      return
    }
    setSelectedIds(current => include
      ? [...new Set([...current, id])]
      : current.filter(value => value !== id))
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
  const search = query.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const visibleRecipes = search ? recipes.filter(recipe =>
    recipe.title.normalize('NFKC').toLocaleLowerCase('nl').includes(search)) : recipes
  const planSelected = (destination: 'planner' | 'list' | 'basket') => {
    setFeedback('')
    if (!plannerAssignments.length || !allPlannerReady || !plannerDaysDistinct) {
      setFeedback('Kies maximaal zeven recepten met gecontroleerde ingrediënten, originele porties en ieder een andere weekdag. Bewaar afwijkende porties eerst als eigen receptvariant.')
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
  const currentCopyKey = JSON.stringify([progressIdentity, checked])
  const latestCopyKey = useRef(currentCopyKey)
  latestCopyKey.current = currentCopyKey
  const readyLineKeys = list?.lines.filter(line => !line.needsReview)
    .map(line => line.key) ?? []
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
  async function copyGroceries() {
    setFeedback('')
    setManualCopy(null)
    if (!list?.canCopy) return
    const key = currentCopyKey
    try {
      const text = formatOwnRecipeChecklist(list, checked)
      if (new TextEncoder().encode(text).length > 256_000)
        throw new Error('De gecombineerde lijst is te groot om veilig mobiel te kopiëren.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          if (latestCopyKey.current !== key) {
            setFeedback('De recepten of afvinkingen veranderden tijdens het kopiëren. Kopieer opnieuw voor de actuele lijst.')
          } else {
            setFeedback('De complete ongeprijsde receptenboodschappenlijst is gekopieerd.')
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
  const exportForStores = () => {
    if (!list?.canCopy) return
    try {
      const json = exportCombinedRecipesPrivateWeek(selected, portionsById)
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
      const json = exportCombinedRecipesPrivateWeek(selected, portionsById)
      if (!window.confirm('Open dit ongeprijsde mandje in de privéwinkelvergelijker? ' +
        'Je controleert daar eerst alle fysieke ingrediënten en bevestigt daarna zelf de bronproducten. ' +
        'Oude winkelprijzen en artikelkeuzes worden niet automatisch meegenomen.')) return
      window.sessionStorage.setItem('supa:private-planner-week-handoff:v1', json)
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
    <label className="recipe-collection-label">Zoek recept in mijn bibliotheek
      <input type="search" maxLength={120} value={query}
        placeholder="Zoek jouw eigen recepten" onChange={event => setQuery(event.currentTarget.value)} />
    </label>
    <small>{selected.length} van {recipes.length} recepten gekozen (maximaal 15).
      Met zoeken worden gekozen recepten niet ongemerkt verwijderd.</small>
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
      {result!.heldRecipes.length > 0 && <section className="recipe-collection-groceries__hold">
        <strong>Corrigeer eerst deze recepten voor betrouwbare fysieke hoeveelheden:</strong>
        {selected.filter(recipe => result!.heldRecipes.includes(recipe.title)).map(recipe =>
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
          <summary>Bekijk de hoeveelheden per recept ({result!.contributorsByLine[line.key].length})</summary>
          <ul>{result!.contributorsByLine[line.key].map((source, index) =>
            <li key={index}>
              <strong>{source.recipeTitle}</strong>{' — '}
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
        {!allPlannerReady && !!selected.length &&
          <p role="status">Eén of meer recepten zijn nog niet klaar voor Planner
            of hebben hier aangepaste porties. Controleer het recept en bewaar
            gewenste andere porties eerst als eigen variant.</p>}
        <div className="recipe-backup-panel__actions">
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('planner')}>Plan alle gekozen recepten</button>
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('list')}>Plan en open de boodschappenlijst</button>
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length || !plannerDaysDistinct}
            onClick={() => planSelected('basket')}>Plan en vergelijk mijn winkelbronnen</button>
        </div>
      </section>
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={() => void copyGroceries()}>Kopieer gezamenlijke lijst (mobiel)</button>
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
        <button type="button" onClick={openInPrivateMatcher}
          disabled={!result!.complete || selected.length > 14}>
          Vergelijk dit mandje met mijn eigen winkelproducten
        </button>
        <button type="button" onClick={exportForStores}
          disabled={!result!.complete || selected.length > 14}>
          Gebruik deze recepten in de privéwinkelvergelijker (JSON)
        </button>
      </div>
      {selected.length > 14 && <small>De bestaande privévergelijker accepteert maximaal
        14 recepten per mandje. Deselecteer één recept voor de overdracht.</small>}
      {!result!.complete && <small>Corrigeer alle onzekere ingrediënten vóór je dit
        mandje in de prijsvergelijker gebruikt. De ongeprijsde tekstlijst blijft beschikbaar.</small>}
      {result!.complete && selected.length <= 14 && <a
        href={import.meta.env.BASE_URL + 'private-basket-mapping.html#own-recipe-import'}
        target="_blank" rel="noopener noreferrer">
        Of open de bestaande privévergelijker voor handmatige JSON-import
      </a>}
      {list.lines.length > 80 && <small>De veilige CSV-export ondersteunt maximaal
        80 regels. Gebruik de complete TXT-lijst, of selecteer minder recepten.</small>}
      {manualCopy?.key === currentCopyKey && <label
        className="recipe-collection-groceries__mobile-copy">
        Selecteer en kopieer mijn volledige, ongeprijsde boodschappenlijst
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
