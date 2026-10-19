import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { createManualRecipeDraft, importRecipeFromHtml, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { readRecipeLibrary, saveRecipeLibrary, reviewRecipe, type LibraryState, type SavedRecipe } from './recipeLibrary'
import { importRecipeLink } from './importRecipeLink'
import { importPlainTextRecipe } from './importPlainTextRecipe'
import { prepareRecipeBackupImport, serializeRecipeBackup, type RecipeBackupPreview, RECIPE_BACKUP_MAX_BYTES } from './recipeBackup'
import { curatedFigmaRecipes } from './curatedFigmaRecipes'
import { m2InitialPlan } from '../../data/m2Fixture'
import { ownRecipeShoppingChecklist, formatOwnRecipeChecklist } from './recipeShoppingChecklist'
import { exportOwnRecipeChecklistCsv } from './recipeShoppingCsv'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { exportOwnRecipePrivateWeek } from './exportOwnRecipePrivateWeek'
import { RECIPE_FAVORITES_KEY, readRecipeFavorites, toggleRecipeFavorite, type RecipeFavorites } from './recipeFavorites'
import './recipes.css'

function keyed<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>()
  return items.map(value => {
    const label = identity(value); const count = occurrences.get(label) ?? 0
    occurrences.set(label, count + 1)
    return { key: JSON.stringify([label, count]), value }
  })
}

const figmaRecipeImages: Record<string, string> = {
  'supa-thai': a.recipeThai,
  'supa-quesadillas': a.recipeQuesadillas,
  'supa-fried-rice': a.imgRecepten,
  'supa-bao': a.imgRecepten1,
  'supa-katsu': a.imgRecepten2,
  'supa-veg-pasta': a.recipePasta,
}
const examples = curatedFigmaRecipes.map(recipe => ({
  ...recipe, image: figmaRecipeImages[recipe.id] ?? null,
  sourceLabel: 'SUPA-recept',
}))

const blank = { title: '', servings: '2', minutes: '20', ingredients: '', steps: '' }
function initialLibrary(): LibraryState {
  if (typeof window === 'undefined') return { recipes: [], raw: null, error: null }
  try { return readRecipeLibrary(window.localStorage) }
  catch { return { recipes: [], raw: null, error: 'Browseropslag is niet beschikbaar. Je kunt recepten bekijken, maar nog niet bewaren.' } }
}

function initialFavorites(): RecipeFavorites {
  if (typeof window === 'undefined') return { ids: [], raw: null, error: null }
  try { return readRecipeFavorites(window.localStorage) }
  catch { return { ids: [], raw: null, error: 'Favorieten kunnen niet worden geopend in deze browser.' } }
}

