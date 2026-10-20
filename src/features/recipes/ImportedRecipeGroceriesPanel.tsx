import { useEffect, useState } from 'react'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { m2InitialPlan } from '../../data/m2Fixture.ts'
import { combinedImportedRecipeGroceries } from './combinedImportedRecipeGroceries.ts'
import { formatOwnRecipeChecklist } from './recipeShoppingChecklist.ts'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv.ts'
import { exportCombinedRecipesPrivateWeek } from './exportCombinedRecipesPrivateWeek.ts'

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
  recipes, recentIds, onEdit,
}: {
  recipes: readonly SavedRecipe[]
  recentIds: readonly string[]
  onEdit: (recipe: SavedRecipe) => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    (recentIds.length ? recentIds : recipes.slice(0, 3).map(recipe => recipe.id)).slice(0, 15))
  const [query, setQuery] = useState('')
  const [startDay, setStartDay] = useState(m2InitialPlan[0].day)
  const [portionsById, setPortionsById] = useState<Record<string, number>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [pendingOnly, setPendingOnly] = useState(false)
  const [feedback, setFeedback] = useState('')
  const selected = recipes.filter(recipe => selectedIds.includes(recipe.id))
  const allPlannerReady = selected.length > 0 && selected.every(recipe =>
    !!toPlannerRecipe(recipe) && (Object.hasOwn(portionsById, recipe.id)
      ? portionsById[recipe.id] === recipe.servings : true))
  const plannerDays = m2InitialPlan.map(meal => meal.day)
  const startDayIndex = plannerDays.indexOf(startDay)
  const plannerAssignments = selected.length <= plannerDays.length && startDayIndex >= 0
    ? selected.map((recipe, index) => ({
        day: plannerDays[(startDayIndex + index) % plannerDays.length],
        recipeId: recipe.id, title: recipe.title, servings: recipe.servings,
        recipeSnapshot: JSON.stringify(recipe),
      })) : []
  const signature = JSON.stringify(selected.map(recipe => [
    recipe.id, portionsById[recipe.id] ?? recipe.servings, recipe.servings,
    recipe.minutes, recipe.warnings,
    recipe.ingredients.map(item => [item.original, item.amount, item.unit, item.reviewReason]),
  ]))
  useEffect(() => { setChecked({}); setFeedback('') }, [signature])
  const result = selected.length
    ? combinedImportedRecipeGroceries(selected, portionsById) : null
  const list = result?.checklist ?? null
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
  const search = query.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const visibleRecipes = search ? recipes.filter(recipe =>
    recipe.title.normalize('NFKC').toLocaleLowerCase('nl').includes(search)) : recipes
  const planSelected = (destination: 'planner' | 'list' | 'basket') => {
    setFeedback('')
    if (!plannerAssignments.length || !allPlannerReady) {
      setFeedback('Voor de gewone Planner: kies maximaal zeven recepten met gecontroleerde ingrediënten, bereidingstijd en oorspronkelijke porties. Bewaar aangepaste porties eerst als eigen receptvariant.')
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
    if (!accepted) setFeedback('De Planner kan één of meer recepten niet meer veilig plaatsen. Open de actuele bibliotheek opnieuw; het bestaande weekmenu blijft behouden.')
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
            : line.amount + ' ' + (line.unit === 'piece' ? 'stuks' : line.unit) + ' ' + line.label}</span>
        </label>
        {(result!.contributorsByLine[line.key]?.length ?? 0) > 1 && <details className="recipe-collection-groceries__sources">
          <summary>Bekijk de hoeveelheden per recept ({result!.contributorsByLine[line.key].length})</summary>
          <ul>{result!.contributorsByLine[line.key].map((source, index) =>
            <li key={index}>
              <strong>{source.recipeTitle}</strong>{' — '}
              {source.amount === null || source.unit === null
                ? 'Hoeveelheid nog controleren'
                : source.amount + ' ' + (source.unit === 'piece' ? 'stuks' : source.unit)}
              <small> · Origineel: {source.original}</small>
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
        {!!plannerAssignments.length && <ol>{plannerAssignments.map(row =>
          <li key={row.recipeId}><strong>{row.day}</strong>: {row.title}
            {' '}({row.servings} porties)</li>)}</ol>}
        {selected.length > plannerDays.length &&
          <p role="status">Je kunt maximaal {plannerDays.length} recepten tegelijk
            over verschillende dagen in de gewone Planner zetten. De privévergelijker
            kan apart maximaal 14 recepten in één fysiek mandje verwerken.</p>}
        {!allPlannerReady && !!selected.length &&
          <p role="status">Eén of meer recepten zijn nog niet klaar voor Planner
            of hebben hier aangepaste porties. Controleer het recept en bewaar
            gewenste andere porties eerst als eigen variant.</p>}
        <div className="recipe-backup-panel__actions">
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length}
            onClick={() => planSelected('planner')}>Plan alle gekozen recepten</button>
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length}
            onClick={() => planSelected('list')}>Plan en open de boodschappenlijst</button>
          <button type="button" disabled={!allPlannerReady || !plannerAssignments.length}
            onClick={() => planSelected('basket')}>Plan en vergelijk mijn winkelbronnen</button>
        </div>
      </section>
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={exportText}>Download gezamenlijke lijst (TXT)</button>
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
      {feedback && <p role="status">{feedback}</p>}
      <small>Dit is uitsluitend een persoonlijke, ongeprijsde lijst. Afvinken blijft
        op dit scherm en bevestigt geen aankoop, prijs of productmatch.</small>
    </>}
  </section>
}
