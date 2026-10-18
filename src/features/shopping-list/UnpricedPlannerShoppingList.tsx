import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import './unpricedPlannerShoppingList.css'

type Progress = { identity: string; done: string[] }
type Need = ReturnType<typeof aggregatePlanIngredients>[number]
const amounts = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 3 })
const validPhysicalAmount = (item: Need) =>
  typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0 &&
  (item.unit !== 'piece' || Number.isSafeInteger(item.amount))
const measurement = (item: Need): string =>
  validPhysicalAmount(item) ? amounts.format(item.amount!) + ' ' +
    (item.unit === 'piece' ? 'stuks' : item.unit) : 'hoeveelheid controleren'
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/gu, ' ').trim().slice(0, 160)

/**
 * Free planner-only checklist. No retailer capture, prices, matching, budgets,
 * inventory, cross-device sync or source permission implied. A tab change does
 * not discard checkmarks: App owns only an in-memory demand-bound progress key.
 */
export function UnpricedPlannerShoppingList({
  plan, recipes, activeDays, progress, setProgress, onOpenPlanner, onOpenCompare,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  progress: Progress
  setProgress: Dispatch<SetStateAction<Progress>>
  onOpenPlanner: () => void
  onOpenCompare: () => void
}) {
  const [message, setMessage] = useState('')
  const demand = useMemo(() => {
    try {
      const items = aggregatePlanIngredients(plan, recipes, activeDays)
      if (items.length > 1000) throw new Error('Te veel ingrediënten in deze planning.')
      return { items, error: '' }
    } catch {
      return { items: [] as Need[], error: 'De weekplanning bevat tegenstrijdige of onleesbare ingrediënten. Controleer eerst Planner.' }
    }
  }, [plan, recipes, activeDays])
  const identity = JSON.stringify([activeDays, demand.items.map(item =>
    [item.id, item.label, item.amount, item.unit])])
  const done = progress.identity === identity ? progress.done : []
  const validIds = new Set(demand.items.map(item => item.id))
  const completed = demand.items.filter(item => done.includes(item.id)).length
  const uncertain = demand.items.filter(item => !validPhysicalAmount(item)).length

  function toggle(id: string) {
    if (!validIds.has(id)) return
    setProgress(previous => {
      const existing = previous.identity === identity ? previous.done : []
      return { identity, done: existing.includes(id)
        ? existing.filter(item => item !== id) : [...existing, id] }
    })
  }
  function download() {
    if (!demand.items.length) return
    try {
      const lines = [
        'SUPA · MIJN WEEKBOODSCHAPPEN ZONDER WINKELPRIJZEN',
        'Dit komt uit jouw huidige actieve Planner-dagen.',
        'Geen retailerproductmatch, voorraadindicatie, prijs of besparingsclaim.',
        '',
        ...demand.items.map(item => (done.includes(item.id) ? '[x] ' : '[ ] ') +
          clean(item.label) + ' — ' + measurement(item)),
        '',
        completed + ' van ' + demand.items.length + ' afgevinkt.',
        uncertain ? uncertain + ' hoeveelheden moeten eerst handmatig worden gecontroleerd.' :
          'Hoeveelheden komen uitsluitend uit je eigen gekozen recepten.',
        'Controleer zelf producten en verpakkingen bij de winkel.',
        '',
      ]
      const file = lines.join('\n')
      if (new TextEncoder().encode(file).byteLength > 256000) {
        throw new Error('Het weekmenu is te groot voor een lokale tekstlijst.')
      }
      const uri = URL.createObjectURL(new Blob([file], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-mijn-weekboodschappen-zonder-prijzen.txt'
        document.body.appendChild(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setMessage('Je weekboodschappen zijn lokaal opgeslagen, zonder winkelprijzen.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'De lijst kon niet worden gedownload.')
    }
  }
  return <section className="supa-unpriced-weeklist"
    aria-label="Boodschappenlijst uit Planner zonder winkelprijzen">
    <header>
      <span className="eyebrow">Planner → ongeprijsde boodschappenlijst</span>
      <h2>Mijn weekboodschappen</h2>
      <p>Je kunt je geplande ingrediënten verzamelen en afvinken zonder
        een PLUS- of DekaMarkt-prijsbestand. Alle winkelprijzen en besparingen blijven onbekend.</p>
    </header>
    {demand.error ? <p role="alert">{demand.error}
      <button type="button" onClick={onOpenPlanner}>Open Planner</button></p>
      : demand.items.length === 0 ? <div className="supa-unpriced-weeklist__empty">
        <p>Er zijn nog geen ingrediënten uit actieve geplande maaltijden.
          Kies maaltijden in Planner om je lijst te vullen.</p>
        <button type="button" onClick={onOpenPlanner}>Kies mijn maaltijden</button>
      </div> : <>
        <div className="supa-unpriced-weeklist__summary">
          <strong>{completed} van {demand.items.length} afgevinkt</strong>
          <progress aria-label="Afgevinkte weekboodschappen" max={demand.items.length} value={completed} />
          {uncertain > 0 && <p role="status">{uncertain} benodigde hoeveelheden zijn onbekend of
            kunnen niet veilig als hele stuks worden berekend. Controleer deze recepten eerst.</p>}
        </div>
        <ul className="supa-unpriced-weeklist__items">
          {demand.items.map(item => <li key={item.id}>
            <label><input type="checkbox" checked={done.includes(item.id)}
              onChange={() => toggle(item.id)} />
              <span><strong>{item.label}</strong><small>{measurement(item)}</small></span>
            </label>
          </li>)}
        </ul>
        <div className="supa-unpriced-weeklist__actions">
          <button type="button" onClick={download}>Download mijn weeklijst (TXT)</button>
          <button type="button" disabled={completed === 0}
            onClick={() => setProgress({ identity, done: [] })}>Maak alle vinkjes leeg</button>
          <button type="button" onClick={onOpenCompare}>Zelf winkelprijzen toevoegen</button>
        </div>
        <small>Afvinken blijft alleen in deze open app bewaard. De lijst bevat geen winkelprijzen;
          een import van eigen geldige brongegevens is afzonderlijk nodig voor een vergelijking.</small>
      </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
