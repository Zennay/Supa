import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { createManualRecipeDraft, importRecipeFromHtml, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { readRecipeLibrary, saveRecipeLibrary, reviewRecipe, type LibraryState, type SavedRecipe } from './recipeLibrary'
import { importRecipeLink } from './importRecipeLink'
import { prepareRecipeBackupImport, serializeRecipeBackup, type RecipeBackupPreview, RECIPE_BACKUP_MAX_BYTES } from './recipeBackup'
import { curatedFigmaRecipes } from './curatedFigmaRecipes'
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

export function RecipeLibrary({ onBack }: { onBack: () => void }) {
  const [library, setLibrary] = useState(initialLibrary)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'own' | 'favorites'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [mode, setMode] = useState<'manual' | 'url' | 'paste'>('manual')
  const [form, setForm] = useState(blank)
  const [url, setUrl] = useState('')
  const [pastedSource, setPastedSource] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<SavedRecipe | typeof examples[number] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [preview, setPreview] = useState<UserRecipeDraft | null>(null)
  const [backupPreview, setBackupPreview] = useState<RecipeBackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const backupReadVersion = useRef(0)
  const sourceReadVersion = useRef(0)
  const editor = useRef<HTMLDialogElement>(null)
  const detail = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const saving = useRef(false)
  useEffect(() => () => request.current?.abort(), [])
  const matches = (r: { id: string; title: string }) => r.title.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) && (filter !== 'favorites' || favorites.includes(r.id))
  const demo = filter === 'own' ? [] : examples.filter(matches)
  const own = library.recipes.filter(matches)
  if (sort) { demo.sort((x, y) => x.title.localeCompare(y.title, 'nl')); own.sort((x, y) => x.title.localeCompare(y.title, 'nl')) }
  const favorite = (id: string) => setFavorites(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])

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
  function openEditor(next: 'manual' | 'url' | 'paste') {
    sourceReadVersion.current++
    request.current?.abort(); setBusy(false); setEditingId(null); setMode(next); setForm(blank); setSource(null); setUrl(''); setPastedSource(''); setPreview(null); setError(''); saving.current = false
    setBackupPreview(null)
    editor.current?.showModal()
  }
  function closeEditor() { sourceReadVersion.current++; request.current?.abort(); setBusy(false); editor.current?.close() }
  function prepareExistingRecipe(recipe: SavedRecipe, duplicate: boolean) {
    request.current?.abort()
    setBusy(false)
    setEditingId(duplicate ? null : recipe.id)
    setForm({ title: duplicate ? recipe.title + ' (kopie)' : recipe.title,
      servings: recipe.servings?.toString() ?? '', minutes: recipe.minutes?.toString() ?? '',
      ingredients: recipe.ingredients.map(item => item.original).join('\n'),
      steps: recipe.steps.join('\n') })
    setSource(recipe.sourceUrl)
    setMode('manual')
    setPreview(null)
    setError('')
    setDeleteConfirm(false)
    detail.current?.close()
    editor.current?.showModal()
  }
  function deleteOwnRecipe(recipe: SavedRecipe) {
    setError('')
    try {
      if (library.error) throw new Error(library.error)
      // The guarded Planner record is a separate localStorage key. Deleting
      // an in-use recipe first would orphan that choice and the strict CAS
      // guard must not be bypassed to rewrite it after the fact.
      const plannerRaw = window.localStorage.getItem('supa:planner-preferences:v2')
      if (plannerRaw !== null) {
        let planner: unknown
        try { planner = JSON.parse(plannerRaw) } catch { throw new Error('Plannergegevens zijn onleesbaar; verwijder het recept niet voordat deze zijn hersteld.') }
        if (!planner || typeof planner !== 'object' || Array.isArray(planner) ||
            !Object.hasOwn(planner, 'recipeByDay') ||
            !(planner as { recipeByDay?: unknown }).recipeByDay ||
            typeof (planner as { recipeByDay: unknown }).recipeByDay !== 'object') {
          throw new Error('Onbekende Plannergegevens zijn beschermd. Controleer eerst je Planner.')
        }
        const choices = (planner as { recipeByDay: Record<string, unknown> }).recipeByDay
        if (Object.values(choices).includes(recipe.id)) {
          throw new Error('Dit recept staat nog in je weekplanning. Kies daar eerst een ander recept voordat je het verwijdert.')
        }
      }
      if (!library.recipes.some(item => item.id === recipe.id)) {
        throw new Error('Dit recept bestaat niet meer in je lokale bibliotheek.')
      }
      const next = saveRecipeLibrary(window.localStorage, library,
        library.recipes.filter(item => item.id !== recipe.id))
      setLibrary(next)
      setFavorites(current => current.filter(id => id !== recipe.id))
      setSelected(null)
      setDeleteConfirm(false)
      detail.current?.close()
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage('Eigen recept verwijderd. Je geplande maaltijden en winkelprijsopnames blijven intact.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recept verwijderen is niet gelukt.')
    }
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
  async function loadPastedRecipeSource(file?: File) {
    if (!file) return
    const version = ++sourceReadVersion.current
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      if (file.size > 500_000) throw new Error('Kies maximaal 500 kB aan eigen HTML of JSON-LD.')
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== sourceReadVersion.current) return
      if (!source.trim()) throw new Error('Het bestand bevat geen receptgegevens.')
      setPastedSource(source)
      setMode('paste')
      setMessage('Bestand uitsluitend in deze browser ingelezen. Vul de oorspronkelijke HTTPS-bronlink in en controleer het recept.')
    } catch (cause) {
      if (version === sourceReadVersion.current) setError(
        cause instanceof Error ? cause.message : 'Kon het lokale receptbestand niet lezen.')
    } finally {
      if (version === sourceReadVersion.current) setBusy(false)
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
      if (library.error) throw new Error(library.error)
      const existing = editingId ? library.recipes.find(item => item.id === editingId) : null
      if (editingId && !existing) throw new Error('Dit recept is ondertussen verwijderd. Er is niets overschreven.')
      const recipe = { ...reviewRecipe(preview),
        id: existing?.id ?? `own-${crypto.randomUUID()}`,
        savedAt: existing?.savedAt ?? new Date().toISOString() }
      const updated = existing
        ? library.recipes.map(item => item.id === existing.id ? recipe : item)
        : [recipe, ...library.recipes]
      const next = saveRecipeLibrary(window.localStorage, library, updated)
      setLibrary(next)
      setBackupPreview(null)
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setFilter('own')
      setQuery('')
      setMessage(existing
        ? `${recipe.title} bijgewerkt. De bestaande Planner-koppeling blijft behouden; winkelmandjes worden opnieuw berekend.`
        : `${recipe.title} is op dit apparaat opgeslagen. Recepten met volledige hoeveelheden staan ook in de planner.`)
      setEditingId(null)
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
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelected(recipe); setDeleteConfirm(false); detail.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving">{'sourceLabel' in recipe ? recipe.sourceLabel : 'Eigen recept'}</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`} aria-pressed={favorites.includes(recipe.id)} onClick={() => favorite(recipe.id)}><FigmaImage asset={favorites.includes(recipe.id) ? a.recipeHeartActive : a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes ?? '?'}</span><span>{`${recipe.servings ?? '?'} porties`}</span></p></div>
      </article>)}</div>
      {!demo.length && !own.length && <p className="hifi-empty">{query ? 'Geen recepten gevonden. Probeer een andere zoekterm.' : 'Voeg je eerste eigen recept toe of importeer een receptlink.'}</p>}
    </section>
    <div className="recipe-add-actions"><button onClick={() => openEditor('manual')}>＋ Eigen recept</button><button onClick={() => openEditor('url')}>Importeer via link</button><button onClick={() => openEditor('paste')}>Plak receptgegevens (JSON-LD)</button></div>
    <section className="recipe-backup-panel" aria-label="Eigen recepten meenemen naar een ander apparaat">
      <h2>Mijn recepten meenemen</h2>
      <p>Maak een privé-backup van je eigen recepten, of herstel een eerdere SUPA-receptenbackup.
        Dit gebruikt alleen je browser, geen upload en geen winkelprijzen. Eigen recepten met
        volledige metrische hoeveelheden verschijnen ook in Planner.</p>
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
      <button className="recipe-close" onClick={closeEditor} aria-label="Recept sluiten">×</button><h2 id="recipe-editor-title">{editingId ? 'Eigen recept bewerken' : mode === 'url' ? 'Recept importeren' : mode === 'paste' ? 'Receptgegevens lokaal plakken' : 'Eigen recept toevoegen'}</h2>
      {mode === 'url' ? <form onSubmit={importLink} className="recipe-form"><p>Plak een openbare receptlink. Daarna kun je ingrediënten, porties en bereiding controleren.</p><label>Receptlink<input required type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label><button className="recipe-primary" disabled={busy}>{busy ? 'Recept ophalen…' : 'Importeer recept'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('paste'); setError('') }}>Plak JSON-LD in plaats van de link op te halen</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('manual'); setError('') }}>Handmatig toevoegen</button></form>
        : mode === 'paste' ? <form className="recipe-form" onSubmit={importPastedRecipe}>
          <p>Plak JSON-LD met schema.org/Recipe of de HTML-broncode van een receptpagina
            die je zelf rechtmatig hebt ontvangen. Supa leest alleen lokaal: er wordt geen link
            geopend, geen website opgevraagd en geen code uitgevoerd.</p>
          <label>Of kies een eigen .html-, .json- of .jsonld-bestand (maximaal 500 kB)
            <input type="file" accept=".html,.htm,.json,.jsonld,text/html,application/json,application/ld+json"
              disabled={busy} onChange={event => {
                const file = event.currentTarget.files?.[0]
                void loadPastedRecipeSource(file)
                event.currentTarget.value = ''
              }} />
          </label>
          {busy && <small role="status">Receptbron wordt lokaal gelezen…</small>}
          <label>Oorspronkelijke openbare HTTPS-receptlink (alleen als bronvermelding)
            <input required type="url" placeholder="https://…" value={url}
              onChange={event => setUrl(event.target.value)} />
          </label>
          <label>JSON-LD of HTML-broncode (maximaal 500 kB)
            <textarea required rows={9} maxLength={500000} spellCheck={false}
              placeholder={'{"@type":"Recipe","name":"...","recipeIngredient":[...],"recipeInstructions":[...]}'} 
              value={pastedSource}
              onChange={event => setPastedSource(event.target.value)} />
          </label>
          <button className="recipe-primary" type="submit" disabled={busy}>Lees lokale receptgegevens</button>
          <button type="button" onClick={() => { setMode('manual'); setError('') }}>
            Handmatig invoeren
          </button>
        </form>
        : <form className="recipe-form" onSubmit={check} onChange={() => setPreview(null)}><label>Naam van het recept<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="recipe-form-row"><label>Porties<input required type="number" min="1" max="1000" value={form.servings} onChange={e => setForm({ ...form, servings: e.target.value })} /></label><label>Minuten<input required type="number" min="1" max="1440" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label></div><label>Ingrediënten<textarea required rows={5} placeholder={'200 g rijst\n1 paprika\n250 ml kokosmelk'} value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} /></label><small>Eén ingrediënt per regel, met hoeveelheid en eenheid.</small><label>Bereiding<textarea required rows={5} placeholder="Eén stap per regel" value={form.steps} onChange={e => setForm({ ...form, steps: e.target.value })} /></label>{source && <p>Bron: <a href={source} target="_blank" rel="noopener noreferrer">Bekijk het oorspronkelijke recept</a></p>}<button className="recipe-primary">Controleer recept</button></form>}
      {preview && <section className="recipe-review"><h3>Zo wordt je recept bewaard</h3><ul>{keyed(preview.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.amount !== null ? `${i.amount} ${i.unit === 'piece' ? 'stuks' : i.unit} ${i.label}` : i.original}{i.reviewReason && <small> · {i.reviewReason}</small>}</li>)}</ul>{preview.warnings.length > 0 && <p>Onbekende hoeveelheden blijven als tekst bewaard. Vul ze aan voordat je een boodschappenberekening maakt.</p>}<p>Bewaren op dit apparaat. Ingrediëntprijzen zijn nog onbekend.</p><button className="recipe-primary" onClick={save} disabled={!!library.error}>{editingId ? 'Wijzigingen opslaan' : 'Opslaan in mijn recepten'}</button></section>}
      {error && <p role="alert" className="recipe-error">{error}</p>}
    </dialog>
    <dialog className="hifi-dialog recipe-dialog" ref={detail} aria-labelledby="recipe-detail-title"><button className="recipe-close" onClick={() => detail.current?.close()} aria-label="Details sluiten">×</button>{selected && <>{'image' in selected && selected.image && <FigmaImage className="hifi-detail-photo" asset={selected.image} alt="" />}<h2 id="recipe-detail-title">{selected.title}</h2><p>{selected.minutes ?? '?'} minuten{'servings' in selected ? ` · ${selected.servings ?? '?'} porties` : ' · ontwerpvoorbeeld'}</p>{'ingredients' in selected ? <><h3>Ingrediënten</h3><ul>{selected.source === 'supa-original-recipe' ? keyed(selected.ingredients, i => i.id).map(({key, value:i}) => <li key={key}>{i.amount} {i.unit === 'piece' ? 'stuks' : i.unit} {i.label}</li>) : keyed(selected.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.original}</li>)}</ul><h3>Bereiding</h3><ol>{keyed(selected.steps, s => s).map(({key, value:s}) => <li key={key}>{s}</li>)}</ol>{'sourceUrl' in selected && selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Oorspronkelijk recept</a>}<p>Ingrediëntprijzen nog onbekend of alleen een niet-actueel plannervoorbeeld.</p></> : <p>Dit is een kaart uit het oorspronkelijke ontwerp. Ingrediënten en bereiding zijn nog niet beschikbaar.</p>}
      {'savedAt' in selected && <section className="recipe-own-actions" aria-label="Eigen recept beheren">
        <h3>Mijn recept beheren</h3>
        <div className="recipe-own-actions__buttons">
          <button type="button" onClick={() => prepareExistingRecipe(selected, false)}>Bewerk recept</button>
          <button type="button" onClick={() => prepareExistingRecipe(selected, true)}>Maak een kopie</button>
          <button type="button" aria-expanded={deleteConfirm}
            onClick={() => setDeleteConfirm(true)}>Verwijder recept</button>
        </div>
        {error && <p role="alert" className="recipe-error">{error}</p>}
        {deleteConfirm && <div className="recipe-own-actions__confirm" role="group"
          aria-label="Bevestig recept verwijderen">
          <p>Dit verwijdert alleen dit eigen recept van dit apparaat. Je Planner valt zo nodig terug
            op het standaardrecept. De bestaande winkelprijsopnames blijven onaangeroerd.</p>
          <button type="button" onClick={() => deleteOwnRecipe(selected)}>Ja, verwijder dit recept</button>
          <button type="button" onClick={() => setDeleteConfirm(false)}>Annuleren</button>
        </div>}
      </section>}</>}</dialog>
  </div>
}
