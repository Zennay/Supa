import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { PlannedMeal, Recipe } from '../../domain/types'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import { buildIngredientReuseInsight } from '../../domain/ingredientReuse.ts'
import { HiFiReuseStrip } from './HiFiReuseStrip.tsx'
import { assessPlannerBudget, getBudgetState } from '../../domain/planner'
import { euro } from '../../lib/money'
import { plannerKnownMinimumOverrunCents } from './plannerKnownMinimumOverrun.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import { HiFiPlannerWeekCard, plannerWeekDate, weekdayNames } from './HiFiPlannerWeekCard.tsx'
import { RecipePicker } from './RecipePicker.tsx'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets, figmaPlannerThumbs } from '../home/figmaAssets'
import './planner.css'

const budgetOptions = [30, 35, 40]
const shortDayNames: Record<string, string> = {
  Ma: 'Ma', Di: 'Di', Wo: 'Wo', Do: 'Do', Vr: 'Vr', Za: 'Za', Zo: 'Zon',
}

type PlannerViewProps = {
  budget: number
  activeDays: string[]
  plannedMeals: PlannedMeal[]
  recipes: Recipe[]
  onOpenShoppingList: () => void
  basketTotalCents: number | null
  basketUnresolvedLineCount: number
  ownSource?: { store: string; observedAt: string }
  onBudgetChange: (budget: number) => void
  onToggleDay: (day: string) => void
  onRecipeChange: (day: string, recipeId: string) => void
  /** Home's "Plan" asks Planner to open the picker for a day. */
  pickRequest?: { day: string | null; serial: number } | null
}

/** Per-serving example estimate in exact cents, or null when unknown. */
function servingEstimateCents(recipe: Recipe): number | null {
  const cost = recipe.estimatedCost
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null
  if (!Number.isSafeInteger(recipe.servings) || recipe.servings < 1) return null
  const cents = Math.round(cost * 100)
  if (cents / 100 !== cost) return null
  return Math.round(cents / recipe.servings)
}

