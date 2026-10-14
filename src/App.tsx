import { useEffect, useMemo, useState } from 'react'
import { PlannerView } from './features/planner/PlannerView'
import { currentWeekSharePreview, formatShareableWeek } from './features/planner/weekPlanShare'
import type { WeekSharePreview } from './features/planner/weekPlanShare'
import { BasketView } from './features/basket/BasketView'
import { ShoppingListView } from './features/shopping-list/ShoppingListView'
import { ObservationView } from './features/observation/ObservationView'
import { buildOneStoreBasket } from './domain/basket'
import { compareFullBaskets } from './domain/basketComparison'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from './domain/plannerPreferences'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from './data/m2Fixture'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from './data/m3ComparisonFixture'

type Tab = 'planner' | 'basket' | 'list' | 'observe'

const tabs: { id: Tab; label: string }[] = [
  { id: 'planner', label: 'Planner' },
  { id: 'basket', label: 'Mand' },
  { id: 'list', label: 'Lijst' },
  { id: 'observe', label: 'Meten' },
]

const plannerStorageKey = 'supa:planner-preferences:v2'
const validRecipeIds = m2Recipes.map((recipe) => recipe.id)

function readPlannerPreferences() {
  if (typeof window === 'undefined') {
    return defaultPlannerPreferences(m2InitialPlan)
  }

  try {
    return parsePlannerPreferences(
      window.localStorage.getItem(plannerStorageKey),
      m2InitialPlan,
      validRecipeIds,
    )
  } catch {
    return defaultPlannerPreferences(m2InitialPlan)
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('planner')
  const [preferences, setPreferences] = useState(readPlannerPreferences)
  const [manualWeekCopy, setManualWeekCopy] = useState<WeekSharePreview | null>(null)
  const [includeWeekBudget, setIncludeWeekBudget] = useState(false)
  const [includeWeekDetails, setIncludeWeekDetails] = useState(false)
  const [weekCopyMessage, setWeekCopyMessage] = useState('')
  const { budget, activeDays, recipeByDay } = preferences

  const plannedMeals = useMemo(
    () =>
      m2InitialPlan.map((meal) => ({
        ...meal,
        recipeId: recipeByDay[meal.day] ?? meal.recipeId,
      })),
    [recipeByDay],
  )

  // Bind prepared copy to the exact user-visible plan state. Clearing it in
  // an effect alone happens after render and briefly exposes stale personal text.
  const shareSourceKey = JSON.stringify([
    plannedMeals,
    activeDays,
    budget,
    includeWeekBudget,
    includeWeekDetails,
  ])
  const currentManualCopy = currentWeekSharePreview(manualWeekCopy, shareSourceKey)

  const basket = useMemo(
    () =>
      buildOneStoreBasket({
        store: m2Store,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m2Products,
      }),
    [activeDays, plannedMeals],
  )

  const comparisonBaseline = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3BaselineStore,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m3BaselineProducts,
      }),
    [activeDays, plannedMeals],
  )

  const comparisonCandidate = useMemo(
    () =>
      buildOneStoreBasket({
        store: m3CandidateStore,
        plan: plannedMeals,
        recipes: m2Recipes,
        activeDays,
        products: m3CandidateProducts,
      }),
    [activeDays, plannedMeals],
  )

  const basketComparison = useMemo(
    () =>
      compareFullBaskets({
        baseline: comparisonBaseline,
        candidate: comparisonCandidate,
      }),
    [comparisonBaseline, comparisonCandidate],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(
        plannerStorageKey,
        serializePlannerPreferences(preferences),
      )
    } catch {
      // Strict privacy modes can deny storage; the active session remains usable.
    }
  }, [preferences])

  useEffect(() => {
    // The export belongs to one exact plan snapshot; don't keep a stale draft
    // visible after the user changes the plan or budget.
    setManualWeekCopy(null)
    setWeekCopyMessage('')
  }, [preferences])

  const prepareWeekPlanCopy = () => {
    try {
      setManualWeekCopy({
        sourceKey: shareSourceKey,
        text: formatShareableWeek({
          plannedMeals,
          activeDays,
          recipes: m2Recipes,
          budget,
          includeBudget: includeWeekBudget,
          includeDetails: includeWeekDetails,
        }),
      })
      setWeekCopyMessage('Selecteer en kopieer de tekst hieronder')
    } catch {
      setManualWeekCopy(null)
      setWeekCopyMessage('Weekmenu niet beschikbaar')
    }
  }

  const toggleDay = (day: string) => {
    setPreferences((current) => ({
      ...current,
      activeDays: current.activeDays.includes(day)
        ? current.activeDays.filter((candidate) => candidate !== day)
        : [...current.activeDays, day],
    }))
  }

  const changeRecipe = (day: string, recipeId: string) => {
    setPreferences((current) => ({
      ...current,
      recipeByDay: {
        ...current.recipeByDay,
        [day]: recipeId,
      },
    }))
  }

  const resetPlan = () => {
    setPreferences(defaultPlannerPreferences(m2InitialPlan))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-mark">S</span>
          <strong>SUPA</strong>
        </div>
        <button className="avatar" aria-label="Profiel">ZE</button>
      </header>

      <div className="content">
        {tab === 'planner' && (
          <section className="week-share-panel" aria-label="Weekmenu delen">
            <div className="week-share-actions">
              <span>Deel je geplande maaltijden, zonder winkelprijzen.</span>
              <button type="button" className="ghost-button" onClick={prepareWeekPlanCopy}>
                Toon kopieertekst
              </button>
            </div>
            <label className="week-share-privacy">
              <input
                type="checkbox"
                checked={includeWeekBudget}
                onChange={(event) => {
                  setIncludeWeekBudget(event.target.checked)
                  setManualWeekCopy(null)
                  setWeekCopyMessage('')
                }}
              />
              Mijn weekbudget ook opnemen (optioneel)
            </label>
            <label className="week-share-privacy">
              <input
                type="checkbox"
                checked={includeWeekDetails}
                onChange={(event) => {
                  setIncludeWeekDetails(event.target.checked)
                  setManualWeekCopy(null)
                  setWeekCopyMessage('')
                }}
              />
              Bereidingstijd en porties opnemen
            </label>
            <p role="status" aria-live="polite">{weekCopyMessage}</p>
            {currentManualCopy !== null && (
              <div className="week-share-manual">
                <label htmlFor="week-share-text">Weekmenu om handmatig te kopiëren</label>
                <textarea
                  id="week-share-text"
                  readOnly
                  autoFocus
                  rows={Math.min(activeDays.length + 6, 14)}
                  value={currentManualCopy}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
            )}
          </section>
        )}
        {tab === 'planner' && (
          <PlannerView
            budget={budget}
            activeDays={activeDays}
            plannedMeals={plannedMeals}
            recipes={m2Recipes}
            basketTotalCents={basket.totalCents}
            basketUnresolvedLineCount={basket.unresolvedLineCount}
            onBudgetChange={(nextBudget) =>
              setPreferences((current) => ({
                ...current,
                budget: nextBudget,
              }))
            }
            onToggleDay={toggleDay}
            onRecipeChange={changeRecipe}
            onReset={resetPlan}
          />
        )}
        {tab === 'basket' && (
          <BasketView
            basket={basket}
            comparison={basketComparison}
            comparisonBaseline={comparisonBaseline}
            comparisonCandidate={comparisonCandidate}
          />
        )}
        {tab === 'list' && <ShoppingListView basket={basket} />}
        {tab === 'observe' && <ObservationView />}
      </div>

      <nav className="bottom-nav" aria-label="Hoofdnavigatie">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  )
}
