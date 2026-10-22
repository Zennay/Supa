import { FigmaImage } from '../../components/FigmaImage'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { figmaAssets as a } from './figmaAssets'
import { upcomingHomeWeek } from './homeWeekDates'
// The full recipe editor, URL parsing and private backup tools are only needed
// after visiting Recepten. Keep the home/product browsing bundle lean.
const RecipeLibrary = lazy(async () => {
  const module = await import('../recipes/RecipeLibrary')
  return { default: module.RecipeLibrary }
})
import { curatedFigmaRecipes } from '../recipes/curatedFigmaRecipes'
import { historicalRetailerProducts, filterHistoricalProducts } from '../products/historicalRetailerProducts'
import { filterDemoProductsByUnit, orderDemoProductsByUnitPrice, type DemoUnitFilter } from '../products/productUnitPrice'
import { productSearchText } from '../products/productSearchText'
import { readUnpricedShoppingProgress, saveUnpricedShoppingProgress, unpricedShoppingProgressKey } from './unpricedShoppingProgress'

export type HiFiTab = 'home' | 'recipes' | 'products'
export const designProducts = [
  { id: 'cola-zero', name: 'Coca cola zero 1.5l fl', image: a.imgProductFoto, logo: a.imgDirk, store: 'Dirk', crop: 'dirk', unit: '1.5L', unitPrice: '€1.16/L', old: '€2.15', price: '€1.75' },
  { id: 'bananas', name: 'Del Monte Bananen', image: a.imgProductFoto1, logo: a.imgDirk, store: 'Dirk', crop: 'dirk', unit: 'Per verpakking', unitPrice: '€1.36/KG', old: '€1.55', price: '€1.37' },
  { id: 'cola-pack', name: 'Coca-Cola Zero sugar zero caffeine & calories 4-pack', image: a.imgProductFoto2, logo: a.imgDirk1, store: 'Hoogvliet', crop: 'hoogvliet', unit: '6L', unitPrice: '€1.54/L', old: '€9.26', price: '€7.96' },
  { id: 'cola-regular', name: 'Coca Cola Regular 1,5 liter fles', image: a.imgProductFoto3, logo: a.imgDirk2, store: 'Jumbo', crop: 'jumbo', unit: '1.5L', unitPrice: '€1.09/L', old: '€2.15', price: '€1.64' },
  { id: 'figma-paprika', name: 'Rode paprika', image: a.productPaprika, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per stuk', unitPrice: '', old: '', price: '' },
  { id: 'figma-watermelon', name: 'Watermeloen', image: a.productWatermelon, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per stuk', unitPrice: '', old: '', price: '' },
  { id: 'figma-cola-classic', name: 'Coca Cola Regular fles', image: a.productColaRed, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per verpakking', unitPrice: '', old: '', price: '' },
  { id: 'figma-arla-milk', name: 'Arla Bio halfvolle melk', image: a.productArlaMilk, logo: '', store: 'Figma voorbeeld', crop: '', unit: '1 liter', unitPrice: '', old: '', price: '' },
  { id: 'figma-heineken', name: 'Heineken 6-pack', image: a.productHeinekenPack, logo: '', store: 'Figma voorbeeld', crop: '', unit: '6 × 330 ml', unitPrice: '', old: '', price: '' },
  { id: 'figma-pastry', name: 'Bladerdeeggebak', image: a.productPastry, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per stuk', unitPrice: '', old: '', price: '' },
  { id: 'figma-muffins', name: 'Muffins', image: a.productMuffins, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per verpakking', unitPrice: '', old: '', price: '' },
  { id: 'figma-peanut-butter', name: 'Calvé pindakaas', image: a.productCalvePeanutButter, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per pot', unitPrice: '', old: '', price: '' },
  { id: 'figma-fruit', name: 'Fruitmix', image: a.productFruitSalad, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per verpakking', unitPrice: '', old: '', price: '' },
  { id: 'figma-ginger', name: 'Verse gember', image: a.productGinger, logo: '', store: 'Figma voorbeeld', crop: '', unit: 'Per stuk', unitPrice: '', old: '', price: '' },
]
const designRecipes = curatedFigmaRecipes.filter(recipe =>
  recipe.id === 'supa-fried-rice' || recipe.id === 'supa-bao' || recipe.id === 'supa-katsu',
).map(recipe => ({
  ...recipe,
  image: recipe.id === 'supa-fried-rice' ? a.imgRecepten :
    recipe.id === 'supa-bao' ? a.imgRecepten1 : a.imgRecepten2,
}))
const discoveryFavoritesKey = 'supa:hifi-favorites:v1'
const discoveryFavoriteIds = new Set([...designProducts.map(p => p.id), ...historicalRetailerProducts.map(p => p.id), ...designRecipes.map(r => r.id)])
// Identity-only selections must never import retailer prices, recipe IDs or unknown SKUs.
const portableProductIds = new Set([...designProducts.map(p => p.id), ...historicalRetailerProducts.map(p => p.id)])
type DiscoveryFavoritesSnapshot = { ids: string[]; raw: string | null; writable: boolean }
function readDiscoveryFavorites(): DiscoveryFavoritesSnapshot {
  if (typeof window === 'undefined') return { ids: [], raw: null, writable: false }
  try {
    const raw = window.localStorage.getItem(discoveryFavoritesKey)
    if (raw === null) return { ids: [], raw: null, writable: true }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ids: [], raw, writable: false }
    const record = value as Record<string, unknown>, ids = record.ids
    if (record.schemaVersion !== 1 || Object.keys(record).some(key => key !== 'schemaVersion' && key !== 'ids') ||
        !Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) ||
        new Set(ids).size !== ids.length) return { ids: [], raw, writable: false }
    return { ids: ids.filter((id): id is string => discoveryFavoriteIds.has(id)), raw, writable: true }
  } catch { return { ids: [], raw: null, writable: false } }
}


type Props = {
  view: HiFiTab
  onNavigate: (view: HiFiTab | 'planner' | 'list' | 'basket') => void
  addedProducts: string[]
  onToggleProduct: (id: string) => void
  activeDays?: readonly string[]
}

export function HiFiHome(props: Props) {
  if (props.view === 'recipes') return <Suspense fallback={
    <section className="hifi-home" role="status" aria-live="polite">
      <p>Je recepten worden geopend…</p>
    </section>
  }><RecipeLibrary onBack={() => props.onNavigate('home')} /></Suspense>
  return <HiFiDiscovery {...props} />
}

function HiFiDiscovery({ view, onNavigate, addedProducts, onToggleProduct, activeDays = [] }: Props) {
  const [query, setQuery] = useState('')
  const [portableText, setPortableText] = useState('')
  const [portablePreview, setPortablePreview] = useState<string[] | null>(null)
  const [portableMessage, setPortableMessage] = useState('')
  const portableReadVersion = useRef(0)
  const [initialFavorites] = useState(readDiscoveryFavorites)
  const [favorites, setFavorites] = useState<string[]>(initialFavorites.ids)
  const [favoritesRaw, setFavoritesRaw] = useState(initialFavorites.raw)
  const [favoritesWritable, setFavoritesWritable] = useState(initialFavorites.writable)
  useEffect(() => {
    const syncFavorites = (event: StorageEvent) => {
      if (event.key !== null && event.key !== discoveryFavoritesKey) return
      const snapshot = readDiscoveryFavorites()
      setFavorites(snapshot.ids)
      setFavoritesRaw(snapshot.raw)
      setFavoritesWritable(snapshot.writable)
      if (!snapshot.writable) setMessage('Favorieten zijn elders gewijzigd met gegevens die deze versie niet kan opslaan; de bestaande opslag blijft behouden.')
    }
    window.addEventListener('storage', syncFavorites)
    return () => window.removeEventListener('storage', syncFavorites)
  }, [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<typeof designRecipes[number] | null>(null)
  const [message, setMessage] = useState('')
  const [sortByPrice, setSortByPrice] = useState(false)
  const [unitFilter, setUnitFilter] = useState<DemoUnitFilter>('all')
  const [productSource, setProductSource] = useState<'history' | 'figma'>('figma')
  const [storeFilter, setStoreFilter] = useState<'all' | 'PLUS' | 'DekaMarkt'>('all')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    setQuery('')
    // Recipe and product favorites have different IDs. Do not carry a
    // recipe-only favorites filter into Products when the tab changes.
    if (view === 'products') {
      setFavoritesOnly(false)
      setSelectedOnly(false)
      setUnitFilter('all')
      setStoreFilter('all')
      setSortByPrice(false)
    }
  }, [view])
  // Search only: normalize accents/case, Dutch decimal commas and spacing
  // between a quantity and its unit. This never alters captured source data.
  const normalizeCatalogSearch = (value: string) =>
    productSearchText(value)
      .replace(/(\d),(?=\d)/gu, '$1.')
      // Normalize written-out metric units only for matching, not for display.
      .replace(/\bmilliliter(?:s)?\b|\bmillilitre(?:s)?\b/gu, 'ml')
      .replace(/\bcentiliter(?:s)?\b|\bcentilitre(?:s)?\b/gu, 'cl')
      .replace(/\bdeciliter(?:s)?\b|\bdecilitre(?:s)?\b/gu, 'dl')
      .replace(/\bliter(?:s)?\b|\blitre(?:s)?\b/gu, 'l')
      .replace(/\bkilogram(?:men|s)?\b/gu, 'kg')
      .replace(/\bgram(?:men|s)?\b/gu, 'g')
      // Treat common multipack spellings as the same search-only form:
      // “6 × 330 ml”, “6x330ml” and “6 x 330 ml”. Captured data stays intact.
      .replace(/(\d)\s*[×✕✖x]\s*(?=\d)/gu, '$1x')
      .replace(/(\d)\s+([a-z])/gu, '$1$2')
  // Each word is a separate constraint, allowing product + retailer + pack
  // terms to match across fields without inventing a combined product identity.
  const queryTerms = normalizeCatalogSearch(query.trim()).split(/\s+/u).filter(Boolean)
  const includesQuery = (values: readonly (string | null | undefined)[]) =>
    queryTerms.every(term => values.some(value => typeof value === 'string' &&
      normalizeCatalogSearch(value).includes(term)))
  const recipes = designRecipes.filter(recipe =>
    includesQuery([recipe.title]) && (!favoritesOnly || favorites.includes(recipe.id)))
  const matchingProducts = filterDemoProductsByUnit(designProducts.filter(product =>
    (view === 'products' ? product.id !== 'bananas' : !product.id.startsWith('figma-')) &&
    includesQuery([product.name, product.store, product.unit, product.unitPrice, product.old, product.price, product.id]) &&
    (!favoritesOnly || favorites.includes(product.id)) &&
    (!selectedOnly || addedProducts.includes(product.id))), unitFilter)
  const products = sortByPrice ? orderDemoProductsByUnitPrice(matchingProducts) :
    view === 'products' ? [...matchingProducts].sort((left, right) =>
      ['cola-regular', 'cola-zero', 'figma-paprika', 'figma-watermelon', 'figma-cola-classic', 'figma-arla-milk', 'figma-heineken', 'figma-pastry', 'figma-muffins', 'figma-peanut-butter', 'figma-fruit', 'figma-ginger', 'cola-pack'].indexOf(left.id) -
      ['cola-regular', 'cola-zero', 'figma-paprika', 'figma-watermelon', 'figma-cola-classic', 'figma-arla-milk', 'figma-heineken', 'figma-pastry', 'figma-muffins', 'figma-peanut-butter', 'figma-fruit', 'figma-ginger', 'cola-pack'].indexOf(right.id)) : matchingProducts
  const historical = filterHistoricalProducts(historicalRetailerProducts, '', storeFilter).filter(item =>
    includesQuery([item.name, item.pack, item.store, item.capturedAt, item.sourceUrl, item.id]) &&
    (!favoritesOnly || favorites.includes(item.id)) &&
    (!selectedOnly || addedProducts.includes(item.id)))
  // Only explicit user selections enter this separate, unpriced shortlist.
  // Archived identities and design examples never feed the price calculator.
  const visibleProductIds = (productSource === 'history' ? historical : products).map(item => item.id)
  const notYetSelected = visibleProductIds.filter(id => !addedProducts.includes(id))
  const freeSlots = Math.max(0, 100 - addedProducts.length)
  const toAdd = notYetSelected.slice(0, freeSlots)
  const addVisibleToUnpricedList = () => {
    if (toAdd.length === 0) return
    for (const id of toAdd) onToggleProduct(id)
    setMessage(`${toAdd.length} van ${notYetSelected.length} zichtbare producten aan je ongeprijsde lijst toegevoegd. ${toAdd.length < notYetSelected.length ? 'De lijst bevat maximaal 100 items. ' : ''}Er zijn geen winkelprijzen of matches gemaakt.`)
  }
  const downloadPortableSelection = () => {
    const ids = [...new Set(addedProducts.filter(id => portableProductIds.has(id)))]
    const backup = JSON.stringify({ kind: 'supa-unpriced-product-selection', schemaVersion: 1, ids }, null, 2)
    if (typeof document === 'undefined') return
    const url = URL.createObjectURL(new Blob([backup], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'supa-productselectie-ongeprijsd.json'
    document.body.appendChild(anchor)
    try { anchor.click() } finally {
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    setPortableMessage(`${ids.length} bekende productidentiteiten lokaal geëxporteerd, zonder prijzen. ${addedProducts.length - ids.length} oude/onbekende ID's blijven alleen op dit apparaat behouden.`)
  }
  const previewPortableSelection = () => {
    setPortablePreview(null)
    if (new TextEncoder().encode(portableText).byteLength > 16_384) { setPortableMessage('Bestand te groot (maximaal 16 kB UTF-8).'); return }
    try {
      const parsed: unknown = JSON.parse(portableText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Ongeldig selectiebestand.')
      const record = parsed as Record<string, unknown>
      if (Object.keys(record).sort().join('|') !== 'ids|kind|schemaVersion' ||
          record.kind !== 'supa-unpriced-product-selection' || record.schemaVersion !== 1 ||
          !Array.isArray(record.ids) || record.ids.length > 100 ||
          !record.ids.every(id => typeof id === 'string' && portableProductIds.has(id)) ||
          new Set(record.ids).size !== record.ids.length) {
        throw Error('Alleen een origineel identiteitsbestand van deze catalogusversie is toegestaan; retailerprijzen en onbekende velden worden geweigerd.')
      }
      const ids = record.ids as string[]
      setPortablePreview(ids)
      setPortableMessage(`${ids.length} identiteiten veilig gelezen. Controleer hieronder wat aan jouw bestaande lijst wordt toegevoegd; winkelprijzen blijven onbekend.`)
    } catch (error) {
      setPortableMessage(error instanceof Error ? error.message : 'Selectiebestand kon niet worden gelezen.')
    }
  }
  const pendingPortableIds = portablePreview?.filter(id => !addedProducts.includes(id)) ?? []
  const permittedPortableIds = pendingPortableIds.slice(0, Math.max(0, 100 - addedProducts.length))
  const importPortableSelection = () => {
    if (portablePreview === null || permittedPortableIds.length === 0) return
    for (const id of permittedPortableIds) onToggleProduct(id)
    setPortableMessage(`${permittedPortableIds.length} bestaande identiteiten toegevoegd als ongeprijsde selectie; ${pendingPortableIds.length - permittedPortableIds.length} passen niet binnen de limiet. Geen winkelprijs of SKU-match overgenomen.`)
    setPortablePreview(null)
    setPortableText('')
  }
  const toggleFavorite = (id: string) => {
    if (!discoveryFavoriteIds.has(id)) return
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]
    if (typeof window === 'undefined' || !favoritesWritable) {
      setFavorites(next)
      setMessage('Favoriet alleen voor deze sessie gewijzigd; bestaande opgeslagen gegevens zijn beschermd.')
      return
    }
    try {
      if (window.localStorage.getItem(discoveryFavoritesKey) !== favoritesRaw) {
        setFavoritesWritable(false)
        setMessage('Favorieten zijn elders gewijzigd. De opgeslagen versie is niet overschreven; laad de pagina om die op te halen.')
        return
      }
      const raw = JSON.stringify({ schemaVersion: 1, ids: next })
      window.localStorage.setItem(discoveryFavoritesKey, raw)
      setFavoritesRaw(raw)
      setFavorites(next)
    } catch {
      setFavorites(next)
      setFavoritesWritable(false)
      setMessage('Favoriet alleen voor deze sessie gewijzigd; browseropslag is niet beschikbaar.')
    }
  }
  const switchProductSource = (source: 'history' | 'figma') => {
    setProductSource(source)
    // Keep the user's search intent while resetting filters that only make
    // sense for the source being left (retailer, unit price and favorites).
    setFavoritesOnly(false)
    setUnitFilter('all')
    setStoreFilter('all')
    setSortByPrice(false)
  }
  const clearSearchAndFilters = () => {
    setQuery('')
    setFavoritesOnly(false)
    setSelectedOnly(false)
    setUnitFilter('all')
    setStoreFilter('all')
    setSortByPrice(false)
  }
  const changeView = (next: HiFiTab) => { setQuery(''); setUnitFilter('all'); setSortByPrice(false); onNavigate(next) }


  return <div className={`hifi-home${view === 'products' ? ' hifi-products' : ''}`} data-figma-node={view === 'products' ? '3064:3125' : '3307:4224'}>
    {view === 'home' ? <>
      <header className="hifi-greeting">
        <div className="hifi-person"><FigmaImage asset={a.imgImage27} alt="Demo-avatar uit het ontwerp" width="48" height="48" /><div><p>Goedemorgen</p><strong>Nick Bergen <span className="hifi-demo-label">· demo</span></strong></div></div>
        <button className="hifi-icon-button" aria-label="Meldingen" onClick={() => setMessage('Je hebt geen nieuwe meldingen.')}><FigmaImage asset={a.imgFrame7312} alt="" /></button>
      </header>
      <section className="hifi-week" aria-labelledby="hifi-week-title" data-figma-node="3307:4186">
        <div><h1 id="hifi-week-title">Weekplanning</h1><p>Maak een planning en ontdek wat je kunt besparen met aanbiedingen en overlappende ingrediënten.</p></div>
        <div className="hifi-days">{upcomingHomeWeek().map(({ label, date, plannerDay, fullName, month, year }) => <button key={`${year}-${month}-${date}`} onClick={() => onNavigate('planner')} aria-label={`Open weekplanning voor ${fullName} ${date}`}><span className={activeDays.includes(plannerDay) ? 'hifi-today' : ''}>{label}</span><span>{date}</span></button>)}</div>
        <button className="hifi-plan-button" onClick={() => onNavigate('planner')}><FigmaImage asset={a.imgVector} alt="" />Plan en bespaar</button>
      </section>
    </> : <header className="hifi-products-heading" data-figma-node="3064:3128"><h1 className="hifi-page-title">Producten</h1><button type="button" className="hifi-go-to-list" onClick={() => onNavigate('list')} aria-label={`Bekijk mijn lijst met ${addedProducts.length} gekozen producten`}>Mijn lijst <span aria-hidden="true">({addedProducts.length})</span> →</button><button className="hifi-icon-button" aria-label="Productfilters" aria-expanded={filterOpen} aria-controls="hifi-filter-panel" onClick={() => setFilterOpen(!filterOpen)}><FigmaImage asset={a.productsFilter} alt="" /></button></header>}

    <div className="hifi-search-row" data-figma-node={view === 'products' ? '3068:4921' : undefined}>
      <label className="hifi-search"><FigmaImage asset={view === "products" ? a.productsSearch : a.imgVector1} alt="" /><input type="search" aria-label={view === 'products' ? 'Zoek producten op naam, winkel, verpakking of broncode' : 'Zoek gerechten of producten'} placeholder={view === 'products' ? 'Coca Cola' : 'Zoek gerechten of producten'} value={query} onChange={e => setQuery(e.target.value)} /></label>
      {view === 'products'
        ? <button className="hifi-weekly-link" type="button" aria-label="Ga naar de weekplanning" onClick={() => onNavigate('planner')}><FigmaImage asset={a.productsWeekly} alt="" /></button>
        : <button className="hifi-filter" aria-label="Filters" aria-expanded={filterOpen} aria-controls="hifi-filter-panel" onClick={() => setFilterOpen(!filterOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button>}
    </div>
    {filterOpen && <div id="hifi-filter-panel" className="hifi-filter-panel"><label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> Alleen favorieten</label>{view === 'products' && <label><input type="checkbox" checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)} /> Alleen mijn lijstselectie</label>}{view === 'products' && productSource === 'history' && <label>Winkel <select aria-label="Filter historische producten op winkel" value={storeFilter} onChange={e => setStoreFilter(e.target.value as 'all' | 'PLUS' | 'DekaMarkt')}><option value="all">Alle winkels</option><option value="PLUS">PLUS</option><option value="DekaMarkt">DekaMarkt</option></select></label>}{view === 'products' && productSource === 'figma' && <label>Eenheid <select aria-label="Filter producten op eenheid" value={unitFilter} onChange={e => setUnitFilter(e.target.value as DemoUnitFilter)}><option value="all">Alle eenheden</option><option value="l">Per liter</option><option value="kg">Per kilogram</option></select></label>}<button type="button" onClick={clearSearchAndFilters}>Wis filters</button></div>}
    {view === 'home' && <p className="hifi-demo-note">Recepten uit de SUPA-planner · voorbeeldproductprijzen en aanbiedingen zijn niet actueel.</p>}
    {view === 'home' && <section className="hifi-section" aria-label="Mijn eigen winkelmand vergelijken">
      <h2>Jouw recepten, jouw winkelmand</h2>
      <p className="hifi-demo-note">Gebruik de actuele Planner-ingrediënten met je eigen PLUS/DekaMarkt-bronbestand.
        De berekening is privé en geeft ontbrekende winkelprijzen eerlijk als onbekend weer.</p>
      <button type="button" className="hifi-plan-button" onClick={() => onNavigate('basket')}>
        Vergelijk mijn winkelmand
      </button>
    </section>}
    {view !== 'products' && <section className="hifi-section" aria-labelledby="hifi-recipes-title">
      <div className="hifi-section-heading"><h2 id="hifi-recipes-title">Recepten uit je planner</h2>{view === 'home' && <button onClick={() => changeView('recipes')}>Bekijk meer <FigmaImage asset={a.imgFrame7159} alt="" /></button>}</div>
      <div className={view === 'recipes' ? 'hifi-recipe-grid' : 'hifi-recipe-row'}>{recipes.map(recipe => <article key={recipe.id} className="hifi-recipe-card">
        {recipe.image && <FigmaImage className="hifi-recipe-photo" asset={recipe.image} alt="" />}
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.title}`} onClick={() => { setSelectedRecipe(recipe); dialog.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving">In je planner</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.title}`} aria-pressed={favorites.includes(recipe.id)} onClick={() => toggleFavorite(recipe.id)}><FigmaImage asset={a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.title}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes}</span><span>{recipe.servings} porties</span></p></div>
      </article>)}</div>
      {recipes.length === 0 && <div className="hifi-empty-state" role="status"><p className="hifi-empty">Geen gerechten gevonden. Pas je zoekopdracht aan of wis je filters.</p><button type="button" className="hifi-empty-reset" onClick={clearSearchAndFilters}>Wis zoekopdracht en filters</button></div>}
    </section>}
    {view === 'products' && <div className="hifi-product-source-tabs" role="group" aria-label="Productbron"><button type="button" aria-pressed={productSource === 'history'} onClick={() => switchProductSource('history')}>Bronwaarnemingen</button><button type="button" aria-pressed={productSource === 'figma'} onClick={() => switchProductSource('figma')}>Figma voorbeelden</button></div>}
    {view === 'products' && <div className="hifi-catalog-tools" role="group" aria-label="Producten kiezen voor mijn ongeprijsde lijst">
      <p role="status" aria-live="polite">{addedProducts.length} gekozen voor mijn lijst · {visibleProductIds.length} zichtbaar uit {productSource === 'history' ? 'historisch brononderzoek' : 'Figma-voorbeelden'}</p>
      <button type="button" className="hifi-empty-reset" aria-pressed={selectedOnly}
        onClick={() => setSelectedOnly(!selectedOnly)}>{selectedOnly ? 'Toon ook niet-gekozen producten' : 'Toon alleen mijn selectie'}</button>
      <button type="button" className="hifi-empty-reset" disabled={toAdd.length === 0}
        onClick={addVisibleToUnpricedList}>{freeSlots === 0 ? 'Lijst vol (maximaal 100)' : `Voeg ${toAdd.length} van ${notYetSelected.length} zichtbare producten toe`}</button>
      <button type="button" className="hifi-empty-reset" onClick={() => onNavigate('list')}>Open mijn lijst →</button>
      <small>Deze keuzes blijven apart en ongeprijsd; geen actuele supermarktprijzen of automatische productmatches.</small>
    </div>}
    {view === 'products' && <details className="hifi-product-portable">
      <summary>Mijn ongeprijsde productselectie overzetten</summary>
      <p>Exporteer alleen de door jou gekozen catalogusidentiteiten. Geen recepten, winkelprijzen, bronrechten of geverifieerde SKU-matches. Import voegt pas na jouw bevestiging toe.</p>
      <button type="button" onClick={downloadPortableSelection}>Download eigen selectie (.json)</button>
      <label>Eigen JSON-selectiebestand openen
        <input type="file" accept=".json,application/json" onChange={async event => {
          const version = ++portableReadVersion.current
          setPortablePreview(null)
          const input = event.currentTarget
          const file = input.files?.[0]
          input.value = ''
          if (!file) return
          if (file.size > 16_384 || !file.size) {
            setPortableMessage('Selectiebestand moet gevuld zijn en maximaal 16 kB bevatten.')
            return
          }
          try {
            const bytes = await file.arrayBuffer()
            if (version !== portableReadVersion.current) return
            // JSON backups produced by Supa are UTF-8. Never silently repair
            // invalid bytes into a different list of product identities.
            const contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            if (new TextEncoder().encode(contents).byteLength > 16_384)
              throw Error('Bestand te groot')
            setPortableText(contents)
            setPortableMessage('Eigen UTF-8 selectiebestand geladen. Controleer de voorbeeldlijst vóór toevoegen.')
          } catch {
            if (version === portableReadVersion.current)
              setPortableMessage('Geen geldig UTF-8 JSON-selectiebestand; je bestaande lijst is behouden.')
          }
        }} />
      </label>
      <label>Of plak eigen JSON
        <textarea value={portableText} maxLength={16_384} rows={4}
          onChange={event => { portableReadVersion.current += 1; setPortableText(event.target.value); setPortablePreview(null); setPortableMessage('') }}
          placeholder='{"kind":"supa-unpriced-product-selection","schemaVersion":1,"ids":[]}' />
      </label>
      <button type="button" disabled={!portableText.trim()} onClick={previewPortableSelection}>Voorbeeld controleren</button>
      {portablePreview !== null && <p role="status">{portablePreview.length} geldig · {pendingPortableIds.length} nog niet op mijn lijst · {permittedPortableIds.length} kunnen worden toegevoegd.</p>}
      {portablePreview !== null && <button type="button" disabled={permittedPortableIds.length === 0}
        onClick={importPortableSelection}>Voeg {permittedPortableIds.length} ongeprijsde producten toe</button>}
      <p role="status" aria-live="polite">{portableMessage}</p>
    </details>}
    {view === 'products' && <section className="hifi-section" aria-label="Vergelijk met je eigen werkelijke winkelbron">
      <div className="hifi-section-heading"><h2>Vergelijk jouw eigen winkelprijzen</h2></div>
      <p className="hifi-demo-note">De historische productvoorbeelden hierboven hebben geen vrijgegeven actuele prijzen.
        Met jouw eigen rechtmatig verkregen PLUS- of DekaMarkt-opname koppelt Supa echte
        bronartikelen aan het geselecteerde weekmenu. Zonder volledige broncontrole wordt er
        geen winkelprijs of besparing verzonnen.</p>
      <button type="button" className="hifi-plan-button" onClick={() => onNavigate('basket')}>
        Open Vergelijk · eigen prijzen invoeren
      </button>
    </section>}
    {view === 'products' && productSource === 'history' && <section className="hifi-section" aria-label="Historisch vastgelegde supermarktproducten">
      <div className="hifi-section-heading"><div><h2>Producten uit brononderzoek</h2><p className="recipe-count" role="status" aria-live="polite">{historical.length} producten · PLUS en DekaMarkt</p></div></div>
      <p className="hifi-demo-note hifi-historical-warning">Alleen historische bronwaarnemingen van 4 oktober 2026. Niet actueel, nog niet gelicentieerd voor productie. Geen prijzen, aanbiedingen, besparingen of beschikbaarheidsclaims.</p>
      <div className="hifi-product-grid">{historical.map(item => <article className="hifi-product-card" key={item.id} data-product-source="historical"><div className="hifi-product-image"><span className="hifi-source-image" aria-hidden="true">{item.name.slice(0, 1)}</span><span className="hifi-store-logo hifi-store-text">{item.store === 'PLUS' ? 'PLUS' : 'Deka'}</span></div><div className="hifi-product-copy"><h3>{item.name}</h3><div className="hifi-product-price"><span>{item.pack}</span></div><span className="hifi-no-price">Prijs niet vrijgegeven</span><small>Bron: {item.store} · {new Date(item.capturedAt).toLocaleDateString('nl-NL')}</small></div><div className="hifi-product-actions"><button className="hifi-product-favorite" aria-label={`Favoriet: ${item.name} bij ${item.store}`} aria-pressed={favorites.includes(item.id)} onClick={() => toggleFavorite(item.id)}><FigmaImage asset={a.imgHeartButton} alt="" /></button><button type="button" className="hifi-history-add" aria-pressed={addedProducts.includes(item.id)}
  aria-label={`${addedProducts.includes(item.id) ? 'Verwijder uit lijst' : 'Voeg toe aan lijst'}: ${item.name} bij ${item.store}`}
  onClick={() => { if (!addedProducts.includes(item.id) && addedProducts.length >= 100) { setMessage('Je lijst is vol (maximaal 100 producten). Verwijder eerst een keuze via Lijst.'); return } onToggleProduct(item.id); setMessage(addedProducts.includes(item.id)
    ? `${item.name} verwijderd uit je eigen lijst.`
    : `${item.name} toegevoegd zonder prijsclaim. Open Lijst om je keuze te bekijken.`) }}>
  {addedProducts.includes(item.id) ? '✓ In lijst' : '+ Lijst'}
</button>
<a className="hifi-source-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Bekijk bronpagina bij ${item.store}: ${item.name}`}>Bron ↗</a></div></article>)}</div>
      {historical.length === 0 && <div className="hifi-empty-state" role="status"><p className="hifi-empty">Geen historische productwaarnemingen gevonden met deze zoekopdracht en filters.</p><button type="button" className="hifi-empty-reset" onClick={clearSearchAndFilters}>Wis zoekopdracht en filters</button></div>}
    </section>}
    {(view === 'home' || (view === 'products' && productSource === 'figma')) && <section className="hifi-section" aria-labelledby="hifi-products-title">
      <div className="hifi-section-heading" data-figma-node={view === 'products' ? '3064:3181' : undefined}><div><h2 id="hifi-products-title">{view === 'products' ? query.trim() || 'Populaire producten' : 'Productvoorbeelden · demo'}</h2>{view === 'products' && <p className="recipe-count" role="status" aria-live="polite">{products.length} producten</p>}</div>{view === 'home' ? <button onClick={() => changeView('products')}>Bekijk meer <FigmaImage asset={a.imgFrame7159} alt="" /></button> : <button className="hifi-product-sort" aria-pressed={sortByPrice} aria-label="Sorteer voorbeeldproducten op laagste prijs per kg of liter" onClick={() => setSortByPrice(!sortByPrice)}>Laagste prijs per kg / l <FigmaImage asset={a.productsSort} alt="" /></button>}</div>
      {view === 'products' && <p className="hifi-demo-note">Figma ontwerpvoorbeelden · de getoonde prijzen en aanbiedingen zijn niet actueel.</p>}
      <div className="hifi-product-grid" data-figma-node={view === 'products' ? '3064:3342' : undefined}>{products.map(product => <article className="hifi-product-card" key={product.id}>
        <div className="hifi-product-image"><FigmaImage className="hifi-product-photo" asset={product.image} alt={product.name} />{product.logo && <span className={`hifi-store-logo ${product.crop}`}><FigmaImage asset={product.logo} alt={product.store} /></span>}{product.unitPrice && <span className="hifi-unit-price">{product.unitPrice}</span>}</div>
        <div className="hifi-product-copy"><h3>{product.name}</h3><div className="hifi-product-price"><span>{product.unit}</span>{product.old && <del>{product.old}</del>}{product.price ? <strong>{product.price}</strong> : <small className="hifi-unpriced">Prijsvoorbeeld ontbreekt</small>}</div></div>
        <div className="hifi-product-actions"><button className="hifi-product-favorite" aria-label={`Favoriet: ${product.name}`} aria-pressed={favorites.includes(product.id)} onClick={() => toggleFavorite(product.id)}><FigmaImage asset={a.imgHeartButton} alt="" /></button><button aria-label={`${addedProducts.includes(product.id) ? 'Verwijder' : 'Voeg toe'}: ${product.name}`} aria-pressed={addedProducts.includes(product.id)} onClick={() => { if (!addedProducts.includes(product.id) && addedProducts.length >= 100) { setMessage('Je lijst is vol (maximaal 100 producten). Verwijder eerst een keuze via Lijst.'); return } onToggleProduct(product.id); setMessage(addedProducts.includes(product.id) ? `${product.name} verwijderd uit je demolijst.` : `${product.name} toegevoegd aan je demolijst.`) }}>{addedProducts.includes(product.id) ? <span className="hifi-added">✓</span> : <FigmaImage asset={a.imgFrame7121} alt="" />}</button></div>
      </article>)}</div>
      {products.length === 0 && <div className="hifi-empty-state" role="status"><p className="hifi-empty">Geen producten gevonden. Pas je zoekopdracht aan of wis je filters.</p><button type="button" className="hifi-empty-reset" onClick={clearSearchAndFilters}>Wis zoekopdracht en filters</button></div>}
    </section>}
    <p className="hifi-feedback" role="status">{message}</p>
    <dialog className="hifi-dialog" ref={dialog} onClose={() => setSelectedRecipe(null)} aria-labelledby="hifi-detail-title">
      {selectedRecipe && <><form method="dialog"><button className="ghost-button">Sluiten</button></form>{selectedRecipe.image && <FigmaImage className="hifi-detail-photo" asset={selectedRecipe.image} alt="" />}<h2 id="hifi-detail-title">{selectedRecipe.title}</h2><p>{selectedRecipe.minutes} minuten · {selectedRecipe.servings} porties</p><h3>Ingrediënten</h3><ul>{selectedRecipe.ingredients.map(item => <li key={item.id}>{item.amount} {item.unit === 'piece' ? 'stuks' : item.unit} {item.label}</li>)}</ul><h3>Bereiding</h3><ol>{selectedRecipe.steps.map(step => <li key={step}>{step}</li>)}</ol><p>Geen geverifieerde supermarktprijs of besparingsclaim.</p><button className="hifi-plan-button" onClick={() => { dialog.current?.close(); onNavigate('planner') }}>Open de planner</button></>}
    </dialog>
  </div>
}

export function HiFiDemoList({ ids, onRemove }: { ids: string[]; onRemove: (id: string) => void }) {
  // The standalone user-picked product collection is distinct from the meal-plan
  // ingredient checklist and never participates in the price comparator.
  const [progress, setProgress] = useState(readUnpricedShoppingProgress)
  const [progressMessage, setProgressMessage] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [copyOnlyOpen, setCopyOnlyOpen] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== unpricedShoppingProgressKey) return
      setProgress(readUnpricedShoppingProgress())
      setProgressMessage('Je aparte, ongeprijsde afvinklijst is op dit apparaat bijgewerkt.')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const completed = (id: string) => progress.doneIds.includes(id)
  const completedCount = ids.filter(completed).length
  function saveDone(next: readonly string[], success: string) {
    const saved = saveUnpricedShoppingProgress(progress, next)
    if (!saved) {
      setProgress(readUnpricedShoppingProgress())
      setProgressMessage('Afvinken niet opgeslagen: deze browseropslag is gewijzigd of niet beschikbaar. De bestaande lijst is beschermd.')
      return false
    }
    setProgress(saved)
    setProgressMessage(success)
    return true
  }
  function toggleDone(id: string) {
    if (!ids.includes(id)) return
    const next = ids.filter(candidate =>
      candidate === id ? !completed(candidate) : completed(candidate))
    saveDone(next, completed(id) ? 'Weer te kopen gemarkeerd.' : 'Product afgevinkt op dit apparaat.')
  }
  function removeAndUncheck(id: string) {
    if (completed(id)) {
      const cleaned = progress.doneIds.filter(item => item !== id)
      // Never delete future-schema bytes in order to remove a product.
      saveDone(cleaned, 'Product uit de aparte lijst verwijderd.')
    }
    onRemove(id)
  }
  const selectedHistorical = historicalRetailerProducts.filter(item => ids.includes(item.id))
  const selectedExamples = designProducts.filter(item => ids.includes(item.id))
  const recognizedIds = new Set([...selectedHistorical.map(item => item.id), ...selectedExamples.map(item => item.id)])
  const selectedUnknown = ids.filter(id => !recognizedIds.has(id))
  const selectedLines = [...selectedHistorical.map(item => `${completed(item.id) ? '☒' : '☐'} ${item.name} · ${item.store} · ${item.pack} · prijs onbekend (historisch)`),
    ...selectedExamples.map(item => `${completed(item.id) ? '☒' : '☐'} ${item.name} · Figma-demo, geen actuele prijs`),
    ...selectedUnknown.map(id => `${completed(id) ? '☒' : '☐'} Product niet beschikbaar · oude product-ID ${id} · prijs onbekend`)]
  const selectionText = selectedLines.join('\n')
  const openSelectionText = selectedLines.filter(line => line.startsWith('☐ ')).join('\n')
  const currentIdsRef = useRef(JSON.stringify(ids))
  currentIdsRef.current = JSON.stringify(ids)
  async function copyOpenShoppingList() {
    if (!openSelectionText) return
    const key = currentIdsRef.current
    const previousRaw = progress.raw
    setCopyOnlyOpen(true)
    try {
      if (!navigator.clipboard?.writeText) throw Error('Geen klembord')
      await navigator.clipboard.writeText('SUPA · nog te kopen · ongeprijsd\n' + openSelectionText)
      setCopyMessage(key === currentIdsRef.current &&
        previousRaw === readUnpricedShoppingProgress().raw
        ? 'Alleen jouw nog te kopen producten gekopieerd, zonder winkelprijzen.'
        : 'De lijst wijzigde tijdens het kopiëren. Bekijk en kopieer de actuele lijst opnieuw.')
    } catch {
      setCopyMessage('Klembord geweigerd. De tekst hieronder bevat uitsluitend nog te kopen producten; selecteer om handmatig te kopiëren.')
    }
  }
  const visibleHistorical = openOnly ? selectedHistorical.filter(item => !completed(item.id)) : selectedHistorical
  const visibleExamples = openOnly ? selectedExamples.filter(item => !completed(item.id)) : selectedExamples
  const visibleUnknown = openOnly ? selectedUnknown.filter(id => !completed(id)) : selectedUnknown
  const progressControl = (id: string, name: string) => (
    <label className="hifi-picked-tick">
      <input type="checkbox" checked={completed(id)} onChange={() => toggleDone(id)}
        disabled={!progress.writable} aria-label={`Afgevinkt: ${name}`} />
      <span>{completed(id) ? 'Gekocht' : 'Nog kopen'}</span>
    </label>
  )
  const downloadSelection = (onlyOpen = false) => {
    const selected = onlyOpen ? openSelectionText : selectionText
    if (typeof document === 'undefined' || !selected) return
    const note = 'SUPA · eigen productselectie (ongeprijsd)\n' +
      'Niet meegerekend in Planner, geverifieerde winkelmand of besparing.\n' +
      'Gekocht = eigen handmatig afgevinkte status, geen winkelbewijs.\n\n' + selected + '\n'
    const url = URL.createObjectURL(new Blob([note], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = onlyOpen ? 'supa-nog-te-kopen-ongeprijsd.txt' : 'supa-eigen-productselectie-ongeprijsd.txt'
    document.body.appendChild(anchor)
    try { anchor.click() } finally {
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  }
  if (!selectedLines.length) return null

  return <section className="hifi-demo-list" aria-label="Zelf gekozen producten">
    <h3>Jouw gekozen producten</h3>
    <p className="disclaimer">Eigen verzamelijst · niet meegenomen in de berekende maaltijdmand of winkelvergelijking.
      Dit is geen offerte, actuele voorraad of bewijs van besparing.</p>
    <div className="hifi-picked-progress" role="group" aria-label="Mijn afvinkvoortgang voor ongeprijsde producten">
      <p role="status" aria-live="polite">{completedCount} van {ids.length} eigen producten afgevinkt · {ids.length - completedCount} nog te kopen.</p>
      <progress max={Math.max(1, ids.length)} value={completedCount}
        aria-label="Afgevinkte producten uit mijn ongeprijsde selectie" />
      <button type="button" className="ghost-button" aria-pressed={openOnly}
        onClick={() => setOpenOnly(!openOnly)}>
        {openOnly ? 'Toon ook gekochte producten' : 'Toon alleen nog te kopen'}
      </button>
      <button type="button" className="ghost-button"
        disabled={!progress.writable || completedCount === 0}
        onClick={() => {
          if (window.confirm('Alle afvinkingen van deze persoonlijke, ongeprijsde lijst terugzetten op nog te kopen?'))
            saveDone([], 'Alle productselecties opnieuw als nog te kopen gemarkeerd.')
        }}>Zet alle vinkjes terug</button>
    </div>
    {!progress.writable && <p role="alert">Deze browseropslag is niet beschikbaar of bevat een onbekende versie.
      Afvinken is uitgeschakeld; jouw bestaande opgeslagen gegevens worden niet overschreven.</p>}
    {progressMessage && <p role="status" aria-live="polite">{progressMessage}</p>}
    {openOnly && completedCount === ids.length &&
      <p role="status">Alles afgevinkt! Toon ook gekochte producten om de lijst terug te zien.</p>}
    {selectedHistorical.length > 0 && <div className="hifi-picked-history" aria-label="Historische bronproducten zonder prijs">
      <h4>Historische bronproducten</h4>
      <p className="disclaimer">Waargenomen op 4 oktober 2026. Geen actuele prijzen of bronrechten voor productie.</p>
      {visibleHistorical.map(item => <div className="hifi-demo-list-row hifi-picked-history-row" key={item.id}>
        <div className="hifi-picked-source-logo" aria-hidden="true">{item.store === 'PLUS' ? 'P' : 'D'}</div>
        <div className="hifi-picked-details">
          <strong>{item.name}</strong>
          <span>{item.store} · {item.pack} · prijs onbekend</span>
        </div>
        {progressControl(item.id, item.name)}
        <button type="button" className="ghost-button" onClick={() => removeAndUncheck(item.id)}
          aria-label={`Verwijder uit lijst: ${item.name} bij ${item.store}`}>Verwijder</button>
      </div>)}
    </div>}
    {selectedUnknown.length > 0 && <div className="hifi-picked-demo" aria-label="Oude productselecties die niet meer in de catalogus staan">
      <h4>Oude productselecties</h4>
      <p className="disclaimer">Deze product-ID's horen niet bij de huidige catalogus. Ze blijven bewaard totdat je ze verwijdert; er wordt geen prijs of productmatch afgeleid.</p>
      {visibleUnknown.map(id => <div className="hifi-demo-list-row" key={id}>
        <div className="hifi-picked-source-logo" aria-hidden="true">?</div>
        <div className="hifi-picked-details"><strong>Product niet beschikbaar</strong><span>Oude product-ID: {id} · prijs onbekend</span></div>
        {progressControl(id, 'oude product-ID ' + id)}
        <button type="button" className="ghost-button" onClick={() => removeAndUncheck(id)} aria-label={`Verwijder oude productselectie: ${id}`}>Verwijder</button>
      </div>)}
    </div>}
    {selectedExamples.length > 0 && <div className="hifi-picked-demo" aria-label="Figma demoproducten">
      <h4>Figma-voorbeelden</h4>
      <p className="disclaimer">Demolijst · geen actuele prijzen. Niet meegenomen in de mandvergelijking.</p>
      {visibleExamples.map(p => <div className="hifi-demo-list-row" key={p.id}>
        <FigmaImage asset={p.image} width="40" height="40" alt="" />
        <span>{p.name}</span>
        {progressControl(p.id, p.name)}
        <button type="button" className="ghost-button" onClick={() => removeAndUncheck(p.id)}
          aria-label={`Verwijder: ${p.name}`}>Verwijder</button>
      </div>)}
    </div>}
    <button type="button" className="hifi-history-add" onClick={() => downloadSelection(false)}>
      Download mijn ongeprijsde selectie (.txt)
    </button>
    <button type="button" className="hifi-history-add"
      disabled={completedCount === ids.length}
      onClick={() => downloadSelection(true)}>
      Download alleen nog te kopen (.txt)
    </button>
    <button type="button" className="hifi-history-add"
      disabled={!openSelectionText} onClick={() => void copyOpenShoppingList()}>
      Kopieer alleen nog te kopen
    </button>
    <p role="status" aria-live="polite">{copyMessage}</p>
    <label className="hifi-picked-copy-label">
      {copyOnlyOpen ? 'Kopieerbare nog-te-kopen lijst (ongeprijsd)' : 'Kopieer je complete ongeprijsde productselectie'}
      <button type="button" className="ghost-button"
        disabled={completedCount === 0}
        onClick={() => setCopyOnlyOpen(!copyOnlyOpen)}>
        {copyOnlyOpen ? 'Toon volledige kopieertekst' : 'Toon alleen open kopieertekst'}
      </button>
      <textarea readOnly rows={Math.min(ids.length + 2, 12)}
        onFocus={event => event.currentTarget.select()}
        value={copyOnlyOpen ? openSelectionText : selectionText}
        aria-label="Kopieerbare eigen ongeprijsde productselectie" />
    </label>
  </section>
}
