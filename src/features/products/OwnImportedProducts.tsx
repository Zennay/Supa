import { useEffect, useMemo, useState } from 'react'
import type { StoreProduct } from '../../domain/basket.ts'
import { parseSingleOfflineCapture, type OfflineCapture, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { offlineSessionFresh } from '../comparison/offlineSessionBaskets.ts'
import type { OfflineComparisonSession } from '../comparison/offlineComparisonSession.ts'
import './ownImportedProducts.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dates = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores: OfflineRetailer[] = ['PLUS', 'DekaMarkt']
type Group = 'kg' | 'liter' | 'stuk'
type Result = { store: OfflineRetailer; product: StoreProduct; group: Group | null;
  unitCents: number | null; amount: string }

function detail(store: OfflineRetailer, product: StoreProduct): Result {
  const { packAmount, packUnit, priceCents, available } = product
  // Canonical offline imports normalize omitted packCount to one outer pack.
  const packCount = typeof product.packCount === 'number' && Number.isSafeInteger(product.packCount) && product.packCount > 0 ? product.packCount : 1
  const group: Group | null = packUnit === 'g' || packUnit === 'kg' ? 'kg'
    : packUnit === 'ml' || packUnit === 'l' ? 'liter'
      : packUnit === 'piece' ? 'stuk' : null
  const physical = packAmount === null ? null : packAmount * packCount
  const basis = physical === null ? null :
    packUnit === 'g' || packUnit === 'ml' ? physical / 1000 : physical
  const known = available && Number.isSafeInteger(priceCents) && priceCents >= 0
  const calculated = known && basis !== null && Number.isFinite(basis) && basis > 0
    ? Math.round(priceCents / basis) : null
  return {
    store, product, group,
    unitCents: calculated !== null && Number.isSafeInteger(calculated) && calculated >= 0 ? calculated : null,
    amount: packAmount === null ? 'Verpakking onbekend'
      : String(packCount > 1 ? packCount + ' × ' : '') + String(packAmount) + ' ' + packUnit,
  }
}

/** Only explicit local imports. Never uses historical/Figma prices in real baskets. */
export function OwnImportedProducts({
  session, query, onCompare, onOpenList,
}: {
  session?: OfflineComparisonSession
  query: string
  onCompare: () => void
  onOpenList: () => void
}) {
  const [storeFilter, setStoreFilter] = useState<'all' | OfflineRetailer>('all')
  const [unitFilter, setUnitFilter] = useState<'all' | Group>('all')
  const [sortByUnitPrice, setSortByUnitPrice] = useState(false)
  const [limit, setLimit] = useState(48)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setClock(Date.now())
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const imported = session?.imported ?? null
  // A canonically admitted single-store source is useful on its own, but
  // never becomes a paired/comparable retailer quote.
  const staged = useMemo(() => {
    const captures: Partial<Record<OfflineRetailer, OfflineCapture>> = {}
    if (imported || !session) return captures
    for (const store of stores) {
      const capture = session.stagedCaptures[store]
      if (!capture) continue
      try {
        const admitted = parseSingleOfflineCapture(JSON.stringify({
          schema: 'supa-offline-store-capture-v1', capture,
        }), clock).normalized
        if (admitted.retailer === store) captures[store] = admitted
      } catch { /* A rejected local capture must not create a catalog. */ }
    }
    return captures
  }, [imported, session?.stagedCaptures, clock])
  const availableCaptures = imported?.captures ?? staged
  const availableStores = stores.filter(store => !!availableCaptures[store])
  const selectedExtras = session ? stores.reduce((total, store) =>
    total + session.extraProductIds[store].length, 0) : 0
  const rows = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('nl-NL')
    const all = stores.flatMap(store => availableCaptures[store]?.products.map(
      product => detail(store, product)) ?? [])
    const filtered = all.filter(row =>
      (storeFilter === 'all' || row.store === storeFilter) &&
      (unitFilter === 'all' || row.group === unitFilter) &&
      row.product.name.toLocaleLowerCase('nl-NL').includes(words))
    if (sortByUnitPrice) {
      const rank: Record<Group, number> = { kg: 0, liter: 1, stuk: 2 }
      filtered.sort((a, b) => {
        const groupOrder = (a.group ? rank[a.group] : 3) - (b.group ? rank[b.group] : 3)
        return groupOrder || (a.unitCents ?? Infinity) - (b.unitCents ?? Infinity) ||
          a.product.name.localeCompare(b.product.name, 'nl-NL')
      })
    }
    return filtered
  }, [availableCaptures, query, storeFilter, unitFilter, sortByUnitPrice])

  if (availableStores.length === 0 || !session) return <section className="hifi-section own-products" aria-label="Eigen prijsopnames">
    <h2>Mijn eigen winkelprijzen</h2>
    <p>Je hebt nog geen PLUS- en DekaMarkt-prijsbestanden geladen. Gebruik je eigen
      geautoriseerde waarnemingen om producten, verpakkingen en eenheidsprijzen te bekijken.</p>
    <button type="button" className="own-products__primary" onClick={onCompare}>
      Importeer prijsbestanden in Vergelijk
    </button>
    <p className="disclaimer">Historische bronproducten en Figma-voorbeelden blijven apart.
      Zij leveren nooit automatisch actuele winkelprijzen aan je mand.</p>
  </section>

  const fresh = imported ? offlineSessionFresh(imported, clock) :
    availableStores.every(store => {
      const source = availableCaptures[store]
      if (!source) return false
      const nowNs = BigInt(Math.trunc(clock)) * 1_000_000n
      return nowNs >= source.observedNs - 300_000_000_000n &&
        nowNs - source.observedNs <= 604_800_000_000_000n
    })
  return <section className="hifi-section own-products" aria-label="Mijn eigen prijsopnames">
    <div className="hifi-section-heading"><div>
      <h2>Mijn privéproducten</h2>
      <p className="recipe-count">{rows.length} producten uit eigen {availableStores.join(' en ')}-invoer</p>
    </div></div>
    <p className="disclaimer" role="status">
      {fresh ? 'Opnames vallen binnen de lokale 7-dagenlimiet.' : 'Verlopen opnames: dit zijn geen actuele winkelprijzen.'}
      {' '}{availableStores.map(store =>
        store + ': ' + dates.format(new Date(availableCaptures[store]!.observedMs))).join('; ')}.
      {' '}Alleen jouw eigen invoer, niet onafhankelijk geverifieerd of gepubliceerd.
      {!imported && ' De andere winkel ontbreekt: geen twee-winkel prijsverschil.'}
      {imported && !imported.pairedWithin24h && ' De twee opnames liggen meer dan 24 uur uiteen.'}
    </p>
    {selectedExtras > 0 && <div className="own-products__list-pulse" role="status">
      <span>{selectedExtras} zelf gekozen losse {selectedExtras === 1 ? 'artikel' : 'artikelen'}
        {' '}staan buiten de berekende maaltijdmand, klaar in Lijst.</span>
      <button type="button" className="own-products__primary" onClick={onOpenList}>
        Open mijn boodschappenlijst
      </button>
    </div>}
    <div className="own-products__filters">
      <label>Winkel <select value={storeFilter}
        onChange={event => { setStoreFilter(event.target.value as typeof storeFilter); setLimit(48) }}>
        <option value="all">Beide winkels</option>
        <option value="PLUS">PLUS</option>
        <option value="DekaMarkt">DekaMarkt</option>
      </select></label>
      <label>Eenheid <select value={unitFilter}
        onChange={event => { setUnitFilter(event.target.value as typeof unitFilter); setLimit(48) }}>
        <option value="all">Alle eenheden</option>
        <option value="kg">Per kilogram</option>
        <option value="liter">Per liter</option>
        <option value="stuk">Per stuk</option>
      </select></label>
      <button type="button" className="ghost-button" aria-pressed={sortByUnitPrice}
        onClick={() => setSortByUnitPrice(current => !current)}>
        {sortByUnitPrice ? 'Sortering uit' : 'Sorteer op eenheidsprijs'}
      </button>
    </div>
    <p className="disclaimer">Sortering vergelijkt uitsluitend prijzen binnen dezelfde
      eenheid (kg, liter of stuk). Onbekende en niet-beschikbare producten komen achteraan.
      Het zijn geen gecontroleerde winkelprijzen of aanbiedingen.
      {imported ? '' : ' Met één winkelopname kun je al losse producten selecteren; er bestaat nog geen twee-winkelvergelijking.'}
      Los toegevoegde artikelen staan apart op Lijst, buiten het berekende
      weekmandtotaal en het prijsverschil.</p>
    <div className="hifi-product-grid">
      {rows.slice(0, limit).map(({ store, product, group, unitCents, amount }) => (
        <article className="hifi-product-card own-products__card" key={store + ':' + product.id}>
          <div className="hifi-product-image own-products__picture">
            <span className="hifi-source-image" aria-hidden="true">{product.name.slice(0, 1)}</span>
            <span className="hifi-store-logo hifi-store-text">{store === 'PLUS' ? 'PLUS' : 'Deka'}</span>
          </div>
          <div className="hifi-product-copy">
            <h3>{product.name}</h3>
            <p className="own-products__pack">{amount}</p>
            {product.available ? <>
              <div className="hifi-product-price">
                <span>Eigen waarneming</span>
                <strong>{euros.format(product.priceCents / 100)}</strong>
              </div>
              <span className="own-products__unit-price">
                {unitCents === null || group === null ? 'Eenheidsprijs onbekend' :
                  euros.format(unitCents / 100) + ' per ' + group}
              </span>
            </> : <p className="hifi-no-price">Prijs onbekend of product niet beschikbaar</p>}
            {!fresh && <small>Verouderd · geen actuele winkelprijs</small>}
          </div>
          <button type="button" className="own-products__extra"
            aria-pressed={session.extraProductIds[store].includes(product.id)}
            aria-label={session.extraProductIds[store].includes(product.id)
              ? 'Verwijder extra artikel uit lijst: ' + product.name + ' bij ' + store
              : 'Voeg extra artikel toe aan lijst: ' + product.name + ' bij ' + store}
            onClick={() => {
              session.setExtraProductIds(previous => ({
                ...previous,
                [store]: previous[store].includes(product.id)
                  ? previous[store].filter(id => id !== product.id)
                  : [...previous[store], product.id],
              }))
              session.setExtraDoneIds(previous => ({
                ...previous, [store]: previous[store].filter(id => id !== product.id),
              }))
              session.setExtraQuantities(previous => {
                const quantities = { ...previous[store] }
                if (session.extraProductIds[store].includes(product.id)) {
                  delete quantities[product.id]
                } else {
                  quantities[product.id] = 1
                }
                return { ...previous, [store]: quantities }
              })
            }}>
            {session.extraProductIds[store].includes(product.id)
              ? '✓ Extra op mijn lijst' : '+ Los artikel aan lijst toevoegen'}
          </button>
          {session.extraProductIds[store].includes(product.id) && <button type="button"
            className="own-products__choose" onClick={() => {
              session.setSelectedStore(store)
              onOpenList()
            }}>Bekijk dit extra artikel op Lijst</button>}
          <button type="button" className="own-products__choose"
            onClick={() => { session.setSelectedStore(store); onCompare() }}>
            Controleer match in Vergelijk
          </button>
        </article>
      ))}
    </div>
    {rows.length === 0 && <p className="hifi-empty">Geen producten voor deze filters.
      Probeer een andere zoekterm of filter.</p>}
    {rows.length > limit && <button className="own-products__primary" type="button"
      onClick={() => setLimit(count => count + 48)}>
      Toon meer producten ({Math.min(rows.length - limit, 48)})
    </button>}
    <button type="button" className="own-products__primary" onClick={onCompare}>
      Bekijk mijn twee winkelmandjes
    </button>
  </section>
}
