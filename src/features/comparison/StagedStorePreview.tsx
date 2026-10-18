import { useMemo } from 'react'
import type { PlannedMeal } from '../../domain/types.ts'
import { buildOneStoreBasket, type RecipeWithIngredients } from '../../domain/basket.ts'
import { parseSingleOfflineCapture, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { PrivateStoreTripChecklist } from './PrivateStoreTripChecklist.tsx'
import type { OfflineComparisonSession } from './offlineComparisonSession.ts'
import { LocalProductPicker } from './LocalProductPicker.tsx'
import { stagedStoreFingerprint } from './stagedStoreFingerprint.ts'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dates = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * This view is intentionally restricted to exactly one locally staged capture.
 * The existing canonical importer validates it again; no second retailer,
 * invented matching partner, quote comparison, scraper or public claim exists.
 */
export function StagedStorePreview({
  store, capture, plan, recipes, activeDays, clockMs, session,
}: {
  store: OfflineRetailer
  capture: Record<string, unknown>
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  clockMs: number
  session: OfflineComparisonSession
}) {
  const fingerprint = useMemo(() => stagedStoreFingerprint(capture, plan, recipes, activeDays),
    [capture, plan, recipes, activeDays])
  const manual = session.stagedManual[store]
  const choices = manual.fingerprint === fingerprint ? manual.products : {}
  function choose(id: string, productId: string) {
    session.setStagedManual(previous => {
      const values = previous[store].fingerprint === fingerprint
        ? { ...previous[store].products } : {}
      if (productId) values[id] = productId
      else delete values[id]
      return { ...previous, [store]: { fingerprint, products: values } }
    })
  }
  const result = useMemo(() => {
    try {
      const text = JSON.stringify({ schema: 'supa-offline-store-capture-v1', capture })
      const source = parseSingleOfflineCapture(text, clockMs).normalized
      if (source.retailer !== store) return null
      const basket = buildOneStoreBasket({
        store: { id: store, name: store },
        plan, recipes, activeDays, products: source.products,
        manualProductIds: choices,
      })
      return { source, basket }
    } catch { return null }
  }, [capture, store, plan, recipes, activeDays, clockMs, manual])

  if (!result) return <p role="alert" className="attention-card">
    De losse opname of Planner-inhoud kan niet veilig als winkelmandje worden getoond.
    Herlaad een geldige bronopname; er is geen prijsvergelijking gemaakt.
  </p>

  const { source, basket } = result
  const nowNs = BigInt(Math.trunc(clockMs)) * 1_000_000n
  const fresh = nowNs >= source.observedNs - 300_000_000_000n &&
    nowNs - source.observedNs <= 604_800_000_000_000n
  const complete = basket.lines.length > 0 && basket.selectedMealCount > 0 &&
    basket.unresolvedLineCount === 0
  const selected = new Set(session.extraProductIds[store])
  const extras = source.products.filter(product => selected.has(product.id))
  const extraLines = extras.map(product => ({
    id: product.id, name: product.name,
    packs: session.extraQuantities[store][product.id] ?? 1,
    priceCents: product.available && Number.isSafeInteger(product.priceCents) &&
      product.priceCents >= 0 ? product.priceCents : null,
    done: session.extraDoneIds[store].includes(product.id),
  }))
  const known = extraLines.reduce((sum, line) =>
    line.priceCents === null ? sum : sum + line.packs * line.priceCents, 0)
  const knownCents = Number.isSafeInteger(known) ? known : null
  const unknown = extraLines.filter(line => line.priceCents === null).length
  return <section className="offline-staged-preview"
    aria-label={'Voorlopige privéboodschappenlijst voor ' + store}>
    <h3>{store}: alvast je boodschappen bekijken</h3>
    <p>Een eigen opname, waargenomen {dates.format(new Date(source.observedMs))},
      met {source.products.length} ingelezen producten.
      De tweede winkel ontbreekt nog; er is <strong>geen prijsverschil</strong> berekend.</p>
    {!fresh && <p role="alert" className="attention-card">
      De bronopname is ouder dan 7 dagen. Onderstaande bedragen zijn geen actuele prijzen.
    </p>}
    <p><strong>{basket.matchedLineCount} van {basket.lines.length}</strong> ingrediënten
      automatisch uit jouw bron gekoppeld. {basket.unresolvedLineCount} ontbreken
      of hebben geen bruikbare prijs/verpakking.</p>
    <p><strong>{complete ? 'Totaal voor alleen ' + store : 'Bekend deelbedrag voor ' + store}:
      {' '}{basket.matchedLineCount > 0 || complete
        ? euros.format(basket.totalCents / 100) : 'onbekend'}</strong>
      {!complete && ' · dit is geen volledig mandtotaal.'}</p>
    <p className="disclaimer">De koppeling is uitsluitend een technisch voorstel uit
      jouw lokale opname. Controleer verpakkingen, identiteit, hoeveelheden en prijzen
      zelf. Handmatige keuzes zijn tijdelijk en brongebonden; ze worden pas door de
      normale twee-winkeltoelating overgenomen als de originele opname en je weekmenu gelijk blijven.</p>
    <details className="offline-staged-preview__matches">
      <summary>Controleer / koppel mijn {basket.lines.length} weekmenu-ingrediënten</summary>
      {basket.lines.map(line => <div key={line.id} className="offline-price-workbench__line">
        <div><strong>{line.ingredientLabel}</strong>
          <small>Benodigd: {line.requirement.amount ?? '?'} {line.requirement.unit}</small>
          {line.status === 'matched' ?
            <small>{line.packs} × {line.productName} · {euros.format(line.lineTotalCents / 100)}</small> :
            <small>Nog geen geschikte koppeling of eigen prijs.</small>}
          <LocalProductPicker key={fingerprint + ':' + line.id}
            store={store} ingredient={line.ingredientLabel}
            requirementUnit={line.requirement.unit}
            products={source.products} selected={choices[line.id] ?? ''}
            onSelect={productId => choose(line.id, productId)}
          />
        </div>
      </div>)}
    </details>
    {extras.length > 0 && <section className="offline-own-extras" aria-label={'Losse privéproducten bij ' + store}>
      <h4>Zelf toegevoegde artikelen ({extras.length})</h4>
      <p className="disclaimer">Je hebt deze producten vanuit Producten aan deze winkel toegevoegd.
        Ze tellen niet mee in de rekenkundige prijs van het geplande maaltijdmandje.</p>
      <p className="offline-own-extras__subtotal" role="status">
        <strong>{knownCents === null ? 'Subtotaal niet berekenbaar' :
          (unknown ? 'Bekend deelbedrag' : 'Subtotaal') + ': ' + euros.format(knownCents / 100)}</strong>
        {unknown > 0 && <small>{unknown} prijzen ontbreken. Dit is geen volledig subtotaal.</small>}
      </p>
      <ul>{extras.map(product => <li key={product.id}>
        <label>
          <input type="checkbox" checked={session.extraDoneIds[store].includes(product.id)}
            onChange={() => session.setExtraDoneIds(previous => ({
              ...previous, [store]: previous[store].includes(product.id)
                ? previous[store].filter(id => id !== product.id)
                : [...previous[store], product.id],
            }))} />
          <span><strong>{product.name}</strong>
            <small>{product.available ? euros.format(product.priceCents / 100) :
              'Prijs niet beschikbaar'} per verpakking</small>
          </span>
        </label>
        <label className="offline-own-extras__quantity">Verpakkingen
          <select aria-label={'Aantal verpakkingen ' + product.name}
            value={session.extraQuantities[store][product.id] ?? 1}
            onChange={event => {
              const packs = Number(event.target.value)
              if (!Number.isSafeInteger(packs) || packs < 1 || packs > 99) return
              session.setExtraQuantities(previous => ({
                ...previous, [store]: { ...previous[store], [product.id]: packs },
              }))
            }}>
            {Array.from({ length: 99 }, (_, index) => index + 1)
              .map(packs => <option key={packs} value={packs}>{packs}</option>)}
          </select>
        </label>
        <button type="button" className="ghost-button" onClick={() => {
          session.setExtraProductIds(previous => ({
            ...previous, [store]: previous[store].filter(id => id !== product.id),
          }))
          session.setExtraDoneIds(previous => ({
            ...previous, [store]: previous[store].filter(id => id !== product.id),
          }))
          session.setExtraQuantities(previous => {
            const quantities = { ...previous[store] }
            delete quantities[product.id]
            return { ...previous, [store]: quantities }
          })
        }}>Verwijder</button>
      </li>)}</ul>
    </section>}
    <PrivateStoreTripChecklist
      key={JSON.stringify([store, source.observedAt, basket.lines.map(line =>
        line.status === 'matched' ? [line.id, line.productId, line.packs, line.pricePerPackCents]
          : [line.id, 'onbekend'])])}
      basket={basket} observedAt={source.observedAt} fresh={fresh}
      extraLines={extraLines}
    />
  </section>
}
