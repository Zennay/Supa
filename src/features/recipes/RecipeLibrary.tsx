import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { readRecipeLibrary, saveRecipeLibrary, updateSavedRecipe, deleteSavedRecipe, duplicateSavedRecipe, reviewRecipe, type LibraryState, type SavedRecipe } from './recipeLibrary'
import { importRecipeLink } from './importRecipeLink'
import { readRecipeFavorites, toggleRecipeFavorite, removeRecipeFavorite } from './recipeFavorites'
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
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try { return readRecipeFavorites(window.localStorage).ids } catch { return [] }
  })
  const [mode, setMode] = useState<'manual' | 'url'>('manual')
  const [form, setForm] = useState(blank)
  const [url, setUrl] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<SavedRecipe | typeof examples[number] | null>(null)
  const [preview, setPreview] = useState<UserRecipeDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editor = useRef<HTMLDialogElement>(null)
  const detail = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const saving = useRef(false)
  useEffect(() => () => request.current?.abort(), [])
  const matches = (r: { id: string; title: string }) => r.title.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) && (filter !== 'favorites' || favorites.includes(r.id))
  const demo = filter === 'own' ? [] : examples.filter(matches)
  const own = library.recipes.filter(matches)
  if (sort) { demo.sort((x, y) => x.title.localeCompare(y.title, 'nl')); own.sort((x, y) => x.title.localeCompare(y.title, 'nl')) }
  function favorite(id: string) {
    try { setFavorites(toggleRecipeFavorite(window.localStorage, id).ids) }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Favoriet kon niet worden opgeslagen.') }
  }
  function openEditor(next: 'manual' | 'url') {
    request.current?.abort(); setBusy(false); setMode(next); setEditingId(null); setForm(blank); setSource(null); setUrl(''); setPreview(null); setError(''); saving.current = false
    editor.current?.showModal()
  }
  function closeEditor() { request.current?.abort(); setBusy(false); editor.current?.close() }
  function editOwnRecipe(recipe: SavedRecipe) {
    request.current?.abort(); detail.current?.close(); setBusy(false); setEditingId(recipe.id)
    setMode('manual'); setSource(recipe.sourceUrl); setPreview(null); setError(''); setMessage('')
    setForm({
      title: recipe.title, servings: recipe.servings?.toString() ?? '',
      minutes: recipe.minutes?.toString() ?? '',
      ingredients: recipe.ingredients.map(item => item.original).join('\n'),
      steps: recipe.steps.join('\n'),
    })
    editor.current?.showModal()
  }
  function duplicateOwnRecipe(recipe: SavedRecipe) {
    try {
      const next = duplicateSavedRecipe(window.localStorage, library, recipe.id,
        `own-${crypto.randomUUID()}`, new Date().toISOString())
      setLibrary(next); detail.current?.close(); setSelected(null); setFilter('own'); setQuery('')
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage(`Een kopie van ${recipe.title} staat bij je eigen recepten.`)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Dupliceren is niet gelukt.') }
  }
  function removeOwnRecipe(recipe: SavedRecipe) {
    if (!window.confirm(`Wil je "${recipe.title}" definitief van dit apparaat verwijderen?`)) return
    try {
      const next = deleteSavedRecipe(window.localStorage, library, recipe.id)
      setLibrary(next); setSelected(null); detail.current?.close()
      try { setFavorites(removeRecipeFavorite(window.localStorage, recipe.id).ids) }
      catch { setFavorites(current => current.filter(id => id !== recipe.id)) }
      window.dispatchEvent(new Event('supa-recipes-changed'))
      setMessage(`${recipe.title} is verwijderd.`)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Verwijderen is niet gelukt.') }
  }
  async function importLink(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPreview(null)
    try {
      const draft = await importRecipeLink(url, controller.signal)
      if (controller.signal.aborted) return
      setForm({ title: draft.title, servings: draft.servings?.toString() ?? '', minutes: draft.minutes?.toString() ?? '', ingredients: draft.ingredients.map(i => i.original).join('\n'), steps: draft.steps.join('\n') })
      setSource(draft.sourceUrl); setMode('manual'); setMessage('Recept opgehaald. Controleer de gegevens en sla het daarna op.')
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Importeren is niet gelukt.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
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
      const recipe = reviewRecipe(preview)
      const next = editingId
        ? updateSavedRecipe(window.localStorage, library, editingId, recipe)
        : saveRecipeLibrary(window.localStorage, library, [{
            ...recipe, id: `own-${crypto.randomUUID()}`, savedAt: new Date().toISOString(),
          }, ...library.recipes])
      setLibrary(next); window.dispatchEvent(new Event('supa-recipes-changed')); setFilter('own'); setQuery('')
      setMessage(`${recipe.title} is ${editingId ? 'bijgewerkt' : 'op dit apparaat opgeslagen'}. Recepten met volledige hoeveelheden staan ook in de planner.`)
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
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelected(recipe); detail.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving">{'sourceLabel' in recipe ? recipe.sourceLabel : 'Eigen recept'}</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`} aria-pressed={favorites.includes(recipe.id)} onClick={() => favorite(recipe.id)}><FigmaImage asset={favorites.includes(recipe.id) ? a.recipeHeartActive : a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes ?? '?'}</span><span>{`${recipe.servings ?? '?'} porties`}</span></p></div>
      </article>)}</div>
      {!demo.length && !own.length && <p className="hifi-empty">{query ? 'Geen recepten gevonden. Probeer een andere zoekterm.' : 'Voeg je eerste eigen recept toe of importeer een receptlink.'}</p>}
    </section>
    <div className="recipe-add-actions"><button onClick={() => openEditor('manual')}>＋ Eigen recept</button><button onClick={() => openEditor('url')}>Importeer via link</button></div>
    {!!demo.length && <p className="recipe-note">Zes uitgewerkte SUPA-recepten met ingrediënten en bereidingsstappen, ook beschikbaar in Planner. Dit zijn geen supermarktaanbiedingen; prijzen en besparingen zijn niet geverifieerd.</p>}
    {library.error && <p role="alert">{library.error}</p>}<p role="status" className="hifi-feedback">{message}</p>
    <dialog className="hifi-dialog recipe-dialog" ref={editor} aria-labelledby="recipe-editor-title" onCancel={closeEditor} onClose={() => { request.current?.abort(); setBusy(false) }}>
      <button className="recipe-close" onClick={closeEditor} aria-label="Recept sluiten">×</button><h2 id="recipe-editor-title">{editingId ? 'Eigen recept bewerken' : mode === 'url' ? 'Recept importeren' : 'Eigen recept toevoegen'}</h2>
      {mode === 'url' ? <form onSubmit={importLink} className="recipe-form"><p>Plak een openbare receptlink. Daarna kun je ingrediënten, porties en bereiding controleren.</p><label>Receptlink<input required type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label><button className="recipe-primary" disabled={busy}>{busy ? 'Recept ophalen…' : 'Importeer recept'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('manual'); setError('') }}>Handmatig toevoegen</button></form>
        : <form className="recipe-form" onSubmit={check} onChange={() => setPreview(null)}><label>Naam van het recept<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="recipe-form-row"><label>Porties<input required type="number" min="1" max="1000" value={form.servings} onChange={e => setForm({ ...form, servings: e.target.value })} /></label><label>Minuten<input required type="number" min="1" max="1440" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label></div><label>Ingrediënten<textarea required rows={5} placeholder={'200 g rijst\n1 paprika\n250 ml kokosmelk'} value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} /></label><small>Eén ingrediënt per regel, met hoeveelheid en eenheid.</small><label>Bereiding<textarea required rows={5} placeholder="Eén stap per regel" value={form.steps} onChange={e => setForm({ ...form, steps: e.target.value })} /></label>{source && <p>Bron: <a href={source} target="_blank" rel="noopener noreferrer">Bekijk het oorspronkelijke recept</a></p>}<button className="recipe-primary">Controleer recept</button></form>}
      {preview && <section className="recipe-review"><h3>Zo wordt je recept bewaard</h3><ul>{keyed(preview.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.amount !== null ? `${i.amount} ${i.unit === 'piece' ? 'stuks' : i.unit} ${i.label}` : i.original}{i.reviewReason && <small> · {i.reviewReason}</small>}</li>)}</ul>{preview.warnings.length > 0 && <p>Onbekende hoeveelheden blijven als tekst bewaard. Vul ze aan voordat je een boodschappenberekening maakt.</p>}<p>Bewaren op dit apparaat. Ingrediëntprijzen zijn nog onbekend.</p><button className="recipe-primary" onClick={save} disabled={!!library.error}>Opslaan in mijn recepten</button></section>}
      {error && <p role="alert" className="recipe-error">{error}</p>}
    </dialog>
    <dialog className="hifi-dialog recipe-dialog" ref={detail} aria-labelledby="recipe-detail-title"><button className="recipe-close" onClick={() => detail.current?.close()} aria-label="Details sluiten">×</button>{selected && <>{'image' in selected && selected.image && <FigmaImage className="hifi-detail-photo" asset={selected.image} alt="" />}<h2 id="recipe-detail-title">{selected.title}</h2><p>{selected.minutes ?? '?'} minuten{'servings' in selected ? ` · ${selected.servings ?? '?'} porties` : ' · ontwerpvoorbeeld'}</p>{'ingredients' in selected ? <><h3>Ingrediënten</h3><ul>{selected.source === 'supa-original-recipe' ? keyed(selected.ingredients, i => i.id).map(({key, value:i}) => <li key={key}>{i.amount} {i.unit === 'piece' ? 'stuks' : i.unit} {i.label}</li>) : keyed(selected.ingredients, i => i.original).map(({key, value:i}) => <li key={key}>{i.original}</li>)}</ul><h3>Bereiding</h3><ol>{keyed(selected.steps, s => s).map(({key, value:s}) => <li key={key}>{s}</li>)}</ol>{'sourceUrl' in selected && selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Oorspronkelijk recept</a>}<p>Ingrediëntprijzen nog onbekend of alleen een niet-actueel plannervoorbeeld.</p></> : <p>Dit is een kaart uit het oorspronkelijke ontwerp. Ingrediënten en bereiding zijn nog niet beschikbaar.</p>}
      {'savedAt' in selected && <div className="recipe-add-actions recipe-detail-actions">
        <button onClick={() => selected && 'savedAt' in selected && editOwnRecipe(selected)}>Bewerk eigen recept</button>
        <button onClick={() => selected && 'savedAt' in selected && duplicateOwnRecipe(selected)}>Dupliceer recept</button>
        <button onClick={() => selected && 'savedAt' in selected && removeOwnRecipe(selected)}>Verwijder eigen recept</button>
      </div>}</>}</dialog>
  </div>
}
