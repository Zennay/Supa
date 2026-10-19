import { useState, type FormEvent } from 'react'
import type { PlannedMeal, Recipe } from '../../domain/types'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import { buildIngredientReuseInsight } from '../../domain/ingredientReuse.ts'
import { IngredientReuseCard } from './IngredientReuseCard.tsx'
import { RecipeReusePreviewPanel } from './RecipeReusePreviewPanel.tsx'
import { assessPlannerBudget, getBudgetState } from '../../domain/planner'
import { euro } from '../../lib/money'
import { RecipePriceExplanation } from './RecipePriceExplanation'
import { plannerKnownMinimumOverrunCents } from './plannerKnownMinimumOverrun.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import { HiFiPlannerWeekCard } from './HiFiPlannerWeekCard.tsx'
import './planner.css'

const budgetOptions = [30, 35, 40]

type PlannerViewProps = {
  budget: number
  activeDays: string[]
  plannedMeals: PlannedMeal[]
  recipes: Recipe[]
  basketTotalCents: number | null
  basketUnresolvedLineCount: number
  ownSource?: { store: string; observedAt: string }
  ownSourceChoices?: { store: string; observedAt: string }[]
  onOwnSourceChange?: (store: string) => void
  onOpenComparison: () => void
  onBudgetChange: (budget: number) => void
  onToggleDay: (day: string) => void
  onRecipeChange: (day: string, recipeId: string) => void
  onReset: () => void
}

