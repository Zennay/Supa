import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { PlannedMeal, Recipe } from '../../domain/types'
import { type RecipeWithIngredients } from '../../domain/basket.ts'
import { buildIngredientReuseInsight } from '../../domain/ingredientReuse.ts'
import { HiFiReuseStrip } from './HiFiReuseStrip.tsx'
import { assessPlannerBudget, getBudgetState } from '../../domain/planner'
import { euro } from '../../lib/money'
import { flyToCart } from '../home/flyToCart'
import { pricePerPersonLabel } from '../recipes/recipePricePerPerson'
import { plannerKnownMinimumOverrunCents } from './plannerKnownMinimumOverrun.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import { HiFiPlannerWeekCard, plannerWeekDate, weekdayNames } from './HiFiPlannerWeekCard.tsx'
import { FigmaImage } from '../../components/FigmaImage'
import { figmaAssets, figmaPlannerThumbs } from '../home/figmaAssets'
import type { PrivateReviewedBaskets, PrivateCaptureProgress, OwnStore, PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import './planner.css'

const budgetOptions = [30, 35, 40]

type PlannerViewProps = {
  /** Open the recipe picker for an open day ('Toevoegen aan planner'). */
  onPickRecipe: (day: string) => void
  budget: number
  activeDays: string[]
  plannedMeals: PlannedMeal[]
  recipes: Recipe[]
  ownReviewed?: PrivateReviewedBaskets | null
  captureProgress?: PrivateCaptureProgress | null
  preferredOwnStore: OwnStore
  onOpenShoppingList: () => void
  onOpenRecipes: () => void
  onOpenMixedRoute: (extraCostRaw?: string) => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
  basketTotalCents: number | null
  basketUnresolvedLineCount: number
  ownSource?: { store: string; observedAt: string }
  ownSourceChoices?: { store: string; observedAt: string }[]
  onOwnSourceChange: (store: OwnStore) => void
  onOpenComparison: () => void
  onImportSourceFiles: (files: File[]) => void
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onBudgetChange: (budget: number) => void
  onToggleDay: (day: string) => void
  onRecipeChange: (day: string, recipeId: string) => void
  onReset: () => void
}

export function PlannerView({
  onPickRecipe,
  budget,
  activeDays,
  plannedMeals,
  recipes,
  ownReviewed,
  captureProgress,
  preferredOwnStore,
  onOpenShoppingList,
  onOpenRecipes,
  onOpenMixedRoute,
  onChooseRouteLine,
  basketTotalCents,
  basketUnresolvedLineCount,
  ownSource,
  ownSourceChoices,
  onOwnSourceChange,
  onOpenComparison,
  onImportSourceFiles,
  onReviewIngredient,
  onBudgetChange,
  onToggleDay,
  onRecipeChange,
  onReset,
}: PlannerViewProps) {
  // The mobile selector is ephemeral; only the canonical App callbacks
  // change the actual planned day and recipe. Respect main's recipe picker.
  const [focusedDay, setFocusedDay] = useState('')
  const quickDay = plannedMeals.some(({ day }) => day === focusedDay)
    ? focusedDay
    : (plannedMeals.find(({ day }) => activeDays.includes(day))?.day ?? plannedMeals[0]?.day ?? '')
  const quickDayActive = activeDays.includes(quickDay)
  const quickMeal = plannedMeals.find(({ day }) => day === quickDay)
  const quickRecipeAvailable = recipes.some(({ id }) => id === quickMeal?.recipeId)
  const [openDay, setOpenDay] = useState<string | null>(null)

  const jumpToRecipe = () => {
    if (!quickDayActive) {
      onPickRecipe(quickDay)
      return
    }
    const select = document.getElementById('planner-mobile-quick-recipe')
    select?.scrollIntoView({ block: 'center' })
    select?.focus({ preventScroll: true })
  }

  const jumpToBudget = () => {
    document.getElementById('weekbudget-title')?.scrollIntoView({ block: 'center' })
  }

  const [customOpen, setCustomOpen] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [customError, setCustomError] = useState('')
  const customActive = validCustomWeekBudgetEuros(budget) !== null && !budgetOptions.includes(budget)
  const [focusCustomBudget, setFocusCustomBudget] = useState(false)
  useEffect(() => {
    if (!focusCustomBudget || !customOpen) return
    const input = document.getElementById('custom-weekbudget-value')
    if (!input) return
    input.scrollIntoView({ block: 'center' })
    input.focus({ preventScroll: true })
    setFocusCustomBudget(false)
  }, [customOpen, focusCustomBudget])

  const jumpToCustomBudget = () => {
    const calc = document.querySelector<HTMLDetailsElement>('.hifi-planner-calc')
    if (calc) calc.open = true
    setCustomDraft(budget.toFixed(2).replace('.', ','))
    setCustomError('')
    setCustomOpen(true)
    setFocusCustomBudget(true)
  }

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

  // Per-person prices of the planned meals, two servings each.
  const activeMeals = plannedMeals.flatMap(meal => {
    if (!activeDays.includes(meal.day)) return []
    const recipe = recipes.find(candidate => candidate.id === meal.recipeId)
    if (!recipe) return []
    const label = pricePerPersonLabel(recipe)
    const pp = label ? Number(label.replace('€', '').replace(',', '.').replace(' p.p.', '')) : null
    return [{ day: meal.day, recipe, pp }]
  })
  const estimate = activeMeals.length > 0 && activeMeals.every(item => item.pp !== null)
    ? activeMeals.reduce((sum, item) => sum + (item.pp as number) * item.recipe.servings, 0)
    : null

  const dayImages = useMemo(() => Object.fromEntries(plannedMeals.flatMap(meal => {
    const image = figmaPlannerThumbs[meal.recipeId]
    return image ? [[meal.day, image]] : []
  })), [plannedMeals])

  return (
    <section className="screen hifi-planner-screen" data-figma-node="3359:4896">
      <div className="section-heading hifi-planner-heading">
        <h2>Planning</h2>
        <button type="button" className="hifi-reset-button" onClick={onReset} aria-label="Planning resetten">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
          </svg>
          Reset
        </button>
      </div>

      <HiFiPlannerWeekCard
        plannedMeals={plannedMeals}
        activeDays={activeDays}
        onToggleDay={day => activeDays.includes(day) ? onToggleDay(day) : onPickRecipe(day)}
        focusedDay={quickDay}
        onFocusDay={setFocusedDay}
        dayImages={dayImages}
      />

      {quickDay && (
        <nav className="planner-mobile-jump" aria-label="Snelle acties voor je weekplanning">
          <div className="planner-mobile-jump-heading">
            <label htmlFor="planner-mobile-edit-day">Bewerk een dag zonder de planning te wijzigen</label>
            <select
              id="planner-mobile-edit-day"
              value={quickDay}
              onChange={(event) => setFocusedDay(event.currentTarget.value)}
            >
              {plannedMeals.map(({ day }) => (
                <option key={day} value={day}>
                  {day} · {activeDays.includes(day) ? 'gepland' : 'nog niet ingepland'}
                </option>
              ))}
            </select>
            <p aria-live="polite">
              <strong>{quickDay}</strong> · {quickDayActive ? 'In je planning' : 'Nog niet ingepland'}
              <span> · {activeDays.length} van {plannedMeals.length} dagen</span>
            </p>
          </div>
          <div className="planner-mobile-recipe" role="group" aria-label="Recept voor de gekozen dag">
            {quickDayActive && quickMeal && quickRecipeAvailable
              ? <>
                  <label htmlFor="planner-mobile-quick-recipe">Recept voor {weekdayNames[quickDay] ?? quickDay}</label>
                  <select id="planner-mobile-quick-recipe" value={quickMeal.recipeId}
                    onChange={(event) => onRecipeChange(quickDay, event.currentTarget.value)}>
                    {recipes.map(recipe => (
                      <option key={recipe.id} value={recipe.id}>{recipe.title}</option>
                    ))}
                  </select>
                  <small>Wijzig dit recept direct in je bestaande weekplanning.</small>
                </>
              : <p>{quickDayActive
                  ? 'Dit recept is niet meer beschikbaar. Open Recepten om het te controleren.'
                  : `Plan ${quickDay} eerst; alleen een dag kiezen verandert je planning niet.`}</p>}
          </div>
          <div className="planner-mobile-budget" role="group" aria-label="Snel weekbudget instellen">
            <strong>Weekbudget: {euro.format(budget)}</strong>
            <small aria-live="polite">
              {trustedCents === null ? 'Winkelkosten nog onbekend'
                : budgetKnown && exactRemainingCents !== null
                  ? exactRemainingCents < 0
                    ? `${euro.formatCents(-exactRemainingCents)} boven budget`
                    : `${euro.formatCents(exactRemainingCents)} over`
                  : knownMinimumOverrunCents !== null
                    ? `Minimaal ${euro.formatCents(knownMinimumOverrunCents)} boven budget; overige prijzen onbekend`
                    : 'Niet alle mandprijzen bekend'}
            </small>
            <div className="planner-mobile-budget-options">
              {budgetOptions.map(option => (
                <button key={option} type="button" aria-pressed={budget === option}
                  onClick={() => onBudgetChange(option)}>
                  {euro.format(option)}
                </button>
              ))}
              <button type="button" className="planner-mobile-custom-budget"
                aria-controls="custom-weekbudget-form" onClick={jumpToCustomBudget}>
                Eigen bedrag instellen
              </button>
            </div>
          </div>
          <div className="planner-mobile-jump-buttons">
            <button type="button" onClick={jumpToRecipe} aria-controls={`recipe-${quickDay}`}>
              {quickDayActive ? 'Kies recept voor' : 'Plan en kies recept voor'} {quickDay}
            </button>
            <button type="button" onClick={jumpToBudget}>
              Naar weekbudget
            </button>
            <button type="button" onClick={onOpenShoppingList}>
              Naar boodschappenlijst
            </button>
          </div>
        </nav>
      )}
      {hasIngredientData && <HiFiReuseStrip insight={reuseInsight} />}

      <div className="day-grid" aria-label="Geplande maaltijden">
        {plannedMeals.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
          if (!recipe) return null
          const active = activeDays.includes(item.day)
          const open = active && openDay === item.day

          const date = plannerWeekDate(item.day).getDate()
          const weekday = weekdayNames[item.day] ?? item.day
          const image = figmaPlannerThumbs[recipe.id]
          const price = pricePerPersonLabel(recipe)

          // Planner design: date column, photo, title with time and price
          // per person and a chevron; open days show an add-to-planner prompt.
          return (
            <article
              className={`hifi-meal-card${open ? ' open' : ''}${item.day === quickDay ? ' quick-focused' : ''}`}
              key={item.day}
            >
              <div className={active ? 'meal-card meal-config hifi-meal-row active' : 'meal-card meal-config hifi-meal-row'}>
                <span className="day hifi-meal-date" aria-label={`${weekday} ${date}`}>
                  <small>{item.day === 'Zo' ? 'Zon' : item.day}</small>
                  <strong>{date}</strong>
                </span>
                {active
                  ? <span className="meal-copy hifi-meal-copy">
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
                          {price && <small className="hifi-meal-price">{price}</small>}
                        </span>
                      </span>
                    </span>
                  : <span className="meal-copy hifi-meal-empty">
                      <strong>Voeg nu iets toe aan de planner</strong>
                      <small>Kies een recept</small>
                    </span>}
                {active
                  ? <button
                      type="button"
                      className="hifi-meal-chevron"
                      aria-label={`${recipe.title} op ${weekday.toLowerCase()} aanpassen`}
                      aria-expanded={open}
                      aria-controls={`meal-edit-${item.day}`}
                      onClick={() => setOpenDay(open ? null : item.day)}
                    >
                      <svg viewBox="0 0 9 15" width="9" height="15" fill="none" aria-hidden="true"><path d="M1.5 1.5 7.5 7.5l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  : <button
                      type="button"
                      className="plan-check hifi-meal-add"
                      aria-label={`${item.day} aan planning toevoegen`}
                      onClick={() => onPickRecipe(item.day)}
                    >
                      +
                    </button>}
              </div>
              {open && <div className="hifi-meal-edit" id={`meal-edit-${item.day}`}>
                <label htmlFor={`recipe-${item.day}`}>Recept</label>
                <select
                  id={`recipe-${item.day}`}
                  value={item.recipeId}
                  onChange={(event) => onRecipeChange(item.day, event.target.value)}
                >
                  {recipes.map((option) => (
                    <option key={option.id} value={option.id}>{option.title}</option>
                  ))}
                </select>
                <button type="button" className="hifi-meal-remove"
                  onClick={() => { onToggleDay(item.day); setOpenDay(null) }}>
                  Uit planning halen
                </button>
              </div>}
            </article>
          )
        })}
      </div>

      <section className="budget-card hifi-planner-total" aria-labelledby="weekbudget-title">
        <div className="budget-summary hifi-total-row">
          <span>
            <strong className="hifi-total-label">Totaal</strong>
            <small>{activeMeals.length} {activeMeals.length === 1 ? 'maaltijd' : 'maaltijden'}</small>
          </span>
          <strong className="hifi-total-amount">
            {estimate === null ? 'Prijs onbekend' : euro.format(estimate)}
          </strong>
        </div>
        <hr className="hifi-total-divider" />
        <div className="budget-heading">
          <span>
            <span className="hifi-budget-label">Weekbudget</span>
            <small>Jouw voorkeur</small>
          </span>
          <strong id="weekbudget-title">{euro.format(budget)}</strong>
        </div>
        {estimate !== null && (
          <span className={estimate > budget ? 'budget-status warning' : 'budget-status'} aria-live="polite">
            {estimate > budget
              ? `${euro.format(estimate - budget)} boven budget`
              : `${euro.format(budget - estimate)} over`}
          </span>
        )}

        <details className="hifi-planner-calc">
          <summary>Bekijk berekening</summary>
          {activeMeals.length === 0
            ? <p className="hifi-calc-empty">Plan een maaltijd om je totaal te zien.</p>
            : <ul className="hifi-calc-list" aria-label="Berekening per maaltijd">
                {activeMeals.map(({ day, recipe, pp }) => (
                  <li key={day}>
                    <span>
                      <strong>{recipe.title}</strong>
                      <small>{pp === null ? 'Prijs onbekend' : `${euro.format(pp)} p.p. × ${recipe.servings} personen`}</small>
                    </span>
                    <b>{pp === null ? '—' : euro.format(pp * recipe.servings)}</b>
                  </li>
                ))}
                <li className="hifi-calc-sum">
                  <span><strong>Totaal</strong></span>
                  <b>{estimate === null ? '—' : euro.format(estimate)}</b>
                </li>
              </ul>}
          {estimate !== null && (
            <div className="budget-progress" role="progressbar" aria-label="Gepland deel van het weekbudget"
              aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(estimate, budget)}>
              <span style={{ width: `${Math.min(100, (estimate / budget) * 100)}%` }} />
            </div>
          )}

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
        </details>
      </section>

      {/* Figma Planner primary action under the total card. */}
      <button type="button" className="hifi-planner-list-cta" onClick={event => {
        flyToCart(event.currentTarget)
        window.setTimeout(onOpenShoppingList, 700)
      }}
        disabled={activeDays.length === 0}>
        Voeg planning toe aan boodschappenlijst
      </button>
    </section>
  )
}
