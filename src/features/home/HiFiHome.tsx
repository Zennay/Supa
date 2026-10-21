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

type Props = {
  view: HiFiTab
  onNavigate: (view: HiFiTab | 'planner' | 'list' | 'basket') => void
  addedProducts: string[]
  onToggleProduct: (id: string) => void
  activeDays?: readonly string[]
  onOpenOwnSources?: () => void
}

export function HiFiHome(props: Props) {
  if (props.view === 'recipes') return <Suspense fallback={
    <section className="hifi-home" role="status" aria-live="polite">
      <p>Je recepten worden geopend…</p>
    </section>
  }><RecipeLibrary onBack={() => props.onNavigate('home')} /></Suspense>
  return <HiFiDiscovery {...props} />
}

function HiFiDiscovery({ view, onNavigate, addedProducts, onToggleProduct, activeDays = [], onOpenOwnSources }: Props) {
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<typeof designRecipes[number] | null>(null)
  const [message, setMessage] = useState('')
  const [sortByPrice, setSortByPrice] = useState(false)
  const [unitFilter, setUnitFilter] = useState<DemoUnitFilter>('all')
  const [productSource, setProductSource] = useState<'history' | 'figma'>('figma')
  const [storeFilter, setStoreFilter] = useState<'all' | 'PLUS' | 'DekaMarkt'>('all')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { setQuery('') }, [view])
  const matches = (item: { id: string; name: string }) =>
    item.name.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) &&
    (!favoritesOnly || favorites.includes(item.id))
  const recipes = designRecipes.filter(recipe => recipe.title.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl')) && (!favoritesOnly || favorites.includes(recipe.id)))
  const matchingProducts = filterDemoProductsByUnit(designProducts.filter(product => (view === 'products' ? product.id !== 'bananas' : !product.id.startsWith('figma-')) && matches(product)), unitFilter)
  const products = sortByPrice ? orderDemoProductsByUnitPrice(matchingProducts) :
    view === 'products' ? [...matchingProducts].sort((left, right) =>
      ['cola-regular', 'cola-zero', 'figma-paprika', 'figma-watermelon', 'figma-cola-classic', 'figma-arla-milk', 'figma-heineken', 'figma-pastry', 'figma-muffins', 'figma-peanut-butter', 'figma-fruit', 'figma-ginger', 'cola-pack'].indexOf(left.id) -
      ['cola-regular', 'cola-zero', 'figma-paprika', 'figma-watermelon', 'figma-cola-classic', 'figma-arla-milk', 'figma-heineken', 'figma-pastry', 'figma-muffins', 'figma-peanut-butter', 'figma-fruit', 'figma-ginger', 'cola-pack'].indexOf(right.id)) : matchingProducts
  const historical = filterHistoricalProducts(historicalRetailerProducts, query, storeFilter).filter(item => !favoritesOnly || favorites.includes(item.id))
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
    </> : <header className="hifi-products-heading" data-figma-node="3064:3128"><h1 className="hifi-page-title">Producten</h1><button type="button" className="hifi-go-to-list" onClick={() => onNavigate('list')} aria-label={`Bekijk mijn lijst met ${addedProducts.length} gekozen producten`}>Mijn lijst <span aria-hidden="true">({addedProducts.length})</span> →</button><button className="hifi-icon-button" aria-label="Productfilters" aria-expanded={filterOpen} aria-controls="hifi-filter-panel" onClick={() => setFilterOpen(!filterOpen)}><FigmaImage asset={a.productsFilter} alt="" /></button></header>}

    <div className="hifi-search-row" data-figma-node={view === 'products' ? '3068:4921' : undefined}>
      <label className="hifi-search"><FigmaImage asset={view === "products" ? a.productsSearch : a.imgVector1} alt="" /><input type="search" aria-label="Zoek gerechten of producten" placeholder={view === 'products' ? 'Coca Cola' : 'Zoek gerechten of producten'} value={query} onChange={e => setQuery(e.target.value)} /></label>
      {view === 'products'
        ? <button className="hifi-weekly-link" type="button" aria-label="Ga naar de weekplanning" onClick={() => onNavigate('planner')}><FigmaImage asset={a.productsWeekly} alt="" /></button>
        : <button className="hifi-filter" aria-label="Filters" aria-expanded={filterOpen} aria-controls="hifi-filter-panel" onClick={() => setFilterOpen(!filterOpen)}><FigmaImage asset={a.imgVector2} alt="" /></button>}
    </div>
    {filterOpen && <div id="hifi-filter-panel" className="hifi-filter-panel"><label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> Alleen favorieten</label>{view === 'products' && <div className="hifi-product-source-tabs" role="group" aria-label="Weergave van producten"><button type="button" aria-pressed={productSource === 'figma'} onClick={() => { setProductSource('figma'); setQuery(''); setStoreFilter('all') }}>Ontwerpvoorbeelden</button><button type="button" aria-pressed={productSource === 'history'} onClick={() => { setProductSource('history'); setQuery(''); setUnitFilter('all'); setSortByPrice(false) }}>Bronproducten</button></div>}{view === 'products' && productSource === 'history' && <label>Winkel <select aria-label="Filter historische producten op winkel" value={storeFilter} onChange={e => setStoreFilter(e.target.value as 'all' | 'PLUS' | 'DekaMarkt')}><option value="all">Alle winkels</option><option value="PLUS">PLUS</option><option value="DekaMarkt">DekaMarkt</option></select></label>}{view === 'products' && productSource === 'figma' && <label>Eenheid <select aria-label="Filter producten op eenheid" value={unitFilter} onChange={e => setUnitFilter(e.target.value as DemoUnitFilter)}><option value="all">Alle eenheden</option><option value="l">Per liter</option><option value="kg">Per kilogram</option></select></label>}<button onClick={() => { setQuery(''); setFavoritesOnly(false); setUnitFilter('all'); setStoreFilter('all'); setSortByPrice(false) }}>Wis filters</button></div>}
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
      {recipes.length === 0 && <p className="hifi-empty">Geen gerechten gevonden. Probeer een andere zoekterm of wis je filters.</p>}
    </section>}
    {view === 'products' && <div className="hifi-product-source-tabs" aria-label="Productbron"><button type="button" aria-pressed={productSource === 'history'} onClick={() => { setProductSource('history'); setUnitFilter('all'); setSortByPrice(false) }}>Bronwaarnemingen</button><button type="button" aria-pressed={productSource === 'figma'} onClick={() => { setProductSource('figma'); setStoreFilter('all') }}>Figma voorbeelden</button></div>}
    {view === 'products' && productSource === 'history' && <section className="hifi-section" aria-label="Historisch vastgelegde supermarktproducten">
      <div className="hifi-section-heading"><div><h2>Producten uit brononderzoek</h2><p className="recipe-count">{historical.length} producten · PLUS en DekaMarkt</p></div></div>
      <p className="hifi-demo-note hifi-historical-warning">Alleen historische bronwaarnemingen van 4 oktober 2026. Niet actueel, nog niet gelicentieerd voor productie. Geen prijzen, aanbiedingen, besparingen of beschikbaarheidsclaims.</p>
      <div className="hifi-product-grid">{historical.map(item => <article className="hifi-product-card" key={item.id} data-product-source="historical"><div className="hifi-product-image"><span className="hifi-source-image" aria-hidden="true">{item.name.slice(0, 1)}</span><span className="hifi-store-logo hifi-store-text">{item.store === 'PLUS' ? 'PLUS' : 'Deka'}</span></div><div className="hifi-product-copy"><h3>{item.name}</h3><div className="hifi-product-price"><span>{item.pack}</span></div><span className="hifi-no-price">Prijs niet vrijgegeven</span><small>Bron: {item.store} · {new Date(item.capturedAt).toLocaleDateString('nl-NL')}</small></div><div className="hifi-product-actions"><button className="hifi-product-favorite" aria-label={`Favoriet: ${item.name} bij ${item.store}`} aria-pressed={favorites.includes(item.id)} onClick={() => toggleFavorite(item.id)}><FigmaImage asset={a.imgHeartButton} alt="" /></button><button type="button" className="hifi-history-add" aria-pressed={addedProducts.includes(item.id)}
  aria-label={`${addedProducts.includes(item.id) ? 'Verwijder uit lijst' : 'Voeg toe aan lijst'}: ${item.name} bij ${item.store}`}
  onClick={() => { onToggleProduct(item.id); setMessage(addedProducts.includes(item.id)
    ? `${item.name} verwijderd uit je eigen lijst.`
    : `${item.name} toegevoegd zonder prijsclaim. Open Lijst om je keuze te bekijken.`) }}>
  {addedProducts.includes(item.id) ? '✓ In lijst' : '+ Lijst'}
</button>
<a className="hifi-source-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Bekijk bronpagina bij ${item.store}: ${item.name}`}>Bron ↗</a></div></article>)}</div>
      {historical.length === 0 && <p className="hifi-empty">Geen historische productwaarnemingen gevonden.</p>}
    </section>}
    {(view === 'home' || (view === 'products' && productSource === 'figma')) && <section className="hifi-section" aria-labelledby="hifi-products-title">
      <div className="hifi-section-heading" data-figma-node={view === 'products' ? '3064:3181' : undefined}><div><h2 id="hifi-products-title">{view === 'products' ? query.trim() || 'Populaire producten' : 'Productvoorbeelden · demo'}</h2>{view === 'products' && <p className="recipe-count">{products.length} producten</p>}</div>{view === 'home' ? <button onClick={() => changeView('products')}>Bekijk meer <FigmaImage asset={a.imgFrame7159} alt="" /></button> : <button className="hifi-product-sort" aria-pressed={sortByPrice} aria-label="Sorteer voorbeeldproducten op laagste prijs per kg of liter" onClick={() => setSortByPrice(!sortByPrice)}>Laagste prijs per kg / l <FigmaImage asset={a.productsSort} alt="" /></button>}</div>
      {view === 'products' && <p className="hifi-demo-note"><strong>DEMO · </strong>Figma-ontwerpvoorbeelden; prijzen en aanbiedingen zijn niet actueel en worden nooit gebruikt in je echte winkelmand, budget of besparingsberekening.</p>}
      <div className="hifi-product-grid" data-figma-node={view === 'products' ? '3064:3342' : undefined}>{products.map(product => <article className="hifi-product-card" key={product.id}>
        <div className="hifi-product-image"><FigmaImage className="hifi-product-photo" asset={product.image} alt={product.name} />{product.logo && <span className={`hifi-store-logo ${product.crop}`}><FigmaImage asset={product.logo} alt={product.store} /></span>}{product.unitPrice && <span className="hifi-unit-price">{product.unitPrice}</span>}</div>
        <div className="hifi-product-copy"><h3>{product.name}</h3><div className="hifi-product-price"><span>{product.unit}</span>{product.old && <del>{product.old}</del>}{product.price ? <strong>{product.price}</strong> : <small className="hifi-unpriced">Prijsvoorbeeld ontbreekt</small>}</div></div>
        <div className="hifi-product-actions"><button className="hifi-product-favorite" aria-label={`Favoriet: ${product.name}`} aria-pressed={favorites.includes(product.id)} onClick={() => toggleFavorite(product.id)}><FigmaImage asset={a.imgHeartButton} alt="" /></button><button aria-label={`${addedProducts.includes(product.id) ? 'Verwijder' : 'Voeg toe'}: ${product.name}`} aria-pressed={addedProducts.includes(product.id)} onClick={() => { onToggleProduct(product.id); setMessage(addedProducts.includes(product.id) ? `${product.name} verwijderd uit je demolijst.` : `${product.name} toegevoegd aan je demolijst.`) }}>{addedProducts.includes(product.id) ? <span className="hifi-added">✓</span> : <FigmaImage asset={a.imgFrame7121} alt="" />}</button></div>
      </article>)}</div>
      {products.length === 0 && <p className="hifi-empty">Geen producten gevonden. Probeer een andere zoekterm of wis je filters.</p>}
    </section>}
    {view === 'products' && <section className="hifi-section" aria-label="Vergelijk met je eigen werkelijke winkelbron">
      <div className="hifi-section-heading"><h2>Vergelijk jouw eigen winkelprijzen</h2></div>
      <p className="hifi-demo-note">De historische productvoorbeelden hierboven hebben geen vrijgegeven actuele prijzen.
        Met jouw eigen rechtmatig verkregen PLUS- of DekaMarkt-opname koppelt Supa echte
        bronartikelen aan het geselecteerde weekmenu. Zonder volledige broncontrole wordt er
        geen winkelprijs of besparing verzonnen.</p>
      <div className="hifi-own-source-actions">
        <button type="button" className="hifi-plan-button" onClick={() => onNavigate('basket')}>
          Open Vergelijk · eigen prijzen invoeren
        </button>
        <button type="button" className="ghost-button" onClick={onOpenOwnSources}>
          Bekijk mijn echte bronartikelen
        </button>
      </div>
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
  const selectedHistorical = historicalRetailerProducts.filter(item => ids.includes(item.id))
  const selectedExamples = designProducts.filter(item => ids.includes(item.id))
  if (!selectedHistorical.length && !selectedExamples.length) return null

  return <section className="hifi-demo-list" aria-label="Zelf gekozen producten">
    <h3>Jouw gekozen producten</h3>
    <p className="disclaimer">Eigen verzamelijst · niet meegenomen in de berekende maaltijdmand of winkelvergelijking.
      Dit is geen offerte, actuele voorraad of bewijs van besparing.</p>
    {selectedHistorical.length > 0 && <div className="hifi-picked-history" aria-label="Historische bronproducten zonder prijs">
      <h4>Historische bronproducten</h4>
      <p className="disclaimer">Waargenomen op 4 oktober 2026. Geen actuele prijzen of bronrechten voor productie.</p>
      {selectedHistorical.map(item => <div className="hifi-demo-list-row hifi-picked-history-row" key={item.id}>
        <div className="hifi-picked-source-logo" aria-hidden="true">{item.store === 'PLUS' ? 'P' : 'D'}</div>
        <div className="hifi-picked-details">
          <strong>{item.name}</strong>
          <span>{item.store} · {item.pack} · prijs onbekend</span>
        </div>
        <button type="button" className="ghost-button" onClick={() => onRemove(item.id)}
          aria-label={`Verwijder uit lijst: ${item.name} bij ${item.store}`}>Verwijder</button>
      </div>)}
    </div>}
    {selectedExamples.length > 0 && <div className="hifi-picked-demo" aria-label="Figma demoproducten">
      <h4>Figma-voorbeelden</h4>
      <p className="disclaimer">Demolijst · geen actuele prijzen. Niet meegenomen in de mandvergelijking.</p>
      {selectedExamples.map(p => <div className="hifi-demo-list-row" key={p.id}>
        <FigmaImage asset={p.image} width="40" height="40" alt="" />
        <span>{p.name}</span>
        <button type="button" className="ghost-button" onClick={() => onRemove(p.id)}
          aria-label={`Verwijder: ${p.name}`}>Verwijder</button>
      </div>)}
    </div>}
    <label className="hifi-picked-copy-label">Kopieer je gekozen productnamen
      <textarea readOnly rows={Math.min(ids.length + 2, 12)}
        onFocus={event => event.currentTarget.select()}
        value={[...selectedHistorical.map(item => `☐ ${item.name} · ${item.store} · ${item.pack} · prijs onbekend (historisch)`),
          ...selectedExamples.map(item => `☐ ${item.name} · Figma-demo, geen actuele prijs`)].join('\n')}
        aria-label="Kopieerbare gekozen producten, zonder winkelprijzen" />
    </label>
  </section>
}
