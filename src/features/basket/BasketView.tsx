import type { OneStoreBasket, RecipeWithIngredients } from '../../domain/basket'
import type { PlannedMeal } from '../../domain/types.ts'
import { ManualStoreComparison } from '../comparison/ManualStoreComparison'
import { OfflineReviewedWorkbench } from '../comparison/OfflineReviewedWorkbench'
import type { BasketComparison } from '../../domain/basketComparison'
import { euro } from '../../lib/money'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation'
import {
  basketComparisonCanShowMoney,
  basketComparisonHeadline,
  basketCostDisclosure,
  basketLineExplanation,
  basketReviewSummary,
  comparisonWarningCopy,
  orderBasketLinesForReview,
} from './basketPresentation'
import { StatPill } from '../../components/StatPill'
import { comparisonLineHighlights, comparisonLineHighlightCopy, comparisonMatchesVisibleBaskets } from './comparisonLineHighlights.ts'

function quantity(amount: number | null, unit: string) {
  const label = quantityUnitLabelNl(unit, amount)
  return amount === null ? `? ${label}` : `${amount} ${label}`
}

export function BasketView({
  basket,
  comparison,
  comparisonBaseline,
  comparisonCandidate,
  manualPlan,
  manualRecipes,
  manualActiveDays,
}: {
  basket: OneStoreBasket
  comparison: BasketComparison
  comparisonBaseline: OneStoreBasket
  comparisonCandidate: OneStoreBasket
  manualPlan?: PlannedMeal[]
  manualRecipes?: RecipeWithIngredients[]
  manualActiveDays?: string[]
}) {
  const basketCost = basketCostDisclosure(
    basket.totalCents,
    basket.unresolvedLineCount,
  )
  const baselineCost = basketCostDisclosure(
    comparisonBaseline.totalCents,
    comparisonBaseline.unresolvedLineCount,
  )
  const candidateCost = basketCostDisclosure(
    comparisonCandidate.totalCents,
    comparisonCandidate.unresolvedLineCount,
  )
  // The domain comparator's older owner branch is still pending. Do not
  // imply equal prices or savings for an empty plan in the live routed UI,
  // even if an upstream comparison incorrectly says it is claimable.
  const hasComparableDemand =
    basket.selectedMealCount > 0 &&
    comparisonBaseline.selectedMealCount > 0 &&
    comparisonCandidate.selectedMealCount > 0 &&
    basket.lines.length > 0 &&
    comparisonBaseline.lines.length > 0 &&
    comparisonCandidate.lines.length > 0
  const comparisonCanShowMoney = hasComparableDemand &&
    basketComparisonCanShowMoney(comparison, comparisonCandidate) &&
    comparisonMatchesVisibleBaskets(comparison, comparisonBaseline, comparisonCandidate)
  const displayComparison = comparisonCanShowMoney
    ? comparison
    : { ...comparison, outcome: 'unknown' as const, claimable: false }
  const comparisonWarning = hasComparableDemand
    ? comparisonWarningCopy(
      comparisonBaseline.unresolvedLineCount,
      comparisonCandidate.unresolvedLineCount,
      Array.isArray(comparison?.reasons) ? comparison.reasons.length : 1,
    )
    : 'Plan eerst een maaltijd; zonder boodschappen is er geen financieel verschil te vergelijken.'
  const comparisonHighlights = comparisonCanShowMoney
    ? comparisonLineHighlights(comparison)
    : []
  const reviewSummary = basketReviewSummary(basket.unresolvedLineCount)
  const basketLines = orderBasketLinesForReview(basket.lines)

  return (
    <section className="screen">
      {manualPlan && manualRecipes && manualActiveDays && (
        <OfflineReviewedWorkbench plan={manualPlan} recipes={manualRecipes} activeDays={manualActiveDays} />
      )}
      {manualPlan && manualRecipes && manualActiveDays && (
        <ManualStoreComparison
          key={JSON.stringify([manualPlan, manualActiveDays, manualRecipes.map(recipe => [recipe.id, recipe.ingredients])])}
          plan={manualPlan}
          recipes={manualRecipes}
          activeDays={manualActiveDays}
        />
      )}
      <details className="demo-comparison-disclosure" open={!manualPlan}>
        <summary>{manualPlan ? 'Toon oude voorbeeldberekening (geen actuele winkelprijzen)' : 'Voorbeeldmandje'}</summary>
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
              volledig mandtotaal. Dit zijn voorbeeldprijzen, geen actuele winkelprijzen of bewezen besparing.
            </>
          ) : (
            <>
              Dit is een volledig voorbeeldmandje met gecontroleerde voorbeeldprijzen.
              Geen actuele winkelprijzen of bewezen besparing.
            </>
          )}
        </p>
      </div>

      <div className="comparison-card" data-comparison-outcome={displayComparison.outcome}>
        <span className="eyebrow">Gecontroleerde winkelvergelijking</span>
        <strong>{hasComparableDemand
          ? basketComparisonHeadline(displayComparison, comparisonCandidate)
          : 'Plan eerst maaltijden om winkels te vergelijken'}</strong>
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
        {comparisonHighlights.length > 0 && (
          <section className="comparison-line-breakdown" aria-label="Grootste mandregelverschillen" data-comparison-line-breakdown="true">
            <h3>Grootste verschillen per ingrediënt</h3>
            <div className="list-card">
              {comparisonHighlights.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.ingredientLabel}</strong>
                    <span>{comparisonLineHighlightCopy(item, comparisonCandidate.store.name)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="disclaimer">
              Dit laat alleen zien waar deze voorbeeldmanden verschillen, niet
              waarom. Het bewijst geen aanbiedingen, besparingen of live prijzen.
            </p>
          </section>
        )}

        {displayComparison.claimable ? (
          <p className="disclaimer">
            Vergelijking van voorbeeldprijzen voor dezelfde week en een volledige mand.
            Geen actuele winkelprijzen of bewezen besparing.
          </p>
        ) : (
          <div className="comparison-warning">
            <strong>Geen financieel verschil tonen</strong>
            <span>{comparisonWarning}</span>
          </div>
        )}
      </div>

      {reviewSummary && (
        <div className="attention-card" data-basket-review-priority="true">
          <strong>Eerst controleren</strong>
          <span>{reviewSummary}</span>
        </div>
      )}

      <div className="list-card">
        {basketLines.map((line) => (
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
                    {basketLineExplanation(line.status, line.reasons)}
                  </small>
                </>
              ) : (
                <small className="trace-note">
                  Controle nodig · {basketLineExplanation(line.status, line.reasons)}
                </small>
              )}
            </div>
            <strong>
              {line.status === 'matched'
                ? euro.formatCents(line.lineTotalCents)
                : '—'}
            </strong>
          </div>
        ))}
      </div>
      </details>
    </section>
  )
}
