import { useMemo, useRef, useState } from 'react'
import type { SavedRecipe } from './recipeLibrary.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'
import './recipeWeekCookingMode.css'

export type CookingDay = {
  day: string
  recipeId: string
  recipeSnapshot: string
}

/** Active, device-only cooking companion for the verified recipe selection.
 * Shopping prices, source permissions and saved Planner are never touched. */
export function RecipeWeekCookingMode({
  assignments, recipes, days,
}: {
  assignments: readonly CookingDay[]
  recipes: readonly SavedRecipe[]
  days: readonly string[]
}) {
  const byId = useMemo(() => new Map(recipes.map(recipe => [recipe.id, recipe])), [recipes])
  const slots = useMemo(() => days.map(day => {
    const assignment = assignments.find(row => row.day === day)
    const recipe = assignment && byId.get(assignment.recipeId)
    return {
      day, assignment, recipe: recipe && assignment &&
        JSON.stringify(recipe) === assignment.recipeSnapshot ? recipe : null,
    }
  }), [assignments, byId, days])
  const weekIdentity = JSON.stringify(assignments.map(row =>
    [row.day, row.recipeId, row.recipeSnapshot]))
  const latestWeekIdentity = useRef(weekIdentity)
  latestWeekIdentity.current = weekIdentity
  const [activeDay, setActiveDay] = useState(days[0] ?? '')
  const current = slots.find(slot => slot.day === activeDay) ?? slots[0]
  const selected = current?.recipe
  const [finishedSteps, setFinishedSteps] = useState<Record<string, number[]>>({})
  const [prepared, setPrepared] = useState<Record<string, string[]>>({})
  const [message, setMessage] = useState('')
  const progressIdentity = JSON.stringify([finishedSteps, prepared])
  const latestProgressIdentity = useRef(progressIdentity)
  latestProgressIdentity.current = progressIdentity
  const snapshot = selected ? JSON.stringify([current.day, selected]) : ''
  const doneSteps = new Set(finishedSteps[snapshot] ?? [])
  const doneIngredients = new Set(prepared[snapshot] ?? [])
  const ingredients = selected && selected.servings !== null
    ? ownRecipeShoppingChecklist(selected, selected.servings)
    : null
  const steps = selected?.steps ?? []
  // A recipe whose canonical physical ingredients require review must not be
  // rendered as an approved cooking/shopping measurement.
  const safe = !!selected && !!ingredients?.canCopy &&
    !ingredients.lines.some(line => line.needsReview || line.amount === null ||
      !Number.isFinite(line.amount) || line.amount <= 0) &&
    steps.length > 0 && steps.every(step => typeof step === 'string' && step.trim().length > 0)
  const stepCount = safe ? steps.length : 0
  const completed = stepCount > 0 && doneSteps.size === stepCount
  const toggleStep = (index: number, checked: boolean) => setFinishedSteps(previous => ({
    ...previous, [snapshot]: checked
      ? [...new Set([...(previous[snapshot] ?? []), index])]
      : (previous[snapshot] ?? []).filter(value => value !== index),
  }))
  const toggleIngredient = (key: string, checked: boolean) => setPrepared(previous => ({
    ...previous, [snapshot]: checked
      ? [...new Set([...(previous[snapshot] ?? []), key])]
      : (previous[snapshot] ?? []).filter(value => value !== key),
  }))
  async function downloadCookingProgress() {
    const expected = weekIdentity
    const expectedProgress = progressIdentity
    try {
      const { exportRecipeCookingProgress } =
        await import('./recipeCookingProgress.ts')
      if (latestWeekIdentity.current !== expected ||
          latestProgressIdentity.current !== expectedProgress)
        throw Error('Je weekmenu of kookafvinkingen zijn tijdens de download gewijzigd. Download opnieuw.')
      const json = exportRecipeCookingProgress(assignments, recipes, finishedSteps, prepared)
      if (latestWeekIdentity.current !== expected ||
          latestProgressIdentity.current !== expectedProgress)
        throw Error('Je kookafvinkingen zijn veranderd. Download de actuele voortgang opnieuw.')
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-prive-kookvoortgang.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Je afgevinkte kookstappen en voorbereidingen zijn lokaal opgeslagen in een privébestand.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message :
        'Kon de huidige kookvoortgang niet veilig bewaren.')
    }
  }
  async function importCookingProgress(file: File | null) {
    if (!file) return
    const expected = weekIdentity
    try {
      const { cookingProgressLimit, restoreRecipeCookingProgress } =
        await import('./recipeCookingProgress.ts')
      if (file.size < 1 || file.size > cookingProgressLimit)
        throw Error('Kies een privé-kookvoortgangbestand van maximaal 256 kB.')
      const text = await file.text()
      if (latestWeekIdentity.current !== expected)
        throw Error('De recepten of weekdagen veranderden tijdens het openen.')
      const restored = restoreRecipeCookingProgress(text, assignments, recipes)
      if (!window.confirm('Vervang alle tijdelijke kookafvinkingen van deze exacte receptenweek ' +
        'met de voortgang uit dit privébestand? Je Planner, boodschappenlijst en winkelprijzen blijven ongemoeid.')) return
      if (latestWeekIdentity.current !== expected)
        throw Error('Het weekmenu is ondertussen gewijzigd; niets hersteld.')
      setFinishedSteps(restored.finishedSteps)
      setPrepared(restored.prepared)
      setMessage('De kookvoortgang is hersteld voor exact deze eigen receptenweek.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message :
        'Het kookvoortgangbestand is geweigerd. Je vinkjes zijn behouden.')
    }
  }
  const nextStep = steps.findIndex((_, index) => !doneSteps.has(index))
  return <section className="recipe-week-cooking" aria-label="Kookmodus voor mijn gekozen weekrecepten">
    <h4>Kookmodus · mijn weekrecepten</h4>
    <p>Gebruik je eigen gecontroleerde recepten tijdens het koken. Bereidingsstappen en
      ingrediënten kun je tijdelijk afvinken. Dit wordt niet naar je Planner,
      boodschappenlijst of een winkel gestuurd en verdwijnt bij opnieuw laden.</p>
    <div className="recipe-week-cooking__days" role="group" aria-label="Kies kookdag">
      {slots.map(slot => <button key={slot.day} type="button"
        aria-pressed={current.day === slot.day}
        className={current.day === slot.day ? 'active' : ''}
        onClick={() => setActiveDay(slot.day)}>
        {slot.day}
      </button>)}
    </div>
    {!current.assignment ? <p role="status">Voor {current.day} staat nog geen recept gepland.</p> :
      !selected ? <p role="alert">Dit recept is tussentijds gewijzigd. Heropen je receptenbundel.</p> :
      !safe ? <p role="alert">Controleer de originele ingrediënten en bereidingsstappen
        voordat je dit recept in de kookmodus gebruikt.</p> :
      <div className="recipe-week-cooking__detail">
        <div className="recipe-week-cooking__intro">
          <h5>{selected.title}</h5>
          <p>{selected.servings} porties · {selected.minutes ?? 'onbekend'} minuten</p>
          <span role="status">{doneSteps.size} van {stepCount} stappen afgevinkt
            {completed ? ' · Klaar met de bereidingsstappen' : ''}</span>
        </div>
        <details open>
          <summary>Ingrediënten voorbereiden · {doneIngredients.size} van {ingredients!.lines.length}</summary>
          <ul>{ingredients!.lines.map(line => <li key={line.key}>
            <label>
              <input type="checkbox" checked={doneIngredients.has(line.key)}
                onChange={event => toggleIngredient(line.key, event.currentTarget.checked)} />
              {line.amount} {line.unit === 'piece' ? 'stuks' : line.unit} {line.label}
            </label>
          </li>)}</ul>
          <small>Dit zijn hoeveelheden per recept, geen extra winkelmandje.
            Alleen de gezamenlijke weeklijst telt dezelfde ingrediënten bij elkaar op.</small>
        </details>
        <h5>Bereiding</h5>
        <ol className="recipe-week-cooking__steps">
          {steps.map((step, index) => <li key={index}
            className={doneSteps.has(index) ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={doneSteps.has(index)}
                aria-label={'Stap ' + (index + 1) + ' afronden voor ' + selected.title}
                onChange={event => toggleStep(index, event.currentTarget.checked)} />
              <span><strong>Stap {index + 1}</strong>{' '}{step}</span>
            </label>
          </li>)}
        </ol>
        <div className="recipe-week-cooking__actions">
          <button type="button" disabled={nextStep < 0}
            onClick={() => toggleStep(nextStep, true)}>
            {nextStep < 0 ? 'Alle stappen klaar' : 'Markeer stap ' + (nextStep + 1) + ' klaar'}
          </button>
          <button type="button" className="ghost-button"
            disabled={!doneSteps.size && !doneIngredients.size}
            onClick={() => {
              setFinishedSteps(previous => ({ ...previous, [snapshot]: [] }))
              setPrepared(previous => ({ ...previous, [snapshot]: [] }))
            }}>Herstart dit recept</button>
        </div>
      </div>}
    <div className="recipe-week-cooking__backup">
      <strong>Kookvoortgang privé bewaren</strong>
      <p>Download je huidige afvinkingen als JSON. Herstellen kan alleen bij exact dezelfde
        recepten en weekdagen. Er worden geen winkelprijzen of persoonlijke gegevens verstuurd.</p>
      <button type="button" onClick={() => void downloadCookingProgress()}>
        Download kookvoortgang (JSON)
      </button>
      <label>Herstel kookvoortgang (JSON)
        <input type="file" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ''
          void importCookingProgress(file)
        }} />
      </label>
      {message && <p role="status">{message}</p>}
    </div>
    <small>Een kookstap afvinken is geen bewijs dat een winkelproduct is gekocht,
      beschikbaar of geprijsd. Weekmenu en bronprijzen blijven ongewijzigd.</small>
  </section>
}