export function RecipeLibrary({ onBack }: { onBack: () => void }) {
  const [library, setLibrary] = useState(initialLibrary)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'own' | 'favorites'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState(false)
  const [favoriteState, setFavoriteState] = useState(initialFavorites)
  const favoriteRef = useRef(favoriteState)
  const favorites = favoriteState.ids
  const [mode, setMode] = useState<'manual' | 'url' | 'paste' | 'plain'>('manual')
  const [form, setForm] = useState(blank)
  const [url, setUrl] = useState('')
  const [pastedSource, setPastedSource] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<SavedRecipe | typeof examples[number] | null>(null)
  const [preview, setPreview] = useState<UserRecipeDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isVariant, setIsVariant] = useState(false)
  const [shoppingPortions, setShoppingPortions] = useState('2')
  const [plannerDay, setPlannerDay] = useState(m2InitialPlan[0].day)
  const [shoppingChecks, setShoppingChecks] = useState<Record<string, boolean>>({})
  const [shoppingOpenOnly, setShoppingOpenOnly] = useState(false)
  const [showShoppingCopy, setShowShoppingCopy] = useState(false)
  const [privateWeekMessage, setPrivateWeekMessage] = useState('')
  const shoppingCopy = useRef<HTMLTextAreaElement>(null)
  const [backupPreview, setBackupPreview] = useState<RecipeBackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const backupReadVersion = useRef(0)
  const pasteReadVersion = useRef(0)
  const [pasteFileMessage, setPasteFileMessage] = useState('')
  const editor = useRef<HTMLDialogElement>(null)
  const detail = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const saving = useRef(false)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== RECIPE_FAVORITES_KEY && event.key !== null) return
      const next = initialFavorites()
      favoriteRef.current = next
      setFavoriteState(next)
      if (next.error) setMessage(next.error)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  const matches = (r: { id: string; title: string }) => r.title.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) && (filter !== 'favorites' || favorites.includes(r.id))
  const demo = filter === 'own' ? [] : examples.filter(matches)
  const own = library.recipes.filter(matches)
  if (sort) { demo.sort((x, y) => x.title.localeCompare(y.title, 'nl')); own.sort((x, y) => x.title.localeCompare(y.title, 'nl')) }
  const ownShopping = selected && 'savedAt' in selected ? ownRecipeShoppingChecklist(selected, Number(shoppingPortions)) : null
  const selectedRecipeShoppingText = ownShopping ? formatOwnRecipeChecklist(ownShopping, shoppingChecks) : ''
  const shoppingCompleted = ownShopping?.lines.filter(line => shoppingChecks[line.key]).length ?? 0
  const shoppingVisible = ownShopping?.lines.filter(line => !shoppingOpenOnly || !shoppingChecks[line.key]) ?? []
  const favorite = (id: string) => {
    try {
      const next = toggleRecipeFavorite(window.localStorage, favoriteRef.current, id)
      favoriteRef.current = next
      setFavoriteState(next)
      setMessage('Favorieten zijn uitsluitend op dit apparaat bewaard.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Favorieten konden niet worden opgeslagen.')
    }
  }

  function downloadOwnRecipes() {
    setBackupError('')
    try {
      if (library.error) throw new Error(library.error)
      if (!library.recipes.length) throw new Error('Je hebt nog geen eigen recepten om te exporteren.')
      const output = serializeRecipeBackup(library.recipes)
      const link = document.createElement('a')
      const uri = URL.createObjectURL(new Blob([output], { type: 'application/json;charset=utf-8' }))
      try {
        link.href = uri
        link.download = 'supa-mijn-recepten.json'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Eigen recepten lokaal opgeslagen als JSON-backup. Je hebt zelf de controle over dit bestand.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'Downloaden is niet gelukt.')
    }
  }
  function downloadOwnRecipeChecklist() {
    if (!ownShopping?.canCopy) return
    try {
      const uri = URL.createObjectURL(new Blob([selectedRecipeShoppingText], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      try {
        link.href = uri
        link.download = 'supa-recept-boodschappen.txt'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Je ongeprijsde receptboodschappen zijn als TXT opgeslagen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch {
      setMessage('Downloaden lukte niet. Selecteer de tekst van je lijst om die zelf op te slaan.')
      setShowShoppingCopy(true)
    }
  }
  function downloadOwnRecipeChecklistCsv() {
    if (!ownShopping?.canCopy) return
    try {
      const csv = exportOwnRecipeChecklistCsv(ownShopping, shoppingChecks)
      const uri = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-recept-boodschappen-ongeprijsd.csv'
        document.body.append(link)
        link.click()
        link.remove()
        setMessage('Je eigen ongeprijsde boodschappenlijst is als CSV opgeslagen; winkelprijzen blijven onbekend.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Kon het CSV-bestand niet veilig exporteren.')
    }
  }
  function planOwnRecipe(recipe: SavedRecipe, destination: 'planner' | 'basket' | 'list' = 'planner') {
    if (library.error || !toPlannerRecipe(recipe)) {
      setMessage('Controleer eerst alle metrische hoeveelheden en hele stuks in dit recept.')
      return
    }
    if (!m2InitialPlan.some(meal => meal.day === plannerDay)) return
    const accepted = window.dispatchEvent(new CustomEvent('supa-plan-own-recipe', {
      cancelable: true,
      detail: { recipeId: recipe.id, day: plannerDay, destination },
    }))
    if (!accepted) {
      setPrivateWeekMessage('Dit recept is niet meer geldig beschikbaar voor Planner. Herlaad je eigen recepten en controleer het opnieuw.')
      return
    }
    setPrivateWeekMessage('')
    detail.current?.close()
  }
  function downloadForPrivateComparison() {
    setPrivateWeekMessage('')
    try {
      if (!selected || !('savedAt' in selected)) throw new Error('Open eerst een eigen recept.')
      const json = exportOwnRecipePrivateWeek(selected, Number(shoppingPortions))
      const uri = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      try {
        link.href = uri
        link.download = 'supa-recept-voor-privevergelijker.json'
        document.body.append(link)
        link.click()
        link.remove()
        setPrivateWeekMessage('Ingrediënten veilig geëxporteerd. Open de privévergelijker, importeer dit JSON-bestand als weekmenu en koppel daarna je eigen waargenomen winkelproducten.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch (cause) {
      setPrivateWeekMessage(cause instanceof Error ? cause.message : 'Dit recept kan niet veilig worden geëxporteerd.')
    }
  }

  async function loadOwnRecipeBackup(file?: File) {
    if (!file) return
    const version = ++backupReadVersion.current
    setBackupPreview(null)
    setBackupError('')
    setBackupBusy(true)
    try {
      if (library.error) throw new Error(library.error)
      if (file.size > RECIPE_BACKUP_MAX_BYTES) throw new Error('Backup is groter dan 2 MB.')
      const data = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const result = prepareRecipeBackupImport(data, library.recipes)
      if (version !== backupReadVersion.current) return
      setBackupPreview(result)
      setMessage('Backup lokaal gelezen. Controleer eerst de aantallen en bevestig zelf de import.')
    } catch (cause) {
      if (version !== backupReadVersion.current) return
      setBackupError(cause instanceof Error ? cause.message : 'Kon deze backup niet lezen.')
    } finally {
      if (version === backupReadVersion.current) setBackupBusy(false)
    }
  }
  function confirmOwnRecipeBackup() {
    if (!backupPreview || !backupPreview.additions.length) return
    setBackupError('')
    try {
      if (library.error) throw new Error(library.error)
      const next = saveRecipeLibrary(
        window.localStorage, library, [...backupPreview.additions, ...library.recipes],
      )
      setLibrary(next)
      setBackupPreview(null)
      setFilter('own')
      setQuery('')
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage('Je eigen recepten zijn geïmporteerd en beschikbaar in Recepten en, met metrische hoeveelheden, Planner.')
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'Importeren is niet gelukt. Je bestaande recepten blijven staan.')
    }
  }
  function openEditor(next: 'manual' | 'url' | 'paste' | 'plain') {
    pasteReadVersion.current++; setPasteFileMessage('')
    request.current?.abort(); setBusy(false); setMode(next); setForm(blank); setSource(null); setUrl(''); setPastedSource(''); setPreview(null); setError(''); setEditingId(null); setIsVariant(false); saving.current = false
    setBackupPreview(null)
    editor.current?.showModal()
  }
  function closeEditor() { pasteReadVersion.current++; request.current?.abort(); setBusy(false); editor.current?.close(); setEditingId(null); setIsVariant(false) }
  function openSavedRecipeEditor(recipe: SavedRecipe, duplicate = false) {
    if (library.error) { setMessage(library.error); return }
    request.current?.abort()
    setBusy(false); saving.current = false
    setEditingId(duplicate ? null : recipe.id); setIsVariant(duplicate)
    setMode('manual')
    setForm({
      title: recipe.title,
      servings: recipe.servings?.toString() ?? '',
      minutes: recipe.minutes?.toString() ?? '',
      ingredients: recipe.ingredients.map(item => item.original).join('\n'),
      steps: recipe.steps.join('\n'),
    })
    setSource(recipe.sourceUrl); setUrl(''); setPastedSource('')
    setPreview(null); setError(''); setMessage('')
    detail.current?.close()
    editor.current?.showModal()
  }
  async function importLink(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPreview(null)
    try {
      const draft = await importRecipeLink(url, controller.signal)
      if (controller.signal.aborted) return
      adoptImportedRecipe(draft, 'Recept opgehaald. Controleer de gegevens en sla het daarna op.')
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Importeren is niet gelukt.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function adoptImportedRecipe(draft: UserRecipeDraft, messageText: string) {
    setForm({
      title: draft.title,
      servings: draft.servings?.toString() ?? '',
      minutes: draft.minutes?.toString() ?? '',
      ingredients: draft.ingredients.map(item => item.original).join('\n'),
      steps: draft.steps.join('\n'),
    })
    setSource(draft.sourceUrl)
    setMode('manual')
    setPastedSource('')
    setPreview(null)
    setMessage(messageText)
  }
  async function loadLocalRecipeSource(file?: File, format: 'schema' | 'plain' = 'schema') {
    if (!file) return
    const revision = ++pasteReadVersion.current
    setPasteFileMessage(''); setError('')
    try {
      if (!file.size || file.size > 500_000) throw new Error('Selecteer een lokaal receptbestand van maximaal 500 kB.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (revision !== pasteReadVersion.current) return
      setPastedSource(content)
      setPreview(null)
      setPasteFileMessage(format === 'plain' ? 'Tekstbestand lokaal gelezen. Controleer de ingrediënten vóór import.' : 'Bestand lokaal gelezen. Controleer de gegevens en vul de oorspronkelijke openbare HTTPS-bronlink in.')
    } catch (cause) {
      if (revision === pasteReadVersion.current) setError(cause instanceof Error ? cause.message : 'Het bestand kan niet lokaal worden gelezen.')
    }
  }
  function importPastedRecipe(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPreview(null)
    try {
      const sourceText = pastedSource.trim()
      if (!sourceText || new TextEncoder().encode(sourceText).length > 500_000) {
        throw new Error('Plak maximaal 500 kB aan zelf verkregen HTML of JSON-LD.')
      }
      // Reuse the existing offline schema.org/Recipe normalizer; this does NOT
      // fetch the URL, navigate a site or execute any pasted HTML/JavaScript.
      const html = sourceText.startsWith('{') || sourceText.startsWith('[')
        ? '<script type="application/ld+json">' + sourceText + '</script>'
        : sourceText
      const draft = importRecipeFromHtml(html, url)
      adoptImportedRecipe(draft, 'Receptgegevens lokaal herkend. Controleer alle hoeveelheden vóór opslaan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kon de geplakte receptgegevens niet verwerken.')
    }
  }
  function importPlainText(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPreview(null)
    try {
      const draft = importPlainTextRecipe(pastedSource)
      adoptImportedRecipe(draft, 'Recepttekst lokaal herkend. Controleer hoeveelheden en stappen vóór opslaan.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kon deze recepttekst niet inlezen.')
    }
  }
  function check(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const draft = createManualRecipeDraft({ title: form.title, servings: Number(form.servings), minutes: Number(form.minutes), ingredients: form.ingredients.split('\n').map(x => x.trim()).filter(Boolean), steps: form.steps.split('\n').map(x => x.trim()).filter(Boolean) })
      setPreview(reviewRecipe({ ...draft, source: source ? 'url' : 'manual', sourceUrl: source }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Controleer de gegevens.') }
  }
  function save() {
    if (!preview || saving.current) return
    saving.current = true
    try {
      const reviewed = reviewRecipe(preview)
      const current = editingId ? library.recipes.find(recipe => recipe.id === editingId) : null
      if (editingId && !current) throw new Error('Dit recept bestaat niet meer. Herlaad de recepten voordat je verdergaat.')
      // Keep the identity of a recipe already referenced by the weekly Planner.
      // The library's CAS write refuses newer changes from another browser tab.
      const recipe: SavedRecipe = current
        ? { ...reviewed, id: current.id, savedAt: current.savedAt }
        : { ...reviewed, id: `own-${crypto.randomUUID()}`, savedAt: new Date().toISOString() }
      const entries = current
        ? library.recipes.map(item => item.id === current.id ? recipe : item)
        : [recipe, ...library.recipes]
      const next = saveRecipeLibrary(window.localStorage, library, entries)
      setLibrary(next); setBackupPreview(null); window.dispatchEvent(new Event('supa-recipes-changed')); setFilter('own'); setQuery('')
      setSelected(recipe)
      setMessage(`${recipe.title} is ${current ? 'bijgewerkt' : 'opgeslagen'} op dit apparaat. ` +
        (toPlannerRecipe(recipe)
          ? 'Het recept is klaar voor Planner. Winkelprijzen blijven onbekend tot je echte brondata bevestigt.'
          : 'Het recept blijft bewaard. Controleer eerst onzekere hoeveelheden of gedeeltelijke stuks voordat je het in Planner gebruikt.'))
      closeEditor()
    } catch (e) { setError(e instanceof Error ? e.message : 'Opslaan is niet gelukt. Je invoer blijft staan.') }
    finally { saving.current = false }
  }
  return <div className="hifi-home recipe-library" data-figma-node="3342:5608">
    <header className="recipe-heading"><button className="recipe-back" onClick={onBack} aria-label="Terug naar Home"><FigmaImage asset={a.recipeBack} alt="" /></button><h1>{filter === 'own' ? 'Mijn eigen recepten' : 'Alle recepten'}</h1></header>
    <div className="hifi-search-row"><label className="hifi-search"><FigmaImage asset={a.recipeSearch} alt="" /><input type="search" aria-label="Zoek recepten" placeholder="Zoek recepten" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="hifi-filter" aria-label="Receptfilters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button></div>
    {filtersOpen && <div className="recipe-tabs" aria-label="Receptfilter">{(['all', 'own', 'favorites'] as const).map((id, i) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{['Alle recepten', 'Eigen recepten', 'Favorieten'][i]}</button>)}</div>}
    <section className="hifi-section"><div className="hifi-section-heading"><div><h2>Recepten</h2><p className="recipe-count">{demo.length + own.length} recepten</p></div><button aria-label="Sorteer recepten op naam" aria-pressed={sort} onClick={() => setSort(!sort)}><FigmaImage asset={a.recipeSort} alt="" /></button></div>
      <div className="hifi-recipe-grid">{[...own, ...demo].map(recipe => <article className={`hifi-recipe-card${'image' in recipe && recipe.image ? '' : ' own-recipe-card'}`} key={recipe.id}>
        {'image' in recipe && recipe.image && <FigmaImage className="hifi-recipe-photo" asset={recipe.image} alt="" />}
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelected(recipe); setShoppingPortions(String(recipe.servings ?? 2)); setShowShoppingCopy(false); setPrivateWeekMessage(''); setShoppingChecks({}); setShoppingOpenOnly(false); detail.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving">{'sourceLabel' in recipe ? recipe.sourceLabel : 'Eigen recept'}</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`}
          aria-pressed={favorites.includes(recipe.id)} disabled={!!favoriteState.error}
          onClick={() => favorite(recipe.id)}><FigmaImage asset={favorites.includes(recipe.id) ? a.recipeHeartActive : a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes ?? '?'}</span><span>{`${recipe.servings ?? '?'} porties`}</span></p>{'savedAt' in recipe && <small className="recipe-planner-readiness">{toPlannerRecipe(recipe) ? '✓ Klaar voor Planner · ongeprijsd' : 'Ingrediënten nog controleren voor Planner'}</small>}</div>
      </article>)}</div>
      {!demo.length && !own.length && <p className="hifi-empty">{query ? 'Geen recepten gevonden. Probeer een andere zoekterm.' : 'Voeg je eerste eigen recept toe of importeer een receptlink.'}</p>}
      <small>Favorieten blijven lokaal bewaard in deze browser; receptgegevens en links worden niet meegestuurd.</small>
      {favoriteState.error && <p role="alert" className="recipe-error">{favoriteState.error}</p>}
    </section>
    <div className="recipe-add-actions"><button onClick={() => openEditor('manual')}>＋ Eigen recept</button><button onClick={() => openEditor('url')}>Importeer via link</button><button onClick={() => openEditor('paste')}>Plak receptgegevens (JSON-LD)</button><button onClick={() => openEditor('plain')}>Plak gewone recepttekst</button></div>
    <section className="recipe-backup-panel" aria-label="Eigen recepten meenemen naar een ander apparaat">
      <h2>Mijn recepten meenemen</h2>
      <p>Maak een privé-backup van je eigen recepten, of herstel een eerdere SUPA-receptenbackup.
        Dit gebruikt alleen je browser, geen upload en geen winkelprijzen. Eigen recepten verschijnen
        pas in Planner nadat ingrediënten, hele fysieke stuks en overige hoeveelheden bevestigd zijn.</p>
      <div className="recipe-backup-panel__actions">
        <button type="button" onClick={downloadOwnRecipes}
          disabled={!!library.error || !library.recipes.length}>
          Download mijn recepten (JSON)
        </button>
        <label>
          Importeer eigen receptenbackup (max. 2 MB)
          <input type="file" accept=".json,application/json"
            disabled={!!library.error || backupBusy}
            onChange={event => {
              void loadOwnRecipeBackup(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }} />
        </label>
      </div>
      {backupBusy && <p role="status">Backup wordt lokaal gelezen…</p>}
      {backupPreview && <div className="recipe-backup-panel__review" aria-live="polite">
        <strong>Controleer je import</strong>
        <p>{backupPreview.sourceCount} recepten in het bestand;
          {' '}{backupPreview.alreadyPresent} al exact aanwezig;
          {' '}{backupPreview.additions.length} nieuwe recepten.</p>
        {backupPreview.additions.length > 0 && <ul>
          {backupPreview.additions.map(recipe => <li key={recipe.id}>{recipe.title}</li>)}
        </ul>}
        <div className="recipe-backup-panel__actions">
          <button type="button" onClick={confirmOwnRecipeBackup}
            disabled={!backupPreview.additions.length || !!library.error}>
            Importeer {backupPreview.additions.length} nieuwe recepten
          </button>
          <button type="button" onClick={() => { backupReadVersion.current++; setBackupPreview(null); setBackupError('') }}>
            Annuleren
          </button>
        </div>
      </div>}
      {backupError && <p role="alert" className="recipe-error">{backupError}</p>}
      <small>Onbekende versies, dubbele IDs met andere inhoud en te grote bestanden worden geweigerd.
        Bestaande recepten worden niet automatisch overschreven; je bevestigt elke import zelf.</small>
    </section>
    {!!demo.length && <p className="recipe-note">Zes uitgewerkte SUPA-recepten met ingrediënten en bereidingsstappen, ook beschikbaar in Planner. Dit zijn geen supermarktaanbiedingen; prijzen en besparingen zijn niet geverifieerd.</p>}
    {library.error && <p role="alert">{library.error}</p>}<p role="status" className="hifi-feedback">{message}</p>
    <dialog className="hifi-dialog recipe-dialog" ref={editor} aria-labelledby="recipe-editor-title" onCancel={closeEditor} onClose={() => { request.current?.abort(); setBusy(false) }}>
      <button className="recipe-close" onClick={closeEditor} aria-label="Recept sluiten">×</button><h2 id="recipe-editor-title">{mode === 'url' ? 'Recept importeren' : mode === 'paste' ? 'Receptgegevens lokaal plakken' : mode === 'plain' ? 'Recepttekst lokaal importeren' : editingId ? 'Mijn recept aanpassen' : isVariant ? 'Receptvariant maken' : 'Eigen recept toevoegen'}</h2>
      {mode === 'url' ? <form onSubmit={importLink} className="recipe-form"><p>Plak een openbare receptlink. Daarna kun je ingrediënten, porties en bereiding controleren.</p><label>Receptlink<input required type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label><button className="recipe-primary" disabled={busy}>{busy ? 'Recept ophalen…' : 'Importeer recept'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('paste'); setError('') }}>Plak JSON-LD in plaats van de link op te halen</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('plain'); setError('') }}>Plak gewone recepttekst</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('manual'); setError('') }}>Handmatig toevoegen</button></form>
        : mode === 'plain' ? <form className="recipe-form" onSubmit={importPlainText}>
          <p>Plak een gewone recepttekst, bijvoorbeeld van een pagina zonder JSON-LD.
            Gebruik een titel, Porties: 2, Tijd: 20 minuten en de koppen Ingrediënten:
            en Bereiding:. De omzetting blijft lokaal. Elke hoeveelheid moet je daarna controleren.</p>
          <label>Of kies een lokaal tekstbestand (.txt, maximaal 500 kB)
            <input type="file" accept=".txt,.md,text/plain,text/markdown"
              onChange={event => { void loadLocalRecipeSource(event.currentTarget.files?.[0], 'plain'); event.currentTarget.value = '' }} />
          </label>
          {pasteFileMessage && <p role="status">{pasteFileMessage}</p>}
          <label>Recepttekst (maximaal 500 kB)
            <textarea required rows={12} maxLength={500000}
              placeholder={'Pasta met spinazie\nPorties: 2\nTijd: 20 minuten\nIngrediënten:\n- 200 g pasta\n- 100 g spinazie\nBereiding:\n1. Kook pasta'}
              value={pastedSource} onChange={event => setPastedSource(event.target.value)} />
          </label>
          <button className="recipe-primary" type="submit">Zet tekst om naar receptconcept</button>
          <button type="button" onClick={() => { setMode('manual'); setError('') }}>Handmatig toevoegen</button>
        </form>
        : mode === 'paste' ? <form className="recipe-form" onSubmit={importPastedRecipe}>
          <p>Plak JSON-LD met schema.org/Recipe of de HTML-broncode van een receptpagina
            die je zelf rechtmatig hebt ontvangen. Supa leest alleen lokaal: er wordt geen link
            geopend, geen website opgevraagd en geen code uitgevoerd.</p>
          <label>Oorspronkelijke openbare HTTPS-receptlink (alleen als bronvermelding)
            <input required type="url" placeholder="https://…" value={url}
              onChange={event => setUrl(event.target.value)} />
          </label>
          <label>Lokaal receptbestand (HTML of JSON-LD, maximaal 500 kB)
            <input type="file" accept=".html,.htm,.json,.jsonld,text/html,application/json"
              onChange={event => { void loadLocalRecipeSource(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          </label>
          {pasteFileMessage && <p role="status">{pasteFileMessage}</p>}
          <label>JSON-LD of HTML-broncode (maximaal 500 kB)
            <textarea required rows={9} maxLength={500000} spellCheck={false}
              placeholder={'{"@type":"Recipe","name":"...","recipeIngredient":[...],"recipeInstructions":[...]}'} 
              value={pastedSource}
              onChange={event => { pasteReadVersion.current++; setPastedSource(event.target.value) }} />
          </label>
          <button className="recipe-primary" type="submit">Lees lokale receptgegevens</button>
          <button type="button" onClick={() => { setMode('manual'); setError('') }}>
            Handmatig invoeren
          </button>
        </form>
        : <form className="recipe-form" onSubmit={check} onChange={() => setPreview(null)}><label>Naam van het recept<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="recipe-form-row"><label>Porties<input required type="number" min="1" max="1000" value={form.servings} onChange={e => setForm({ ...form, servings: e.target.value })} /></label><label>Minuten<input required type="number" min="1" max="1440" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label></div><label>Ingrediënten<textarea required rows={5} placeholder={'200 g rijst\n1 paprika\n250 ml kokosmelk'} value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} /></label><small>Eén ingrediënt per regel, met hoeveelheid en eenheid.</small><label>Bereiding<textarea required rows={5} placeholder="Eén stap per regel" value={form.steps} onChange={e => setForm({ ...form, steps: e.target.value })} /></label>{source && <p>Bron: <a href={source} target="_blank" rel="noopener noreferrer">Bekijk het oorspronkelijke recept</a></p>}<button className="recipe-primary">Controleer recept</button></form>}
      {preview && <section className="recipe-review"><h3>Zo wordt je recept bewaard</h3><ul>{keyed(preview.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.amount !== null ? `${i.amount} ${i.unit === 'piece' ? 'stuks' : i.unit} ${i.label}` : i.original}{i.reviewReason && <small> · {i.reviewReason}</small>}</li>)}</ul>{preview.warnings.length > 0 && <p>Onzekere hoeveelheden en gedeeltelijke stuks blijven als tekst bewaard. Corrigeer deze regels in het recept voordat je de Planner of prijsvergelijking gebruikt.</p>}<p>Bewaren op dit apparaat. Ingrediëntprijzen zijn nog onbekend.</p><button className="recipe-primary" onClick={save} disabled={!!library.error}>{editingId ? 'Wijzigingen opslaan' : isVariant ? 'Variant als nieuw recept opslaan' : 'Opslaan in mijn recepten'}</button></section>}
      {error && <p role="alert" className="recipe-error">{error}</p>}
    </dialog>
    <dialog className="hifi-dialog recipe-dialog" ref={detail} aria-labelledby="recipe-detail-title"><button className="recipe-close" onClick={() => detail.current?.close()} aria-label="Details sluiten">×</button>{selected && <>{'image' in selected && selected.image && <FigmaImage className="hifi-detail-photo" asset={selected.image} alt="" />}<h2 id="recipe-detail-title">{selected.title}</h2><p>{selected.minutes ?? '?'} minuten{'servings' in selected ? ` · ${selected.servings ?? '?'} porties` : ' · ontwerpvoorbeeld'}</p>{'ingredients' in selected ? <><h3>Ingrediënten</h3><ul>{selected.source === 'supa-original-recipe' ? keyed(selected.ingredients, i => i.id).map(({key, value:i}) => <li key={key}>{i.amount} {i.unit === 'piece' ? 'stuks' : i.unit} {i.label}</li>) : keyed(selected.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.original}</li>)}</ul><h3>Bereiding</h3><ol>{keyed(selected.steps, s => s).map(({key, value:s}) => <li key={key}>{s}</li>)}</ol>{'sourceUrl' in selected && selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Oorspronkelijk recept</a>}<p>Ingrediëntprijzen nog onbekend of alleen een niet-actueel plannervoorbeeld.</p>{'savedAt' in selected && <><div className="recipe-detail-actions"><button type="button" onClick={() => openSavedRecipeEditor(selected)}>Bewerk mijn recept</button><button type="button" onClick={() => openSavedRecipeEditor(selected, true)}>Maak een variant</button></div>
        <section className="recipe-plan-panel" aria-label="Zet eigen recept direct in de weekplanning">
          <h3>Plan dit eigen recept</h3>
          {toPlannerRecipe(selected) ? <>
            <p>Kies een dag. Supa plaatst dit recept in je Planner en activeert de dag.
              Eerdere prijsopnames moeten opnieuw passen bij de gewijzigde ingrediënten.</p>
            <label>Planner-dag
              <select value={plannerDay} onChange={event => setPlannerDay(event.currentTarget.value)}>
                {m2InitialPlan.map(meal => <option value={meal.day} key={meal.day}>{meal.day}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => planOwnRecipe(selected)}>
              Zet {selected.title} op {plannerDay} in Planner
            </button>
            <button type="button" onClick={() => planOwnRecipe(selected, 'list')}>
              Plan dit recept en open mijn boodschappenlijst
            </button>
            <button type="button" onClick={() => planOwnRecipe(selected, 'basket')}>
              Plan dit recept en open mijn winkelvergelijking
            </button>
            <small>De vergelijking gebruikt alleen zelf ingevoerde en opnieuw gecontroleerde winkelprijzen.
              De boodschappenlijst werkt ook zonder prijzen. Ontbrekende of verlopen winkelprijzen blijven onbekend. Geen JSON-export nodig.</small>
            {privateWeekMessage && <p role="status">{privateWeekMessage}</p>}
          </> : <p>Controleer eerst de hoeveelheid, metrische eenheid en eventuele gedeeltelijke stuks.
            Pas daarna kun je dit recept zonder gokwerk plannen.</p>}
        </section>
        <section className="recipe-shopping-panel" aria-label="Boodschappen voor eigen recept">
          <h3>Mijn boodschappen voor dit recept</h3>
          <p>Maak een ongeprijsde lijst voor het gewenste aantal porties. Stuks die niet heel uitkomen, moet je zelf beoordelen.</p>
          <label>Gewenste porties
            <input type="number" min="1" max="100" step="1" value={shoppingPortions}
              onChange={event => { setShoppingPortions(event.target.value); setShowShoppingCopy(false); setPrivateWeekMessage(''); setShoppingChecks({}); setShoppingOpenOnly(false) }} />
          </label>
          {ownShopping && ownShopping.canCopy ? <>
            <div className="recipe-shopping-panel__progress">
              <strong role="status">{shoppingCompleted} van {ownShopping.lines.length} boodschappen afgevinkt</strong>
              <label><input type="checkbox" checked={shoppingOpenOnly}
                onChange={event => setShoppingOpenOnly(event.currentTarget.checked)} /> Alleen nog te kopen</label>
              <button type="button" onClick={() => { setShoppingChecks({}); setShowShoppingCopy(false) }}>Wis vinkjes</button>
            </div>
            <ul>{shoppingVisible.map(line => <li key={line.key}>
              <label className="recipe-shopping-panel__row">
                <input type="checkbox" checked={!!shoppingChecks[line.key]}
                  onChange={event => setShoppingChecks(current => ({ ...current, [line.key]: event.currentTarget.checked }))} />
                <span>{line.needsReview ? `${line.original} — hoeveelheid controleren`
                  : `${line.amount?.toLocaleString('nl-NL', { maximumFractionDigits: 3 })} ${line.unit === 'piece' ? 'stuks' : line.unit} ${line.label}`}</span>
              </label>
            </li>)}</ul>
            {!shoppingVisible.length && <p role="status">Alle boodschappen voor dit recept afgevinkt.</p>}
            {ownShopping.lines.some(line => line.needsReview) && <p role="status">Onbekende of gedeeltelijke stuks blijven voor handmatige controle gemarkeerd; er wordt niets gegokt.</p>}
            <button type="button" onClick={() => setShowShoppingCopy(value => !value)}>
              {showShoppingCopy ? 'Tekst verbergen' : 'Boodschappenlijst selecteren'}
            </button>
            {showShoppingCopy && <textarea ref={shoppingCopy} readOnly rows={Math.min(20, Math.max(6, ownShopping.lines.length + 4))}
              aria-label="Kopieer mijn ongeprijsde boodschappenlijst"
              value={selectedRecipeShoppingText} onFocus={event => event.currentTarget.select()} />}
            {showShoppingCopy && <button type="button" onClick={() => shoppingCopy.current?.select()}>Selecteer alle tekst</button>}
            <button type="button" onClick={downloadOwnRecipeChecklist}>Download ongeprijsde lijst (TXT)</button>
            <button type="button" onClick={downloadOwnRecipeChecklistCsv}>Download ongeprijsde lijst (CSV)</button>
            <button type="button" onClick={downloadForPrivateComparison}>Gebruik dit recept in winkelvergelijker (JSON)</button>
            <a href="/private-basket-mapping.html" target="_blank" rel="noopener noreferrer">Open privéwinkelvergelijker met dit JSON-bestand</a>
            <a href="/private-basket-mapping.html#own-recipe-import" target="_blank" rel="noopener noreferrer">Of kies mijn lokaal opgeslagen recepten rechtstreeks in de vergelijker</a>
            {privateWeekMessage && <p role="status">{privateWeekMessage}</p>}
          </> : <p role="status">Vul 1 tot 100 hele porties in en controleer de oorspronkelijke hoeveelheid per recept.</p>}
        </section></>}</> : <p>Dit is een kaart uit het oorspronkelijke ontwerp. Ingrediënten en bereiding zijn nog niet beschikbaar.</p>}</>}</dialog>
  </div>
}
