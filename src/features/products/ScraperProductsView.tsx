import { useMemo, useRef, useState } from 'react'
import { FigmaImage } from '../../components/FigmaImage'
import { RetailerImage } from '../../components/RetailerImage'
import { figmaAssets as a } from '../home/figmaAssets'
import { euro } from '../../lib/money'
import {
  mergeScraperProducts,
  productsFromScraperFile,
  readScraperProducts,
  unitPriceCents,
  writeScraperProducts,
  type ScraperProduct,
} from './scraperProducts.ts'
import './scraperProducts.css'

export const SCRAPER_PICKS_STORAGE_KEY = 'supa:scraper-picks:v1'
const FAVORITES_STORAGE_KEY = 'supa:scraper-favorites:v1'

function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}
function writeIds(key: string, ids: string[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)) } catch { /* storage unavailable */ }
}
function initialProducts(): ScraperProduct[] {
  if (typeof window === 'undefined') return []
  return readScraperProducts(window.localStorage)
}

export function ScraperProductCardImage({ product }: { product: ScraperProduct }) {
  return <RetailerImage className="scraper-product-photo" src={product.imageUrl}
    fallback={<span className="scraper-product-monogram" aria-hidden="true">{product.name.slice(0, 1)}</span>} />
}

/** Producten (design 3064:3125) filled with products imported from the scrapers. */
export function ScraperProductsView() {
  const [products, setProducts] = useState<ScraperProduct[]>(initialProducts)
  const [query, setQuery] = useState('')
  const [sortByUnit, setSortByUnit] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(() => typeof window === 'undefined' ? [] : readIds(FAVORITES_STORAGE_KEY))
  const [picks, setPicks] = useState<string[]>(() => typeof window === 'undefined' ? [] : readIds(SCRAPER_PICKS_STORAGE_KEY))
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const importFiles = async (files: File[]) => {
    let next = products
    const problems: string[] = []
    let added = 0
    for (const file of files) {
      try {
        const imported = productsFromScraperFile(await file.text())
        next = mergeScraperProducts(next, imported)
        added += imported.length
      } catch (error) {
        problems.push(`${file.name}: ${error instanceof Error ? error.message : 'niet leesbaar'}`)
      }
    }
    setProducts(next)
    try { writeScraperProducts(window.localStorage, next) } catch { problems.push('Opslaan in deze browser is niet gelukt.') }
    setMessage([added ? `${added} producten geïmporteerd.` : '', ...problems].filter(Boolean).join(' '))
  }

  const toggle = (key: string, ids: string[], set: (ids: string[]) => void, id: string) => {
    const next = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
    set(next)
    writeIds(key, next)
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('nl')
    const filtered = products.filter(product =>
      (!needle || product.name.toLocaleLowerCase('nl').includes(needle)) &&
      (!favoritesOnly || favorites.includes(product.id)))
    const offersFirst = (left: ScraperProduct, right: ScraperProduct) =>
      Number(right.originalPriceCents !== null) - Number(left.originalPriceCents !== null)
    return [...filtered].sort(sortByUnit
      ? (left, right) => (unitPriceCents(left)?.cents ?? Infinity) - (unitPriceCents(right)?.cents ?? Infinity)
      : offersFirst)
  }, [products, query, favoritesOnly, favorites, sortByUnit])

  return (
    <div className="hifi-home hifi-products scraper-products" data-figma-node="3064:3125">
      <header className="hifi-products-heading">
        <h1 className="hifi-page-title">Producten</h1>
        <button type="button" className="hifi-icon-button scraper-favorites-toggle" aria-label="Toon alleen favorieten"
          aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}>
          <svg width="22" height="20" viewBox="0 0 26 24" fill="none" aria-hidden="true"><path d="M13 22.2 3.6 13A6 6 0 0 1 12.1 4.5l.9.9.9-.9A6 6 0 0 1 22.4 13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </button>
      </header>

      <div className="hifi-search-row">
        <label className="hifi-search">
          <FigmaImage asset={a.productsSearch} alt="" />
          <input type="search" aria-label="Zoek producten" placeholder="Zoek producten"
            value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <button type="button" className="hifi-weekly-link" aria-label="Importeer supermarktproducten van de scrapers"
          onClick={() => fileInput.current?.click()}>
          <FigmaImage asset={a.productsWeekly} alt="" />
        </button>
        <input ref={fileInput} type="file" multiple hidden accept=".json,application/json"
          aria-label="Kies PLUS- of DekaMarkt-scraperbestanden"
          onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length) void importFiles(files)
          }} />
      </div>
      {message && <p className="scraper-products-message" role="status">{message}</p>}

      <section className="hifi-section" aria-labelledby="scraper-products-title">
        <div className="hifi-section-heading">
          <div>
            <h2 id="scraper-products-title">{query.trim() || 'Beste aanbiedingen'}</h2>
            <p className="recipe-count">{visible.length} producten</p>
          </div>
          <button type="button" className="scraper-sort" aria-label="Sorteer op laagste prijs per kg of liter"
            aria-pressed={sortByUnit} onClick={() => setSortByUnit(!sortByUnit)}>
            <FigmaImage asset={a.productsSort} alt="" />
          </button>
        </div>

        {products.length === 0
          ? <button type="button" className="scraper-products-empty" onClick={() => fileInput.current?.click()}>
              <strong>Nog geen producten</strong>
              <span>Importeer een PLUS- of DekaMarkt-scraperbestand (.json)</span>
            </button>
          : <div className="hifi-product-grid">
              {visible.map(product => {
                const unit = unitPriceCents(product)
                const favorite = favorites.includes(product.id)
                const picked = picks.includes(product.id)
                return (
                  <article className="hifi-product-card" key={product.id}>
                    <div className="hifi-product-image">
                      <ScraperProductCardImage product={product} />
                      <span className={`scraper-store-badge ${product.store === 'PLUS' ? 'plus' : 'deka'}`}>
                        {product.store === 'PLUS' ? 'PLUS' : 'DEKA'}
                      </span>
                      {unit && <span className="hifi-unit-price">{euro.formatCents(unit.cents)}/{unit.unit === 'kg' ? 'kg' : 'L'}</span>}
                    </div>
                    <div className="hifi-product-copy">
                      <h3>{product.name}</h3>
                      <div className="hifi-product-price">
                        <span>{product.packLabel}</span>
                        {product.originalPriceCents !== null && <del>{euro.formatCents(product.originalPriceCents)}</del>}
                        {product.priceCents !== null
                          ? <strong title={`Prijs waargenomen op ${new Date(product.capturedAt).toLocaleDateString('nl-NL')}`}>
                              {euro.formatCents(product.priceCents)}
                            </strong>
                          : <small className="hifi-unpriced">Prijs onbekend</small>}
                      </div>
                    </div>
                    <div className="hifi-product-actions">
                      <button type="button" className="hifi-product-favorite" aria-label={`Favoriet: ${product.name}`}
                        aria-pressed={favorite}
                        onClick={() => toggle(FAVORITES_STORAGE_KEY, favorites, setFavorites, product.id)}>
                        {favorite
                          ? <FigmaImage asset={a.imgHeartButton} alt="" />
                          : <svg className="scraper-heart-outline" width="22" height="20" viewBox="0 0 26 24" fill="none" aria-hidden="true"><path d="M13 22.2 3.6 13A6 6 0 0 1 12.1 4.5l.9.9.9-.9A6 6 0 0 1 22.4 13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>}
                      </button>
                      <button type="button" aria-label={`${picked ? 'Verwijder van' : 'Zet op'} mijn lijst: ${product.name}`}
                        aria-pressed={picked}
                        onClick={() => toggle(SCRAPER_PICKS_STORAGE_KEY, picks, setPicks, product.id)}>
                        {picked ? <span className="hifi-added">✓</span> : <FigmaImage asset={a.imgFrame7121} alt="" />}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>}
      </section>
    </div>
  )
}

/** Products the user put on the list from Producten, shown in Lijst. */
export function ScraperPicksList() {
  const [picks, setPicks] = useState<string[]>(() => typeof window === 'undefined' ? [] : readIds(SCRAPER_PICKS_STORAGE_KEY))
  const products = useMemo(() => {
    const all = initialProducts()
    return picks.flatMap(id => all.find(product => product.id === id) ?? [])
  }, [picks])
  if (!products.length) return null
  return (
    <section className="scraper-picks" aria-labelledby="scraper-picks-title">
      <h3 id="scraper-picks-title">Producten</h3>
      {products.map(product => (
        <div className="scraper-pick-row" key={product.id}>
          <span className="scraper-pick-thumb"><ScraperProductCardImage product={product} /></span>
          <span className="scraper-pick-copy">
            <strong>{product.name}</strong>
            <small>{product.store} · {product.packLabel}</small>
          </span>
          <span className="scraper-pick-price">{product.priceCents !== null ? euro.formatCents(product.priceCents) : '—'}</span>
          <button type="button" aria-label={`Verwijder van mijn lijst: ${product.name}`} onClick={() => {
            const next = picks.filter(id => id !== product.id)
            setPicks(next)
            writeIds(SCRAPER_PICKS_STORAGE_KEY, next)
          }}>×</button>
        </div>
      ))}
    </section>
  )
}
