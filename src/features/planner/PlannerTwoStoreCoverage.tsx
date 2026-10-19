import { useState } from 'react'
import type { PrivateCaptureProgress, PrivateReviewedBaskets, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import './plannerTwoStoreCoverage.css'

const STORES = ['PLUS', 'DekaMarkt'] as const
type Cell = { kind: 'ready' | 'reviewed' | 'review' | 'missing' | 'source' | 'expired'; text: string }

function sourceStillRecent(observedAt: string, now: number): boolean {
  const ms = Date.parse(observedAt)
  return Number.isFinite(ms) && now >= ms - 300_000 && now - ms <= 604_800_000
}

/** This is a work queue over the canonical physical Planner demand, never a
 * second financial calculation. One shop may be ready while the paired total
 * remains unknown; neither readiness nor a unit price is a savings claim. */
function cellFor(
  store: OwnStore, id: string, progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null, now: number,
): Cell {
  if (reviewed?.stores[store]) return { kind: 'ready', text: 'Heel mandje gecontroleerd' }
  const capture = progress?.stores[store]
  if (!capture) return { kind: 'source', text: 'Bronbestand ontbreekt' }
  if (!capture.fresh || !sourceStillRecent(capture.observedAt, now)) {
    return { kind: 'expired', text: 'Bron verouderd of ongeldig' }
  }
  if (capture.missingIngredients.some(item => item.id === id)) {
    return { kind: 'missing', text: 'Nog geen passend bronproduct' }
  }
  if (capture.awaitingReviewIngredients.some(item => item.id === id)) {
    return { kind: 'review', text: 'Controleer originele SKU en verpakking' }
  }
  if (capture.demandLineCount < 1) return { kind: 'review', text: 'Koppeling nog niet beoordeeld' }
  return { kind: 'reviewed', text: 'SKU gekoppeld · mandje nog onvolledig' }
}

function amountText(need: PlannerCaptureGuideNeed): string {
  return typeof need.amount === 'number' && Number.isFinite(need.amount) &&
    need.amount > 0 && need.amount <= 1_000_000
    ? `${need.amount.toLocaleString('nl-NL', { useGrouping: false, maximumFractionDigits: 3 })} ${need.unit}`
    : 'Hoeveelheid nog controleren'
}

export function PlannerTwoStoreCoverage({
  needs, progress, reviewed, onReviewIngredient, onOpenComparison, now,
}: {
  needs: readonly PlannerCaptureGuideNeed[]
  progress: PrivateCaptureProgress | null
  reviewed: PrivateReviewedBaskets | null
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onOpenComparison: () => void
  now: number
}) {
  const [showAll, setShowAll] = useState(false)
  if (!needs.length) return null
  // The admission bridge is plan-bound. Never mix two versions of a week.
  const samePlan = !progress || !reviewed || progress.planKey === reviewed.planKey
  const safeReviewed = samePlan ? reviewed : null
  const safeProgress = samePlan ? progress : null
  const items = needs.map(need => ({
    need,
    cells: STORES.map(store => cellFor(store, need.id, safeProgress, safeReviewed, now)),
  }))
  const ready = STORES.map((_, index) => items.filter(item =>
    ['ready', 'reviewed'].includes(item.cells[index].kind)).length)
  const pending = items.filter(item => item.cells.some(cell =>
    cell.kind !== 'ready' && cell.kind !== 'reviewed'))
  const visible = showAll ? items : pending
  return <section className="supa-two-store-coverage" aria-labelledby="supa-coverage-heading">
    <div className="supa-two-store-coverage__heading">
      <div>
        <h4 id="supa-coverage-heading">Hetzelfde weekmandje bij twee winkels</h4>
        <p>Voor elk oorspronkelijk ingrediënt zie je welke bron of productcontrole nog ontbreekt.
          Groene status is geen nieuwe prijs of bewijs van besparing.</p>
      </div>
      <button type="button" className="ghost-button" onClick={onOpenComparison}>
        Open mijn bronimport
      </button>
    </div>
    <div className="supa-two-store-coverage__totals" aria-label="Ingrediëntenstatus per winkel">
      {STORES.map((store, index) => <div key={store}>
        <strong>{store}</strong>
        <span>{ready[index]} / {needs.length} ingrediënten gekoppeld</span>
      </div>)}
    </div>
    <div className="supa-two-store-coverage__toolbar">
      <p role="status">{pending.length === 0
        ? 'Alle ingrediënten hebben een bronkoppeling. Alleen een complete actuele twee-winkelvergelijking mag een verschil tonen.'
        : `${pending.length} van ${needs.length} ingrediënten hebben nog een controle nodig bij minstens één winkel.`}</p>
      <label><input type="checkbox" checked={showAll}
        onChange={event => setShowAll(event.currentTarget.checked)} />
        Toon ook volledig gekoppelde ingrediënten</label>
    </div>
    {visible.length > 0 ? <div className="supa-two-store-coverage__rows">
      {visible.map(({ need, cells }) => <article key={need.id}
        className="supa-two-store-coverage__row">
        <header><strong>{need.label}</strong><small>{amountText(need)}</small></header>
        <div className="supa-two-store-coverage__shops">
          {STORES.map((store, index) => {
            const cell = cells[index]
            return <section key={store} aria-label={store + ': ' + cell.text}>
              <strong>{store}</strong>
              <span data-status={cell.kind}>{cell.text}</span>
              {cell.kind !== 'ready' && cell.kind !== 'reviewed' && <button
                type="button" onClick={() =>
                  cell.kind === 'source' || cell.kind === 'expired'
                    ? onOpenComparison() : onReviewIngredient(store, need.id)}>
                {cell.kind === 'source' ? 'Importeer bron' : cell.kind === 'expired'
                  ? 'Vernieuw bron' : 'Bekijk oorspronkelijke SKU'}
              </button>}
            </section>
          })}
        </div>
      </article>)}
    </div> : <p>Geen openstaande ingredientcontroles in deze weergave.
      Schakel hierboven alle ingrediënten in om beide winkels naast elkaar te bekijken.</p>}
    <small>Alle prijzen blijven onbekend zolang één of beide hele mandjes onvolledig,
      onveilig of verouderd zijn. Geen automatische goedkeuring van producten.</small>
  </section>
}
