import { FigmaImage } from '../../components/FigmaImage'
import { useRef, useState } from 'react'
import { figmaAssets as a } from './figmaAssets'
import { upcomingHomeWeek } from './homeWeekDates'
import { RecipeLibrary } from '../recipes/RecipeLibrary'
import { filterDemoProductsByUnit, orderDemoProductsByUnitPrice, type DemoUnitFilter } from '../products/productUnitPrice'

export type HiFiTab = 'home' | 'recipes' | 'products'
export const designProducts = [
  { id: 'cola-zero', name: 'Coca cola zero 1.5l fl', image: a.imgProductFoto, logo: a.imgDirk, store: 'Dirk', crop: 'dirk', unit: '1.5L', unitPrice: '€1.16/L', old: '€2.15', price: '€1.75' },
  { id: 'bananas', name: 'Del Monte Bananen', image: a.imgProductFoto1, logo: a.imgDirk, store: 'Dirk', crop: 'dirk', unit: 'Per verpakking', unitPrice: '€1.36/KG', old: '€1.55', price: '€1.37' },
  { id: 'cola-pack', name: 'Coca-Cola Zero sugar zero caffeine & calories 4-pack', image: a.imgProductFoto2, logo: a.imgDirk1, store: 'Hoogvliet', crop: 'hoogvliet', unit: '6L', unitPrice: '€1.54/L', old: '€9.26', price: '€7.96' },
  { id: 'cola-regular', name: 'Coca Cola Regular 1,5 liter fles', image: a.imgProductFoto3, logo: a.imgDirk2, store: 'Jumbo', crop: 'jumbo', unit: '1.5L', unitPrice: '€1.09/L', old: '€2.15', price: '€1.64' },
]
const designRecipes = [
  { id: 'fried-rice', name: 'Fried rice', image: a.imgRecepten, minutes: 15 },
  { id: 'bao-buns', name: 'Bao buns', image: a.imgRecepten1, minutes: 40 },
  { id: 'katsu-curry', name: 'Katsu curry', image: a.imgRecepten2, minutes: 40 },
]
type Props = {
  view: HiFiTab
  onNavigate: (view: HiFiTab | 'planner' | 'list') => void
  addedProducts: string[]
  onToggleProduct: (id: string) => void
  activeDays?: readonly string[]
}

export function HiFiHome(props: Props) {
  if (props.view === 'recipes') return <RecipeLibrary onBack={() => props.onNavigate('home')} />
  return <HiFiDiscovery {...props} />
}

