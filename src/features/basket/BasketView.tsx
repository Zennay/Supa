import type { OneStoreBasket } from '../../domain/basket'
import type { BasketComparison } from '../../domain/basketComparison'
import { euro } from '../../lib/money'
import { basketCostDisclosure } from './basketPresentation'
import { StatPill } from '../../components/StatPill'

function quantity(amount: number | null, unit: string) {
  return amount === null ? `? ${unit}` : `${amount} ${unit}`
}

function comparisonTitle(
  comparison: BasketComparison,
  candidate: OneStoreBasket,
) {
  if (!comparison.claimable || comparison.outcome === 'unknown') {
    return 'Nog geen betrouwbare vergelijking'
  }

  if (comparison.outcome === 'same') {
    return 'Beide testmanden zijn even duur'
  }

  const difference = euro.format(
    Math.abs(comparison.savingsCents ?? 0) / 100,
  )
  return comparison.outcome === 'better'
    ? `${candidate.store.name} ligt ${difference} lager`
    : `${candidate.store.name} ligt ${difference} hoger`
}

export function BasketView({
  basket,
  comparison,
  comparisonBaseline,
  comparisonCandidate,
}: {
  basket: OneStoreBasket
  comparison: BasketComparison
  comparisonBaseline: OneStoreBasket
  comparisonCandidate: OneStoreBasket
}) {
  const basketCost = basketCostDisclosure(
    basket.totalCents,
    basketCost.unresolvedLineCount,
  )
  const baselineCost = basketCostDisclosure(
    comparisonBaseline.totalCents,
    comparisonBaseline.unresolvedLineCount,
  )
  const candidateCost = basketCostDisclosure(
    comparisonCandidate.totalCents,
    comparisonCandidate.unresolvedLineCount,
  )

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Eén-store mand</span>
          <h2>{basket.store.name}</h2>
        </div>
      </div>

      <div
        className="hero-total"
        data-basket-total-state={basketCost.state}
      >
        <span>{basketCost.headline}</span>
        <strong>{basketCost.amountLabel}</strong>
        <div className="stat-row">
          <StatPill label="Gematcht" value={String(basket.matchedLineCount)} />
          <StatPill label="Controle" value={String(basketCost.unresolvedLineCount)} />
        </div>
        <p className="disclaimer">
          {basketCost.state === 'minimum' ? (
            <>
              {basketCost.unresolvedLineCount}{' '}
              {basketCost.unresolvedLineCount === 1
                ? 'productkeuze is'
                : 'productkeuzes zijn'}{' '}
              nog niet meegerekend. Dit is alleen het bekende minimum, geen
              volledig mandtotaal. M2 testfixture — geen productie-liveprijs.
            </>
          ) : (
            <>
              Volledige deterministische M2 testfixture — geen besparingsclaim
              en geen productie-liveprijs.
            </>
          )}
        </p>
      </div>

      <div className="comparison-card" data-comparison-outcome={comparison.outcome}>
        <span className="eyebrow">Gecontroleerde winkelvergelijking</span>
        <strong>{comparisonTitle(comparison, comparisonCandidate)}</strong>
        <div className="comparison-totals">
          <div>
            <span>Baseline · {comparisonBaseline.store.name}</span>
            <strong data-basket-cost-state={baselineCost.state}>
              {baselineCost.amountLabel}
            </strong>
          </div>
          <div>
            <span>Kandidaat · {comparisonCandidate.store.name}</span>
            <strong data-basket-cost-state={candidateCost.state}>
              {candidateCost.amountLabel}
            </strong>
          </div>
        </div>
        {comparison.claimable ? (
          <p className="disclaimer">
            M3 controlled testdata · zelfde week en volledige mand · geen
            live-besparingsclaim.
          </p>
        ) : (
          <div className="comparison-warning">
            <strong>Geen financieel verschil tonen</strong>
            <span>{comparison.reasons.join(' · ')}</span>
          </div>
        )}
      </div>

      <div className="list-card">
        {basket.lines.map((line) => (
          <div
            className={line.status === 'matched' ? 'list-row trace-row' : 'list-row trace-row unresolved-row'}
            key={line.id}
          >
            <div>
              <strong>{line.ingredientLabel}</strong>
              <span>Benodigd: {quantity(line.requirement.amount, line.requirement.unit)}</span>
              {line.status === 'matched' ? (
                <>
                  <span>
                    → {line.productName} · {line.packs} verpakking{line.packs === 1 ? '' : 'en'}
                  </span>
                  <small className="trace-note">
                    Match {line.matchScore} · {line.reasons.join(' · ')}
                  </small>
                </>
              ) : (
                <small className="trace-note">
                  Controle nodig · {line.reasons.join(' · ')}
                </small>
              )}
            </div>
            <strong>
              {line.status === 'matched'
                ? euro.format(line.lineTotalCents / 100)
                : '—'}
            </strong>
          </div>
        ))}
      </div>
    </section>
  )
}