export function PlannerView({
  budget,
  activeDays,
  plannedMeals,
  recipes,
  onOpenShoppingList,
  basketTotalCents,
  basketUnresolvedLineCount,
  ownSource,
  onBudgetChange,
  onToggleDay,
  onRecipeChange,
  pickRequest,
}: PlannerViewProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [customError, setCustomError] = useState('')
  const [pickingDay, setPickingDay] = useState<string | null>(null)
  const customActive = validCustomWeekBudgetEuros(budget) !== null && !budgetOptions.includes(budget)

  useEffect(() => {
    if (!pickRequest) return
    const requested = pickRequest.day && plannedMeals.some(meal => meal.day === pickRequest.day)
      ? pickRequest.day : null
    const day = requested ?? plannedMeals.find(meal => !activeDays.includes(meal.day))?.day ??
      plannedMeals[0]?.day ?? null
    if (day) setPickingDay(day)
    // Only a new request (serial) may open the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRequest?.serial])

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
  const ingredientRecipes = useMemo(() => recipes.filter(
    (recipe): recipe is RecipeWithIngredients =>
      recipe !== null && typeof recipe === 'object' &&
      Array.isArray((recipe as RecipeWithIngredients).ingredients),
  ), [recipes])
  const hasIngredientData = ingredientRecipes.length > 0 &&
    ingredientRecipes.length === recipes.length
  const reuseInsight = useMemo(() => hasIngredientData
    ? buildIngredientReuseInsight({ plan: plannedMeals, recipes: ingredientRecipes, activeDays })
    : null, [hasIngredientData, plannedMeals, ingredientRecipes, activeDays])

  const dayImages = useMemo(() => Object.fromEntries(plannedMeals.flatMap(meal => {
    const image = figmaPlannerThumbs[meal.recipeId]
    return image ? [[meal.day, image]] : []
  })), [plannedMeals])

  const pickingMeal = pickingDay ? plannedMeals.find(meal => meal.day === pickingDay) : undefined
  const pickingLabel = pickingDay
    ? `${weekdayNames[pickingDay] ?? pickingDay} ${plannerWeekDate(pickingDay).getDate()}`
    : ''

  return (
    <section className="screen hifi-planner-screen" data-figma-node="3359:4896">
      <div className="section-heading">
        <div>
          <h2>Planning</h2>
          <span className="hifi-sr-only">Plan eerst. Vergelijk daarna.</span>
        </div>
      </div>

      <HiFiPlannerWeekCard
        plannedMeals={plannedMeals}
        activeDays={activeDays}
        onChooseDay={setPickingDay}
        dayImages={dayImages}
      />

      {hasIngredientData && <HiFiReuseStrip insight={reuseInsight} />}

      <div className="day-grid" aria-label="Geplande maaltijden">
        {plannedMeals.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
          if (!recipe) return null
          const active = activeDays.includes(item.day)
          const date = plannerWeekDate(item.day).getDate()
          const weekday = weekdayNames[item.day] ?? item.day
          const image = figmaPlannerThumbs[recipe.id]
          const perServing = servingEstimateCents(recipe)

          // Figma 3359:4896 meal rows: date column, photo, title, time and
          // chevron for planned days; an "add to planner" prompt otherwise.
          // Every tap opens the recipe picker; nothing is added implicitly.
          return (
            <article
              className={active ? 'meal-card meal-config hifi-meal-row active' : 'meal-card meal-config hifi-meal-row'}
              key={item.day}
            >
              <span className="day hifi-meal-date" aria-hidden="true">
                <small>{shortDayNames[item.day] ?? item.day}</small>
                <strong>{date}</strong>
              </span>
              {active
                ? <button type="button" className="meal-copy hifi-meal-copy hifi-meal-open"
                    aria-label={`${weekday} ${date}: ${recipe.title} wijzigen`}
                    onClick={() => setPickingDay(item.day)}>
                    <span className="hifi-meal-thumb" aria-hidden="true">
                      {image
                        ? <FigmaImage asset={image} alt="" />
                        : <span>{recipe.title.slice(0, 1)}</span>}
                    </span>
                    <span className="hifi-meal-text">
                      <strong className="hifi-meal-title">{recipe.title}</strong>
                      <span className="hifi-meal-meta">
                        <small className="hifi-meal-time">
                          <FigmaImage asset={figmaAssets.imgVector4} alt="" />
                          {recipe.minutes} min
                        </small>
                        {perServing !== null && <small className="hifi-meal-price"
                          title="Richtprijs uit het voorbeeldrecept, geen actuele winkelprijs">
                          {euro.formatCents(perServing)} p.p
                        </small>}
                      </span>
                    </span>
                    <span className="hifi-meal-chevron" aria-hidden="true" />
                  </button>
                : <button type="button" className="meal-copy hifi-meal-empty hifi-meal-open"
                    aria-label={`${weekday} ${date}: recept kiezen`}
                    onClick={() => setPickingDay(item.day)}>
                    <span className="hifi-meal-text">
                      <strong>Voeg nu iets toe aan de planner</strong>
                      <small>Kies een recept</small>
                    </span>
                    <span className="plan-check" aria-hidden="true">+</span>
                  </button>}
            </article>
          )
        })}
      </div>

      <section className="budget-card hifi-planner-total" aria-labelledby="hifi-total-title">
        <div className="budget-summary hifi-total-row">
          <span>
            <strong className="hifi-total-label" id="hifi-total-title">Totaal</strong>
            <small>{activeDays.length} maaltijden actief</small>
          </span>
          <strong className="hifi-total-amount">
            {plannedCost === null
              ? 'Prijs onbekend'
              : budgetKnown ? euro.format(plannedCost)
                : `min. ${euro.format(plannedCost)}`}
          </strong>
        </div>
        <hr className="hifi-total-divider" />

        <details className="hifi-planner-calc">
          <summary>Bekijk berekening</summary>
          <div className="budget-heading">
            <span>
              <span className="hifi-budget-label">Weekbudget</span>
              <small>Jouw voorkeur</small>
            </span>
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
                Nog geen totaal: er zijn nog geen complete, gecontroleerde winkelprijzen voor deze week.
              </p>}

          {trustedCents !== null && ownSource && <p className="disclaimer" role="status">
            Bron: {ownSource.store} · eigen winkelopname {ownSource.observedAt}.
          </p>}
          {trustedCents !== null && !budgetKnown && <p className="disclaimer">
            Nog {unresolvedCount} {unresolvedCount === 1 ? 'productmatch is' : 'productmatches zijn'}
            {' '}onopgelost; dit is uitsluitend het bekende minimum.
          </p>}
        </details>
      </section>

      {/* Figma Planner primary action under the total card. */}
      <button type="button" className="hifi-planner-list-cta" onClick={onOpenShoppingList}
        disabled={activeDays.length === 0}>
        Voeg planning toe aan boodschappenlijst
      </button>

      {pickingDay && pickingMeal && (
        <RecipePicker
          day={pickingDay}
          dayLabel={pickingLabel}
          recipes={recipes}
          selectedId={pickingMeal.recipeId}
          active={activeDays.includes(pickingDay)}
          onChoose={(recipeId) => {
            if (recipeId !== pickingMeal.recipeId) onRecipeChange(pickingDay, recipeId)
            if (!activeDays.includes(pickingDay)) onToggleDay(pickingDay)
            setPickingDay(null)
          }}
          onRemove={() => {
            if (activeDays.includes(pickingDay)) onToggleDay(pickingDay)
            setPickingDay(null)
          }}
          onClose={() => setPickingDay(null)}
        />
      )}
    </section>
  )
}