function HiFiDiscovery({ view, onNavigate, addedProducts, onToggleProduct, activeDays = [] }: Props) {
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<typeof designRecipes[number] | null>(null)
  const [message, setMessage] = useState('')
  const [sortByPrice, setSortByPrice] = useState(false)
  const [unitFilter, setUnitFilter] = useState<DemoUnitFilter>('all')
  const dialog = useRef<HTMLDialogElement>(null)
  const matches = (item: { id: string; name: string }) =>
    item.name.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) &&
    (!favoritesOnly || favorites.includes(item.id))
  const recipes = designRecipes.filter(matches)
  const matchingProducts = filterDemoProductsByUnit(designProducts.filter(matches), unitFilter)
  const products = sortByPrice ? orderDemoProductsByUnitPrice(matchingProducts) : matchingProducts
  const toggleFavorite = (id: string) => setFavorites(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])
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
    </> : <header className="hifi-products-heading"><h1 className="hifi-page-title">Producten</h1><button className="hifi-icon-button" aria-label="Alleen favoriete producten" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}><FigmaImage asset={a.imgHeartButton} alt="" /></button></header>}

    <div className="hifi-search-row">
      <label className="hifi-search"><FigmaImage asset={a.imgVector1} alt="" /><input type="search" aria-label="Zoek gerechten of producten" placeholder={view === 'products' ? 'Zoek producten' : 'Zoek gerechten of producten'} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button className="hifi-filter" aria-label="Filters" aria-expanded={filterOpen} aria-controls="hifi-filter-panel" onClick={() => setFilterOpen(!filterOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button>
    </div>
    {filterOpen && <div id="hifi-filter-panel" className="hifi-filter-panel"><label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> Alleen favorieten</label>{view === 'products' && <label>Eenheid <select aria-label="Filter producten op eenheid" value={unitFilter} onChange={e => setUnitFilter(e.target.value as DemoUnitFilter)}><option value="all">Alle eenheden</option><option value="l">Per liter</option><option value="kg">Per kilogram</option></select></label>}<button onClick={() => { setQuery(''); setFavoritesOnly(false); setUnitFilter('all'); setSortByPrice(false) }}>Wis filters</button></div>}
    <p className="hifi-demo-note">Ontwerpvoorbeelden · prijzen en aanbiedingen zijn niet actueel.</p>
    {view !== 'products' && <section className="hifi-section" aria-labelledby="hifi-recipes-title">
      <div className="hifi-section-heading"><h2 id="hifi-recipes-title">Gerechten in de aanbieding</h2>{view === 'home' && <button onClick={() => changeView('recipes')}>Bekijk meer <FigmaImage asset={a.imgFrame7159} alt="" /></button>}</div>
      <div className={view === 'recipes' ? 'hifi-recipe-grid' : 'hifi-recipe-row'}>{recipes.map(recipe => <article key={recipe.id} className="hifi-recipe-card">
        <FigmaImage className="hifi-recipe-photo" asset={recipe.image} alt="" />
        <button className="hifi-recipe-open" aria-label={`Bekijk ${recipe.name}`} onClick={() => { setSelectedRecipe(recipe); dialog.current?.showModal() }} />
        <div className="hifi-recipe-top"><span className="hifi-saving"><FigmaImage asset={a.imgVector3} alt="" />-€2.50</span><button className="hifi-favorite" aria-label={`Favoriet: ${recipe.name}`} aria-pressed={favorites.includes(recipe.id)} onClick={() => toggleFavorite(recipe.id)}><FigmaImage asset={a.imgFilter} alt="" /></button></div>
        <div className="hifi-recipe-caption"><h3>{recipe.name}</h3><p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes}</span><span>€6.20 p.p</span></p></div>
      </article>)}</div>
      {recipes.length === 0 && <p className="hifi-empty">Geen gerechten gevonden. Probeer een andere zoekterm of wis je filters.</p>}
    </section>}
    {view !== 'recipes' && <section className="hifi-section" aria-labelledby="hifi-products-title">
      <div className="hifi-section-heading"><div><h2 id="hifi-products-title">{view === 'products' ? query || 'Alle producten' : 'Aanbiedingen voor jou'}</h2>{view === 'products' && <p className="recipe-count">{products.length} producten</p>}</div>{view === 'home' ? <button onClick={() => changeView('products')}>Bekijk meer <FigmaImage asset={a.imgFrame7159} alt="" /></button> : <button className="hifi-product-sort" aria-pressed={sortByPrice} aria-label="Sorteer voorbeeldproducten op laagste prijs per kg of liter" onClick={() => setSortByPrice(!sortByPrice)}>Laagste prijs per kg / l <FigmaImage asset={a.recipeSort} alt="" /></button>}</div>
      <div className="hifi-product-grid">{products.map(product => <article className="hifi-product-card" key={product.id}>
        <div className="hifi-product-image"><FigmaImage className="hifi-product-photo" asset={product.image} alt={product.name} /><span className={`hifi-store-logo ${product.crop}`}><FigmaImage asset={product.logo} alt={product.store} /></span><span className="hifi-unit-price">{product.unitPrice}</span></div>
        <div className="hifi-product-copy"><h3>{product.name}</h3><div className="hifi-product-price"><span>{product.unit}</span><del>{product.old}</del><strong>{product.price}</strong></div></div>
        <div className="hifi-product-actions"><button className="hifi-product-favorite" aria-label={`Favoriet: ${product.name}`} aria-pressed={favorites.includes(product.id)} onClick={() => toggleFavorite(product.id)}><FigmaImage asset={a.imgHeartButton} alt="" /></button><button aria-label={`${addedProducts.includes(product.id) ? 'Verwijder' : 'Voeg toe'}: ${product.name}`} aria-pressed={addedProducts.includes(product.id)} onClick={() => { onToggleProduct(product.id); setMessage(addedProducts.includes(product.id) ? `${product.name} verwijderd uit je demolijst.` : `${product.name} toegevoegd aan je demolijst.`) }}>{addedProducts.includes(product.id) ? <span className="hifi-added">✓</span> : <FigmaImage asset={a.imgFrame7121} alt="" />}</button></div>
      </article>)}</div>
      {products.length === 0 && <p className="hifi-empty">Geen producten gevonden. Probeer een andere zoekterm of wis je filters.</p>}
    </section>}
    <p className="hifi-feedback" role="status">{message}</p>
    <dialog className="hifi-dialog" ref={dialog} onClose={() => setSelectedRecipe(null)} aria-labelledby="hifi-detail-title">
      {selectedRecipe && <><form method="dialog"><button className="ghost-button">Sluiten</button></form><FigmaImage className="hifi-detail-photo" asset={selectedRecipe.image} alt="" /><h2 id="hifi-detail-title">{selectedRecipe.name}</h2><p>{selectedRecipe.minutes} minuten · ontwerpvoorbeeld</p><p>Dit gerecht komt uit het Figma-ontwerp. De volledige bereiding en ingrediënten zijn nog niet gekoppeld. Je kunt in de planner alvast met de beschikbare demorecepten plannen.</p><button className="hifi-plan-button" onClick={() => { dialog.current?.close(); onNavigate('planner') }}>Open de planner</button></>}
    </dialog>
  </div>
}

export function HiFiDemoList({ ids, onRemove }: { ids: string[]; onRemove: (id: string) => void }) {
  if (!ids.length) return null
  return <section className="hifi-demo-list" aria-label="Producten uit het ontwerp"><h3>Jouw gekozen producten</h3><p className="disclaimer">Demolijst · geen actuele prijzen. Niet meegenomen in de mandvergelijking.</p>{designProducts.filter(p => ids.includes(p.id)).map(p => <div className="hifi-demo-list-row" key={p.id}><FigmaImage asset={p.image} width="40" height="40" alt="" /><span>{p.name}</span><button className="ghost-button" onClick={() => onRemove(p.id)} aria-label={`Verwijder: ${p.name}`}>Verwijder</button></div>)}</section>
}
