import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { createManualRecipeDraft, type UserRecipeDraft } from '../../domain/userRecipeImport'
import { readRecipeLibrary, saveRecipeLibrary, reviewRecipe, type LibraryState, type SavedRecipe } from './recipeLibrary'
import './recipes.css'

const examples = [
  { id: 'thai', title: 'Thai red curry', image: a.recipeThai, minutes: 40, price: '6.20', saving: '1.50' },
  { id: 'quesadillas', title: 'Quesadillas', image: a.recipeQuesadillas, minutes: 15, price: '3.75', saving: '3.60' },
  { id: 'fried', title: 'Fried rice', image: a.imgRecepten, minutes: 15, price: '2.65', saving: '2.50' },
  { id: 'bao', title: 'Bao buns', image: a.imgRecepten1, minutes: 20, price: '4.45', saving: '2.50' },
  { id: 'katsu', title: 'Katsu curry', image: a.imgRecepten2, minutes: 40, price: '6.20', saving: '2.50' },
  { id: 'pasta', title: 'Groente pasta', image: a.recipePasta, minutes: 15, price: '6.20', saving: '2.50' },
]
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
  const [favorites, setFavorites] = useState<string[]>(['quesadillas'])
  const [mode, setMode] = useState<'manual' | 'url'>('manual')
  const [form, setForm] = useState(blank)
  const [url, setUrl] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<SavedRecipe | typeof examples[number] | null>(null)
  const [preview, setPreview] = useState<UserRecipeDraft | null>(null)
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
  function openEditor(next: 'manual' | 'url') {
    request.current?.abort(); setBusy(false); setMode(next); setForm(blank); setSource(null); setUrl(''); setPreview(null); setError(''); saving.current = false
    editor.current?.showModal()
  }
  function closeEditor() { request.current?.abort(); setBusy(false); editor.current?.close() }
  async function importLink(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPreview(null)
    try {
      const response = await fetch('/api/recipes/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal })
      const payload = await response.json().catch(() => { throw new Error('Linkimport is op deze versie nog niet beschikbaar. Je kunt het recept wel handmatig toevoegen.') })
      if (!response.ok) throw new Error(payload.error || 'Importeren is niet gelukt.')
      if (controller.signal.aborted) return
      const draft: UserRecipeDraft = payload.draft
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
      const recipe = { ...reviewRecipe(preview), id: `own-${crypto.randomUUID()}`, savedAt: new Date().toISOString() }
      const next = saveRecipeLibrary(window.localStorage, library, [recipe, ...library.recipes])
      setLibrary(next); setFilter('own'); setQuery(''); setMessage(`${recipe.title} is op dit apparaat opgeslagen.`); closeEditor()
    } catch (e) { setError(e instanceof Error ? e.message : 'Opslaan is niet gelukt. Je invoer blijft staan.') }
    finally { saving.current = false }
  }
  return <div className="hifi-home recipe-library" data-figma-node="3342:5608">
    <header className="recipe-heading"><button className="recipe-back" onClick={onBack} aria-label="Terug naar Home"><FigmaImage asset={a.recipeBack} alt="" /></button><h1>{filter === 'own' ? 'Mijn eigen recepten' : 'Mijn favoriete recepten'}</h1></header>
    <div className="hifi-search-row"><label className="hifi-search"><FigmaImage asset={a.recipeSearch} alt="" /><input type="search" aria-label="Zoek recepten" placeholder="Zoek recepten" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="hifi-filter" aria-label="Receptfilters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button></div>
    {filtersOpen && <div className="recipe-tabs" aria-label="Receptfilter">{(['all', 'own', 'favorites'] as const).map((id, i) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{['Alle recepten', 'Eigen recepten', 'Favorieten'][i]}</button>)}</div>}
    <section className="hifi-section"><div className="hifi-section-heading"><div><h2>Recepten</h2><p className="recipe-count">{demo.length + own.length} recepten</p></div><button aria-label="Sorteer recepten op naam" aria-pressed={sort} onClick={() => setSort(!sort)}><FigmaImage asset={a.recipeSort} alt="" /></button></div>
      <div className="hifi-recipe-grid">{[...own, ...demo].map(recipe => <article className={`hifi-recipe-card${'image' in recipe ? '' : ' own-recipe-card'}`} key={recipe.id}>
        {'image' in recipe && <FigmaImage className="hifi-recipe-photo" asset={recipe.image} alt="" />}
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelected(recipe); detail.current?.showModal() }} />
        <div className="hifi-recipe-top">{'saving' in recipe ? <span className="hifi-saving"><FigmaImage asset={a.imgVector3} alt="" />-€{recipe.saving}</span> : <span className="hifi-saving">Eigen recept</span>}<button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`} aria-pressed={favorites.includes(recipe.id)} onClick={() => favorite(recipe.id)}><FigmaImage asset={favorites.includes(recipe.id) ? a.recipeHeartActive : a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes ?? '?'}</span><span>{'price' in recipe ? `€${recipe.price} p.p` : `${recipe.servings ?? '?'} porties`}</span></p></div>
      </article>)}</div>
      {!demo.length && !own.length && <p className="hifi-empty">{query ? 'Geen recepten gevonden. Probeer een andere zoekterm.' : 'Voeg je eerste eigen recept toe of importeer een receptlink.'}</p>}
    </section>
    <div className="recipe-add-actions"><button onClick={() => openEditor('manual')}>＋ Eigen recept</button><button onClick={() => openEditor('url')}>Importeer via link</button></div>
    {!!demo.length && <p className="recipe-note">Ontwerpvoorbeelden · prijzen en aanbiedingen zijn niet actueel.</p>}
    {library.error && <p role="alert">{library.error}</p>}<p role="status" className="hifi-feedback">{message}</p>
    <dialog className="hifi-dialog recipe-dialog" ref={editor} aria-labelledby="recipe-editor-title" onCancel={closeEditor} onClose={() => { request.current?.abort(); setBusy(false) }}>
      <button className="recipe-close" onClick={closeEditor} aria-label="Recept sluiten">×</button><h2 id="recipe-editor-title">{mode === 'url' ? 'Recept importeren' : 'Eigen recept toevoegen'}</h2>
      {mode === 'url' ? <form onSubmit={importLink} className="recipe-form"><p>Plak een openbare receptlink. Daarna kun je ingrediënten, porties en bereiding controleren.</p><label>Receptlink<input required type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label><button className="recipe-primary" disabled={busy}>{busy ? 'Recept ophalen…' : 'Importeer recept'}</button><button type="button" onClick={() => { request.current?.abort(); setBusy(false); setMode('manual'); setError('') }}>Handmatig toevoegen</button></form>
        : <form className="recipe-form" onSubmit={check} onChange={() => setPreview(null)}><label>Naam van het recept<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="recipe-form-row"><label>Porties<input required type="number" min="1" max="1000" value={form.servings} onChange={e => setForm({ ...form, servings: e.target.value })} /></label><label>Minuten<input required type="number" min="1" max="1440" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label></div><label>Ingrediënten<textarea required rows={5} placeholder={'200 g rijst\n1 paprika\n250 ml kokosmelk'} value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} /></label><small>Eén ingrediënt per regel, met hoeveelheid en eenheid.</small><label>Bereiding<textarea required rows={5} placeholder="Eén stap per regel" value={form.steps} onChange={e => setForm({ ...form, steps: e.target.value })} /></label>{source && <p>Bron: <a href={source} target="_blank" rel="noreferrer">Bekijk het oorspronkelijke recept</a></p>}<button className="recipe-primary">Controleer recept</button></form>}
      {preview && <section className="recipe-review"><h3>Zo wordt je recept bewaard</h3><ul>{preview.ingredients.map((i, n) => <li key={n}>{i.amount !== null ? `${i.amount} ${i.unit === 'piece' ? 'stuks' : i.unit} ${i.label}` : i.original}{i.reviewReason && <small> · {i.reviewReason}</small>}</li>)}</ul>{preview.warnings.length > 0 && <p>Onbekende hoeveelheden blijven als tekst bewaard. Vul ze aan voordat je een boodschappenberekening maakt.</p>}<p>Bewaren op dit apparaat. Ingrediëntprijzen zijn nog onbekend.</p><button className="recipe-primary" onClick={save} disabled={!!library.error}>Opslaan in mijn recepten</button></section>}
      {error && <p role="alert" className="recipe-error">{error}</p>}
    </dialog>
    <dialog className="hifi-dialog recipe-dialog" ref={detail} aria-labelledby="recipe-detail-title"><button className="recipe-close" onClick={() => detail.current?.close()} aria-label="Details sluiten">×</button>{selected && <>{'image' in selected && <FigmaImage className="hifi-detail-photo" asset={selected.image} alt="" />}<h2 id="recipe-detail-title">{selected.title}</h2><p>{selected.minutes ?? '?'} minuten{'servings' in selected ? ` · ${selected.servings ?? '?'} porties` : ' · ontwerpvoorbeeld'}</p>{'ingredients' in selected ? <><h3>Ingrediënten</h3><ul>{selected.ingredients.map((i, n) => <li key={n}>{i.original}</li>)}</ul><h3>Bereiding</h3><ol>{selected.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Oorspronkelijk recept</a>}<p>Ingrediëntprijzen nog onbekend.</p></> : <p>Dit is een kaart uit het oorspronkelijke ontwerp. Ingrediënten en bereiding zijn nog niet beschikbaar.</p>}</>}</dialog>
  </div>
}
