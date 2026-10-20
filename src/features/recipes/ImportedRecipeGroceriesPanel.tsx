import { useEffect, useState } from 'react'
import type { SavedRecipe } from './recipeLibrary.ts'
import { combinedImportedRecipeGroceries } from './combinedImportedRecipeGroceries.ts'
import { formatOwnRecipeChecklist } from './recipeShoppingChecklist.ts'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv.ts'

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
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [pendingOnly, setPendingOnly] = useState(false)
  const [feedback, setFeedback] = useState('')
  const selected = recipes.filter(recipe => selectedIds.includes(recipe.id))
  const signature = JSON.stringify(selected.map(recipe => [
    recipe.id, recipe.servings, recipe.minutes, recipe.warnings,
    recipe.ingredients.map(item => [item.original, item.amount, item.unit, item.reviewReason]),
  ]))
  useEffect(() => { setChecked({}); setFeedback('') }, [signature])
  const result = selected.length ? combinedImportedRecipeGroceries(selected) : null
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
  return <section className="recipe-collection-groceries" aria-label="Gecombineerde ongeprijsde boodschappenlijst">
    <h3>Één boodschappenlijst voor je nieuwe recepten</h3>
    <p>Kies welke recepten je samen wilt koken. Dezelfde duidelijke ingrediënten en
      metrische eenheden worden samengevoegd. Alle hoeveelheden zijn voor de
      oorspronkelijke porties van elk recept. Producten, verpakkingsprijzen en
      besparingen blijven onbekend tot je eigen winkelbronnen controleert.</p>
    <label className="recipe-collection-label">Zoek recept in mijn bibliotheek
      <input type="search" maxLength={120} value={query}
        placeholder="Zoek jouw eigen recepten" onChange={event => setQuery(event.currentTarget.value)} />
    </label>
    <small>{selected.length} van {recipes.length} recepten gekozen (maximaal 15).
      Met zoeken worden gekozen recepten niet ongemerkt verwijderd.</small>
    <div className="recipe-collection-groceries__recipes" role="group" aria-label="Recepten combineren">
      {visibleRecipes.map(recipe => <label key={recipe.id}>
        <input type="checkbox" checked={selectedIds.includes(recipe.id)}
          onChange={event => changeSelection(recipe.id, event.currentTarget.checked)} />
        {recipe.title} · {recipe.servings ?? '?'} porties
      </label>)}
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
      </li>)}</ul>
      {!visible.length && <p role="status">Alle controleerbare boodschappen zijn afgevinkt.</p>}
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={exportText}>Download gezamenlijke lijst (TXT)</button>
        <button type="button" onClick={exportCsv}
          disabled={list.lines.length > 80}>Download gezamenlijke lijst (CSV)</button>
      </div>
      {list.lines.length > 80 && <small>De veilige CSV-export ondersteunt maximaal
        80 regels. Gebruik de complete TXT-lijst, of selecteer minder recepten.</small>}
      {feedback && <p role="status">{feedback}</p>}
      <small>Dit is uitsluitend een persoonlijke, ongeprijsde lijst. Afvinken blijft
        op dit scherm en bevestigt geen aankoop, prijs of productmatch.</small>
    </>}
  </section>
}
