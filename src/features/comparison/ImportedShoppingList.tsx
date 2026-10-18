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
  const [store, setStore] = useState<OfflineRetailer>('PLUS')
  const [now, setNow] = useState(() => Date.now())
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
        onClick={() => setStore(option)}>{option}</button>)}
      <button type="button" className="ghost-button" onClick={onOpenComparison}>
        Productkoppelingen bewerken
      </button>
    </div>
    <p><strong>{store}:</strong> {basket.matchedLineCount} van {basket.lines.length}
      gekoppeld · {basket.unresolvedLineCount} nog te controleren.</p>
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
    <PrivateStoreTripChecklist key={identity} basket={basket}
      observedAt={imported.captures[store].observedAt} fresh={fresh} />
    <p className="disclaimer">Afvinken blijft standaard tijdelijk.
      Alleen na jouw toestemming worden vinkjes in dit browsertabblad bewaard.</p>
  </section>
}
