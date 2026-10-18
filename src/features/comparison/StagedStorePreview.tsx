import { useMemo } from 'react'
import type { PlannedMeal } from '../../domain/types.ts'
import { buildOneStoreBasket, type RecipeWithIngredients } from '../../domain/basket.ts'
import { parseSingleOfflineCapture, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { PrivateStoreTripChecklist } from './PrivateStoreTripChecklist.tsx'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dates = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * This view is intentionally restricted to exactly one locally staged capture.
 * The existing canonical importer validates it again; no second retailer,
 * invented matching partner, quote comparison, scraper or public claim exists.
 */
export function StagedStorePreview({
  store, capture, plan, recipes, activeDays, clockMs,
}: {
  store: OfflineRetailer
  capture: Record<string, unknown>
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  clockMs: number
}) {
  const result = useMemo(() => {
    try {
      const text = JSON.stringify({ schema: 'supa-offline-store-capture-v1', capture })
      const source = parseSingleOfflineCapture(text, clockMs).normalized
      if (source.retailer !== store) return null
      const basket = buildOneStoreBasket({
        store: { id: store, name: store },
        plan, recipes, activeDays, products: source.products,
      })
      return { source, basket }
    } catch { return null }
  }, [capture, store, plan, recipes, activeDays, clockMs])

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
    <p className="disclaimer">De koppeling is uitsluitend een technisch voorstel binnen
      jouw lokale opname. Controleer verpakkingen, identiteit, hoeveelheden en prijzen
      zelf. Je kunt definitieve handmatige keuzes maken zodra beide winkelopnames
      samen in Vergelijk zijn geladen.</p>
    <PrivateStoreTripChecklist
      key={store + ':' + source.observedAt}
      basket={basket} observedAt={source.observedAt} fresh={fresh}
    />
  </section>
}