export function PlannerView({
  budget,
  activeDays,
  plannedMeals,
  recipes,
  basketTotalCents,
  basketUnresolvedLineCount,
  ownSource,
  ownSourceChoices,
  onOwnSourceChange,
  onOpenComparison,
  onBudgetChange,
  onToggleDay,
  onRecipeChange,
  onReset,
}: PlannerViewProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [customError, setCustomError] = useState('')
  const customActive = validCustomWeekBudgetEuros(budget) !== null && !budgetOptions.includes(budget)

  const commitCustomBudget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cents = parseCustomWeekBudgetCents(customDraft)
    if (cents === null) {
      setCustomError('Vul een bedrag van €0,01 t/m €1.000,00 in, met maximaal twee decimalen.')
      return
    }
    onBudgetChange(cents / 100)
    setCustomError('')
    setCustomOpen(false)
  }

  // Never use internal example-catalog prices as a real budget total.
  // Only a still-current, fully reviewed user's own store basket can
  // establish a spent amount. The chosen budget remains editable regardless.
  const trustedCents = ownSource && typeof basketTotalCents === 'number' &&
    Number.isSafeInteger(basketTotalCents) && basketTotalCents >= 0
    ? basketTotalCents : null
  const plannedCost = trustedCents === null ? null : trustedCents / 100
  const budgetState = plannedCost === null ? null : getBudgetState(plannedCost, budget)
  const budgetAssessment = plannedCost === null ? null : assessPlannerBudget(
    plannedCost, budget, basketUnresolvedLineCount,
  )
  const budgetKnown = budgetAssessment?.status === 'known'
  const unresolvedCount = budgetAssessment?.status === 'unknown'
    ? budgetAssessment.unresolvedLineCount : 0
  // The basket already uses canonical integer cents. Do not subtract floating
  // euros and then let the strict formatter silently show an em dash.
  const budgetCents = Math.round(budget * 100)
  const exactRemainingCents =
    trustedCents !== null &&
    Number.isSafeInteger(budgetCents) && budget >= 0 &&
    budget === budgetCents / 100
      ? budgetCents - trustedCents
      : null
  // Only a strictly validated cent-native lower bound can prove minimum
  // overspend while unfinished matches keep the final total uncertain.
  const knownMinimumOverrunCents = trustedCents !== null && !budgetKnown
    ? plannerKnownMinimumOverrunCents({
        knownCostCents: trustedCents,
        budgetEuros: budget,
        unresolvedLineCount: basketUnresolvedLineCount,
      })
    : null
  // Derive reuse from current active recipe choices. No packet, leftover or
  // monetary savings conclusion can be inferred from ingredient overlap.
  const ingredientRecipes = recipes.filter(
    (recipe): recipe is RecipeWithIngredients =>
      recipe !== null && typeof recipe === 'object' &&
      Array.isArray((recipe as RecipeWithIngredients).ingredients),
  )
  const hasIngredientData = ingredientRecipes.length > 0 &&
    ingredientRecipes.length === recipes.length
  const reuseInsight = hasIngredientData
    ? buildIngredientReuseInsight({ plan: plannedMeals, recipes: ingredientRecipes, activeDays })
    : null

  return (
    <section className="screen hifi-planner-screen" data-figma-node="3359:4896">
      <div className="section-heading">
        <div>
          <h2>Planning</h2>
          <span className="hifi-sr-only">Plan eerst. Vergelijk daarna.</span>
        </div>
        <button type="button" className="ghost-button" onClick={onReset}>Reset</button>
      </div>

      <HiFiPlannerWeekCard
        plannedMeals={plannedMeals}
        activeDays={activeDays}
        onToggleDay={onToggleDay}
      />

      <div className="day-grid" aria-label="Geplande maaltijden">
        {plannedMeals.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
          if (!recipe) return null
          const active = activeDays.includes(item.day)

          return (
            <article
              className={active ? 'meal-card meal-config active' : 'meal-card meal-config'}
              key={item.day}
            >
              <span className="day">{item.day}</span>
              <span className="meal-copy">
                <label htmlFor={`recipe-${item.day}`}>Recept</label>
                <select
                  id={`recipe-${item.day}`}
                  value={item.recipeId}
                  onChange={(event) => onRecipeChange(item.day, event.target.value)}
                >
                  {recipes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
                <small>{recipe.minutes} min</small>
                <RecipePriceExplanation estimatedCost={recipe.estimatedCost} />
              </span>
              <button
                type="button"
                className="plan-check"
                aria-label={active ? `${item.day} uit planning halen` : `${item.day} aan planning toevoegen`}
                aria-pressed={active}
                onClick={() => onToggleDay(item.day)}
              >
                {active ? '✓' : '+'}
              </button>
            </article>
          )
        })}
      </div>

      {ownSource && ownSourceChoices && ownSourceChoices.length > 1 &&
        onOwnSourceChange && (
        <div className="budget-card" aria-label="Kies welke echte winkelbron jouw weekbudget gebruikt">
          <label htmlFor="own-source-budget-store"><strong>Winkel voor jouw eigen bronbudget</strong></label>
          <select id="own-source-budget-store" value={ownSource.store}
            onChange={event => onOwnSourceChange(event.currentTarget.value)}
            style={{ display: 'block', width: '100%', minHeight: 44, marginTop: 8 }}>
            {ownSourceChoices.map(choice =>
              <option key={choice.store} value={choice.store}>{choice.store} · eigen opname {choice.observedAt}</option>)}
          </select>
          <p className="disclaimer">Alleen jouw afzonderlijk bevestigde winkelmandjes.
            Een prijsverschil mag pas worden getoond wanneer beide bronmomenten vergelijkbaar zijn.</p>
        </div>
      )}
      <section className="budget-card" aria-labelledby="weekbudget-title">
        <div className="budget-heading">
          <div>
            <span className="eyebrow">Voorkeur · weekbudget</span>
            <strong id="weekbudget-title">{euro.format(budget)}</strong>
          </div>
          <span
            className={
              budgetKnown && budgetAssessment?.status === 'known' && budgetAssessment.budgetState.overBudget
                ? 'budget-status warning'
                : budgetKnown
                  ? 'budget-status'
                  : 'budget-status warning'
            }
            aria-live="polite"
          >
            {trustedCents === null
              ? 'Prijs onbekend · nog geen eigen winkelbron'
              : budgetKnown
              ? exactRemainingCents === null
                ? 'Budgetgegevens controleren'
                : exactRemainingCents < 0
                  ? `${euro.formatCents(-exactRemainingCents)} boven budget`
                  : `${euro.formatCents(exactRemainingCents)} over`
              : knownMinimumOverrunCents !== null
                ? `Minimaal ${euro.formatCents(knownMinimumOverrunCents)} boven budget · ${unresolvedCount} ${unresolvedCount === 1 ? 'mandregel' : 'mandregels'} open`
                : `${unresolvedCount} ${unresolvedCount === 1 ? 'mandregel' : 'mandregels'} open`}
          </span>
        </div>

        <div className="budget-options" aria-label="Kies je weekbudget">
          {budgetOptions.map((option) => (
            <button
              type="button"
              key={option}
              className={budget === option ? 'budget-chip active' : 'budget-chip'}
              aria-pressed={budget === option}
              onClick={() => onBudgetChange(option)}
            >
              {euro.format(option)}
            </button>
          ))}
        </div>

        <div className="budget-custom">
          <button
            type="button"
            className={customActive ? 'budget-chip budget-custom-toggle active' : 'budget-chip budget-custom-toggle'}
            aria-pressed={customActive}
            aria-expanded={customOpen}
            aria-controls="custom-weekbudget-form"
            onClick={() => {
              setCustomOpen((open) => !open)
              setCustomError('')
              setCustomDraft(customActive ? budget.toFixed(2).replace('.', ',') : '')
            }}
          >
            {customActive ? `Eigen budget · ${euro.format(budget)}` : 'Ander bedrag instellen'}
          </button>
          {customOpen && (
            <form id="custom-weekbudget-form" className="budget-custom-form" onSubmit={commitCustomBudget} noValidate>
              <label htmlFor="custom-weekbudget-value">Eigen weekbudget (€)</label>
              <input
                id="custom-weekbudget-value"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Bijv. 27,50"
                value={customDraft}
                aria-invalid={customError !== '' ? true : undefined}
                aria-describedby="custom-weekbudget-hint"
                onChange={(event) => {
                  setCustomDraft(event.target.value)
                  setCustomError('')
                }}
              />
              <p id="custom-weekbudget-hint" className="disclaimer">€0,01 – €1.000,00 · maximaal twee decimalen</p>
              <button type="submit" className="budget-chip">Budget opslaan</button>
              {customError && <p role="alert" className="budget-custom-error">{customError}</p>}
            </form>
          )}
        </div>

        {plannedCost !== null && budgetState !== null
          ? <div
              className="budget-progress"
              role="progressbar"
              aria-label={budgetKnown ? 'Gepland deel van het weekbudget' : 'Bekend minimum van het weekbudget'}
              aria-valuemin={0}
              aria-valuemax={budget}
              aria-valuenow={Math.min(plannedCost, budget)}
            >
              <span style={{ width: `${budgetState.usage * 100}%` }} />
            </div>
          : <p className="disclaimer" role="status">
              Geen budgetbalk berekend: er zijn nog geen complete, zelf gecontroleerde winkelprijzen.
            </p>}

        <div className="budget-summary">
          <span>{activeDays.length} maaltijden actief</span>
          <strong>
            {plannedCost === null
              ? 'Prijs onbekend'
              : budgetKnown ? euro.format(plannedCost)
                : `min. ${euro.format(plannedCost)}`}
          </strong>
        </div>
        {trustedCents !== null && ownSource && <p className="disclaimer" role="status">
          Privécontrole: {ownSource.store} · eigen winkelopname {ownSource.observedAt}.
          Het getoonde budgetbedrag gebruikt jouw volledige, persoonlijk bevestigde winkelmand
          in plaats van de Supa-voorbeeldprijzen. Geen kassagarantie of publieke besparingsclaim.
        </p>}
        {trustedCents === null && <p className="disclaimer" role="status">
          Je weekbudget is ingesteld, maar de werkelijke mandprijs is onbekend.
          Supa rekent voorbeeldcatalogusprijzen niet mee als jouw uitgaven.
          Open Vergelijk om eigen actuele winkelproducten, verpakkingen en prijzen te controleren.
        </p>}
        {trustedCents === null && <button type="button" className="ghost-button"
          onClick={onOpenComparison}>
          Open Vergelijk · voeg eigen winkelprijzen toe
        </button>}
        {trustedCents !== null && <p className="disclaimer">
          {budgetKnown
            ? <>Dit bedrag komt uit jouw persoonlijk bevestigde winkelbron
                en dezelfde fysieke verpakkingsberekening als Vergelijk.</>
            : <>Nog {unresolvedCount} {unresolvedCount === 1 ? 'productmatch is' : 'productmatches zijn'}
                {' '}onopgelost; dit is uitsluitend het bekende minimum.
                {knownMinimumOverrunCents !== null
                  ? <> De huidige eigen bronkosten liggen minimaal {euro.formatCents(knownMinimumOverrunCents)} boven budget. Het werkelijke tekort kan groter zijn.</>
                  : <> Supa kan nog niet bepalen of je binnen budget zit.</>}
              </>}
        </p>}
      </section>

      {hasIngredientData && <IngredientReuseCard insight={reuseInsight} />}
      {hasIngredientData && (
        <RecipeReusePreviewPanel
          plannedMeals={plannedMeals}
          activeDays={activeDays}
          recipes={ingredientRecipes}
          onChooseRecipe={onRecipeChange}
        />
      )}

      <div className="insight-card">
        <strong>Van je planning naar je boodschappenlijst</strong>
        <p>
          Onzekere productmatches worden niet ingevuld: ze blijven zichtbaar
          als controlepunt in Mand en Lijst.
        </p>
      </div>
    </section>
  )
}
