import { useEffect, useMemo, useState } from 'react'
import type { PlannedMeal } from '../../domain/types.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import type { OfflineComparisonSession } from './offlineComparisonSession.ts'
import { offlineSessionBaskets, offlineSessionFresh } from './offlineSessionBaskets.ts'
import { PrivateStoreTripChecklist } from './PrivateStoreTripChecklist.tsx'
import './offlineReviewedWorkbench.css'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores: OfflineRetailer[] = ['PLUS', 'DekaMarkt']

/** Reuses actual private comparison inputs, never the demonstration basket. */
export function ImportedShoppingList({
  session, plan, recipes, activeDays, onOpenComparison,
}: {
  session: OfflineComparisonSession
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  onOpenComparison: () => void
}) {
  const store = session.selectedStore
  const [now, setNow] = useState(() => Date.now())
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const pair = useMemo(
    () => offlineSessionBaskets(session, plan, recipes, activeDays),
    [session.imported, session.manualSelections, plan, recipes, activeDays],
  )
  const imported = session.imported
  if (!imported) return null
  if (!pair) return <section className="offline-price-workbench__results" role="alert">
    Deze privéwinkelmand kan niet veilig aan je weekmenu worden gekoppeld.
    <button type="button" onClick={onOpenComparison}>Controleer in Vergelijk</button>
  </section>
  const basket = store === 'PLUS' ? pair.plus : pair.deka
  const extras = imported.captures[store].products.filter(product =>
    session.extraProductIds[store].includes(product.id))
  const extraDone = session.extraDoneIds[store]
  const fresh = offlineSessionFresh(imported, now)
  const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
    basket.unresolvedLineCount === 0
  const comparable = fresh && imported.pairedWithin24h && pair.comparison.claimable
  const identity = JSON.stringify([
    store, imported.captures[store].observedAt,
    basket.selectedMealCount, basket.totalCents,
    basket.matchedLineCount, basket.unresolvedLineCount,
    basket.lines.map(line => line.status === 'matched'
      ? [line.id, line.productId, line.packs, line.pricePerPackCents]
      : [line.id, 'onbekend']),
  ])
  return <section className="offline-price-workbench__results" aria-label="Mijn geïmporteerde boodschappenlijst">
    <span className="eyebrow">Jouw eigen invoer · privé</span>
    <h2>Mijn winkelmand voor het weekmenu</h2>
    <p>Dezelfde toegestane lokale invoer als in Vergelijk, met de actuele
      Planner-ingrediënten. Geen automatische bronrequests of publieke prijsclaim.</p>
    <div className="offline-price-workbench__actions" role="group" aria-label="Kies je winkel">
      {stores.map(option => <button key={option} type="button"
        aria-pressed={store === option}
        onClick={() => session.setSelectedStore(option)}>{option}</button>)}
      <button type="button" className="ghost-button" onClick={onOpenComparison}>
        Productkoppelingen bewerken
      </button>
    </div>
    <p><strong>{store}:</strong> {basket.matchedLineCount} van {basket.lines.length}
      gekoppeld · {basket.unresolvedLineCount} nog te controleren.</p>
    {basket.unresolvedLineCount > 0 && <section className="offline-list-missing" aria-label="Ontbrekende producten oplossen">
      <h3>Maak je winkelmand compleet</h3>
      <p>Voor {store} ontbreken {basket.unresolvedLineCount} geldige productkoppelingen.
        Kies per ingrediënt zelf een passend product uit je bestaande privéprijsopname.
        Er wordt geen winkelprijs verzonnen of online opgehaald.</p>
      <ul>
        {basket.lines.filter(line => line.status === 'unresolved').slice(0, 25)
          .map(line => <li key={line.id}>
            <span><strong>{line.ingredientLabel}</strong> · benodigd:
              {' '}{line.requirement.amount ?? '?'} {line.requirement.unit}</span>
            <button type="button" onClick={() => {
              session.setReviewTarget({ store, ingredientId: line.id })
              onOpenComparison()
            }}>Koppel product</button>
          </li>)}
      </ul>
      {basket.unresolvedLineCount > 25 && <small>
        Nog {basket.unresolvedLineCount - 25} ontbrekende ingrediënten vind je onder Vergelijk.
      </small>}
    </section>}
    <p><strong>{complete ? 'Totaal eigen invoer' : 'Bekend deelbedrag, geen mandtotaal'}:</strong>{' '}
      {basket.matchedLineCount || complete ? euro.format(basket.totalCents / 100) : 'onbekend'}</p>
    {!fresh && <p className="attention-card" role="alert">
      Verouderde prijsopname. Importeer nieuwe toegestane gegevens voor een actuele vergelijking.
    </p>}
    {!imported.pairedWithin24h && <p className="attention-card">
      De twee opnames liggen meer dan 24 uur uiteen: geen geldig prijsverschil.
    </p>}
    {comparable && <p className="disclaimer">Privé rekenkundig vergelijkbaar,
      niet onafhankelijk geverifieerd en geen officiële besparingsclaim.</p>}
    <div className="offline-price-workbench__actions">
      {!confirmDiscard ? (
        <button type="button" className="ghost-button" onClick={() => setConfirmDiscard(true)}>
          Wis deze lokale winkelopnames
        </button>
      ) : (
        <div role="group" aria-label="Bevestig wissen prijsopnames">
          <p role="status">Wis beide winkelopnames, productkeuzes en tijdelijke vinkjes
            uit dit open app-tabblad? Gedownloade bestanden en apart met jouw
            toestemming opgeslagen concepten blijven onaangeroerd.</p>
          <button type="button" onClick={() => {
            session.setImported(null)
            session.setText('')
            session.setStagedCaptures({})
            session.setManualSelections({ fingerprint: '', products: {} })
            session.setTripMemory({})
            session.setExtraProductIds({ PLUS: [], DekaMarkt: [] })
            session.setExtraDoneIds({ PLUS: [], DekaMarkt: [] })
            session.setImportEpoch(current => current + 1)
            setConfirmDiscard(false)
          }}>Ja, wis deze privégegevens</button>
          <button type="button" className="ghost-button"
            onClick={() => setConfirmDiscard(false)}>Annuleer</button>
        </div>
      )}
    </div>
    {extras.length > 0 && <section className="offline-own-extras"
      aria-label={'Losse extra producten bij ' + store}>
      <h3>Mijn losse {store}-artikelen ({extras.length})</h3>
      <p className="disclaimer">Zelf gekozen via Producten. Deze losse artikelen
        staan buiten de Planner-ingrediënten: hun prijzen zijn niet meegenomen
        in het berekende mandtotaal, weekbudget of prijsverschil met de andere winkel.</p>
      <ul>
        {extras.map(product => <li key={product.id}>
          <label>
            <input type="checkbox" checked={extraDone.includes(product.id)}
              onChange={() => session.setExtraDoneIds(previous => ({
                ...previous, [store]: previous[store].includes(product.id)
                  ? previous[store].filter(id => id !== product.id)
                  : [...previous[store], product.id],
              }))} />
            <span>
              <strong>{product.name}</strong>
              <small>{product.packAmount ?? '?'} {product.packUnit}
                {product.packCount && product.packCount > 1 ? ' × ' + product.packCount : ''}
                {' '}· {product.available ? 'Eigen opname: ' + euro.format(product.priceCents / 100) :
                  'Prijs onbekend of niet beschikbaar'} (niet meegeteld)
              </small>
            </span>
          </label>
          <button type="button" className="ghost-button"
            onClick={() => {
              session.setExtraProductIds(previous => ({
                ...previous, [store]: previous[store].filter(id => id !== product.id),
              }))
              session.setExtraDoneIds(previous => ({
                ...previous, [store]: previous[store].filter(id => id !== product.id),
              }))
            }}>Verwijder</button>
        </li>)}
      </ul>
      <small>Extra artikelen en hun vinkjes blijven alleen in het geheugen van dit
        open app-tabblad. Nieuwe of gewiste bronopnames wissen deze selectie.</small>
    </section>}
    <PrivateStoreTripChecklist key={identity} basket={basket}
      observedAt={imported.captures[store].observedAt} fresh={fresh}
      memoryProgress={session.tripMemory[store]}
      onMemoryChange={(basketIdentity, done) => session.setTripMemory(previous =>
        ({ ...previous, [store]: { identity: basketIdentity, done } }))} />
    <p className="disclaimer">Afvinken blijft standaard tijdelijk.
      Alleen na jouw toestemming worden vinkjes in dit browsertabblad bewaard.</p>
  </section>
}
