import { useMemo, useState } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets as a, figmaRecipeImages, figmaPlannerThumbs } from '../home/figmaAssets'
import { curatedFigmaRecipes } from './curatedFigmaRecipes'
import { pricePerPersonLabel } from './recipePricePerPerson'
import { HeartIcon, PlusIcon } from '../../components/HiFiIcons'
import './hifiRecipes.css'

const favoritesKey = 'supa:recipe-favorites:v2'
function readFavorites(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(favoritesKey) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

/** Recipe categories of the design; each recipe belongs to one. */
const categories = [
  { id: 'bowls', name: 'Bowls', image: figmaRecipeImages['supa-fried-rice'], ids: ['supa-burrito-bowl', 'supa-fried-rice', 'supa-thai'] },
  { id: 'pastas', name: 'Pastas', image: figmaRecipeImages['supa-veg-pasta'], ids: ['supa-veg-pasta'] },
  { id: 'ovenschotels', name: 'Ovenschotels', image: figmaRecipeImages['supa-katsu'], ids: ['supa-katsu'] },
  { id: 'wraps', name: 'Wraps', image: figmaRecipeImages['supa-bao'], ids: ['supa-quesadillas', 'supa-bao'] },
]

const priceOf = (id: string) => {
  const label = pricePerPersonLabel(curatedFigmaRecipes.find(recipe => recipe.id === id)!)
  return label ? Number(label.replace('€', '').replace(',', '.').replace(' p.p.', '')) : null
}

type Props = {
  /** `pick` = "Toevoegen aan planner": every card has a + that chooses the recipe. */
  mode: 'browse' | 'pick'
  onPick?: (recipeId: string) => void
  onBack?: () => void
  /** Recipe ids already planned, used by the "Combineren" filter. */
  plannedRecipeIds?: readonly string[]
}

export function HiFiRecipes({ mode, onPick, onBack, plannedRecipeIds = [] }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [twoPeople, setTwoPeople] = useState(false)
  const [budget, setBudget] = useState(false)
  const [combine, setCombine] = useState(false)
  const [byPrice, setByPrice] = useState(false)

  const toggleFavorite = (id: string) => setFavorites(current => {
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    try { window.localStorage.setItem(favoritesKey, JSON.stringify(next)) } catch { /* kept in memory */ }
    return next
  })

  const plannedIngredients = useMemo(() => new Set(curatedFigmaRecipes
    .filter(recipe => plannedRecipeIds.includes(recipe.id))
    .flatMap(recipe => recipe.ingredients.map(item => item.id))), [plannedRecipeIds])

  const recipes = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('nl')
    const list = curatedFigmaRecipes.filter(recipe => {
      if (text && !recipe.title.toLocaleLowerCase('nl').includes(text) &&
          !recipe.ingredients.some(item => item.label.toLocaleLowerCase('nl').includes(text))) return false
      if (category && !categories.find(entry => entry.id === category)?.ids.includes(recipe.id)) return false
      if (favoritesOnly && !favorites.includes(recipe.id)) return false
      if (twoPeople && recipe.servings !== 2) return false
      if (budget) { const price = priceOf(recipe.id); if (price === null || price < 2 || price > 5) return false }
      if (combine && !recipe.ingredients.some(item => plannedIngredients.has(item.id))) return false
      return true
    })
    return byPrice ? [...list].sort((x, y) => (priceOf(x.id) ?? 99) - (priceOf(y.id) ?? 99)) : list
  }, [query, category, favoritesOnly, favorites, twoPeople, budget, combine, byPrice, plannedIngredients])

  return <div className="hifi-home hifi-recipes" data-figma-node="3342:5608">
    <header className="hifi-recipes-heading">
      {mode === 'pick' && <button type="button" className="hifi-back" aria-label="Terug naar planning" onClick={onBack}>
        <svg viewBox="0 0 9 15" width="9" height="15" fill="none" aria-hidden="true"><path d="M7.5 1.5 1.5 7.5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
      <h1 className="hifi-page-title">{mode === 'pick' ? 'Toevoegen aan planner' : 'Recepten'}</h1>
      <button type="button" className="hifi-heart-toggle" aria-label="Alleen favoriete recepten" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}>
        <svg width="24" height="22" viewBox="0 0 26 24" fill={favoritesOnly ? 'currentColor' : 'none'} aria-hidden="true"><path d="M13 22.2 3.6 13A6 6 0 0 1 12.1 4.5l.9.9.9-.9A6 6 0 0 1 22.4 13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      </button>
    </header>

    <div className="hifi-search-row">
      <label className="hifi-search"><FigmaImage asset={a.recipeSearch} alt="" />
        <input type="search" aria-label="Zoek recepten op naam of ingrediënt" placeholder="Zoek recepten" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <button type="button" className="hifi-filter" aria-label="Filters wissen" onClick={() => { setQuery(''); setCategory(null); setFavoritesOnly(false); setTwoPeople(false); setBudget(false); setCombine(false) }}><FigmaImage asset={a.imgVector2} alt="" /></button>
    </div>

    <section className="hifi-categories" aria-label="Categorieën">
      {mode === 'pick' && <h2>Categorieën</h2>}
      <div className="hifi-category-row">{categories.map(entry => {
        const count = entry.ids.length
        const selected = category === entry.id
        return <button key={entry.id} type="button" aria-pressed={selected} className={selected ? 'selected' : ''} onClick={() => setCategory(selected ? null : entry.id)}>
          <span className="hifi-category-photo"><FigmaImage asset={entry.image} alt="" /></span>
          <strong>{entry.name}</strong>
          <small>{count} {count === 1 ? 'recept' : 'recepten'}</small>
        </button>
      })}</div>
    </section>

    <div className="hifi-chip-row" aria-label="Filters">
      {mode === 'pick' && <button type="button" aria-pressed={combine} className={combine ? 'on' : ''} onClick={() => setCombine(!combine)}>Combineren</button>}
      <button type="button" aria-pressed={twoPeople} className={twoPeople ? 'on' : ''} onClick={() => setTwoPeople(!twoPeople)}>2 personen</button>
      <button type="button" aria-pressed={budget} className={budget ? 'on' : ''} onClick={() => setBudget(!budget)}>€2,00 - €5,00 p.p</button>
    </div>

    <section className="hifi-section">
      <div className="hifi-section-heading"><div><h2>Recepten</h2><p className="recipe-count">{recipes.length} {recipes.length === 1 ? 'recept' : 'recepten'}</p></div>
        <button type="button" aria-label="Sorteer op prijs" aria-pressed={byPrice} onClick={() => setByPrice(!byPrice)}><FigmaImage asset={a.recipeSort} alt="" /></button></div>
      <div className="hifi-recipe-grid">{recipes.map(recipe => {
        const image = figmaRecipeImages[recipe.id] ?? figmaPlannerThumbs[recipe.id]
        const price = pricePerPersonLabel(recipe)
        const favorite = favorites.includes(recipe.id)
        return <article key={recipe.id} className={`hifi-recipe-card${image ? '' : ' no-photo'}`}>
          {image && <FigmaImage className="hifi-recipe-photo" asset={image} alt="" />}
          <div className="hifi-recipe-top"><span />
            <button type="button" className="hifi-favorite hifi-heart" aria-label={`Favoriet: ${recipe.title}`} aria-pressed={favorite} onClick={() => toggleFavorite(recipe.id)}>
              <HeartIcon filled={favorite} /></button></div>
          <div className="hifi-recipe-caption"><h3>{recipe.title}</h3>
            <p><span><FigmaImage asset={a.imgVector4} alt="" />{recipe.minutes}</span>{price && <span>{price}</span>}</p></div>
          {mode === 'pick' && <button type="button" className="hifi-recipe-add" aria-label={`Voeg ${recipe.title} toe aan de planner`} onClick={() => onPick?.(recipe.id)}><PlusIcon /></button>}
        </article>
      })}</div>
      {recipes.length === 0 && <p className="hifi-empty">Geen recepten gevonden. Probeer een andere zoekterm of wis de filters.</p>}
    </section>
  </div>
}
