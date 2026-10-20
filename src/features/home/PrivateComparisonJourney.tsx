import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { euro } from '../../lib/money.ts'
import {
  privateReviewedPairWithin24Hours,
  type OwnStore, type PrivateCaptureProgress, type PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import './privateComparisonJourney.css'

const stores: OwnStore[] = ['PLUS', 'DekaMarkt']

/**
 * A prominent route from Home to the existing source importer and exact SKU
 * review. Only live, complete owner-reviewed baskets may produce a number.
 * Partial price sources are guidance, not a financial estimate.
 */
export function PrivateComparisonJourney({
  reviewed, progress, onOpenPlanner, onOpenImport, onOpenList, onReview,
}: {
  reviewed: PrivateReviewedBaskets | null
  progress: PrivateCaptureProgress | null
  onOpenPlanner: () => void
  onOpenImport: () => void
  onOpenList: () => void
  onReview: (store: OwnStore, ingredientId: string) => void
}) {
  const plus = reviewed?.stores.PLUS
  const deka = reviewed?.stores.DekaMarkt
  const paired = !!plus && !!deka && privateReviewedPairWithin24Hours(plus, deka)
  const comparison = paired
    ? compareFullBaskets({ baseline: plus.basket, candidate: deka.basket }) : null
  const ready = paired && comparison?.claimable === true
  const cheaper = ready
    ? plus!.basket.totalCents === deka!.basket.totalCents ? null
      : plus!.basket.totalCents < deka!.basket.totalCents ? 'PLUS' : 'DekaMarkt'
    : null
  const delta = ready
    ? Math.abs(plus!.basket.totalCents - deka!.basket.totalCents) : null
  const singleReady = !!plus || !!deka
  const hasAnySource = singleReady || stores.some(store => !!progress?.stores[store])

  return <section className="private-comparison-journey" aria-label="Mijn echte winkelvergelijking">
    <div className="private-comparison-journey__heading">
      <div>
        <span className="private-comparison-journey__eyebrow">SUPA · JOUW WINKELMANDJE</span>
        <h2>Vergelijk dezelfde boodschappen</h2>
        <p>Plan je maaltijden, voeg zelf toegestane PLUS- en DekaMarkt-bronprijzen toe
          en controleer de gekozen verpakkingen. Je gegevens blijven lokaal in deze sessie.</p>
      </div>
      <button type="button" onClick={onOpenImport}>Open prijsvergelijking</button>
    </div>

    <div className="private-comparison-journey__shops" aria-label="Brondekking per winkel">
      {stores.map(store => {
        const complete = reviewed?.stores[store]
        const partial = progress?.stores[store]
        const fresh = partial?.fresh !== false
        const total = partial?.demandLineCount ?? complete?.basket.lines.length ?? 0
        const confirmed = complete?.basket.lines.length ?? partial?.reviewedLineCount ?? 0
        const next = !complete && fresh ? partial?.nextIngredientId : null
        return <div key={store} className="private-comparison-journey__shop">
          <strong>{store}</strong>
          <span>{complete
            ? 'Volledig persoonlijk gecontroleerd'
            : partial && !fresh ? 'Bronopname verouderd of toekomstig'
              : partial ? 'Nog producten controleren'
                : 'Nog geen gecontroleerde bronopname'}</span>
          {total > 0 && <>
            <progress max={total} value={Math.min(total, Math.max(0, confirmed))}
              aria-label={store + ' gecontroleerde producten'} />
            <small>{Math.min(total, Math.max(0, confirmed))} van {total} ingrediënten gecontroleerd</small>
          </>}
          <button type="button" className="private-comparison-journey__link"
            onClick={() => next ? onReview(store, next) : onOpenImport()}>
            {next ? 'Controleer volgend bronartikel' :
              complete ? 'Bekijk bevestigde artikelen' :
                partial && !fresh ? 'Vernieuw bronopname' : 'Voeg eigen bronprijzen toe'}
          </button>
        </div>
      })}
    </div>

    <div className="private-comparison-journey__result" role="status" aria-live="polite">
      {ready && delta !== null ? <>
        <span>Vergelijking van hetzelfde volledige eigen mandje</span>
        <strong>{cheaper
          ? cheaper + ' is ' + euro.formatCents(delta) + ' goedkoper in jouw bronopnames'
          : 'Beide eigen mandjes hebben hetzelfde hele-pakbedrag'}</strong>
        <p>PLUS: {euro.formatCents(plus!.basket.totalCents)} · DekaMarkt: {euro.formatCents(deka!.basket.totalCents)}.
          Alleen voor jouw geselecteerde, volledig gecontroleerde producten en bronmomenten.
          Dit is geen kassagarantie of onafhankelijk bewezen besparing.</p>
      </> : <>
        <span>Werkelijke prijsvergelijking</span>
        <strong>Volledig prijsverschil nog onbekend</strong>
        <p>{plus && deka && !paired
          ? 'Beide winkels zijn afzonderlijk gecontroleerd, maar de bronmomenten liggen meer dan 24 uur uiteen. Vernieuw de oudere opname.'
          : singleReady
            ? 'Eén winkel is volledig gecontroleerd. De andere winkel ontbreekt of heeft nog openstaande productkeuzes.'
            : hasAnySource
              ? 'Je hebt eigen brondata, maar nog niet voor beide winkels een volledig bevestigd mandje.'
              : 'Nog geen eigen actuele PLUS- en DekaMarkt-prijzen gekoppeld. Voorbeeldprijzen tellen niet mee.'}</p>
      </>}
    </div>
    <div className="private-comparison-journey__actions">
      <button type="button" onClick={onOpenPlanner}>Open weekplanner</button>
      <button type="button" onClick={onOpenImport}>Importeer of controleer prijzen</button>
      {singleReady && <button type="button" onClick={onOpenList}>Bekijk mijn echte winkellijst</button>}
    </div>
    <small>Geen fictieve prijzen, automatische retaileropvraging of publieke besparingsclaim.
      Ontbrekende en verlopen bronprijzen blijven onbekend.</small>
  </section>
}
